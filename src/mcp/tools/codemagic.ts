import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, GateError, type Ctx, type ToolDef } from "../context.js";
import { requireCheckPassed, requireConnected } from "../gates.js";
import { nowIso } from "../../state/store.js";
import type { Build, State } from "../../state/schema.js";
import { Codemagic, TERMINAL, buildPageUrl, mapStatus, normalizeRepo, toArtifacts } from "../../services/codemagic.js";
import { codemagicYaml, WF, YAML_MARKER } from "../../services/codemagic-yaml.js";
import { GitHub, generateDeployKey, parseGithubRemote } from "../../services/github.js";
import { Git } from "../../lib/git.js";
import { HttpError, sleep } from "../../lib/http.js";
import { ensureIosCertificateKey, ensureUploadKey, patchGradleSigning } from "../../services/signing.js";
import { AppStoreConnect } from "../../services/appstore.js";
import { GROUPS } from "../../services/codemagic-yaml.js";

function cm(ctx: Ctx): Codemagic {
  const s = ctx.secrets.get("codemagic");
  if (!s) throw new GateError("Codemagic is not connected.", "Call setup_link(service='codemagic').");
  return new Codemagic(s.token);
}

const cmConnectStatus = defineTool({
  name: "cm_connect_status",
  title: "Codemagic connection status",
  description: "Checks whether Codemagic is connected and working, and which Codemagic app this project is linked to. If not connected, returns the link the user must open.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const s = ctx.store.read();
    if (!ctx.secrets.has("codemagic")) {
      const link = await ctx.ui.link("/connect/codemagic").catch(() => undefined);
      return { connected: false, link, next_step: link ? `Ask the user to open ${link} to connect Codemagic.` : "Run `npx prompt-to-store ui`." };
    }
    const client = cm(ctx);
    const user = await client.user();
    const appId = s.connections.codemagic.details.appId;
    return {
      connected: true,
      user_id: user.id,
      app: appId ? { id: appId, name: s.connections.codemagic.details.appName, url: `https://codemagic.io/app/${appId}` } : null,
      next_step: appId ? "Ready to ship." : "The Codemagic app is created automatically on the first ship_test_build.",
    };
  },
});

interface PrepResult {
  repoTop: string;
  workingDirectory: string;
  branch: string;
  remoteUrl: string;
  commit?: string;
  appId: string;
  appName: string;
  steps: string[];
}

/** Make sure codemagic.yaml exists, code is committed and pushed, and a Codemagic app exists. */
async function prepareRepo(ctx: Ctx, s: State, opts: { commit: boolean; dryRun: boolean; repositoryUrl?: string }): Promise<PrepResult> {
  const steps: string[] = [];
  const git = new Git(ctx.root);
  if (!opts.dryRun && (await git.ensureRepo())) steps.push("Initialized a git repository");
  const repoTop = (await git.toplevel()) ?? ctx.root;
  const workingDirectory = path.relative(repoTop, ctx.root).split(path.sep).join("/");

  // codemagic.yaml at the repository root
  const yamlPath = path.join(repoTop, "codemagic.yaml");
  const yaml = codemagicYaml({ bundleId: s.project.bundleId, emails: s.project.testerEmails, workingDirectory });
  if (!fs.existsSync(yamlPath)) {
    if (!opts.dryRun) fs.writeFileSync(yamlPath, yaml);
    steps.push("Wrote codemagic.yaml");
  } else if (fs.readFileSync(yamlPath, "utf8").startsWith(YAML_MARKER) && fs.readFileSync(yamlPath, "utf8") !== yaml) {
    if (!opts.dryRun) fs.writeFileSync(yamlPath, yaml);
    steps.push("Updated codemagic.yaml (tester emails / bundle id)");
  } else if (!fs.readFileSync(yamlPath, "utf8").includes(WF.androidTest)) {
    throw new GateError(
      "codemagic.yaml exists but has no prompt-to-store workflows.",
      `Add the '${WF.androidTest}' workflow to codemagic.yaml (see templates/codemagic.yaml in the prompt-to-store package) or delete the file so it can be generated.`,
    );
  }

  let commit: string | undefined;
  if (opts.commit && !opts.dryRun) {
    commit = await git.commitAll(`prompt-to-store: ${s.project.displayName || "app"} build`);
    if (commit) steps.push(`Committed changes (${commit.slice(0, 7)})`);
  } else if (!opts.dryRun && (await git.isDirty())) {
    steps.push("Warning: uncommitted changes are not included in the build (commit=false)");
  }
  const branch = await git.branch();

  // Remote
  let remoteUrl = opts.repositoryUrl ?? (await git.remoteUrl());
  const gh = ctx.secrets.get("github");
  if (!remoteUrl) {
    if (!gh || !s.connections.github.connected) {
      const link = await ctx.ui.link("/connect/github").catch(() => undefined);
      throw new GateError(
        "This project has no git remote, and Codemagic builds from a git repository.",
        `Ask the user to connect GitHub${link ? ` at ${link}` : ""} so a private repository can be created automatically — or add a remote yourself (git remote add origin <url>) and call ship_test_build again.`,
        link,
      );
    }
    const client = new GitHub(gh.token);
    const me = await client.user();
    const name = s.project.name.replace(/_/g, "-") || path.basename(repoTop);
    let repo = await client.getRepo(me.login, name);
    if (!repo) {
      if (opts.dryRun) {
        steps.push(`Would create private GitHub repo ${me.login}/${name}`);
        remoteUrl = `https://github.com/${me.login}/${name}.git`;
      } else {
        repo = await client.createRepo(name, `${s.project.displayName} — built with prompt-to-store`, true);
        steps.push(`Created private GitHub repo ${repo.full_name}`);
      }
    }
    if (repo) {
      remoteUrl = repo.clone_url;
      if (!opts.dryRun) await git.exec(["remote", "add", "origin", remoteUrl]);
    }
  }
  if (!remoteUrl) throw new Error("No remote URL");
  const ghRemote = parseGithubRemote(remoteUrl);

  // Push
  if (!opts.dryRun && !opts.repositoryUrl) {
    await git.push("origin", branch, ghRemote && gh ? gh.token : undefined);
    steps.push(`Pushed ${branch} to ${ghRemote ? `${ghRemote.owner}/${ghRemote.repo}` : remoteUrl}`);
  }

  // Codemagic app
  const client = cm(ctx);
  let appId: string | undefined = s.connections.codemagic.details.appId;
  let appName = s.connections.codemagic.details.appName ?? "";
  if (appId && s.connections.codemagic.details.repo !== normalizeRepo(remoteUrl)) appId = undefined;
  if (!appId) {
    const existing = await client.findAppByRepo(remoteUrl);
    if (existing) {
      appId = existing._id;
      appName = existing.appName;
      steps.push(`Linked existing Codemagic app ${appName}`);
    } else if (opts.dryRun) {
      steps.push("Would add the repository to Codemagic");
      appId = "(new)";
    } else {
      let added: { id: string; name: string } | undefined;
      let firstErr: unknown;
      try {
        added = await client.addApp(remoteUrl.replace(/^https:\/\/[^@/]+@/, "https://"));
      } catch (e) {
        firstErr = e;
      }
      if (!added && ghRemote && gh) {
        // Private repo without Codemagic's GitHub integration: read-only deploy key.
        const key = generateDeployKey(`prompt-to-store codemagic ${s.project.bundleId}`);
        await new GitHub(gh.token).addDeployKey(ghRemote.owner, ghRemote.repo, "Codemagic (prompt-to-store)", key.publicKeyOpenSsh);
        added = await client.addAppWithSshKey(`git@github.com:${ghRemote.owner}/${ghRemote.repo}.git`, key.privateKeyPem);
        steps.push("Added a read-only deploy key so Codemagic can clone the private repository");
      }
      if (!added) {
        const detail = firstErr instanceof HttpError ? firstErr.body.slice(0, 300) : String(firstErr);
        throw new GateError(
          `Codemagic could not access the repository (${detail}).`,
          "Either connect GitHub in the local UI (setup_link service='github') so a deploy key can be added automatically, or add the repository in Codemagic once (codemagic.io → Add application) and call ship_test_build again.",
        );
      }
      appId = added.id;
      appName = added.name;
      steps.push(`Added ${appName} to Codemagic`);
    }
    if (!opts.dryRun) {
      const repoKey = normalizeRepo(remoteUrl);
      ctx.store.update((st) => {
        st.connections.codemagic.details = { ...st.connections.codemagic.details, appId: appId!, appName, repo: repoKey };
      });
    }
  }
  return { repoTop, workingDirectory, branch, remoteUrl, commit, appId: appId!, appName, steps };
}

const shipTestBuild = defineTool({
  name: "ship_test_build",
  title: "Ship a test build via Codemagic",
  description:
    "Builds an installable test version in the cloud with Codemagic — no store accounts needed. Android: an APK the user installs on their phone via a link/QR code (and email if tester_emails were set in plan_save). iOS: a Simulator build (a real-iPhone build needs an Apple account → TestFlight via ship_release_build). Automatically writes codemagic.yaml, commits and pushes the code, and creates the Codemagic app. Requires a passing check_run and a connected Codemagic account. Returns build ids; then poll build_status.",
  input: {
    platform: z.enum(["android", "ios", "both"]).default("android"),
    commit: z.boolean().default(true).describe("Commit all changes before building (builds use the pushed code)"),
    repository_url: z.string().optional().describe("Advanced: use this clone URL instead of the origin remote (no push is done)"),
  },
  supportsDryRun: true,
  async gate(ctx, _a, s) {
    requireCheckPassed(ctx, s);
    await requireConnected(ctx, s, "codemagic");
  },
  async run(ctx, a) {
    const s = ctx.store.read();
    const dry = !!a.dry_run;
    if (!dry) ctx.store.setStage("ship", "in_progress", "Preparing repository");
    let prep: PrepResult;
    try {
      prep = await prepareRepo(ctx, s, { commit: a.commit, dryRun: dry, repositoryUrl: a.repository_url });
    } catch (e) {
      if (!dry) ctx.store.setStage("ship", "failed", (e as Error).message.slice(0, 200));
      throw e;
    }
    const workflows: { wf: string; platform: Build["platform"] }[] = [];
    if (a.platform !== "ios") workflows.push({ wf: WF.androidTest, platform: "android" });
    if (a.platform !== "android") workflows.push({ wf: WF.iosSimulator, platform: "ios" });
    if (dry) {
      return { dry_run: true, would: [...prep.steps, ...workflows.map((w) => `Start Codemagic workflow ${w.wf} on ${prep.branch}`)] };
    }
    const client = cm(ctx);
    const started: Build[] = [];
    for (const w of workflows) {
      const id = await client.startBuild(prep.appId, w.wf, prep.branch, {}, ["prompt-to-store"]);
      started.push({
        id,
        provider: "codemagic",
        workflow: w.wf,
        platform: w.platform,
        kind: "test",
        status: "queued",
        startedAt: nowIso(),
        url: buildPageUrl(prep.appId, id),
        artifacts: [],
      });
    }
    ctx.store.update((st) => {
      st.builds.push(...started);
      st.stages.ship = { status: "in_progress", updatedAt: nowIso(), note: `Building on Codemagic (${started.map((b) => b.platform).join(", ")})` };
      st.log.push({ at: nowIso(), level: "info", source: "ship", message: `Started ${started.map((b) => `${b.workflow} (${b.id})`).join(", ")}` });
    });
    return {
      started: started.map((b) => ({ build_id: b.id, platform: b.platform, url: b.url })),
      steps: prep.steps,
      next_step: "Builds take ~5–15 minutes. Call build_status(wait_seconds=300) to wait; tell the user they can watch progress in the local UI.",
    };
  },
});

async function refreshBuild(ctx: Ctx, client: Codemagic, b: Build): Promise<Build> {
  const remote = await client.getBuild(b.id);
  const status = mapStatus(remote.status);
  let artifacts = toArtifacts(remote);
  if (status === "finished") {
    const prev = new Map(b.artifacts.map((x) => [x.name, x.publicUrl]));
    artifacts = await Promise.all(
      artifacts.map(async (art) => {
        if (prev.get(art.name)) return { ...art, publicUrl: prev.get(art.name) };
        if (!/\.(apk|aab|zip|ipa)$/i.test(art.name)) return art;
        const pub = await client.publicUrl(art.url).catch(() => undefined);
        return { ...art, publicUrl: pub };
      }),
    );
  }
  const updated: Build = { ...b, status, artifacts, finishedAt: TERMINAL.includes(status) ? (remote.finished_at ?? nowIso()) : undefined };
  ctx.store.update((st) => {
    const i = st.builds.findIndex((x) => x.id === b.id);
    if (i >= 0) {
      const changed = st.builds[i].status !== status;
      st.builds[i] = updated;
      if (changed) {
        st.log.push({
          at: nowIso(),
          level: status === "finished" ? "success" : TERMINAL.includes(status) ? "error" : "info",
          source: "build",
          message: `${b.platform} build ${b.id}: ${status}`,
        });
      }
    }
    const active = st.builds.filter((x) => x.kind === "test" && !TERMINAL.includes(x.status));
    if (!active.length && changedToTerminal(b, status)) {
      const ok = st.builds.filter((x) => x.kind === "test").slice(-2).some((x) => x.status === "finished");
      st.stages.ship = { status: ok ? "done" : "failed", updatedAt: nowIso(), note: ok ? "Test build ready" : `Build ${status}` };
    }
  });
  return updated;
}

function changedToTerminal(b: Build, status: Build["status"]) {
  return TERMINAL.includes(status) && !TERMINAL.includes(b.status);
}

const buildStatus = defineTool({
  name: "build_status",
  title: "Build status (and wait)",
  description:
    "Gets the status of Codemagic builds (default: the latest ones still running, or the last build). With wait_seconds it polls until the build finishes or the time runs out. When finished, returns install links (also shown as a QR code in the local UI) — give them to the user. On failure, call build_logs.",
  input: {
    build_id: z.string().optional(),
    wait_seconds: z.number().int().min(0).max(600).default(0),
  },
  async run(ctx, a) {
    const client = cm(ctx);
    const deadline = Date.now() + a.wait_seconds * 1000;
    let st = ctx.store.read();
    const pick = () => {
      if (a.build_id) return st.builds.filter((b) => b.id === a.build_id);
      const running = st.builds.filter((b) => !TERMINAL.includes(b.status));
      return running.length ? running : st.builds.slice(-1);
    };
    let targets = pick();
    if (!targets.length) {
      if (a.build_id) {
        // A build not started by us: still report it.
        const r = await client.getBuild(a.build_id);
        return { build_id: r.id, status: r.status, artifacts: toArtifacts(r) };
      }
      return { message: "No builds yet. Call ship_test_build." };
    }
    let results: Build[] = [];
    for (;;) {
      results = [];
      for (const b of targets) results.push(TERMINAL.includes(b.status) && b.artifacts.length ? b : await refreshBuild(ctx, client, b));
      if (results.every((b) => TERMINAL.includes(b.status)) || Date.now() >= deadline) break;
      await sleep(Math.min(15_000, Math.max(1000, deadline - Date.now())));
      st = ctx.store.read();
      targets = results;
    }
    const uiLink = await ctx.ui.link("/builds").catch(() => undefined);
    return {
      builds: results.map((b) => ({
        build_id: b.id,
        platform: b.platform,
        workflow: b.workflow,
        status: b.status,
        codemagic_url: b.url,
        install_links: b.artifacts.filter((x) => x.publicUrl).map((x) => ({ file: x.name, url: x.publicUrl })),
      })),
      ui: uiLink,
      next_step: results.some((b) => !TERMINAL.includes(b.status))
        ? "Still building. Call build_status(wait_seconds=300) again."
        : results.some((b) => b.status !== "finished")
          ? "A build failed. Call build_logs(build_id) to see why, fix it, run check_run, then ship_test_build again."
          : `Done! Give the user the install link${uiLink ? ` and the QR code at ${uiLink}` : ""}. Android: open the link on the phone and allow installing from the browser. iOS simulator builds are for the Simulator only.`,
    };
  },
});

const shipReleaseBuild = defineTool({
  name: "ship_release_build",
  title: "Release build for the stores (AAB / TestFlight)",
  description:
    "Builds a store-ready release on Codemagic. android: a signed AAB for Google Play — the first time, an upload key is generated locally (backed up in .prompt-to-store/keys/, gitignored), android/app/build.gradle is patched to use it, and the key is stored in a secure Codemagic variable group. ios: a signed IPA uploaded to TestFlight — needs App Store Connect connected and the app record created once in App Store Connect; certificates and profiles are created automatically. Requires a passing check_run and a successful test build. Then poll build_status; publish with play_publish / asc_submit_review.",
  input: {
    platform: z.enum(["android", "ios"]),
    commit: z.boolean().default(true),
  },
  supportsDryRun: true,
  async gate(ctx, a, s) {
    requireCheckPassed(ctx, s);
    await requireConnected(ctx, s, "codemagic");
    if (a.platform === "ios") await requireConnected(ctx, s, "appstore");
    if (!s.builds.some((b) => b.kind === "test" && b.status === "finished")) {
      throw new GateError("Ship a successful test build first.", "Call ship_test_build and confirm the app works on the user's phone.");
    }
  },
  async run(ctx, a) {
    const s = ctx.store.read();
    const dry = !!a.dry_run;
    const steps: string[] = [];
    const vars: Record<string, string> = {};
    let ascAppId: string | undefined;
    if (a.platform === "android") {
      if (!dry) {
        const { key, created } = ensureUploadKey(ctx.store.p.dir, s.project.displayName || s.project.bundleId);
        if (created) steps.push(`Generated an Android upload key (SHA-256 ${key.sha256}); backup in .prompt-to-store/keys/ — keep a copy somewhere safe`);
        const patched = patchGradleSigning(ctx.root);
        if (patched.changed) steps.push(`Patched ${path.relative(ctx.root, patched.file)} to sign releases with android/key.properties`);
        vars.P2S_KEYSTORE_B64 = key.p12Base64;
        vars.P2S_KEYSTORE_PASSWORD = key.password;
        vars.P2S_KEY_ALIAS = key.alias;
      } else steps.push("Would generate/reuse the upload key, patch Gradle signing and store it in Codemagic");
    } else {
      const f = ctx.secrets.get("appstore")!;
      const asc = new AppStoreConnect({ issuerId: f.issuerId, keyId: f.keyId, privateKey: f.privateKey });
      const app = await asc.findAppByBundleId(s.project.bundleId);
      if (!app) {
        throw new GateError(
          `No App Store Connect app with bundle id ${s.project.bundleId}.`,
          `Ask the user to create it once: App Store Connect → Apps → + → New App → bundle id ${s.project.bundleId} (register it under Certificates, Identifiers & Profiles → Identifiers if it is not listed). Then call ship_release_build again.`,
        );
      }
      ascAppId = app.id;
      if (!dry) {
        vars.APP_STORE_CONNECT_ISSUER_ID = f.issuerId;
        vars.APP_STORE_CONNECT_KEY_IDENTIFIER = f.keyId;
        vars.APP_STORE_CONNECT_PRIVATE_KEY = f.privateKey;
        vars.CERTIFICATE_PRIVATE_KEY = ensureIosCertificateKey(ctx.store.p.dir);
        vars.APP_STORE_APP_ID = app.id;
      } else steps.push(`Would store App Store Connect credentials in Codemagic for app ${app.name} (${app.id})`);
    }
    const prep = await prepareRepo(ctx, s, { commit: a.commit, dryRun: dry });
    steps.push(...prep.steps);
    const wf = a.platform === "android" ? WF.androidRelease : WF.iosRelease;
    if (dry) return { dry_run: true, would: [...steps, `Start Codemagic workflow ${wf} on ${prep.branch}`] };
    const client = cm(ctx);
    await client.putVariableGroup(prep.appId, a.platform === "android" ? GROUPS.androidSigning : GROUPS.appStore, vars);
    steps.push(`Stored signing credentials in the Codemagic variable group ${a.platform === "android" ? GROUPS.androidSigning : GROUPS.appStore} (secure)`);
    const id = await client.startBuild(prep.appId, wf, prep.branch, ascAppId ? { APP_STORE_APP_ID: ascAppId } : {}, ["prompt-to-store", "release"]);
    const b: Build = { id, provider: "codemagic", workflow: wf, platform: a.platform, kind: "release", status: "queued", startedAt: nowIso(), url: buildPageUrl(prep.appId, id), artifacts: [] };
    ctx.store.update((st) => {
      st.builds.push(b);
      st.stages.store = { status: "in_progress", updatedAt: nowIso(), note: `Release build (${a.platform})` };
      st.log.push({ at: nowIso(), level: "info", source: "ship", message: `Started release build ${wf} (${id})` });
    });
    return {
      build_id: id,
      url: b.url,
      steps,
      next_step:
        a.platform === "android"
          ? "Poll build_status(wait_seconds=300). When finished: if this app has never been uploaded to Google Play, the user must upload this first AAB manually in Play Console (Internal testing → Create release); after that use play_publish."
          : "Poll build_status(wait_seconds=300). When finished the build appears in TestFlight after Apple processing (asc_testflight_status).",
    };
  },
});

const buildLogs = defineTool({
  name: "build_logs",
  title: "Build logs (why did it fail?)",
  description: "Returns the steps of a Codemagic build with their status, the failing step's script, and the tail of any log artifacts — use it to diagnose a failed build (see the doctor skill / rejections.md for known fixes).",
  input: { build_id: z.string().optional() },
  readOnly: true,
  async run(ctx, a) {
    const client = cm(ctx);
    const st = ctx.store.read();
    const id = a.build_id ?? st.builds.at(-1)?.id;
    if (!id) return { message: "No builds yet." };
    const [build, actions] = await Promise.all([client.getBuild(id), client.buildActions(id)]);
    const failed = actions.filter((x) => x.status === "failed");
    const logs: { name: string; tail: string }[] = [];
    for (const art of build.artifacts ?? []) {
      if (art.type === "log" || /\.log$/.test(art.name)) {
        const url = art.short_lived_download_url ?? art.url;
        if (!url) continue;
        const text = await client.downloadText(url).catch(() => "");
        if (text) logs.push({ name: art.name, tail: text.split(/\r?\n/).slice(-80).join("\n") });
      }
    }
    return {
      build_id: id,
      status: build.status,
      codemagic_url: buildPageUrl(build.app_id, id),
      steps: actions.map((x) => ({ name: x.name, status: x.status })),
      failed_steps: failed.map((x) => ({ name: x.name, script: x.script })),
      log_artifacts: logs,
      hint: failed.length
        ? "Reproduce the failing step locally if possible (e.g. flutter build apk --release), fix, check_run, then ship again. Full logs are on the Codemagic page."
        : undefined,
    };
  },
});

const buildCancel = defineTool({
  name: "build_cancel",
  title: "Cancel a build",
  description: "Cancels a running Codemagic build.",
  input: { build_id: z.string() },
  async run(ctx, a) {
    await cm(ctx).cancelBuild(a.build_id);
    ctx.store.update((st) => {
      const b = st.builds.find((x) => x.id === a.build_id);
      if (b) b.status = "canceled";
      st.log.push({ at: nowIso(), level: "warn", source: "build", message: `Canceled build ${a.build_id}` });
    });
    return { canceled: a.build_id };
  },
});

export const codemagicTools: ToolDef<any>[] = [cmConnectStatus, shipTestBuild, shipReleaseBuild, buildStatus, buildLogs, buildCancel];
export { prepareRepo, refreshBuild, cm };

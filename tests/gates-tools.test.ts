import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { setFetch } from "../src/lib/http.js";
import { StateStore } from "../src/state/store.js";
import { createCtx, invokeTool, type Ctx, type UiHandle } from "../src/mcp/context.js";
import { allTools } from "../src/mcp/tools/index.js";
import { codemagicYaml, YAML_MARKER } from "../src/services/codemagic-yaml.js";

process.env.P2S_SECRETS_BACKEND = "file";

const ui: UiHandle = {
  async ensure() {
    return { baseUrl: "http://127.0.0.1:1", token: "t" };
  },
  async link(p: string) {
    return `http://127.0.0.1:1${p}`;
  },
};
const tool = (n: string) => {
  const t = allTools().find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const call = async (ctx: Ctx, name: string, input: Record<string, unknown> = {}) => {
  const r = await invokeTool(ctx, tool(name), input);
  return { isError: !!r.isError, json: JSON.parse(r.content[0].text) as any };
};

interface Req {
  method: string;
  url: string;
  body?: any;
}
function mockHttp(routes: Record<string, unknown | ((r: Req) => unknown)>) {
  const calls: Req[] = [];
  setFetch((async (url: any, init: any) => {
    const raw = init?.body;
    const req: Req = { method: init?.method ?? "GET", url: String(url), body: typeof raw === "string" ? JSON.parse(raw) : raw };
    calls.push(req);
    const hit = routes[`${req.method} ${req.url}`];
    if (hit === undefined) return new Response(JSON.stringify({ error: `unmocked ${req.method} ${req.url}` }), { status: 418 });
    return new Response(JSON.stringify(typeof hit === "function" ? (hit as any)(req) : hit), { status: 200 });
  }) as typeof fetch);
  return calls;
}

const PLAN = {
  app_name: "Habit Streaks",
  package_name: "habit_streaks",
  bundle_id: "com.example.habitstreaks",
  summary: "Track daily habits and keep your streak going.",
  screens: [
    { name: "Home", purpose: "List of habits" },
    { name: "Detail", purpose: "Habit history" },
  ],
  decisions: ["Riverpod", "Hive storage"],
};

let tmp: string;
let ctx: Ctx;
beforeEach(() => {
  delete process.env.P2S_CODEMAGIC_TOKEN;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "p2s-gates-")));
  ctx = createCtx(tmp, ui);
  mockHttp({});
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const store = () => new StateStore(tmp);
const approvePlan = async () => {
  const r = await call(ctx, "plan_save", { ...PLAN, approved_by_user: true });
  expect(r.json.approved).toBe(true);
};
const seedPassedCheck = () =>
  store().update((s) => {
    s.checks.push({ id: "chk_1", startedAt: "t", finishedAt: "t", passed: true, items: [{ name: "analyze", status: "passed", summary: "ok", details: [] }], screenshots: [] });
    s.stages.check = { status: "done", updatedAt: "t" };
  });
const connectCodemagic = () => {
  ctx.secrets.set("codemagic", { token: "cm-test-token" });
  store().update((s) => {
    s.connections.codemagic.connected = true;
  });
};

describe("tool registry", () => {
  it("exposes the core tools with unique names", () => {
    const names = allTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["state_get", "plan_save", "stage_update", "setup_link", "check_run", "ship_test_build", "build_status", "build_logs", "build_cancel"]) expect(names).toContain(n);
    expect(tool("ship_test_build").supportsDryRun).toBe(true);
  });
});

describe("state_get", () => {
  it("initializes the project and recommends plan_save first", async () => {
    const r = await call(ctx, "state_get");
    expect(r.isError).toBe(false);
    expect(store().exists()).toBe(true);
    expect(r.json.next_step).toMatch(/plan_save/);
    expect(r.json.ui).toBe("http://127.0.0.1:1");
    expect(r.json.connections.codemagic.connected).toBe(false);
  });
  it("never leaks stored secrets", async () => {
    ctx.secrets.set("codemagic", { token: "super-secret-token-value" });
    const r = await invokeTool(ctx, tool("state_get"), {});
    expect(r.content[0].text).not.toContain("super-secret-token-value");
  });
});

describe("plan_save", () => {
  it("rejects a bad bundle_id with 'Invalid arguments' and writes nothing", async () => {
    for (const bad of ["nodots", "com..x", "1com.example.app", "com.example.-app", "com.exa mple.app", ""]) {
      const r = await call(ctx, "plan_save", { ...PLAN, bundle_id: bad });
      expect(r.isError, bad).toBe(true);
      expect(r.json.error).toBe("Invalid arguments");
      expect(r.json.issues.join(" ")).toMatch(/bundle_id/);
    }
    expect(store().exists()).toBe(false);
  });

  it("rejects bad package_name, short summary, empty screens and bad emails", async () => {
    expect((await call(ctx, "plan_save", { ...PLAN, package_name: "Bad-Name" })).json.issues.join()).toMatch(/package_name/);
    expect((await call(ctx, "plan_save", { ...PLAN, summary: "short" })).json.issues.join()).toMatch(/summary/);
    expect((await call(ctx, "plan_save", { ...PLAN, screens: [] })).json.issues.join()).toMatch(/screens/);
    expect((await call(ctx, "plan_save", { ...PLAN, tester_emails: ["nope"] })).json.issues.join()).toMatch(/tester_emails/);
    expect((await call(ctx, "plan_save", { ...PLAN, platforms: ["windows"] })).json.error).toBe("Invalid arguments");
  });

  it("writes spec.md and state; an unapproved plan awaits approval", async () => {
    const r = await call(ctx, "plan_save", { ...PLAN, tester_emails: ["qa@example.com"] });
    expect(r.isError).toBe(false);
    expect(r.json.approved).toBe(false);
    expect(r.json.saved).toBe(store().p.spec);
    expect(r.json.next_step).toMatch(/approve/i);
    expect(r.json.next_step).toContain("http://127.0.0.1:1/");

    const md = fs.readFileSync(store().p.spec, "utf8");
    expect(md).toContain("# Habit Streaks");
    expect(md).toContain("`habit_streaks`");
    expect(md).toContain("`com.example.habitstreaks`");
    expect(md).toContain("- **Home** — List of habits");
    expect(md).toContain("- Riverpod");
    expect(md).toContain("android, ios");

    const s = store().read();
    expect(s.project).toMatchObject({ name: "habit_streaks", displayName: "Habit Streaks", bundleId: "com.example.habitstreaks", testerEmails: ["qa@example.com"] });
    expect(s.plan.approved).toBe(false);
    expect(s.stages.plan.status).toBe("awaiting_approval");
  });

  it("writes '(none)' when there are no decisions", async () => {
    await call(ctx, "plan_save", { ...PLAN, decisions: undefined });
    expect(fs.readFileSync(store().p.spec, "utf8")).toContain("- (none)");
  });

  it("approved_by_user marks the plan approved via chat and the plan stage done", async () => {
    const r = await call(ctx, "plan_save", { ...PLAN, approved_by_user: true });
    expect(r.json.approved).toBe(true);
    expect(r.json.next_step).toMatch(/Plan approved/);
    const s = store().read();
    expect(s.plan).toMatchObject({ approved: true, approvedVia: "chat" });
    expect(s.plan.approvedAt).toBeTruthy();
    expect(s.stages.plan.status).toBe("done");
  });

  it("re-saving the identical plan keeps the approval", async () => {
    await approvePlan();
    const r = await call(ctx, "plan_save", PLAN);
    expect(r.json.approved).toBe(true);
    expect(store().read().stages.plan.status).toBe("done");
  });

  it("changing the summary or screens resets approval and the plan stage", async () => {
    await approvePlan();
    let r = await call(ctx, "plan_save", { ...PLAN, summary: "A different summary of the app." });
    expect(r.json.approved).toBe(false);
    let s = store().read();
    expect(s.plan.approved).toBe(false);
    expect(s.stages.plan.status).toBe("awaiting_approval");

    await approvePlan();
    await approvePlan(); // same plan, approved again
    r = await call(ctx, "plan_save", { ...PLAN, summary: "A different summary of the app.", screens: [{ name: "Only", purpose: "One screen" }] });
    expect(r.json.approved).toBe(false);
    s = store().read();
    expect(s.plan.screens).toHaveLength(1);
  });

  it("changing the plan together with approved_by_user=true stays approved", async () => {
    await approvePlan();
    const r = await call(ctx, "plan_save", { ...PLAN, summary: "Totally new summary text.", approved_by_user: true });
    expect(r.json.approved).toBe(true);
  });

  it("changing only decisions does not reset approval", async () => {
    await approvePlan();
    const r = await call(ctx, "plan_save", { ...PLAN, decisions: ["Bloc"] });
    expect(r.json.approved).toBe(true);
    expect(store().read().plan.decisions).toEqual(["Bloc"]);
  });

  it("keeps earlier tester emails when none are passed again", async () => {
    await call(ctx, "plan_save", { ...PLAN, tester_emails: ["a@example.com"] });
    await call(ctx, "plan_save", PLAN);
    expect(store().read().project.testerEmails).toEqual(["a@example.com"]);
  });
});

describe("stage_update rules", () => {
  it("blocks the plan stage (set by plan_save)", async () => {
    await approvePlan();
    const r = await call(ctx, "stage_update", { stage: "plan", status: "in_progress" });
    expect(r.isError).toBe(true);
    expect(r.json.blocked).toBe(true);
    expect(r.json.next_step).toMatch(/plan_save/);
  });

  it("blocks everything until the plan is approved", async () => {
    const r = await call(ctx, "stage_update", { stage: "build", status: "in_progress" });
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/Plan not approved/);
    await call(ctx, "plan_save", PLAN); // saved but unapproved
    expect((await call(ctx, "stage_update", { stage: "build", status: "done" })).json.blocked).toBe(true);
  });

  it("blocks check 'done' / 'failed' and points to check_run", async () => {
    await approvePlan();
    for (const status of ["done", "failed"]) {
      const r = await call(ctx, "stage_update", { stage: "check", status });
      expect(r.json.blocked, status).toBe(true);
      expect(r.json.next_step).toMatch(/check_run/);
    }
    expect(store().read().stages.check.status).toBe("pending");
  });

  it("blocks ship/store 'done' but allows in_progress", async () => {
    await approvePlan();
    for (const stage of ["ship", "store"]) {
      const r = await call(ctx, "stage_update", { stage, status: "done" });
      expect(r.json.blocked, stage).toBe(true);
      expect(r.json.next_step).toMatch(/ship_test_build|store/);
      const ok = await call(ctx, "stage_update", { stage, status: "in_progress", note: "go" });
      expect(ok.isError).toBe(false);
      expect(store().read().stages[stage as "ship" | "store"]).toMatchObject({ status: "in_progress", note: "go" });
    }
  });

  it("build can be set freely with a note, and the update is logged", async () => {
    await approvePlan();
    let r = await call(ctx, "stage_update", { stage: "build", status: "in_progress", note: "writing" });
    expect(r.json).toEqual({ ok: true, stage: "build", status: "in_progress" });
    r = await call(ctx, "stage_update", { stage: "build", status: "failed", note: "oops" });
    const s = store().read();
    expect(s.stages.build).toMatchObject({ status: "failed", note: "oops" });
    expect(s.log.at(-1)).toMatchObject({ source: "stage", level: "error" });
  });

  it("any build update resets a 'done' check stage to pending", async () => {
    await approvePlan();
    seedPassedCheck();
    expect(store().read().stages.check.status).toBe("done");
    await call(ctx, "stage_update", { stage: "build", status: "done" });
    const s = store().read();
    expect(s.stages.check.status).toBe("pending");
    expect(s.stages.check.note).toMatch(/re-run checks/);
    expect(s.stages.build.status).toBe("done");
    // the earlier passed check run is still recorded, but ship is now gated
    expect(s.checks).toHaveLength(1);
  });

  it("does not touch the check stage if it was not done", async () => {
    await approvePlan();
    store().setStage("check", "failed", "x");
    await call(ctx, "stage_update", { stage: "build", status: "in_progress" });
    expect(store().read().stages.check.status).toBe("failed");
  });

  it("rejects invalid stage/status values", async () => {
    expect((await call(ctx, "stage_update", { stage: "deploy", status: "done" })).json.error).toBe("Invalid arguments");
    expect((await call(ctx, "stage_update", { stage: "build", status: "pending" })).json.error).toBe("Invalid arguments");
  });
});

describe("check_run gates", () => {
  it("is blocked without a saved plan", async () => {
    const r = await call(ctx, "check_run", {});
    expect(r.isError).toBe(true);
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/No plan saved/);
    expect(r.json.next_step).toMatch(/plan_save/);
  });

  it("is blocked when the plan is saved but not approved", async () => {
    await call(ctx, "plan_save", PLAN);
    fs.writeFileSync(path.join(tmp, "pubspec.yaml"), "name: habit_streaks\n");
    const r = await call(ctx, "check_run", {});
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/not been approved/);
  });

  it("is blocked without pubspec.yaml once the plan is approved", async () => {
    await approvePlan();
    const r = await call(ctx, "check_run", {});
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/pubspec\.yaml missing/);
    expect(r.json.next_step).toMatch(/flutter create/);
    expect(store().read().stages.check.status).toBe("pending");
    expect(store().read().checks).toHaveLength(0);
  });

  it("a blocked call is logged as a warning", async () => {
    await call(ctx, "check_run", {});
    expect(store().read().log.at(-1)).toMatchObject({ source: "check_run", level: "warn" });
  });
});

describe("ship_test_build gates", () => {
  it("is blocked when no check has run", async () => {
    const r = await call(ctx, "ship_test_build", {});
    expect(r.isError).toBe(true);
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/No checks have been run/);
    expect(r.json.next_step).toMatch(/check_run/);
  });

  it("is blocked when the last check failed, naming the failed items", async () => {
    store().update((s) => {
      s.checks.push({
        id: "c",
        startedAt: "t",
        passed: false,
        items: [
          { name: "analyze", status: "failed", summary: "2 errors", details: [] },
          { name: "tests", status: "failed", summary: "1 failed", details: [] },
          { name: "format", status: "warning", summary: "meh", details: [] },
        ],
        screenshots: [],
      });
      s.stages.check = { status: "failed", updatedAt: "t" };
    });
    const r = await call(ctx, "ship_test_build", {});
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toContain("analyze, tests");
    expect(r.json.reason).not.toContain("format");
    expect(r.json.next_step).toMatch(/check_results/);
  });

  it("is blocked when the check passed but the check stage is no longer done", async () => {
    seedPassedCheck();
    store().setStage("check", "pending", "Code changed");
    const r = await call(ctx, "ship_test_build", {});
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/Code changed after the last check/);
    expect(r.json.next_step).toMatch(/check_run/);
  });

  it("a build stage_update after a passing check re-blocks shipping", async () => {
    await approvePlan();
    seedPassedCheck();
    await call(ctx, "stage_update", { stage: "build", status: "in_progress" });
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/Code changed/);
  });

  it("is blocked when Codemagic is not connected, with a connect link", async () => {
    seedPassedCheck();
    const r = await call(ctx, "ship_test_build", {});
    expect(r.json.blocked).toBe(true);
    expect(r.json.reason).toMatch(/Codemagic is not connected/);
    expect(r.json.link).toBe("http://127.0.0.1:1/connect/codemagic");
    expect(r.json.next_step).toContain("http://127.0.0.1:1/connect/codemagic");
  });

  it("is blocked when only the secret OR only the connected flag is set", async () => {
    seedPassedCheck();
    ctx.secrets.set("codemagic", { token: "cm-test-token" });
    expect((await call(ctx, "ship_test_build", {})).json.reason).toMatch(/not connected/);
    fs.rmSync(store().p.secrets);
    store().update((s) => {
      s.connections.codemagic.connected = true;
    });
    expect((await call(ctx, "ship_test_build", {})).json.reason).toMatch(/not connected/);
  });

  it("without a UI the next step tells the user to run the ui command", async () => {
    seedPassedCheck();
    const noUi = createCtx(tmp);
    const r = await call(noUi, "ship_test_build", {});
    expect(r.json.blocked).toBe(true);
    expect(r.json.link).toBeUndefined();
    expect(r.json.next_step).toMatch(/prompt-to-store ui/);
  });

  it("makes no HTTP calls while blocked", async () => {
    const calls = mockHttp({});
    seedPassedCheck();
    await call(ctx, "ship_test_build", {});
    expect(calls).toHaveLength(0);
  });
});

describe("ship_test_build dry run", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "ignore" });
  const entries = () => fs.readdirSync(tmp).sort();

  beforeEach(() => {
    git("init", "-b", "main");
    git("remote", "add", "origin", "https://github.com/acme/app.git");
    seedPassedCheck();
    connectCodemagic();
    store().update((s) => {
      s.project.bundleId = "com.acme.app";
      s.project.displayName = "Acme";
      s.project.name = "app";
    });
  });

  // GitHub's unauthenticated repo lookup decides public vs private (200 = public).
  const GH_REPO = "GET https://api.github.com/repos/acme/app";
  const appsRoute = (htmlUrl: string, repository: Record<string, unknown> = {}) => ({
    "GET https://api.codemagic.io/apps": { applications: [{ _id: "cm-app-1", appName: "acme-app", repository: { htmlUrl, ...repository } }] },
    [GH_REPO]: { private: false },
  });

  it("reports the steps it would take without writing files or starting builds", async () => {
    const calls = mockHttp(appsRoute("https://github.com/acme/app"));
    const before = entries();
    const stateBefore = store().read();
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.isError).toBe(false);
    expect(r.json.dry_run).toBe(true);
    expect(r.json.would).toEqual(["Wrote codemagic.yaml", "Linked existing Codemagic app acme-app", "Start Codemagic workflow p2s-android-test on main"]);

    expect(entries()).toEqual(before);
    expect(fs.existsSync(path.join(tmp, "codemagic.yaml"))).toBe(false);
    expect(execFileSync("git", ["status", "--porcelain", "--", "codemagic.yaml"], { cwd: tmp }).toString()).toBe("");
    expect(spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: tmp }).status).not.toBe(0); // nothing committed
    // only read-only HTTP
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.map((c) => c.url).sort()).toEqual(["https://api.codemagic.io/apps", "https://api.github.com/repos/acme/app"]);
    // no state mutation (builds, ship stage, linked app details)
    const s = store().read();
    expect(s.builds).toEqual([]);
    expect(s.stages.ship).toEqual(stateBefore.stages.ship);
    expect(s.connections.codemagic.details).toEqual({});
  });

  it("matches the Codemagic app regardless of ssh/https/.git spelling of the remote", async () => {
    git("remote", "set-url", "origin", "git@github.com:acme/app.git");
    mockHttp(appsRoute("https://github.com/acme/app.git"));
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would).toContain("Linked existing Codemagic app acme-app");
  });

  it("says it would add the repository when Codemagic does not know it yet", async () => {
    const calls = mockHttp(appsRoute("https://github.com/acme/other"));
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would).toEqual(["Wrote codemagic.yaml", "Would add the public repository to Codemagic", "Start Codemagic workflow p2s-android-test on main"]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("private repo (GitHub lookup 404): a plain-URL Codemagic app is not usable, so a deploy key is planned", async () => {
    const routes: Record<string, unknown> = appsRoute("https://github.com/acme/app", { provider: "github_enterprise" });
    delete routes[GH_REPO]; // unmocked -> non-2xx -> treated as private
    mockHttp(routes);
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would).toEqual(["Wrote codemagic.yaml", "Would add a read-only deploy key and add the private repository to Codemagic", "Start Codemagic workflow p2s-android-test on main"]);
  });

  it("private repo: an app via the GitHub integration, or with an SSH key, is linked", async () => {
    for (const repository of [{ provider: "github" }, { publicSshKey: "ssh-rsa AAAA" }]) {
      const routes: Record<string, unknown> = appsRoute("https://github.com/acme/app", repository);
      delete routes[GH_REPO];
      mockHttp(routes);
      const r = await call(ctx, "ship_test_build", { dry_run: true });
      expect(r.json.would, JSON.stringify(repository)).toContain("Linked existing Codemagic app acme-app");
    }
  });

  it("prefers the GitHub-integration app over a plain-URL duplicate", async () => {
    mockHttp({
      "GET https://api.codemagic.io/apps": {
        applications: [
          { _id: "plain", appName: "plain-app", repository: { htmlUrl: "https://github.com/acme/app" } },
          { _id: "integ", appName: "integ-app", repository: { htmlUrl: "https://github.com/acme/app", provider: "github" } },
        ],
      },
      [GH_REPO]: {},
    });
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would).toContain("Linked existing Codemagic app integ-app");
  });

  it("platform=both also lists the iOS simulator workflow; ios only lists iOS", async () => {
    mockHttp(appsRoute("https://github.com/acme/app"));
    let r = await call(ctx, "ship_test_build", { dry_run: true, platform: "both" });
    expect(r.json.would.slice(-2)).toEqual(["Start Codemagic workflow p2s-android-test on main", "Start Codemagic workflow p2s-ios-simulator on main"]);
    r = await call(ctx, "ship_test_build", { dry_run: true, platform: "ios" });
    expect(r.json.would.filter((w: string) => w.startsWith("Start"))).toEqual(["Start Codemagic workflow p2s-ios-simulator on main"]);
  });

  it("an up-to-date managed codemagic.yaml needs no write; a stale one reports an update", async () => {
    mockHttp(appsRoute("https://github.com/acme/app"));
    const yamlPath = path.join(tmp, "codemagic.yaml");
    const fresh = codemagicYaml({ bundleId: "com.acme.app", emails: [], workingDirectory: "" });
    fs.writeFileSync(yamlPath, fresh);
    let r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would.some((w: string) => /codemagic\.yaml/.test(w))).toBe(false);

    fs.writeFileSync(yamlPath, fresh.replace("com.acme.app", "com.old.id"));
    r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would[0]).toMatch(/Updated codemagic\.yaml/);
    expect(fs.readFileSync(yamlPath, "utf8")).toContain("com.old.id"); // dry run: untouched
  });

  it("a hand-written codemagic.yaml without our workflow blocks with guidance", async () => {
    mockHttp(appsRoute("https://github.com/acme/app"));
    fs.writeFileSync(path.join(tmp, "codemagic.yaml"), "workflows:\n  mine:\n    name: x\n");
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.blocked).toBe(true);
    expect(r.json.next_step).toMatch(/p2s-android-test/);
  });

  it("a user-edited yaml that keeps our workflow id (no marker) is left alone", async () => {
    mockHttp(appsRoute("https://github.com/acme/app"));
    fs.writeFileSync(path.join(tmp, "codemagic.yaml"), "workflows:\n  p2s-android-test:\n    name: custom\n");
    const r = await call(ctx, "ship_test_build", { dry_run: true });
    expect(r.json.would.some((w: string) => /codemagic\.yaml/.test(w))).toBe(false);
    expect(YAML_MARKER.length).toBeGreaterThan(0);
  });

  it("a Flutter project nested in a git repo still dry-runs cleanly and writes nothing at the repo root", async () => {
    // project lives in <repo>/app; the repo root is the git toplevel
    const sub = path.join(tmp, "app");
    fs.mkdirSync(sub);
    const subCtx = createCtx(sub, ui);
    // state lives in the subproject: copy it over
    new StateStore(sub).init();
    new StateStore(sub).update((s) => {
      Object.assign(s, JSON.parse(fs.readFileSync(store().p.state, "utf8")));
    });
    subCtx.secrets.set("codemagic", { token: "cm-test-token" });
    mockHttp(appsRoute("https://github.com/acme/app"));
    const r = await call(subCtx, "ship_test_build", { dry_run: true });
    expect(r.isError).toBe(false);
    expect(r.json.would[0]).toBe("Wrote codemagic.yaml");
    expect(fs.existsSync(path.join(tmp, "codemagic.yaml"))).toBe(false);
  });
});

describe("build_status", () => {
  const B = "build-777";
  const seedBuild = (over: Record<string, unknown> = {}) =>
    store().update((s) => {
      s.builds.push({
        id: B,
        provider: "codemagic",
        workflow: "p2s-android-test",
        platform: "android",
        kind: "test",
        status: "queued",
        startedAt: "2026-01-01T00:00:00Z",
        url: `https://codemagic.io/app/cm-app-1/build/${B}`,
        artifacts: [],
        ...over,
      } as any);
      s.stages.ship = { status: "in_progress", updatedAt: "t" };
    });
  const ART = "https://api.codemagic.io/artifacts/aaa/bbb/app-release.apk";
  const finishedRoutes = () => ({
    [`GET https://codemagic.io/api/v3/builds/${B}`]: {
      data: {
        id: B,
        app_id: "cm-app-1",
        status: "finished",
        finished_at: "2026-01-01T00:10:00Z",
        artifacts: [
          { name: "app-release.apk", type: "apk", size_in_bytes: 1234, short_lived_download_url: ART },
          { name: "notes.txt", type: "txt", url: "https://api.codemagic.io/artifacts/ccc/ddd/notes.txt" },
        ],
      },
    },
    [`POST ${ART}/public-url`]: { url: "https://pub/link" },
  });

  it("without any builds reports there are none", async () => {
    connectCodemagic();
    const r = await call(ctx, "build_status", {});
    expect(r.json.message).toMatch(/No builds yet/);
  });

  it("is blocked when Codemagic is not connected", async () => {
    seedBuild();
    const r = await call(ctx, "build_status", {});
    expect(r.json.blocked).toBe(true);
  });

  it("finished build: public install link, state updated, ship stage done", async () => {
    connectCodemagic();
    seedBuild();
    const calls = mockHttp(finishedRoutes());
    const r = await call(ctx, "build_status", {});
    expect(r.isError).toBe(false);
    expect(r.json.builds).toEqual([
      {
        build_id: B,
        platform: "android",
        workflow: "p2s-android-test",
        status: "finished",
        codemagic_url: `https://codemagic.io/app/cm-app-1/build/${B}`,
        install_links: [{ file: "app-release.apk", url: "https://pub/link" }],
      },
    ]);
    expect(r.json.ui).toBe("http://127.0.0.1:1/builds");
    expect(r.json.next_step).toMatch(/Done!/);
    expect(r.json.next_step).toContain("http://127.0.0.1:1/builds");

    // only the apk gets a public url, with an expiry in the future
    const pub = calls.filter((c) => c.url.endsWith("/public-url"));
    expect(pub).toHaveLength(1);
    expect(pub[0].body.expiresAt).toBeGreaterThan(Date.now() / 1000);

    const s = store().read();
    const b = s.builds.find((x) => x.id === B)!;
    expect(b.status).toBe("finished");
    expect(b.finishedAt).toBe("2026-01-01T00:10:00Z");
    expect(b.artifacts.find((a) => a.name === "app-release.apk")).toMatchObject({ url: ART, type: "apk", size: 1234, publicUrl: "https://pub/link" });
    expect(b.artifacts.find((a) => a.name === "notes.txt")?.publicUrl).toBeUndefined();
    expect(s.stages.ship).toMatchObject({ status: "done", note: "Test build ready" });
    expect(s.log.some((l) => l.source === "build" && l.level === "success" && l.message.includes("finished"))).toBe(true);
  });

  it("a second call for a finished build makes no further HTTP requests", async () => {
    connectCodemagic();
    seedBuild();
    mockHttp(finishedRoutes());
    await call(ctx, "build_status", {});
    const calls = mockHttp({});
    const r = await call(ctx, "build_status", { build_id: B });
    expect(calls).toHaveLength(0);
    expect(r.json.builds[0].install_links).toEqual([{ file: "app-release.apk", url: "https://pub/link" }]);
  });

  it("still building: stays in progress and asks to poll again", async () => {
    connectCodemagic();
    seedBuild();
    mockHttp({ [`GET https://codemagic.io/api/v3/builds/${B}`]: { data: { id: B, app_id: "cm-app-1", status: "building", artifacts: [] } } });
    const r = await call(ctx, "build_status", {});
    expect(r.json.builds[0].status).toBe("building");
    expect(r.json.builds[0].install_links).toEqual([]);
    expect(r.json.next_step).toMatch(/Still building/);
    const s = store().read();
    expect(s.stages.ship.status).toBe("in_progress");
    expect(s.builds[0].finishedAt).toBeUndefined();
  });

  it("failed build: ship stage failed, next step points at build_logs", async () => {
    connectCodemagic();
    seedBuild();
    mockHttp({ [`GET https://codemagic.io/api/v3/builds/${B}`]: { data: { id: B, app_id: "cm-app-1", status: "failed", artifacts: [] } } });
    const r = await call(ctx, "build_status", {});
    expect(r.json.builds[0].status).toBe("failed");
    expect(r.json.next_step).toMatch(/build_logs/);
    const s = store().read();
    expect(s.stages.ship).toMatchObject({ status: "failed", note: "Build failed" });
    expect(s.log.some((l) => l.source === "build" && l.level === "error")).toBe(true);
  });

  it("a public-url failure does not fail the status call", async () => {
    connectCodemagic();
    seedBuild();
    const routes: Record<string, unknown> = finishedRoutes();
    delete routes[`POST ${ART}/public-url`]; // -> 418 from the mock
    mockHttp(routes);
    const r = await call(ctx, "build_status", {});
    expect(r.isError).toBe(false);
    expect(r.json.builds[0].status).toBe("finished");
    expect(r.json.builds[0].install_links).toEqual([]);
  });

  it("unknown remote statuses map to 'unknown' and aliases to 'queued'", async () => {
    connectCodemagic();
    seedBuild();
    mockHttp({ [`GET https://codemagic.io/api/v3/builds/${B}`]: { data: { id: B, app_id: "x", status: "initializing", artifacts: [] } } });
    expect((await call(ctx, "build_status", {})).json.builds[0].status).toBe("queued");
  });
});

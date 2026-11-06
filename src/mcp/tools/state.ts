import fs from "node:fs";
import { z } from "zod";
import { defineTool, GateError } from "../context.js";
import { nowIso } from "../../state/store.js";
import { STAGES, SERVICES } from "../../state/schema.js";
import { lastCheck } from "../gates.js";

export const stateGet = defineTool({
  name: "state_get",
  title: "Get pipeline state",
  description:
    "Returns the prompt-to-store pipeline state: stages (plan → build → check → ship → store), connections (which services are connected — never the keys), last check, recent builds, pending approvals, and the recommended next step. Call this first in every session.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const s = ctx.store.exists() ? ctx.store.read() : ctx.store.init();
    let uiUrl: string | undefined;
    try {
      uiUrl = (await ctx.ui.ensure()).baseUrl;
    } catch {
      /* ignore */
    }
    return {
      project: s.project,
      plan: { summary: s.plan.summary, approved: s.plan.approved, screens: s.plan.screens.length },
      stages: s.stages,
      connections: Object.fromEntries(SERVICES.map((k) => [k, { connected: s.connections[k].connected, ...s.connections[k].details }])),
      last_check: lastCheck(s) && {
        passed: lastCheck(s)!.passed,
        items: lastCheck(s)!.items.map((i) => `${i.status.toUpperCase()} ${i.name}: ${i.summary}`),
      },
      builds: s.builds.slice(-5).map((b) => ({ id: b.id, platform: b.platform, status: b.status, url: b.url })),
      pending_approvals: s.approvals.filter((a) => a.status === "pending").map((a) => a.title),
      ui: uiUrl,
      next_step: nextStep(s),
    };
  },
});

function nextStep(s: ReturnType<import("../../state/store.js").StateStore["read"]>): string {
  if (!s.plan.summary) return "Write a short plan (screens, decisions) and call plan_save.";
  if (!s.plan.approved) return "Ask the user to approve the plan (UI or chat), then call plan_save with approved_by_user=true.";
  if (s.stages.build.status !== "done" && s.stages.check.status !== "done")
    return "Build the Flutter app, then call stage_update(stage='build', status='done') and check_run.";
  const c = s.checks.at(-1);
  if (!c || !c.passed || s.stages.check.status !== "done") return "Call check_run and fix failures until it passes.";
  if (!s.connections.codemagic.connected) return "Call setup_link(service='codemagic') and ask the user to connect Codemagic.";
  const ok = s.builds.find((b) => b.status === "finished");
  if (!ok) {
    const running = s.builds.find((b) => !["finished", "failed", "canceled", "timeout", "skipped"].includes(b.status));
    return running ? `Build ${running.id} is ${running.status}; poll build_status.` : "Call ship_test_build.";
  }
  return "Test build delivered. When the user wants a store release: connect Google Play / App Store via setup_link, update the listing, then publish.";
}

export const planSave = defineTool({
  name: "plan_save",
  title: "Save the app plan",
  description:
    "Saves the app plan to .prompt-to-store/spec.md and state.json (Plan stage). Call it after drafting the plan with the user. The plan is approved either by the user pressing Approve in the local UI, or by you passing approved_by_user=true ONLY after the user explicitly said yes in chat. Also sets project identity (name, bundle id).",
  input: {
    app_name: z.string().min(1).describe("Human-readable app name, e.g. 'Habit Streaks'"),
    package_name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .describe("Dart package name, e.g. habit_streaks"),
    bundle_id: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/)
      .describe("Reverse-domain id used for both Android applicationId and iOS bundle id, e.g. com.example.habitstreaks"),
    summary: z.string().min(10).describe("One-paragraph description of the app"),
    screens: z.array(z.object({ name: z.string(), purpose: z.string() })).min(1),
    decisions: z.array(z.string()).default([]).describe("Key technical/product decisions (state management, storage, packages…)"),
    platforms: z.array(z.enum(["android", "ios"])).default(["android", "ios"]),
    tester_emails: z.array(z.string().email()).default([]).describe("Where test builds are emailed"),
    approved_by_user: z.boolean().default(false).describe("true only if the user explicitly approved this plan in chat"),
  },
  async run(ctx, a) {
    ctx.store.init();
    const md = [
      `# ${a.app_name}`,
      "",
      `- **Package:** \`${a.package_name}\``,
      `- **Bundle ID:** \`${a.bundle_id}\``,
      `- **Platforms:** ${a.platforms.join(", ")}`,
      "",
      "## Summary",
      "",
      a.summary,
      "",
      "## Screens",
      "",
      ...a.screens.map((s) => `- **${s.name}** — ${s.purpose}`),
      "",
      "## Decisions",
      "",
      ...(a.decisions.length ? a.decisions.map((d) => `- ${d}`) : ["- (none)"]),
      "",
    ].join("\n");
    fs.writeFileSync(ctx.store.p.spec, md);
    const st = ctx.store.update((s) => {
      const changed = s.plan.summary !== a.summary || JSON.stringify(s.plan.screens) !== JSON.stringify(a.screens);
      s.project = {
        name: a.package_name,
        displayName: a.app_name,
        bundleId: a.bundle_id,
        platforms: a.platforms,
        testerEmails: a.tester_emails.length ? a.tester_emails : s.project.testerEmails,
      };
      s.plan.summary = a.summary;
      s.plan.screens = a.screens;
      s.plan.decisions = a.decisions;
      if (a.approved_by_user) {
        s.plan.approved = true;
        s.plan.approvedAt = nowIso();
        s.plan.approvedVia = "chat";
      } else if (changed) {
        s.plan.approved = false;
      }
      const t = nowIso();
      s.stages.plan = s.plan.approved ? { status: "done", updatedAt: t } : { status: "awaiting_approval", updatedAt: t };
      s.log.push({ at: t, level: "info", source: "plan", message: s.plan.approved ? "Plan approved" : "Plan saved, waiting for approval" });
    });
    let link: string | undefined;
    try {
      link = await ctx.ui.link("/");
    } catch {
      /* ignore */
    }
    return {
      saved: ctx.store.p.spec,
      approved: st.plan.approved,
      next_step: st.plan.approved
        ? "Plan approved. Build the app (flutter create + code), then call stage_update(stage='build', status='in_progress')."
        : `Show the plan to the user and ask them to approve it${link ? ` (they can also press Approve at ${link})` : ""}.`,
    };
  },
});

export const stageUpdate = defineTool({
  name: "stage_update",
  title: "Report stage progress",
  description:
    "Report progress on the Build stage (and add notes to any stage) so the local UI shows it live. Only 'build' can be set freely; check/ship/store are set by their own tools. Call stage_update(build, in_progress) when you start writing code and (build, done) when the app compiles.",
  input: {
    stage: z.enum(STAGES),
    status: z.enum(["in_progress", "done", "failed"]),
    note: z.string().optional(),
  },
  async run(ctx, a) {
    const s = ctx.store.read();
    if (a.stage === "plan") throw new GateError("The plan stage is set by plan_save.", "Call plan_save.");
    if (a.stage !== "build" && a.status !== "in_progress") {
      throw new GateError(`The ${a.stage} stage is completed by its own tool.`, a.stage === "check" ? "Call check_run." : "Use ship_test_build / store tools.");
    }
    if (!s.plan.approved) throw new GateError("Plan not approved yet.", "Get the plan approved first (plan_save).");
    ctx.store.update((st) => {
      st.stages[a.stage] = { status: a.status, note: a.note, updatedAt: nowIso() };
      // Any new build work invalidates the previous check.
      if (a.stage === "build" && st.stages.check.status === "done") st.stages.check = { status: "pending", updatedAt: nowIso(), note: "Code changed; re-run checks" };
      st.log.push({ at: nowIso(), level: a.status === "failed" ? "error" : "info", source: "stage", message: `${a.stage} → ${a.status}${a.note ? `: ${a.note}` : ""}` });
    });
    return { ok: true, stage: a.stage, status: a.status };
  },
});

export const setupLink = defineTool({
  name: "setup_link",
  title: "Get a link for the user to connect a service",
  description:
    "Returns a localhost link to the page where the USER connects a service (Codemagic, GitHub, Google Play, App Store Connect) and enters its key. Keys are never typed into the chat and you can never read them. Give the link to the user and wait for them to say it's done, then call the tool that needed it again.",
  input: { service: z.enum(SERVICES) },
  readOnly: true,
  async run(ctx, a) {
    ctx.store.init();
    const link = await ctx.ui.link(`/connect/${a.service}`);
    const s = ctx.store.read();
    return {
      link,
      connected: s.connections[a.service].connected,
      say_to_user: `Open ${link} to connect ${a.service}. Your key stays on your machine and is never shared in this chat.`,
    };
  },
});

import fs from "node:fs";
import path from "node:path";
import { GateError, type Ctx } from "./context.js";
import type { ServiceName, State } from "../state/schema.js";
import { newId, nowIso } from "../state/store.js";

/**
 * Stage gates. Each tool calls the gates it needs; a failing gate returns a
 * structured "blocked" result with the exact next step, so the agent cannot
 * skip Plan → Build → Check → Ship → Store.
 */

export function requireInitialized(ctx: Ctx) {
  if (!ctx.store.exists()) {
    throw new GateError("Project is not initialized for prompt-to-store.", "Call `plan_save` with the app plan to start.");
  }
}

export function requirePlanApproved(_ctx: Ctx, s: State) {
  if (!s.plan.summary) throw new GateError("No plan saved yet.", "Call `plan_save` with the app plan, then ask the user to approve it.");
  if (!s.plan.approved) {
    throw new GateError(
      "The plan has not been approved by the user.",
      "Show the plan to the user. They approve it in the local UI (Path → Approve) or tell you in chat; then call `plan_save` with approved_by_user=true.",
    );
  }
}

export function requireFlutterProject(ctx: Ctx) {
  if (!fs.existsSync(path.join(ctx.root, "pubspec.yaml"))) {
    throw new GateError(
      `No Flutter project found at ${ctx.root} (pubspec.yaml missing).`,
      "Create the Flutter app first (`flutter create --org <reverse.domain> --project-name <name> .`), then write the code.",
    );
  }
}

export function lastCheck(s: State) {
  return s.checks.at(-1);
}

export function requireCheckPassed(_ctx: Ctx, s: State) {
  const c = lastCheck(s);
  if (!c) throw new GateError("No checks have been run yet.", "Call `check_run` and fix any failures.");
  if (!c.passed) {
    const failed = c.items.filter((i) => i.status === "failed").map((i) => i.name);
    throw new GateError(`The last check failed (${failed.join(", ")}).`, "Fix the failures (see `check_results`), then call `check_run` again.");
  }
  if (s.stages.check.status !== "done") {
    throw new GateError("Code changed after the last check (stage reset).", "Call `check_run` again.");
  }
}

export async function requireConnected(ctx: Ctx, s: State, service: ServiceName) {
  if (!ctx.secrets.has(service) || !s.connections[service].connected) {
    let link: string | undefined;
    try {
      link = await ctx.ui.link(`/connect/${service}`);
    } catch {
      /* UI unavailable */
    }
    const names: Record<ServiceName, string> = {
      codemagic: "Codemagic",
      github: "GitHub",
      play: "Google Play",
      appstore: "App Store Connect",
    };
    throw new GateError(
      `${names[service]} is not connected.`,
      link
        ? `Ask the user to open ${link} and connect ${names[service]} (the key is entered there, never in chat). Then call the tool again.`
        : `Run \`npx prompt-to-store ui\` and connect ${names[service]} there. Never ask the user to paste keys in chat.`,
      link,
    );
  }
}

export function requireSuccessfulTestBuild(_ctx: Ctx, s: State, platform: "android" | "ios") {
  const ok = s.builds.some(
    (b) => b.status === "finished" && (b.platform === platform || b.platform === "both"),
  );
  if (!ok) {
    throw new GateError(
      `No successful ${platform} build yet.`,
      "Call `ship_test_build` and wait for it to finish (`build_status`) before publishing to a store.",
    );
  }
}

/**
 * Publishing needs an explicit click in the local UI. If no approved request exists,
 * create a pending one and block with the link.
 */
export async function requireUiApproval(
  ctx: Ctx,
  action: string,
  title: string,
  summary: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const s = ctx.store.read();
  const approved = s.approvals.find((a) => a.action === action && a.status === "approved");
  if (approved) return approved.id;
  let pending = s.approvals.find((a) => a.action === action && a.status === "pending");
  if (!pending) {
    const id = newId("appr");
    ctx.store.update((st) => {
      st.approvals.push({ id, action, title, summary, payload, status: "pending", createdAt: nowIso() });
      st.log.push({ at: nowIso(), level: "warn", source: "approval", message: `Waiting for the user to confirm: ${title}` });
    });
    pending = ctx.store.read().approvals.find((a) => a.id === id)!;
  }
  let link: string | undefined;
  try {
    link = await ctx.ui.link(`/store?approval=${pending.id}`);
  } catch {
    /* no UI */
  }
  throw new GateError(
    `"${title}" needs the user's explicit confirmation.`,
    link
      ? `Ask the user to open ${link}, review, and press Publish. Then call this tool again.`
      : "Ask the user to run `npx prompt-to-store ui` and press Publish, then call this tool again.",
    link,
  );
}

export function consumeApproval(ctx: Ctx, id: string) {
  ctx.store.update((s) => {
    const a = s.approvals.find((x) => x.id === id);
    if (a) a.status = "consumed";
  });
}

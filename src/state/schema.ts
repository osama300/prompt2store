import { z } from "zod";

/** The ordered pipeline. Gates in the MCP tools enforce this order. */
export const STAGES = ["plan", "build", "check", "ship", "store"] as const;
export type StageName = (typeof STAGES)[number];

export const StageStatus = z.enum([
  "pending",
  "in_progress",
  "awaiting_approval",
  "done",
  "failed",
  "blocked",
]);
export type StageStatus = z.infer<typeof StageStatus>;

export const Stage = z.object({
  status: StageStatus.default("pending"),
  updatedAt: z.string().optional(),
  note: z.string().optional(),
});
export type Stage = z.infer<typeof Stage>;

export const SERVICES = ["codemagic", "github", "play", "appstore"] as const;
export type ServiceName = (typeof SERVICES)[number];

export const Connection = z.object({
  connected: z.boolean().default(false),
  verifiedAt: z.string().optional(),
  /** Non-secret details, e.g. account name, Codemagic appId, GitHub repo. */
  details: z.record(z.string(), z.string()).default({}),
  error: z.string().optional(),
});
export type Connection = z.infer<typeof Connection>;

export const CheckItem = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "warning", "skipped"]),
  summary: z.string(),
  details: z.array(z.string()).default([]),
  durationMs: z.number().optional(),
});
export type CheckItem = z.infer<typeof CheckItem>;

export const CheckRun = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  passed: z.boolean(),
  items: z.array(CheckItem).default([]),
  screenshots: z.array(z.string()).default([]),
});
export type CheckRun = z.infer<typeof CheckRun>;

export const BuildStatus = z.enum([
  "queued",
  "preparing",
  "building",
  "testing",
  "publishing",
  "finishing",
  "finished",
  "failed",
  "canceled",
  "timeout",
  "skipped",
  "unknown",
]);
export type BuildStatus = z.infer<typeof BuildStatus>;

export const Artifact = z.object({
  name: z.string(),
  url: z.string(),
  type: z.string().optional(),
  publicUrl: z.string().optional(),
  size: z.number().optional(),
});
export type Artifact = z.infer<typeof Artifact>;

export const Build = z.object({
  id: z.string(),
  provider: z.literal("codemagic").default("codemagic"),
  workflow: z.string(),
  platform: z.enum(["android", "ios", "both"]).default("android"),
  kind: z.enum(["test", "release"]).default("test"),
  status: BuildStatus,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  url: z.string().optional(),
  artifacts: z.array(Artifact).default([]),
  error: z.string().optional(),
});
export type Build = z.infer<typeof Build>;

export const Approval = z.object({
  id: z.string(),
  action: z.string(),
  title: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["pending", "approved", "rejected", "consumed"]),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
});
export type Approval = z.infer<typeof Approval>;

export const LogEntry = z.object({
  at: z.string(),
  level: z.enum(["info", "warn", "error", "success"]).default("info"),
  source: z.string(),
  message: z.string(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const Project = z.object({
  name: z.string().default(""),
  displayName: z.string().default(""),
  bundleId: z.string().default(""),
  platforms: z.array(z.enum(["android", "ios"])).default(["android", "ios"]),
  testerEmails: z.array(z.string()).default([]),
});

export const Plan = z.object({
  summary: z.string().default(""),
  screens: z.array(z.object({ name: z.string(), purpose: z.string() })).default([]),
  decisions: z.array(z.string()).default([]),
  approved: z.boolean().default(false),
  approvedAt: z.string().optional(),
  approvedVia: z.enum(["ui", "chat"]).optional(),
});

const stagesDefault = () =>
  Object.fromEntries(STAGES.map((s) => [s, { status: "pending" as const }])) as Record<StageName, Stage>;

export const State = z.object({
  schemaVersion: z.literal(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  project: Project.default(() => Project.parse({})),
  plan: Plan.default(() => Plan.parse({})),
  stages: z
    .object({
      plan: Stage,
      build: Stage,
      check: Stage,
      ship: Stage,
      store: Stage,
    })
    .default(stagesDefault),
  connections: z
    .object({
      codemagic: Connection,
      github: Connection,
      play: Connection,
      appstore: Connection,
    })
    .default(() => ({
      codemagic: Connection.parse({}),
      github: Connection.parse({}),
      play: Connection.parse({}),
      appstore: Connection.parse({}),
    })),
  checks: z.array(CheckRun).default([]),
  builds: z.array(Build).default([]),
  approvals: z.array(Approval).default([]),
  log: z.array(LogEntry).default([]),
});
export type State = z.infer<typeof State>;

export function emptyState(now = new Date().toISOString()): State {
  return State.parse({ createdAt: now, updatedAt: now });
}

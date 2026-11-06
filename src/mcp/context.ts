import { z } from "zod";
import { StateStore, findProjectRoot } from "../state/store.js";
import { Secrets, redact } from "../secrets/index.js";
import type { State } from "../state/schema.js";

export interface UiHandle {
  /** Starts the local companion UI if needed and returns its base URL (with access token). */
  ensure(): Promise<{ baseUrl: string; token: string }>;
  link(pathname: string): Promise<string>;
}

export interface Ctx {
  root: string;
  store: StateStore;
  secrets: Secrets;
  ui: UiHandle;
}

export function createCtx(root = findProjectRoot(), ui?: UiHandle): Ctx {
  const store = new StateStore(root);
  const secrets = Secrets.forProject(root, store.p.secrets);
  return {
    root,
    store,
    secrets,
    ui:
      ui ??
      ({
        async ensure() {
          throw new Error("UI not available");
        },
        async link() {
          throw new Error("UI not available");
        },
      } satisfies UiHandle),
  };
}

/** A gate failure: tells the agent exactly what to do next instead of doing work out of order. */
export class GateError extends Error {
  constructor(
    message: string,
    public nextStep: string,
    public link?: string,
  ) {
    super(message);
  }
}

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export interface ToolDef<S extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Read-only tools never change state or remote services. */
  readOnly?: boolean;
  /** Adds a `dry_run` boolean argument; run() receives it in args. */
  supportsDryRun?: boolean;
  gate?: (ctx: Ctx, args: z.infer<z.ZodObject<S>>, state: State) => void | Promise<void>;
  run: (ctx: Ctx, args: z.infer<z.ZodObject<S>> & { dry_run?: boolean }) => Promise<unknown>;
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function textResult(ctx: Ctx, value: unknown, isError = false): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text: redact(text, ctx.secrets.allValues()) }], ...(isError ? { isError } : {}) };
}

export async function invokeTool(ctx: Ctx, def: ToolDef<any>, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const schema = z.object({ ...def.input, ...(def.supportsDryRun ? { dry_run: z.boolean().optional() } : {}) });
    const parsed = schema.safeParse(input ?? {});
    if (!parsed.success) {
      return textResult(ctx, { error: "Invalid arguments", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, true);
    }
    const rawArgs = parsed.data as Record<string, unknown>;
    if (def.gate) {
      const state = ctx.store.read();
      await def.gate(ctx, rawArgs as any, state);
    }
    const out = await def.run(ctx, rawArgs as any);
    return textResult(ctx, out);
  } catch (e) {
    if (e instanceof GateError) {
      try {
        ctx.store.log(def.name, `Blocked: ${e.message}`, "warn");
      } catch {
        /* state may be unwritable */
      }
      return textResult(ctx, { blocked: true, reason: e.message, next_step: e.nextStep, ...(e.link ? { link: e.link } : {}) }, true);
    }
    const msg = (e as Error)?.message ?? String(e);
    try {
      ctx.store.log(def.name, msg, "error");
    } catch {
      /* ignore */
    }
    return textResult(ctx, { error: msg }, true);
  }
}

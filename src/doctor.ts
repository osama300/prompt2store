import { findFlutter, hasAndroidSdk } from "./check/flutter.js";
import { createCtx } from "./mcp/context.js";
import { SERVICES } from "./state/schema.js";

export async function runDoctor(): Promise<number> {
  const ctx = createCtx();
  const flutter = findFlutter();
  const line = (ok: boolean, label: string, extra = "") => console.log(`${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  console.log(`prompt-to-store doctor (${ctx.root})\n`);
  line(Number(process.versions.node.split(".")[0]) >= 20, "Node.js >= 20", process.versions.node);
  line(!!flutter, "Flutter SDK", flutter ?? "missing — your agent can install it with env_check(install_flutter=true)");
  line(hasAndroidSdk(), "Android SDK (optional)", "only needed for local APK builds");
  line(ctx.store.exists(), "Project initialized", ctx.store.p.state);
  console.log(`  secrets backend: ${ctx.secrets.backendKind}`);
  for (const s of SERVICES) line(ctx.secrets.has(s), `${s} key stored`);
  return flutter ? 0 : 1;
}

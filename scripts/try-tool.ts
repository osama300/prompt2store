// Dev helper: invoke a tool against a project dir. Usage: tsx scripts/try-tool.ts <projectDir> <tool> '<json args>'
import { createCtx, invokeTool } from "../src/mcp/context.js";
import { allTools } from "../src/mcp/tools/index.js";
const [dir, name, json] = process.argv.slice(2);
const ctx = createCtx(dir);
try { const { createUiHandle } = await import("../src/ui/server.js"); ctx.ui = createUiHandle(ctx); } catch {}
const def = allTools().find((t) => t.name === name);
if (!def) throw new Error(`unknown tool ${name}`);
const r = await invokeTool(ctx, def, json ? JSON.parse(json) : {});
console.log(r.content[0].text);
process.exit(0);

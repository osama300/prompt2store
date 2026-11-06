// Starts the real MCP server over stdio (as an agent would) in a temp project and exercises it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "p2s smoke ")); // space on purpose
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

const t = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist", "cli.js"), "mcp"], cwd: project, env: { ...process.env, P2S_SECRETS_BACKEND: "file" } });
const c = new Client({ name: "smoke", version: "1" });
await c.connect(t);
const { tools } = await c.listTools();
console.log(`${tools.length} tools`);
if (tools.length < 28) fail(`expected >= 28 tools, got ${tools.length}`);
for (const n of ["state_get", "plan_save", "app_create", "font_add", "check_run", "ship_test_build", "play_publish", "asc_submit_review"]) {
  if (!tools.find((x) => x.name === n)) fail(`missing tool ${n}`);
}
if (!c.getInstructions()?.includes("Plan")) fail("server instructions missing");
const txt = async (name, args = {}) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);

const st = await txt("state_get");
if (!st.next_step) fail("state_get has no next_step");
if (!st.ui?.startsWith("http://127.0.0.1:")) fail(`local UI not started: ${st.ui}`);
const health = await (await fetch(new URL("/api/health", st.ui))).json();
if (!health.ok) fail("UI health check failed");

const early = await txt("check_run");
if (!early.blocked) fail("check_run should be blocked before a plan");
const plan = await txt("plan_save", { app_name: "Smoke Test", package_name: "smoke_test", bundle_id: "com.example.smoketest", summary: "A smoke test app.", screens: [{ name: "Home", purpose: "test" }], approved_by_user: true });
if (!plan.approved) fail("plan not approved");
const ship = await txt("ship_test_build");
if (!ship.blocked) fail("ship_test_build should be blocked without checks");
const link = await txt("setup_link", { service: "codemagic" });
if (!/\/connect\/codemagic\?t=[0-9a-f]+/.test(link.link)) fail("setup_link has no tokenized link");
const res = await fetch(link.link);
if (res.status !== 200) fail(`connect page returned ${res.status}`);

await c.close();
console.log("MCP smoke test passed");
process.exit(0);

// Real Flutter end-to-end on this OS: app_create → font_add (Arabic) → check_run with headless screenshots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCtx, invokeTool } from "../dist/mcp/context.js";
import { allTools } from "../dist/mcp/tools/index.js";

const fail = (m) => { console.error("FAIL:", m); process.exit(1); };
const project = fs.mkdtempSync(path.join(os.tmpdir(), "p2s e2e "));
const ctx = createCtx(project, { async ensure() { return { baseUrl: "http://127.0.0.1", token: "t" }; }, async link(p) { return p; } });
const call = async (name, args = {}) => {
  const def = allTools().find((t) => t.name === name);
  const r = await invokeTool(ctx, def, args);
  const out = JSON.parse(r.content[0].text);
  console.log(`\n== ${name}\n${JSON.stringify(out, null, 2).slice(0, 2500)}`);
  return out;
};

const env = await call("env_check");
if (!env.flutter) fail("Flutter not found");
await call("plan_save", { app_name: "قائمة المشتريات", package_name: "shopping_list", bundle_id: "com.example.shoppinglist", summary: "A shopping list app in Arabic.", screens: [{ name: "List", purpose: "items" }], approved_by_user: true });
const created = await call("app_create");
if (!created.created) fail("app_create failed");
const gradle = fs.readFileSync(path.join(project, "android", "app", "build.gradle.kts"), "utf8");
if (!gradle.includes('applicationId = "com.example.shoppinglist"')) fail("applicationId not set");
if (!fs.readFileSync(path.join(project, "ios", "Runner", "Info.plist"), "utf8").includes("قائمة المشتريات")) fail("iOS display name not set");

const font = await call("font_add", { script: "arabic" });
const main = path.join(project, "lib", "main.dart");
let src = fs.readFileSync(main, "utf8");
src = src.replace("theme: ThemeData(", `theme: ThemeData(\n        fontFamily: '${font.family}',`).replace("'Flutter Demo Home Page'", "'قائمة المشتريات'");
fs.writeFileSync(main, src);
await call("stage_update", { stage: "build", status: "done" });

const build = process.env.P2S_E2E_BUILD === "1";
const check = await call("check_run", { build });
if (!check.passed) fail("check_run did not pass");
const shot = path.join(project, ".prompt-to-store", "checks", "screens", "phone", "01_home.png");
if (!fs.existsSync(shot)) fail("screenshot missing");
const png = fs.readFileSync(shot);
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
if (w !== 1290 || h !== 2796) fail(`screenshot is ${w}x${h}, expected 1290x2796`);
if (build && !check.items.find((i) => i.name === "build" && i.status === "passed")) fail("local APK build did not pass");

const outDir = process.env.P2S_E2E_ARTIFACTS;
if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.copyFileSync(shot, path.join(outDir, `screenshot-${process.platform}.png`)); }
console.log(`\nFlutter e2e passed on ${process.platform} (${w}x${h} screenshot${build ? ", APK built" : ""})`);

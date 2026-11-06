import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pubspecWithFont } from "../src/mcp/tools/font.js";
import { createCtx, invokeTool } from "../src/mcp/context.js";
import { allTools } from "../src/mcp/tools/index.js";

const assets = [{ asset: "assets/fonts/A-Regular.ttf" }, { asset: "assets/fonts/A-Bold.ttf", weight: 700 }];

describe("pubspecWithFont", () => {
  it("adds a fonts list under the flutter section", () => {
    const out = pubspecWithFont("name: x\n\nflutter:\n  uses-material-design: true\n", "A", assets);
    expect(out).toContain("flutter:\n  fonts:\n    - family: A\n      fonts:\n        - asset: assets/fonts/A-Regular.ttf\n        - asset: assets/fonts/A-Bold.ttf\n          weight: 700\n  uses-material-design: true");
  });
  it("appends to an existing fonts list and is idempotent", () => {
    const base = "flutter:\n  fonts:\n    - family: Other\n      fonts:\n        - asset: x.ttf\n";
    const once = pubspecWithFont(base, "A", assets);
    expect(once).toContain("    - family: Other");
    expect(once).toContain("    - family: A");
    expect(pubspecWithFont(once, "A", assets)).toBe(once);
  });
  it("creates the flutter section when missing", () => {
    expect(pubspecWithFont("name: x\n", "A", assets)).toMatch(/flutter:\n  fonts:\n    - family: A/);
  });
});

describe("font_add tool", () => {
  it("copies the bundled Arabic font and declares it", async () => {
    process.env.P2S_SECRETS_BACKEND = "file";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-font-"));
    fs.writeFileSync(path.join(root, "pubspec.yaml"), "name: app\nflutter:\n  uses-material-design: true\n");
    const ctx = createCtx(root, { async ensure() { return { baseUrl: "", token: "" }; }, async link(p: string) { return p; } });
    ctx.store.init();
    ctx.store.update((s) => { s.plan = { ...s.plan, summary: "x", approved: true }; });
    const def = allTools().find((t) => t.name === "font_add")!;
    const out = JSON.parse((await invokeTool(ctx, def, {})).content[0].text);
    expect(out.family).toBe("IBMPlexSansArabic");
    for (const f of out.files) expect(fs.statSync(path.join(root, f)).size).toBeGreaterThan(100_000);
    expect(fs.readFileSync(path.join(root, "pubspec.yaml"), "utf8")).toContain("family: IBMPlexSansArabic");
  });
});

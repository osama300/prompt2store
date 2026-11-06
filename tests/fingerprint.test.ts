import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceFingerprint } from "../src/check/fingerprint.js";
import { createCtx, invokeTool } from "../src/mcp/context.js";
import { allTools } from "../src/mcp/tools/index.js";
import { nowIso } from "../src/state/store.js";

process.env.P2S_SECRETS_BACKEND = "file";
const ui = { async ensure() { return { baseUrl: "http://x", token: "t" }; }, async link(p: string) { return `http://x${p}`; } };
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-fp-"));
  fs.writeFileSync(path.join(root, "pubspec.yaml"), "name: app\n");
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "lib", "main.dart"), "void main() {}\n");
});

describe("source fingerprint", () => {
  it("changes when app code changes and ignores build output", () => {
    const a = sourceFingerprint(root);
    fs.mkdirSync(path.join(root, "build"));
    fs.writeFileSync(path.join(root, "build", "x.txt"), "noise");
    expect(sourceFingerprint(root)).toBe(a);
    fs.writeFileSync(path.join(root, "lib", "main.dart"), "void main() { print(1); }\n");
    expect(sourceFingerprint(root)).not.toBe(a);
  });

  it("ship_test_build is blocked when code changed after a passing check", async () => {
    const ctx = createCtx(root, ui);
    ctx.store.init();
    ctx.store.update((s) => {
      s.plan = { ...s.plan, summary: "x", approved: true };
      s.checks.push({ id: "c1", startedAt: nowIso(), finishedAt: nowIso(), passed: true, items: [], screenshots: [], fingerprint: sourceFingerprint(root) });
      s.stages.check = { status: "done", updatedAt: nowIso() };
    });
    fs.writeFileSync(path.join(root, "lib", "main.dart"), "void main() { /* edited */ }\n");
    const def = allTools().find((t) => t.name === "ship_test_build")!;
    const out = JSON.parse((await invokeTool(ctx, def, {})).content[0].text);
    expect(out.blocked).toBe(true);
    expect(out.reason).toMatch(/changed after the last passing check/);
    expect(ctx.store.read().stages.check.status).toBe("pending");
  });
});

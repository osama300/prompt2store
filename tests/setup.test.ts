import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { runSetup } from "../src/setup/index.js";

let home: string;
let skills: string;
const quiet = { log: (l: string) => { if (process.env.DBG) console.log(l); } };
const run = (args: string[]) => runSetup(args, { home, skillsDir: skills, ...quiet });
const rd = (...p: string[]) => fs.readFileSync(path.join(home, ...p), "utf8");
const backups = () =>
  fs.readdirSync(home, { recursive: true, encoding: "utf8" }).filter((f) => f.includes(".p2s-backup-"));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-home-"));
  skills = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-skills-"));
  for (const n of ["prompt-to-store", "check"]) {
    fs.mkdirSync(path.join(skills, n), { recursive: true });
    fs.writeFileSync(path.join(skills, n, "SKILL.md"), `# ${n}\n`);
  }
  fs.writeFileSync(path.join(skills, "prompt-to-store", "rejections.md"), "rej\n");
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ numStartups: 3, mcpServers: { other: { command: "x" } }, projects: { a: 1 } }),
  );
  fs.mkdirSync(path.join(home, ".cursor"));
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "y"\n',
  );
});

const AGENTS = ["--agents", "claude,cursor,codex"];

describe("setup", () => {
  it("installs, preserves, backs up", async () => {
    expect(await run([...AGENTS, "--yes"])).toBe(0);
    const c = JSON.parse(rd(".claude.json"));
    expect(c.numStartups).toBe(3);
    expect(c.projects).toEqual({ a: 1 });
    expect(c.mcpServers.other).toEqual({ command: "x" });
    expect(c.mcpServers["prompt-to-store"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "prompt-to-store@latest", "mcp"],
      env: {},
    });
    const s = JSON.parse(rd(".claude", "settings.json"));
    expect(s.permissions.deny).toContain("Read(**/.prompt-to-store/secrets.json)");
    expect(s.permissions.deny).toHaveLength(3);
    expect(s.permissions.allow).toContain("mcp__prompt-to-store__state_get");
    expect(JSON.parse(rd(".cursor", "mcp.json")).mcpServers["prompt-to-store"].command).toBe("npx");
    const t = parseToml(rd(".codex", "config.toml")) as any;
    expect(t.model).toBe("gpt-5");
    expect(t.mcp_servers.other).toEqual({ command: "y" });
    expect(t.mcp_servers["prompt-to-store"]).toMatchObject({ command: "npx", startup_timeout_sec: 30, tool_timeout_sec: 900 });
    for (const d of [".claude", ".cursor", ".codex"]) {
      expect(rd(d, "skills", "check", "SKILL.md")).toBe("# check\n");
      expect(rd(d, "skills", "prompt-to-store", "rejections.md")).toBe("rej\n");
    }
    const b = backups();
    expect(b.some((f) => f.startsWith(".claude.json.p2s-backup-"))).toBe(true);
    expect(b.some((f) => f.includes("config.toml.p2s-backup-"))).toBe(true);
  });

  it("is idempotent", async () => {
    await run([...AGENTS, "--yes"]);
    const before = backups().length;
    const snap = rd(".claude.json") + rd(".claude", "settings.json") + rd(".codex", "config.toml");
    expect(await run([...AGENTS, "--yes"])).toBe(0);
    expect(backups().length).toBe(before);
    expect(rd(".claude.json") + rd(".claude", "settings.json") + rd(".codex", "config.toml")).toBe(snap);
  });

  it("dry-run changes nothing", async () => {
    const before = rd(".claude.json");
    expect(await run([...AGENTS, "--dry-run"])).toBe(0);
    expect(rd(".claude.json")).toBe(before);
    expect(fs.existsSync(path.join(home, ".claude", "settings.json"))).toBe(false);
    expect(backups()).toHaveLength(0);
  });

  it("declining exits 2 and changes nothing", async () => {
    const before = rd(".claude.json");
    expect(await runSetup(AGENTS, { home, skillsDir: skills, ...quiet, ask: async () => "n" })).toBe(2);
    expect(rd(".claude.json")).toBe(before);
  });

  it("--local uses node + dist/cli.js", async () => {
    await run([...AGENTS, "--yes", "--local"]);
    const e = JSON.parse(rd(".cursor", "mcp.json")).mcpServers["prompt-to-store"];
    expect(e.command).toBe("node");
    expect(e.args[0]).toMatch(/dist[\\/]cli\.js$/);
    expect(e.args[1]).toBe("mcp");
  });

  it("uninstalls our entries, keeps others and backups", async () => {
    await run([...AGENTS, "--yes"]);
    expect(await run([...AGENTS, "--yes", "--uninstall"])).toBe(0);
    const c = JSON.parse(rd(".claude.json"));
    expect(c.mcpServers).toEqual({ other: { command: "x" } });
    expect(c.numStartups).toBe(3);
    const s = JSON.parse(rd(".claude", "settings.json"));
    expect(s.permissions).toBeUndefined();
    expect(JSON.parse(rd(".cursor", "mcp.json")).mcpServers).toBeUndefined();
    const t = parseToml(rd(".codex", "config.toml")) as any;
    expect(Object.keys(t.mcp_servers)).toEqual(["other"]);
    expect(fs.existsSync(path.join(home, ".claude", "skills", "check"))).toBe(false);
    expect(backups().length).toBeGreaterThan(0);
  });

  it("rejects unknown agents", async () => {
    expect(await run(["--agents", "nope"])).toBe(1);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { PKG_ROOT } from "../version.js";

export interface SetupOptions {
  /** Directory holding skills/<name>/SKILL.md (defaults to PKG_ROOT/skills). */
  skillsDir?: string;
  /** Home dir override (defaults to $P2S_HOME, then os.homedir()). */
  home?: string;
  /** Output sink (defaults to console.log). */
  log?: (line: string) => void;
  /** Answer source for the y/N prompt. */
  ask?: (question: string) => Promise<string>;
}

const SERVER = "prompt-to-store";
const NPX_ARGS = ["-y", "prompt-to-store@latest", "mcp"];
const DENY = [
  "Read(**/.prompt-to-store/secrets.json)",
  "Edit(**/.prompt-to-store/secrets.json)",
  "Bash(cat *secrets.json*)",
];
const ALLOW = ["mcp__prompt-to-store__state_get", "mcp__prompt-to-store__check_results"];

type Json = Record<string, any>;
type AgentId = "claude" | "cursor" | "codex" | "gemini" | "windsurf";
const ALL_AGENTS: AgentId[] = ["claude", "cursor", "codex", "gemini", "windsurf"];

interface Flags {
  yes: boolean;
  dryRun: boolean;
  uninstall: boolean;
  local: boolean;
  agents: AgentId[] | null;
}

/** A planned write of one whole file. */
interface FileChange {
  file: string;
  /** New content; null = leave (only used for removal of skill files). */
  content: Buffer | string;
  existed: boolean;
}
interface Plan {
  agent: AgentId;
  label: string;
  lines: string[];
  writes: FileChange[];
  /** Directories to remove (uninstall of skills). */
  removeDirs: string[];
}

function parseArgs(args: string[]): Flags | string {
  const f: Flags = { yes: false, dryRun: false, uninstall: false, local: false, agents: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--dry-run") f.dryRun = true;
    else if (a === "--uninstall") f.uninstall = true;
    else if (a === "--local") f.local = true;
    else if (a === "--agents" || a.startsWith("--agents=")) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      if (!v) return "--agents needs a value, e.g. --agents claude,cursor,codex";
      const list = v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      for (const s of list) if (!ALL_AGENTS.includes(s as AgentId)) return `Unknown agent "${s}". Known: ${ALL_AGENTS.join(", ")}`;
      f.agents = list as AgentId[];
    } else return `Unknown option "${a}"`;
  }
  return f;
}

function onPath(cmd: string): boolean {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      try {
        fs.accessSync(path.join(dir, cmd + e), fs.constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}

const exists = (p: string) => fs.existsSync(p);

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson(file: string): Json {
  const t = readText(file);
  if (t === null || t.trim() === "") return {};
  try {
    const v = JSON.parse(t);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new Error(`Cannot parse ${file} as a JSON object — fix or remove it, then re-run.`);
}

/** smol-toml parses integers as bigint when they are large; keep safe ones as numbers so equality checks hold. */
function normalizeToml(v: unknown): unknown {
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v;
  if (Array.isArray(v)) return v.map(normalizeToml);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeToml(x)]));
  return v;
}

function readTomlFile(file: string): Json {
  const t = readText(file);
  if (t === null || t.trim() === "") return {};
  try {
    return normalizeToml(parseToml(t)) as Json;
  } catch (e) {
    throw new Error(`Cannot parse ${file} as TOML (${(e as Error).message}).`);
  }
}

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Add (or update) one entry in a map under `key`; returns diff lines. */
function setEntry(root: Json, key: string, name: string, value: Json): string[] {
  if (!isObj(root[key])) root[key] = {};
  const cur = root[key][name];
  if (isDeepStrictEqual(cur, value)) return [];
  root[key][name] = value;
  return [`${cur === undefined ? "+" : "~"} ${key}.${name}`];
}

function removeEntry(root: Json, key: string, name: string): string[] {
  if (!isObj(root[key]) || !(name in root[key])) return [];
  delete root[key][name];
  if (Object.keys(root[key]).length === 0) delete root[key];
  return [`- ${key}.${name}`];
}

/** Plan an edit of a JSON/TOML config file. */
function planConfig(
  file: string,
  format: "json" | "toml",
  mutate: (root: Json) => string[],
): { lines: string[]; write?: FileChange } {
  const existed = exists(file);
  const root = format === "json" ? readJson(file) : readTomlFile(file);
  const lines = mutate(root);
  if (lines.length === 0) return { lines };
  const content = format === "json" ? JSON.stringify(root, null, 2) + "\n" : stringifyToml(root) + "\n";
  return { lines, write: { file, content, existed } };
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out.sort();
}

function skillNames(skillsDir: string): string[] {
  try {
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function planSkills(skillsSrc: string, destRoot: string, uninstall: boolean, tilde: (p: string) => string) {
  const names = skillNames(skillsSrc);
  const lines: string[] = [];
  const writes: FileChange[] = [];
  const removeDirs: string[] = [];
  if (uninstall) {
    const present = names.filter((n) => exists(path.join(destRoot, n)));
    for (const n of present) removeDirs.push(path.join(destRoot, n));
    if (present.length) lines.push(`- ${present.length} skills ← ${tilde(destRoot)}`);
    return { lines, writes, removeDirs };
  }
  let added = 0;
  let updated = 0;
  for (const n of names) {
    let skillNew = false;
    let skillChanged = false;
    for (const rel of listFiles(path.join(skillsSrc, n))) {
      const src = fs.readFileSync(path.join(skillsSrc, n, rel));
      const dest = path.join(destRoot, n, rel);
      const cur = exists(dest) ? fs.readFileSync(dest) : null;
      if (cur && cur.equals(src)) continue;
      writes.push({ file: dest, content: src, existed: cur !== null });
      skillChanged = true;
      if (cur === null && !exists(path.join(destRoot, n))) skillNew = true;
    }
    if (skillChanged) skillNew ? added++ : updated++;
  }
  if (added) lines.push(`+ ${added} skills → ${tilde(destRoot)}`);
  if (updated) lines.push(`~ ${updated} skills updated in ${tilde(destRoot)}`);
  return { lines, writes, removeDirs };
}

function addUnique(arr: unknown, values: string[]): { arr: string[]; added: string[] } {
  const out = Array.isArray(arr) ? [...arr] : [];
  const added = values.filter((v) => !out.includes(v));
  out.push(...added);
  return { arr: out, added };
}

export async function runSetup(args: string[], opts: SetupOptions = {}): Promise<number> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    log(`✖ ${parsed}`);
    log("Usage: prompt-to-store setup [--dry-run] [--yes] [--uninstall] [--local] [--agents claude,cursor,codex]");
    return 1;
  }
  const flags = parsed;
  const home = path.resolve(opts.home ?? process.env.P2S_HOME ?? os.homedir());
  const skillsSrc = opts.skillsDir ?? path.join(PKG_ROOT, "skills");
  const tilde = (p: string) => (p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p);
  const h = (...p: string[]) => path.join(home, ...p);

  const command = flags.local ? "node" : "npx";
  const serverArgs = flags.local ? [path.join(PKG_ROOT, "dist", "cli.js"), "mcp"] : NPX_ARGS;
  const un = flags.uninstall;

  const detect: Record<AgentId, () => boolean> = {
    claude: () => exists(h(".claude")) || exists(h(".claude.json")) || onPath("claude"),
    cursor: () => exists(h(".cursor")) || onPath("cursor"),
    codex: () => exists(h(".codex")) || onPath("codex"),
    gemini: () => exists(h(".gemini")) || onPath("gemini"),
    windsurf: () => exists(h(".codeium", "windsurf")) || exists(h(".codeium")),
  };
  const labels: Record<AgentId, string> = {
    claude: "Claude Code",
    cursor: "Cursor",
    codex: "Codex",
    gemini: "Gemini CLI",
    windsurf: "Windsurf",
  };

  const candidates = flags.agents ?? ALL_AGENTS;
  const detected = candidates.filter((a) => detect[a]());
  log(`🚢 prompt-to-store setup${flags.dryRun ? " (dry run)" : ""}${un ? " — uninstall" : ""}`);
  if (detected.length === 0) {
    log("No supported coding agents detected (Claude Code, Cursor, Codex, Gemini CLI, Windsurf).");
    log("Install one, or pass --agents to force a target.");
    return 2;
  }
  log(`Detected: ${detected.map((a) => labels[a]).join(", ")}\n`);

  const mkMcp = (extra: Json = {}) => ({ command, args: serverArgs, ...extra });
  const plans: Plan[] = [];

  try {
    for (const agent of detected) {
      const plan: Plan = { agent, label: labels[agent], lines: [], writes: [], removeDirs: [] };
      const addConfig = (file: string, fmt: "json" | "toml", mutate: (r: Json) => string[]) => {
        const r = planConfig(file, fmt, mutate);
        if (r.lines.length) plan.lines.push(...r.lines.map((l) => `  ${l}   (${tilde(file)})`));
        if (r.write) plan.writes.push(r.write);
      };
      const addSkills = (dir: string) => {
        const s = planSkills(skillsSrc, dir, un, tilde);
        plan.lines.push(...s.lines.map((l) => `  ${l}`));
        plan.writes.push(...s.writes);
        plan.removeDirs.push(...s.removeDirs);
      };
      const mcpMap = (file: string, value: Json) =>
        addConfig(file, "json", (r) => (un ? removeEntry(r, "mcpServers", SERVER) : setEntry(r, "mcpServers", SERVER, value)));

      if (agent === "claude") {
        mcpMap(h(".claude.json"), { type: "stdio", ...mkMcp(), env: {} });
        addSkills(h(".claude", "skills"));
        addConfig(h(".claude", "settings.json"), "json", (r) => {
          const lines: string[] = [];
          if (un) {
            const perms = r.permissions;
            if (!isObj(perms)) return lines;
            for (const [k, vals] of [["deny", DENY], ["allow", ALLOW]] as const) {
              if (!Array.isArray(perms[k])) continue;
              const gone = vals.filter((v) => perms[k].includes(v));
              if (!gone.length) continue;
              perms[k] = perms[k].filter((v: string) => !vals.includes(v));
              if (perms[k].length === 0) delete perms[k];
              lines.push(...gone.map((v) => `- ${k} ${v}`));
            }
            if (Object.keys(perms).length === 0) delete r.permissions;
            return lines;
          }
          if (!isObj(r.permissions)) r.permissions = {};
          for (const [k, vals] of [["deny", DENY], ["allow", ALLOW]] as const) {
            const { arr, added } = addUnique(r.permissions[k], vals);
            if (added.length) {
              r.permissions[k] = arr;
              lines.push(...added.map((v) => `+ ${k} ${v}`));
            }
          }
          return lines;
        });
      } else if (agent === "cursor") {
        mcpMap(h(".cursor", "mcp.json"), mkMcp());
        if (exists(h(".cursor"))) addSkills(h(".cursor", "skills"));
      } else if (agent === "codex") {
        const entry = { command, args: serverArgs, startup_timeout_sec: 30, tool_timeout_sec: 900 };
        addConfig(h(".codex", "config.toml"), "toml", (r) => {
          if (un) {
            if (!isObj(r.mcp_servers) || !(SERVER in r.mcp_servers)) return [];
            delete r.mcp_servers[SERVER];
            if (Object.keys(r.mcp_servers).length === 0) delete r.mcp_servers;
            return [`- mcp_servers.${SERVER}`];
          }
          return setEntry(r, "mcp_servers", SERVER, entry);
        });
        addSkills(h(".codex", "skills"));
      } else if (agent === "gemini") {
        mcpMap(h(".gemini", "settings.json"), mkMcp({ timeout: 900000 }));
      } else if (agent === "windsurf") {
        mcpMap(h(".codeium", "windsurf", "mcp_config.json"), mkMcp());
      }
      plans.push(plan);
    }
  } catch (e) {
    log(`✖ ${(e as Error).message}`);
    return 1;
  }

  // Show the plan.
  let pending = 0;
  for (const p of plans) {
    log(`${p.label}`);
    if (p.lines.length === 0) log(`  ✓ ${un ? "nothing to remove" : "already set up — no changes"}`);
    else for (const l of p.lines) log(l);
    pending += p.writes.length + p.removeDirs.length;
  }
  log("");
  if (pending === 0) {
    log(un ? "Nothing to uninstall." : "✓ Everything is already installed. Nothing to do.");
    return 0;
  }
  const backups = plans.flatMap((p) => p.writes.filter((w) => w.existed && isConfig(w.file)));
  if (backups.length) log("Backups (next to each changed file): <file>.p2s-backup-<timestamp>");
  if (flags.dryRun) {
    log("Dry run — no files were changed.");
    return 0;
  }

  if (!flags.yes) {
    const ask =
      opts.ask ??
      ((q: string) =>
        new Promise<string>((resolve) => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          let done = false;
          rl.on("close", () => !done && resolve(""));
          rl.question(q, (a) => {
            done = true;
            rl.close();
            resolve(a);
          });
        }));
    const ans = (await ask(`Apply these changes? [y/N] `)).trim().toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      log("Declined — nothing was changed.");
      return 2;
    }
  }

  // Apply.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const madeBackups: string[] = [];
  try {
    for (const p of plans) {
      for (const d of p.removeDirs) fs.rmSync(d, { recursive: true, force: true });
      for (const w of p.writes) {
        if (w.existed && isConfig(w.file)) {
          const b = `${w.file}.p2s-backup-${ts}`;
          fs.copyFileSync(w.file, b);
          madeBackups.push(b);
        }
        fs.mkdirSync(path.dirname(w.file), { recursive: true });
        fs.writeFileSync(w.file, w.content);
      }
    }
  } catch (e) {
    log(`✖ ${(e as Error).message}`);
    return 1;
  }

  log("");
  log(un ? "✓ Uninstalled (backups are kept)." : "✓ Installed.");
  if (madeBackups.length) {
    log("Backups:");
    for (const b of madeBackups) log(`  ${tilde(b)}`);
  }
  if (!un) {
    log("\nNext steps:");
    log(`  Restart ${detected.map((a) => labels[a]).join(" / ")}, then ask:`);
    log('  "Build a habit tracker with daily streaks and send me a test build."');
  }
  return 0;

  /** Config files (json/toml) get a backup; skill files are plain copies of ours... unless they existed and differ. */
  function isConfig(file: string): boolean {
    return /\.(json|toml)$/.test(file) && !file.includes(`${path.sep}skills${path.sep}`);
  }
}

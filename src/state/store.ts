import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { emptyState, State, type LogEntry, type StageName, type StageStatus } from "./schema.js";

export const DIR_NAME = ".prompt-to-store";
const MAX_LOG = 500;
const MAX_CHECKS = 20;
const MAX_BUILDS = 50;

export interface Paths {
  root: string;
  dir: string;
  state: string;
  secrets: string;
  spec: string;
  checks: string;
  screenshots: string;
  ui: string;
}

export function paths(projectRoot: string): Paths {
  const root = path.resolve(projectRoot);
  const dir = path.join(root, DIR_NAME);
  return {
    root,
    dir,
    state: path.join(dir, "state.json"),
    secrets: path.join(dir, "secrets.json"),
    spec: path.join(dir, "spec.md"),
    checks: path.join(dir, "checks"),
    screenshots: path.join(dir, "checks", "screens"),
    ui: path.join(dir, "ui.json"),
  };
}

/** Walk up from `start` looking for an existing .prompt-to-store dir or a pubspec.yaml. */
export function findProjectRoot(start = process.cwd()): string {
  let cur = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cur, DIR_NAME)) || fs.existsSync(path.join(cur, "pubspec.yaml"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(start);
    cur = parent;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function ensureDir(p: Paths) {
  fs.mkdirSync(p.dir, { recursive: true });
  // secrets never get committed; ui.json holds the local UI token/port. Merge into any existing file.
  const gi = path.join(p.dir, ".gitignore");
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = cur.split(/\r?\n/);
  const missing = ["secrets.json", "ui.json", "*.lock", "keys/", "builds/"].filter((l) => !lines.includes(l));
  if (missing.length) fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
}

function atomicWrite(file: string, data: string, mode?: number) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

/** Tiny cross-process lock using O_EXCL lockfiles; stale after 10s. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.closeSync(fd);
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 10_000) fs.rmSync(lock, { force: true });
      } catch {
        /* lock vanished */
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${lock}`);
      const until = Date.now() + 15;
      while (Date.now() < until) {
        /* spin briefly; sync by design so callers stay simple */
      }
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

export class StateStore {
  readonly p: Paths;
  constructor(projectRoot: string) {
    this.p = paths(projectRoot);
  }

  exists(): boolean {
    return fs.existsSync(this.p.state);
  }

  read(): State {
    if (!this.exists()) return emptyState();
    const raw = fs.readFileSync(this.p.state, "utf8");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`state.json is not valid JSON (${(e as Error).message}). Fix or delete ${this.p.state}.`);
    }
    const parsed = State.safeParse(json);
    if (!parsed.success) {
      throw new Error(`state.json failed validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    return parsed.data;
  }

  init(): State {
    ensureDir(this.p);
    if (this.exists()) return this.read();
    const s = emptyState();
    atomicWrite(this.p.state, JSON.stringify(s, null, 2) + "\n");
    return s;
  }

  /** Read-modify-write under a lock. The mutator may mutate in place or return a new state. */
  update(mutator: (s: State) => State | void): State {
    ensureDir(this.p);
    return withLock(this.p.state, () => {
      const cur = this.read();
      const next = mutator(cur) ?? cur;
      next.updatedAt = nowIso();
      if (next.log.length > MAX_LOG) next.log = next.log.slice(-MAX_LOG);
      if (next.checks.length > MAX_CHECKS) next.checks = next.checks.slice(-MAX_CHECKS);
      if (next.builds.length > MAX_BUILDS) next.builds = next.builds.slice(-MAX_BUILDS);
      const valid = State.parse(next);
      atomicWrite(this.p.state, JSON.stringify(valid, null, 2) + "\n");
      return valid;
    });
  }

  log(source: string, message: string, level: LogEntry["level"] = "info"): State {
    return this.update((s) => {
      s.log.push({ at: nowIso(), level, source, message });
    });
  }

  setStage(stage: StageName, status: StageStatus, note?: string): State {
    return this.update((s) => {
      s.stages[stage] = { status, note, updatedAt: nowIso() };
      s.log.push({
        at: nowIso(),
        level: status === "failed" ? "error" : status === "done" ? "success" : "info",
        source: "stage",
        message: `${stage} → ${status}${note ? `: ${note}` : ""}`,
      });
    });
  }

  /** Watch state.json for changes (used by the UI for live updates). */
  watch(onChange: () => void): () => void {
    ensureDir(this.p);
    let timer: NodeJS.Timeout | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 50);
    };
    // fs.watch on the directory survives atomic renames of the file.
    const w = fs.watch(this.p.dir, (_ev, name) => {
      if (!name || String(name) === "state.json") fire();
    });
    return () => w.close();
  }
}

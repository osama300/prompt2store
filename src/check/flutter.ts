import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

/** Where prompt-to-store installs its own Flutter SDK when the user has none. */
export const MANAGED_FLUTTER = path.join(os.homedir(), ".prompt-to-store", "flutter");

const exe = (name: string) => (process.platform === "win32" ? `${name}.bat` : name);

export function findFlutter(): string | undefined {
  const candidates: string[] = [];
  if (process.env.FLUTTER_ROOT) candidates.push(path.join(process.env.FLUTTER_ROOT, "bin", exe("flutter")));
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe("flutter")));
  candidates.push(path.join(MANAGED_FLUTTER, "bin", exe("flutter")));
  candidates.push(path.join(os.homedir(), "flutter", "bin", exe("flutter")));
  candidates.push(path.join(os.homedir(), "development", "flutter", "bin", exe("flutter")));
  candidates.push("/opt/flutter/bin/flutter");
  return candidates.find((c) => fs.existsSync(c));
}

export function flutterRootOf(flutterBin: string) {
  return path.dirname(path.dirname(flutterBin));
}

export function hasAndroidSdk(): boolean {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Library", "Android", "sdk"), path.join(os.homedir(), "Android", "Sdk")];
  return roots.some((r) => r && fs.existsSync(path.join(r, "platform-tools")));
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export function run(cmd: string, args: string[], cwd: string, timeoutMs = 10 * 60_000, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, CI: "true", FLUTTER_SUPPRESS_ANALYTICS: "true", PUB_ENVIRONMENT: "prompt-to-store", ...env },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (s: string, chunk: Buffer) => (s.length > 2_000_000 ? s : s + chunk.toString());
    child.stdout.on("data", (c) => (stdout = cap(stdout, c)));
    child.stderr.on("data", (c) => (stderr = cap(stderr, c)));
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 127, stdout, stderr: stderr + String(e), durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr, durationMs: Date.now() - started, timedOut });
    });
  });
}

/** Clone the stable Flutter SDK into ~/.prompt-to-store/flutter (no admin rights needed). */
export async function installFlutter(): Promise<{ ok: boolean; flutter?: string; output: string }> {
  if (fs.existsSync(path.join(MANAGED_FLUTTER, "bin", exe("flutter")))) {
    return { ok: true, flutter: path.join(MANAGED_FLUTTER, "bin", exe("flutter")), output: "already installed" };
  }
  const git = spawnSync("git", ["--version"]);
  if (git.status !== 0) {
    return { ok: false, output: "git is required to download Flutter. Install git (macOS: `xcode-select --install`; Windows: https://git-scm.com) and retry." };
  }
  fs.mkdirSync(path.dirname(MANAGED_FLUTTER), { recursive: true });
  const r = await run("git", ["clone", "--depth", "1", "-b", "stable", "https://github.com/flutter/flutter.git", MANAGED_FLUTTER], os.homedir(), 20 * 60_000);
  if (r.code !== 0) return { ok: false, output: r.stderr.slice(-2000) };
  const bin = path.join(MANAGED_FLUTTER, "bin", exe("flutter"));
  const v = await run(bin, ["--version"], os.homedir(), 20 * 60_000);
  return { ok: v.code === 0, flutter: bin, output: (v.stdout + v.stderr).slice(-1500) };
}

export interface AnalyzerIssue {
  severity: "ERROR" | "WARNING" | "INFO";
  type: string;
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
}

/** Parse `flutter analyze --machine` output: SEVERITY|TYPE|CODE|FILE|LINE|COL|LEN|MESSAGE */
export function parseAnalyzerMachine(out: string, root: string): AnalyzerIssue[] {
  const issues: AnalyzerIssue[] = [];
  for (const line of out.split(/\r?\n/)) {
    const parts = line.split("|");
    if (parts.length < 8 || !["ERROR", "WARNING", "INFO"].includes(parts[0])) continue;
    const msg = parts.slice(7).join("|").replace(/\\\|/g, "|");
    issues.push({
      severity: parts[0] as AnalyzerIssue["severity"],
      type: parts[1],
      code: parts[2].toLowerCase(),
      file: path.relative(root, parts[3]) || parts[3],
      line: Number(parts[4]),
      column: Number(parts[5]),
      message: msg,
    });
  }
  return issues;
}

/** Extract failing test names from `flutter test` (expanded reporter) output. */
export function parseTestFailures(out: string): string[] {
  const fails = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\d+:\d+ \+\d+(?: ~\d+)? -\d+: (.+?) \[E\]\s*$/);
    if (m) fails.add(m[1].trim());
  }
  return [...fails];
}

export function parseTestSummary(out: string): { passed: number; failed: number; skipped: number } {
  // last progress line looks like: "00:05 +12 ~1 -2: Some tests failed."
  let passed = 0,
    failed = 0,
    skipped = 0;
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\d+:\d+ \+(\d+)(?: ~(\d+))?(?: -(\d+))?:/);
    if (m) {
      passed = Number(m[1]);
      skipped = Number(m[2] ?? 0);
      failed = Number(m[3] ?? 0);
    }
  }
  return { passed, failed, skipped };
}

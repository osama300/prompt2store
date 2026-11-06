import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, GateError, type ToolDef } from "../context.js";
import { requireFlutterProject, requirePlanApproved } from "../gates.js";
import { newId, nowIso } from "../../state/store.js";
import type { CheckItem, CheckRun } from "../../state/schema.js";
import {
  findFlutter,
  flutterRootOf,
  hasAndroidSdk,
  installFlutter,
  parseAnalyzerMachine,
  parseTestFailures,
  parseTestSummary,
  run,
} from "../../check/flutter.js";
import { SCREENSHOT_TEST_FILE, screenshotTestSource } from "../../check/screenshots.js";

const toolsEnv = defineTool({
  name: "env_check",
  title: "Check the local toolchain",
  description:
    "Checks for the Flutter SDK, git and the Android SDK. If Flutter is missing, pass install_flutter=true to download it into ~/.prompt-to-store/flutter (no admin rights; ~1.5 GB). The user does not need to install anything themselves.",
  input: { install_flutter: z.boolean().default(false) },
  async run(_ctx, a) {
    let flutter = findFlutter();
    let installOutput: string | undefined;
    if (!flutter && a.install_flutter) {
      const r = await installFlutter();
      installOutput = r.output;
      flutter = r.flutter;
    }
    let version: string | undefined;
    if (flutter) {
      const v = await run(flutter, ["--version", "--machine"], process.cwd(), 5 * 60_000);
      try {
        const j = JSON.parse(v.stdout.slice(v.stdout.indexOf("{")));
        version = `Flutter ${j.frameworkVersion} • Dart ${j.dartSdkVersion}`;
      } catch {
        version = v.stdout.split("\n")[0];
      }
    }
    const git = await run("git", ["--version"], process.cwd(), 10_000);
    return {
      flutter: flutter ? { path: flutter, version } : null,
      git: git.code === 0 ? git.stdout.trim() : null,
      android_sdk: hasAndroidSdk(),
      install_output: installOutput,
      next_step: !flutter
        ? "Flutter is missing. Call env_check(install_flutter=true) to install it automatically."
        : `Use ${flutter} for flutter commands (it may not be on PATH). Android SDK is optional: cloud builds run on Codemagic.`,
    };
  },
});

const checkRun = defineTool({
  name: "check_run",
  title: "Run checks (analyze, tests, screenshots, build)",
  description:
    "Runs the Check stage in the Flutter project: pub get, format, analyze, unit/widget tests, headless screenshots of every screen (no emulator needed), and a local debug build when the Android SDK is present. Results and screenshots appear in the local UI. Shipping is blocked until this passes. Fix what it reports and run it again.",
  input: {
    screenshots: z.boolean().default(true).describe("Render screenshots via test/p2s_screenshots_test.dart (created from a template if missing)"),
    build: z.boolean().default(true).describe("Run a local debug APK build if the Android SDK is installed"),
  },
  gate(ctx, _a, s) {
    requirePlanApproved(ctx, s);
    requireFlutterProject(ctx);
  },
  async run(ctx, a) {
    const flutter = findFlutter();
    if (!flutter) throw new GateError("Flutter SDK not found.", "Call env_check(install_flutter=true), then check_run again.");
    const root = ctx.root;
    const id = newId("chk");
    const startedAt = nowIso();
    ctx.store.update((s) => {
      s.stages.check = { status: "in_progress", updatedAt: startedAt };
      s.log.push({ at: startedAt, level: "info", source: "check", message: "Running checks…" });
    });
    const items: CheckItem[] = [];
    const add = (i: CheckItem) => {
      items.push(i);
      ctx.store.log("check", `${i.status.toUpperCase()} ${i.name}: ${i.summary}`, i.status === "failed" ? "error" : i.status === "warning" ? "warn" : "info");
    };

    // 1. pub get
    const pub = await run(flutter, ["pub", "get"], root, 10 * 60_000);
    add({
      name: "dependencies",
      status: pub.code === 0 ? "passed" : "failed",
      summary: pub.code === 0 ? "flutter pub get OK" : "flutter pub get failed",
      details: pub.code === 0 ? [] : tail(pub.stderr || pub.stdout, 30),
      durationMs: pub.durationMs,
    });

    if (pub.code === 0) {
      // 2. analyze (errors fail, warnings warn)
      const an = await run(flutter, ["analyze", "--machine", "--no-pub"], root, 10 * 60_000);
      const issues = parseAnalyzerMachine(an.stderr + "\n" + an.stdout, root);
      const errors = issues.filter((i) => i.severity === "ERROR");
      const warnings = issues.filter((i) => i.severity === "WARNING");
      const fmtIssue = (i: (typeof issues)[number]) => `${i.severity} ${i.file}:${i.line}:${i.column} ${i.message} (${i.code})`;
      add({
        name: "analyze",
        status: errors.length ? "failed" : warnings.length ? "warning" : "passed",
        summary: `${errors.length} errors, ${warnings.length} warnings, ${issues.length - errors.length - warnings.length} infos`,
        details: [...errors, ...warnings].slice(0, 40).map(fmtIssue),
        durationMs: an.durationMs,
      });

      // 3. format (warning only)
      const dart = path.join(path.dirname(flutter), process.platform === "win32" ? "dart.bat" : "dart");
      const fmt = await run(dart, ["format", "--output=none", "--set-exit-if-changed", "lib", "test"].filter((x) => x !== "test" || fs.existsSync(path.join(root, "test"))), root, 2 * 60_000);
      add({
        name: "format",
        status: fmt.code === 0 ? "passed" : "warning",
        summary: fmt.code === 0 ? "Code is formatted" : "Some files are not formatted (run `dart format lib test`)",
        details: fmt.code === 0 ? [] : tail(fmt.stdout, 15),
        durationMs: fmt.durationMs,
      });

      // 4. screenshots test file
      const shotsDir = ctx.store.p.screenshots;
      if (a.screenshots) {
        const testFile = path.join(root, SCREENSHOT_TEST_FILE);
        if (!fs.existsSync(testFile)) {
          fs.mkdirSync(path.dirname(testFile), { recursive: true });
          fs.writeFileSync(testFile, screenshotTestSource(readPackageName(root)));
          add({
            name: "screenshots-setup",
            status: "warning",
            summary: `Created ${SCREENSHOT_TEST_FILE} from the template. Edit its SCREENS list so every screen of the app is captured.`,
            details: [],
          });
        }
      }

      // 5. tests (all tests except the screenshot test)
      const testDir = path.join(root, "test");
      const otherTests = fs.existsSync(testDir)
        ? walk(testDir).filter((f) => f.endsWith("_test.dart") && !f.endsWith(SCREENSHOT_TEST_FILE.split("/").pop()!))
        : [];
      if (otherTests.length) {
        const t = await run(flutter, ["test", "--no-pub", "--reporter", "expanded", ...otherTests.map((f) => path.relative(root, f))], root, 15 * 60_000);
        const sum = parseTestSummary(t.stdout);
        const fails = parseTestFailures(t.stdout);
        add({
          name: "tests",
          status: t.code === 0 ? "passed" : "failed",
          summary: `${sum.passed} passed, ${sum.failed} failed, ${sum.skipped} skipped`,
          details: t.code === 0 ? [] : [...fails.map((f) => `FAILED: ${f}`), ...tail(t.stdout, 40)],
          durationMs: t.durationMs,
        });
      } else {
        add({ name: "tests", status: "warning", summary: "No tests found in test/. Add at least one widget test for the main flow.", details: [] });
      }

      // 6. screenshots run
      if (a.screenshots && fs.existsSync(path.join(root, SCREENSHOT_TEST_FILE))) {
        fs.rmSync(shotsDir, { recursive: true, force: true });
        fs.mkdirSync(shotsDir, { recursive: true });
        const s = await run(flutter, ["test", "--no-pub", "--update-goldens", SCREENSHOT_TEST_FILE], root, 10 * 60_000, {
          P2S_SCREENSHOT_DIR: shotsDir,
          FLUTTER_ROOT: flutterRootOf(flutter),
        });
        const pngs = fs.existsSync(shotsDir) ? walk(shotsDir).filter((f) => f.endsWith(".png")) : [];
        add({
          name: "screenshots",
          status: s.code === 0 && pngs.length ? "passed" : "failed",
          summary: s.code === 0 ? `${pngs.length} screenshots rendered` : "Screenshot test failed (a screen threw while rendering)",
          details: s.code === 0 ? pngs.map((p) => path.relative(root, p)) : tail(s.stdout + s.stderr, 40),
          durationMs: s.durationMs,
        });
      }

      // 7. local build
      if (a.build) {
        if (hasAndroidSdk()) {
          const b = await run(flutter, ["build", "apk", "--debug", "--no-pub"], root, 20 * 60_000);
          add({
            name: "build",
            status: b.code === 0 ? "passed" : "failed",
            summary: b.code === 0 ? "Debug APK built: build/app/outputs/flutter-apk/app-debug.apk" : "Local Android build failed",
            details: b.code === 0 ? [] : tail(b.stderr || b.stdout, 40),
            durationMs: b.durationMs,
          });
        } else {
          add({ name: "build", status: "skipped", summary: "No Android SDK locally — the full build runs on Codemagic. Compile errors were checked by analyze.", details: [] });
        }
      }
    }

    const passed = !items.some((i) => i.status === "failed");
    const shots = fs.existsSync(ctx.store.p.screenshots) ? walk(ctx.store.p.screenshots).filter((f) => f.endsWith(".png")).map((f) => path.relative(ctx.store.p.dir, f)) : [];
    const runRec: CheckRun = { id, startedAt, finishedAt: nowIso(), passed, items, screenshots: shots };
    fs.mkdirSync(ctx.store.p.checks, { recursive: true });
    fs.writeFileSync(path.join(ctx.store.p.checks, "last.json"), JSON.stringify(runRec, null, 2));
    ctx.store.update((s) => {
      s.checks.push(runRec);
      const t = nowIso();
      s.stages.check = { status: passed ? "done" : "failed", updatedAt: t, note: passed ? undefined : items.filter((i) => i.status === "failed").map((i) => i.name).join(", ") };
      if (passed && s.stages.build.status !== "done") s.stages.build = { status: "done", updatedAt: t };
      s.log.push({ at: t, level: passed ? "success" : "error", source: "check", message: passed ? "All checks passed" : "Checks failed" });
    });
    return {
      passed,
      items: items.map((i) => ({ name: i.name, status: i.status, summary: i.summary, details: i.details.slice(0, 25) })),
      screenshots: shots,
      next_step: passed
        ? "Checks passed. Look at the screenshots (read the PNG files) to confirm the UI looks right, then call ship_test_build."
        : "Fix the failed items and call check_run again.",
    };
  },
});

const checkResults = defineTool({
  name: "check_results",
  title: "Get the last check results",
  description: "Returns the full results of the last check_run, including all analyzer issues, failing tests and screenshot paths (read the PNGs to review the UI).",
  input: {},
  readOnly: true,
  async run(ctx) {
    const s = ctx.store.read();
    const c = s.checks.at(-1);
    if (!c) return { message: "No checks yet. Call check_run." };
    return { ...c, screenshots: c.screenshots.map((p) => path.join(ctx.store.p.dir, p)) };
  },
});

export const checkTools: ToolDef<any>[] = [toolsEnv, checkRun, checkResults];

function tail(s: string, n: number): string[] {
  return s.split(/\r?\n/).filter(Boolean).slice(-n);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readPackageName(root: string): string {
  const pub = fs.readFileSync(path.join(root, "pubspec.yaml"), "utf8");
  return pub.match(/^name:\s*([a-z0-9_]+)/m)?.[1] ?? "app";
}

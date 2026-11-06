import fs from "node:fs";
import path from "node:path";
import { defineTool, GateError } from "../context.js";
import { requirePlanApproved } from "../gates.js";
import { findFlutter, run } from "../../check/flutter.js";
import { nowIso } from "../../state/store.js";

/**
 * `flutter create` derives ids from --org + --project-name (Android: org.snake_name, iOS: org.camelName), which rarely
 * equals the planned bundle id. These helpers set the store-facing ids and display name exactly, without moving
 * Kotlin packages (the Android namespace may differ from applicationId).
 */
export function setAndroidApplicationId(gradle: string, bundleId: string): string {
  return gradle
    .replace(/applicationId\s*=\s*"[^"]*"/, `applicationId = "${bundleId}"`)
    .replace(/applicationId\s+"[^"]*"/, `applicationId "${bundleId}"`);
}

export function setIosBundleId(pbxproj: string, bundleId: string): string {
  return pbxproj.replace(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g, (_m, cur: string) => {
    const v = cur.replace(/"/g, "");
    return `PRODUCT_BUNDLE_IDENTIFIER = ${v.endsWith(".RunnerTests") ? `${bundleId}.RunnerTests` : bundleId};`;
  });
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function setAndroidLabel(manifest: string, name: string): string {
  return manifest.replace(/android:label="[^"]*"/, `android:label="${xmlEscape(name)}"`);
}

export function setIosDisplayName(plist: string, name: string): string {
  const esc = xmlEscape(name);
  if (/<key>CFBundleDisplayName<\/key>/.test(plist)) {
    return plist.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${esc}$2`);
  }
  return plist.replace(/<dict>/, `<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>${esc}</string>`);
}

function edit(file: string, fn: (s: string) => string): boolean {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, "utf8");
  const after = fn(before);
  if (after !== before) fs.writeFileSync(file, after);
  return after !== before;
}

export const appCreate = defineTool({
  name: "app_create",
  title: "Create the Flutter project with the planned identity",
  description:
    "Creates the Flutter project (Android + iOS) in the project folder from the approved plan and sets the store-facing identity exactly: Android applicationId and iOS bundle id = the plan's bundle_id, app display name on both platforms. Use it instead of running `flutter create` and renaming ids by hand. Requires an approved plan; refuses if a Flutter project already exists.",
  input: {},
  gate(ctx, _a, s) {
    requirePlanApproved(ctx, s);
    if (fs.existsSync(path.join(ctx.root, "pubspec.yaml"))) {
      throw new GateError("A Flutter project already exists here.", "Keep building in it; ids can be checked with state_get (project.bundleId).");
    }
  },
  async run(ctx) {
    const flutter = findFlutter();
    if (!flutter) throw new GateError("Flutter SDK not found.", "Call env_check(install_flutter=true), then app_create again.");
    const s = ctx.store.read();
    const { bundleId, name, displayName } = s.project;
    const org = bundleId.split(".").slice(0, -1).join(".") || "com.example";
    const r = await run(
      flutter,
      ["create", "--org", org, "--project-name", name, "--platforms", "android,ios", "--description", displayName || name, "."],
      ctx.root,
      10 * 60_000,
    );
    if (r.code !== 0) throw new Error(`flutter create failed: ${(r.stderr || r.stdout).slice(-1500)}`);
    const changed: string[] = [];
    for (const g of ["android/app/build.gradle.kts", "android/app/build.gradle"]) {
      if (edit(path.join(ctx.root, g), (t) => setAndroidApplicationId(t, bundleId))) changed.push(`${g}: applicationId`);
    }
    if (edit(path.join(ctx.root, "ios/Runner.xcodeproj/project.pbxproj"), (t) => setIosBundleId(t, bundleId))) changed.push("iOS bundle id");
    if (displayName) {
      if (edit(path.join(ctx.root, "android/app/src/main/AndroidManifest.xml"), (t) => setAndroidLabel(t, displayName))) changed.push("Android app name");
      if (edit(path.join(ctx.root, "ios/Runner/Info.plist"), (t) => setIosDisplayName(t, displayName))) changed.push("iOS app name");
    }
    ctx.store.update((st) => {
      st.stages.build = { status: "in_progress", updatedAt: nowIso(), note: "Project created" };
      st.log.push({ at: nowIso(), level: "info", source: "build", message: `Created Flutter project (${bundleId})` });
    });
    return {
      created: true,
      bundle_id: bundleId,
      display_name: displayName,
      updated: changed,
      next_step: "Write the app in lib/ (replace the counter template), add tests, then stage_update(build, done) and check_run.",
    };
  },
});

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * A hash of the app's source, taken when a check passes and compared before shipping, so code edited
 * after the last check can never be shipped unchecked (even if the agent forgets to report the edit).
 */
const ROOTS = ["lib", "test", "assets", "android/app/src/main", "ios/Runner"];
const FILES = ["pubspec.yaml", "pubspec.lock", "android/app/build.gradle", "android/app/build.gradle.kts", "analysis_options.yaml"];
const SKIP = new Set(["build", ".dart_tool", ".gradle", "Pods", ".symlinks", "Flutter", "generated"]);

export function sourceFingerprint(root: string): string {
  const h = crypto.createHash("sha256");
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  for (const r of ROOTS) walk(path.join(root, r));
  for (const f of FILES) if (fs.existsSync(path.join(root, f))) files.push(path.join(root, f));
  for (const f of files.sort()) {
    h.update(path.relative(root, f).split(path.sep).join("/"));
    h.update("\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

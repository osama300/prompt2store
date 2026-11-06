import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, GateError } from "../context.js";
import { requireFlutterProject, requirePlanApproved } from "../gates.js";
import { PKG_ROOT } from "../../version.js";

/**
 * Bundled, OFL-licensed fonts that ship with prompt-to-store, so apps in non-Latin scripts render correctly
 * on every device and in headless screenshots — without the agent having to download anything.
 */
export const FONTS = {
  arabic: {
    family: "IBMPlexSansArabic",
    files: [
      { file: "IBMPlexSansArabic-Regular.ttf" },
      { file: "IBMPlexSansArabic-SemiBold.ttf", weight: 600 },
      { file: "IBMPlexSansArabic-Bold.ttf", weight: 700 },
    ],
  },
} as const;

export function pubspecWithFont(pubspec: string, family: string, assets: { asset: string; weight?: number }[]): string {
  if (new RegExp(`family:\\s*${family}\\b`).test(pubspec)) return pubspec;
  const entry = [
    `    - family: ${family}`,
    `      fonts:`,
    ...assets.flatMap((a) => [`        - asset: ${a.asset}`, ...(a.weight ? [`          weight: ${a.weight}`] : [])]),
  ].join("\n");
  const lines = pubspec.split("\n");
  const flutterIdx = lines.findIndex((l) => /^flutter:\s*(#.*)?$/.test(l));
  if (flutterIdx < 0) return `${pubspec.trimEnd()}\n\nflutter:\n  fonts:\n${entry}\n`;
  // Existing `fonts:` list inside the flutter section?
  let end = lines.length;
  for (let i = flutterIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const fontsIdx = lines.slice(flutterIdx + 1, end).findIndex((l) => /^  fonts:\s*(#.*)?$/.test(l));
  if (fontsIdx >= 0) {
    lines.splice(flutterIdx + 1 + fontsIdx + 1, 0, entry);
  } else {
    lines.splice(flutterIdx + 1, 0, `  fonts:\n${entry}`);
  }
  return lines.join("\n");
}

export const fontAdd = defineTool({
  name: "font_add",
  title: "Add a bundled font for a non-Latin script",
  description:
    "Adds a high-quality bundled font (Arabic: IBM Plex Sans Arabic, OFL license, includes Latin) to the Flutter app: copies the files to assets/fonts/ and declares them in pubspec.yaml. No download needed. Use for any app with Arabic text — without it, Arabic shows as boxes in the headless screenshots. Afterwards set fontFamily in the app's ThemeData as the result says, then run check_run.",
  input: { script: z.enum(["arabic"]).default("arabic") },
  gate(ctx, _a, s) {
    requirePlanApproved(ctx, s);
    requireFlutterProject(ctx);
  },
  async run(ctx, a) {
    const spec = FONTS[a.script];
    const src = path.join(PKG_ROOT, "templates", "fonts");
    if (!fs.existsSync(path.join(src, spec.files[0].file))) {
      throw new GateError("Bundled font files are missing from this prompt-to-store install.", "Reinstall prompt-to-store (npx prompt-to-store@latest setup).");
    }
    const dest = path.join(ctx.root, "assets", "fonts");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of spec.files) fs.copyFileSync(path.join(src, f.file), path.join(dest, f.file));
    fs.copyFileSync(path.join(src, "OFL.txt"), path.join(dest, `${spec.family}-OFL.txt`));
    const pubspecPath = path.join(ctx.root, "pubspec.yaml");
    const before = fs.readFileSync(pubspecPath, "utf8");
    const after = pubspecWithFont(
      before,
      spec.family,
      spec.files.map((f) => ({ asset: `assets/fonts/${f.file}`, weight: "weight" in f ? f.weight : undefined })),
    );
    if (after !== before) fs.writeFileSync(pubspecPath, after);
    ctx.store.log("font", `Added ${spec.family} to the app`);
    return {
      family: spec.family,
      files: spec.files.map((f) => `assets/fonts/${f.file}`),
      pubspec_updated: after !== before,
      next_step: `Set fontFamily: '${spec.family}' in both the light and dark ThemeData (e.g. ThemeData(fontFamily: '${spec.family}', ...)), then run check_run and look at the screenshots.`,
    };
  },
});

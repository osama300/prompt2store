import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (works from src/ via tsx and from dist/). */
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

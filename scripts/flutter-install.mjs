// Installs Flutter the way prompt-to-store does for users without it (archive path when P2S_FLUTTER_INSTALL=archive).
import { installFlutter, findFlutter } from "../dist/check/flutter.js";
const r = await installFlutter();
console.log(r.output);
if (!r.ok) { console.error("FAIL: install failed"); process.exit(1); }
console.log("installed:", r.flutter, "found:", findFlutter());

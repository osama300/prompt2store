// App Store Connect client — implemented by the App Store work package.
import type { VerifyResult } from "../lib/http.js";
import type { SecretFields } from "../secrets/index.js";

export async function verifyAppStore(_fields: SecretFields): Promise<VerifyResult> {
  return { ok: false, error: "not implemented" };
}

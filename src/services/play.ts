// Google Play Android Publisher client — implemented by the Play work package.
import type { VerifyResult } from "../lib/http.js";
import type { SecretFields } from "../secrets/index.js";

export async function verifyPlay(_fields: SecretFields): Promise<VerifyResult> {
  return { ok: false, error: "not implemented" };
}

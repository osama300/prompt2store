import type { ServiceName } from "../state/schema.js";
import type { SecretFields } from "../secrets/index.js";
import type { VerifyResult } from "../lib/http.js";
import { verifyCodemagic } from "./codemagic.js";
import { verifyGithub } from "./github.js";
import { verifyPlay } from "./play.js";
import { verifyAppStore } from "./appstore.js";

/** Validate credentials entered in the local UI before they are saved. */
export const VERIFIERS: Record<ServiceName, (f: SecretFields) => Promise<VerifyResult>> = {
  codemagic: verifyCodemagic,
  github: verifyGithub,
  play: verifyPlay,
  appstore: verifyAppStore,
};

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never touch the developer's or CI machine's real keychain from tests.
    env: { P2S_SECRETS_BACKEND: "file" },
    testTimeout: 30_000,
  },
});

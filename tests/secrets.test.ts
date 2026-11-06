import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Secrets, FileSecretBackend, SECRET_SPEC, redact } from "../src/secrets/index.js";

process.env.P2S_SECRETS_BACKEND = "file";

const ENV_KEYS = Object.values(SECRET_SPEC).flatMap((f) => f.map((x) => x.env));
let tmp: string;
let file: string;
let secrets: Secrets;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-sec-"));
  file = path.join(tmp, ".prompt-to-store", "secrets.json");
  secrets = Secrets.forProject(tmp, file);
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  fs.rmSync(tmp, { recursive: true, force: true });
});

const asc = { issuerId: "issuer-1234", keyId: "KEYID12345", privateKey: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" };

describe("file backend", () => {
  it("is selected by P2S_SECRETS_BACKEND=file", () => {
    expect(secrets.backendKind).toBe("file");
  });

  it("writes secrets.json with mode 0600 and round-trips", () => {
    secrets.set("codemagic", { token: "cm-token-abcdef" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).codemagic).toEqual({ token: "cm-token-abcdef" });
    expect(secrets.get("codemagic")).toEqual({ token: "cm-token-abcdef" });
    expect(secrets.has("codemagic")).toBe(true);
  });

  it("keeps mode 0600 on rewrite and leaves no tmp files", () => {
    secrets.set("codemagic", { token: "aaaaaaaa" });
    secrets.set("github", { token: "bbbbbbbb" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["secrets.json"]);
    expect(secrets.get("codemagic")).toEqual({ token: "aaaaaaaa" });
  });

  it("delete removes only that service", () => {
    secrets.set("codemagic", { token: "aaaaaaaa" });
    secrets.set("github", { token: "bbbbbbbb" });
    secrets.delete("codemagic");
    expect(secrets.get("codemagic")).toBeUndefined();
    expect(secrets.get("github")).toEqual({ token: "bbbbbbbb" });
  });

  it("tolerates a corrupt file", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{nope");
    expect(secrets.get("codemagic")).toBeUndefined();
    secrets.set("codemagic", { token: "aaaaaaaa" });
    expect(secrets.get("codemagic")).toEqual({ token: "aaaaaaaa" });
  });

  it("FileSecretBackend.get on a missing file is undefined", () => {
    expect(new FileSecretBackend(path.join(tmp, "nope.json")).get("play")).toBeUndefined();
  });
});

describe("get() requirements", () => {
  it("appstore needs issuerId, keyId and privateKey", () => {
    // write partial data straight to the backend, bypassing set() validation
    new FileSecretBackend(file).set("appstore", { issuerId: "i", keyId: "k" });
    expect(secrets.get("appstore")).toBeUndefined();
    expect(secrets.has("appstore")).toBe(false);
    new FileSecretBackend(file).set("appstore", asc);
    expect(secrets.get("appstore")).toEqual(asc);
  });

  it("unknown service returns undefined when nothing stored", () => {
    for (const s of ["codemagic", "github", "play", "appstore"] as const) expect(secrets.get(s)).toBeUndefined();
  });

  it("a partial env set for appstore does not count and falls back to the store", () => {
    process.env.P2S_ASC_ISSUER_ID = "env-issuer";
    expect(secrets.get("appstore")).toBeUndefined();
    secrets.set("appstore", asc);
    expect(secrets.get("appstore")).toEqual(asc); // stored values win when env is incomplete
  });
});

describe("env overrides", () => {
  it("P2S_CODEMAGIC_TOKEN works without any stored secret", () => {
    process.env.P2S_CODEMAGIC_TOKEN = "env-token-123";
    expect(secrets.get("codemagic")).toEqual({ token: "env-token-123" });
    expect(secrets.has("codemagic")).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("env wins over the stored value", () => {
    secrets.set("codemagic", { token: "stored-token" });
    process.env.P2S_CODEMAGIC_TOKEN = "env-token-123";
    expect(secrets.get("codemagic")).toEqual({ token: "env-token-123" });
    delete process.env.P2S_CODEMAGIC_TOKEN;
    expect(secrets.get("codemagic")).toEqual({ token: "stored-token" });
  });

  it("a full set of appstore env vars is used", () => {
    process.env.P2S_ASC_ISSUER_ID = "ei";
    process.env.P2S_ASC_KEY_ID = "ek";
    process.env.P2S_ASC_PRIVATE_KEY = "ep";
    expect(secrets.get("appstore")).toEqual({ issuerId: "ei", keyId: "ek", privateKey: "ep" });
  });
});

describe("set()", () => {
  it("trims values", () => {
    secrets.set("github", { token: "  ghp_trimmedtoken  \n" });
    expect(secrets.get("github")).toEqual({ token: "ghp_trimmedtoken" });
  });

  it("drops fields that are not in the spec", () => {
    secrets.set("github", { token: "tttttttt", extra: "junk" });
    expect(secrets.get("github")).toEqual({ token: "tttttttt" });
  });

  it("rejects missing or blank fields with the field label, and stores nothing", () => {
    expect(() => secrets.set("codemagic", {})).toThrow(/Missing Codemagic API token/);
    expect(() => secrets.set("codemagic", { token: "   " })).toThrow(/Missing/);
    expect(() => secrets.set("appstore", { issuerId: "i", keyId: "k" })).toThrow(/Missing Private key/);
    expect(() => secrets.set("appstore", { issuerId: "i", keyId: " ", privateKey: "p" })).toThrow(/Missing Key ID/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("allValues()", () => {
  it("returns stored values of 8+ chars only", () => {
    secrets.set("codemagic", { token: "short" });
    secrets.set("github", { token: "ghp_longenoughtoken" });
    const vals = secrets.allValues();
    expect(vals).toContain("ghp_longenoughtoken");
    expect(vals).not.toContain("short");
  });
  it("includes env-provided values", () => {
    process.env.P2S_CODEMAGIC_TOKEN = "env-token-123";
    expect(secrets.allValues()).toContain("env-token-123");
  });
});

describe("redact()", () => {
  it("removes every occurrence of a secret value", () => {
    const out = redact("token=abcdef123456 and again abcdef123456!", ["abcdef123456"]);
    expect(out).not.toContain("abcdef123456");
    expect(out).toBe("token=[REDACTED] and again [REDACTED]!");
  });

  it("ignores empty values", () => {
    expect(redact("hello", [""])).toBe("hello");
  });

  it("redacts each long line of a multi-line secret even when printed alone", () => {
    const pem = ["-----BEGIN PRIVATE KEY-----", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "KcwggSjAgEAAoIBAQDabcdefghijklmn", "-----END PRIVATE KEY-----"].join("\n");
    const out = redact("log: KcwggSjAgEAAoIBAQDabcdefghijklmn leaked", [pem]);
    expect(out).not.toContain("KcwggSjAgEAAoIBAQDabcdefghijklmn");
    expect(redact(`x ${pem} y`, [pem])).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
  });

  it("handles CRLF line endings in multi-line secrets", () => {
    const pem = "line-one-is-long-enough\r\nline-two-is-long-enough";
    const out = redact("a line-two-is-long-enough b", [pem]);
    expect(out).toBe("a [REDACTED] b");
  });

  it("redacts PEM private key blocks that are not in the known values", () => {
    for (const kind of ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY"]) {
      const text = `before\n-----BEGIN ${kind}-----\nMIIabc\ndef123\n-----END ${kind}-----\nafter`;
      const out = redact(text, []);
      expect(out).toBe("before\n[REDACTED PRIVATE KEY]\nafter");
    }
  });

  it("does not redact public key / certificate PEM blocks", () => {
    const t = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
    expect(redact(t, [])).toBe(t);
  });

  it("redacts GitHub tokens of all prefixes and fine-grained PATs", () => {
    const tok = "A".repeat(36);
    for (const p of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
      expect(redact(`x ${p}_${tok} y`, [])).toBe("x [REDACTED] y");
    }
    expect(redact(`github_pat_${"B".repeat(30)}_${"c".repeat(20)}`, [])).toBe("[REDACTED]");
  });

  it("does not touch short ghp_-like strings or ordinary text", () => {
    expect(redact("ghp_short and plain text", [])).toBe("ghp_short and plain text");
  });
});

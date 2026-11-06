import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { ServiceName } from "../state/schema.js";

/**
 * Secrets never pass through the agent conversation.
 *  - They are entered in the local UI (or via env vars in CI).
 *  - They are stored in the OS keychain (macOS) or in .prompt-to-store/secrets.json (mode 0600, gitignored).
 *  - Only MCP tools read them; tool results never echo them back (see redact()).
 */

export type SecretFields = Record<string, string>;

/** Which fields each service needs. */
export const SECRET_SPEC: Record<ServiceName, { field: string; label: string; env: string }[]> = {
  codemagic: [{ field: "token", label: "Codemagic API token", env: "P2S_CODEMAGIC_TOKEN" }],
  github: [{ field: "token", label: "GitHub token (repo scope)", env: "P2S_GITHUB_TOKEN" }],
  play: [{ field: "serviceAccountJson", label: "Google Play service account JSON", env: "P2S_PLAY_SERVICE_ACCOUNT_JSON" }],
  appstore: [
    { field: "issuerId", label: "Issuer ID", env: "P2S_ASC_ISSUER_ID" },
    { field: "keyId", label: "Key ID", env: "P2S_ASC_KEY_ID" },
    { field: "privateKey", label: "Private key (.p8)", env: "P2S_ASC_PRIVATE_KEY" },
  ],
};

export interface SecretBackend {
  readonly kind: string;
  get(service: ServiceName): SecretFields | undefined;
  set(service: ServiceName, fields: SecretFields): void;
  delete(service: ServiceName): void;
}

export class FileSecretBackend implements SecretBackend {
  readonly kind = "file";
  constructor(private file: string) {}
  private readAll(): Record<string, SecretFields> {
    if (!fs.existsSync(this.file)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }
  private writeAll(all: Record<string, SecretFields>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* windows */
    }
  }
  get(service: ServiceName) {
    return this.readAll()[service];
  }
  set(service: ServiceName, fields: SecretFields) {
    const all = this.readAll();
    all[service] = fields;
    this.writeAll(all);
  }
  delete(service: ServiceName) {
    const all = this.readAll();
    delete all[service];
    this.writeAll(all);
  }
}

/** macOS Keychain via the `security` CLI. One generic-password item per service+project. */
export class MacKeychainBackend implements SecretBackend {
  readonly kind = "keychain";
  constructor(private account: string) {}
  private svc(service: ServiceName) {
    return `prompt-to-store:${service}`;
  }
  get(service: ServiceName) {
    try {
      const out = execFileSync("security", ["find-generic-password", "-s", this.svc(service), "-a", this.account, "-w"], {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      return JSON.parse(Buffer.from(out.trim(), "base64").toString("utf8"));
    } catch {
      return undefined;
    }
  }
  set(service: ServiceName, fields: SecretFields) {
    const val = Buffer.from(JSON.stringify(fields)).toString("base64");
    execFileSync("security", ["add-generic-password", "-U", "-s", this.svc(service), "-a", this.account, "-w", val], {
      stdio: "ignore",
    });
  }
  delete(service: ServiceName) {
    try {
      execFileSync("security", ["delete-generic-password", "-s", this.svc(service), "-a", this.account], { stdio: "ignore" });
    } catch {
      /* not found */
    }
  }
}

export class Secrets {
  constructor(private backend: SecretBackend) {}

  static forProject(projectDir: string, secretsFile: string): Secrets {
    const pref = process.env.P2S_SECRETS_BACKEND;
    if (pref === "keychain" || (pref !== "file" && os.platform() === "darwin" && hasSecurityCli())) {
      return new Secrets(new MacKeychainBackend(path.resolve(projectDir)));
    }
    return new Secrets(new FileSecretBackend(secretsFile));
  }

  get backendKind() {
    return this.backend.kind;
  }

  /** Env vars win (CI), then the backend. Returns undefined unless every required field is present. */
  get(service: ServiceName): SecretFields | undefined {
    const spec = SECRET_SPEC[service];
    const fromEnv: SecretFields = {};
    for (const f of spec) {
      const v = process.env[f.env];
      if (v) fromEnv[f.field] = v;
    }
    if (spec.every((f) => fromEnv[f.field])) return fromEnv;
    const stored = this.backend.get(service);
    if (stored && spec.every((f) => stored[f.field])) return stored;
    return undefined;
  }

  has(service: ServiceName): boolean {
    return this.get(service) !== undefined;
  }

  set(service: ServiceName, fields: SecretFields) {
    const spec = SECRET_SPEC[service];
    const clean: SecretFields = {};
    for (const f of spec) {
      const v = fields[f.field];
      if (!v || !v.trim()) throw new Error(`Missing ${f.label}`);
      clean[f.field] = v.trim();
    }
    this.backend.set(service, clean);
  }

  delete(service: ServiceName) {
    this.backend.delete(service);
  }

  /** All secret values currently known, for redaction of tool output. */
  allValues(): string[] {
    const vals: string[] = [];
    for (const s of Object.keys(SECRET_SPEC) as ServiceName[]) {
      const f = this.get(s);
      if (f) for (const v of Object.values(f)) if (v && v.length >= 8) vals.push(v);
    }
    return vals;
  }
}

function hasSecurityCli(): boolean {
  try {
    execFileSync("security", ["help"], { stdio: "ignore" });
    return true;
  } catch (e: any) {
    // `security help` exits non-zero but exists; ENOENT means missing.
    return e?.code !== "ENOENT";
  }
}

/** Replace any secret value (and obvious token shapes) in text. */
export function redact(text: string, values: string[]): string {
  let out = text;
  for (const v of values) {
    if (!v) continue;
    out = out.split(v).join("[REDACTED]");
    // also redact each line of multi-line secrets such as PEM keys
    for (const line of v.split(/\r?\n/)) if (line.length >= 16) out = out.split(line).join("[REDACTED]");
  }
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]");
  return out;
}

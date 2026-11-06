import crypto from "node:crypto";
import { request, HttpError, type VerifyResult } from "../lib/http.js";
import type { SecretFields } from "../secrets/index.js";

export const GITHUB_API = process.env.P2S_GITHUB_API_URL ?? "https://api.github.com";

export class GitHub {
  constructor(private token: string) {}
  private h() {
    return { authorization: `Bearer ${this.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  }
  async user(): Promise<{ login: string; name?: string }> {
    return request(`${GITHUB_API}/user`, { headers: this.h() });
  }
  async getRepo(owner: string, repo: string): Promise<GhRepo | undefined> {
    try {
      return await request(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.h() });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return undefined;
      throw e;
    }
  }
  async createRepo(name: string, description: string, isPrivate = true): Promise<GhRepo> {
    return request(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: this.h(),
      json: { name, description, private: isPrivate, auto_init: false },
      retries: 0,
    });
  }
  async addDeployKey(owner: string, repo: string, title: string, publicKey: string): Promise<void> {
    await request(`${GITHUB_API}/repos/${owner}/${repo}/keys`, {
      method: "POST",
      headers: this.h(),
      json: { title, key: publicKey, read_only: true },
      retries: 0,
    });
  }
}

export interface GhRepo {
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch?: string;
  owner: { login: string };
}

/** Parse owner/repo from any GitHub remote URL. */
export function parseGithubRemote(url: string): { owner: string; repo: string } | undefined {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : undefined;
}

/**
 * Generate an RSA deploy key: private key as PKCS#1 PEM (accepted by OpenSSH/Codemagic),
 * public key in OpenSSH `ssh-rsa AAAA…` format (accepted by GitHub).
 */
export function generateDeployKey(comment = "prompt-to-store"): { privateKeyPem: string; publicKeyOpenSsh: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 4096 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const mpint = (b64url: string) => {
    let buf = Buffer.from(b64url, "base64url");
    if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
    return buf;
  };
  const str = (b: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const blob = Buffer.concat([str(Buffer.from("ssh-rsa")), str(mpint(jwk.e)), str(mpint(jwk.n))]);
  return { privateKeyPem, publicKeyOpenSsh: `ssh-rsa ${blob.toString("base64")} ${comment}` };
}

export async function verifyGithub(fields: SecretFields): Promise<VerifyResult> {
  try {
    const u = await new GitHub(fields.token).user();
    return { ok: true, details: { login: u.login } };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return { ok: false, error: "GitHub rejected this token." };
    return { ok: false, error: (e as Error).message };
  }
}

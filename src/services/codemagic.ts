import { request, HttpError, type VerifyResult } from "../lib/http.js";
import type { SecretFields } from "../secrets/index.js";
import type { Artifact, BuildStatus } from "../state/schema.js";

/**
 * Codemagic client.
 *  - Legacy API  https://api.codemagic.io       (apps add, cancel, artifact public links)
 *  - v3 API      https://codemagic.io/api/v3    (user, apps, start/get build, actions)
 * Header: x-auth-token. Verified against a live account Nov 2026.
 */
export const LEGACY = process.env.P2S_CODEMAGIC_LEGACY_URL ?? "https://api.codemagic.io";
export const V3 = process.env.P2S_CODEMAGIC_V3_URL ?? "https://codemagic.io/api/v3";

export const TERMINAL: BuildStatus[] = ["finished", "failed", "canceled", "timeout", "skipped"];

export class Codemagic {
  constructor(private token: string) {}
  private h() {
    return { "x-auth-token": this.token };
  }

  async user(): Promise<{ id: string; avatar_url?: string }> {
    return (await request(`${V3}/user`, { headers: this.h() })).data;
  }

  /** Legacy list includes repository info, which we need to match a git remote. */
  async listApps(): Promise<LegacyApp[]> {
    const r = await request<{ applications: LegacyApp[] }>(`${LEGACY}/apps`, { headers: this.h() });
    return r.applications ?? [];
  }

  async findAppByRepo(repoUrl: string): Promise<LegacyApp | undefined> {
    const want = normalizeRepo(repoUrl);
    return (await this.listApps()).find((a) => !a.archived && a.repository && normalizeRepo(a.repository.htmlUrl ?? "") === want);
  }

  /** Add an app by clone URL (works for public repos and repos covered by the user's GitHub integration). */
  async addApp(repositoryUrl: string): Promise<{ id: string; name: string }> {
    const r = await request<any>(`${LEGACY}/apps`, { method: "POST", headers: this.h(), json: { repositoryUrl } });
    return { id: r._id ?? r.application?._id, name: r.appName ?? r.application?.appName };
  }

  /** Add a private repo over SSH with a deploy key. privateKeyPem is base64-encoded as Codemagic expects. */
  async addAppWithSshKey(sshUrl: string, privateKeyPem: string): Promise<{ id: string; name: string }> {
    const r = await request<any>(`${LEGACY}/apps/new`, {
      method: "POST",
      headers: this.h(),
      json: {
        repositoryUrl: sshUrl,
        sshKey: { data: Buffer.from(privateKeyPem).toString("base64"), passphrase: null },
        projectType: "flutter-app",
      },
    });
    const app = r.application ?? r;
    return { id: app._id, name: app.appName };
  }

  async startBuild(appId: string, workflowId: string, branch: string, vars: Record<string, string> = {}, labels: string[] = []): Promise<string> {
    const r = await request<any>(`${V3}/apps/${appId}/builds`, {
      method: "POST",
      headers: this.h(),
      json: { workflow_id: workflowId, branch, labels, environment: { variables: vars } },
      retries: 0,
    });
    return r?.data?.id ?? r?.buildId;
  }

  async getBuild(buildId: string): Promise<V3Build> {
    // A just-started build can 404 briefly.
    for (let i = 0; ; i++) {
      try {
        return (await request<any>(`${V3}/builds/${buildId}`, { headers: this.h() })).data;
      } catch (e) {
        if (e instanceof HttpError && e.status === 404 && i < 3) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw e;
      }
    }
  }

  async buildActions(buildId: string): Promise<BuildAction[]> {
    const r = await request<any>(`${V3}/builds/${buildId}/actions?page_size=100`, { headers: this.h() });
    return r?.data ?? [];
  }

  async cancelBuild(buildId: string): Promise<void> {
    await request(`${LEGACY}/builds/${buildId}/cancel`, { method: "POST", headers: this.h(), retries: 0 });
  }

  /** Public, shareable link for an artifact (anyone with the URL can download until expiry). */
  async publicUrl(artifactUrl: string, ttlSeconds = 7 * 24 * 3600): Promise<string | undefined> {
    const secure = secureFilenameOf(artifactUrl);
    if (!secure) return undefined;
    const r = await request<any>(`${LEGACY}/artifacts/${secure}/public-url`, {
      method: "POST",
      headers: this.h(),
      json: { expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds },
    });
    return r?.url;
  }

  async listVariableGroups(appId: string): Promise<{ id: string; name: string }[]> {
    const r = await request<any>(`${V3}/apps/${appId}/variable-groups?page_size=100`, { headers: this.h() });
    return r?.data ?? [];
  }

  async deleteVariableGroup(groupId: string): Promise<void> {
    await request(`${V3}/variable-groups/${groupId}`, { method: "DELETE", headers: this.h(), retries: 0 });
  }

  /** Create (or replace) an app variable group holding secure variables. */
  async putVariableGroup(appId: string, name: string, vars: Record<string, string>): Promise<string> {
    for (const g of await this.listVariableGroups(appId)) if (g.name === name) await this.deleteVariableGroup(g.id);
    const created = await request<any>(`${V3}/apps/${appId}/variable-groups`, { method: "POST", headers: this.h(), json: { name }, retries: 0 });
    const id = created?.data?.id ?? created?.id;
    await request(`${V3}/variable-groups/${id}/variables`, {
      method: "POST",
      headers: this.h(),
      json: { secure: true, variables: Object.entries(vars).map(([k, v]) => ({ name: k, value: v })) },
      retries: 0,
    });
    return id;
  }

  /** Download a text artifact such as a log (authenticated). */
  async downloadText(url: string): Promise<string> {
    const r = await request<any>(url, { headers: { ...this.h(), accept: "*/*" } });
    return typeof r === "string" ? r : JSON.stringify(r);
  }
}

export interface LegacyApp {
  _id: string;
  appName: string;
  archived?: boolean;
  repository?: { htmlUrl?: string; defaultBranch?: string; provider?: string };
}

export interface V3Build {
  id: string;
  app_id: string;
  status: string;
  workflow?: { id: string; name: string };
  branch?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  artifacts?: { name: string; size_in_bytes?: number; type?: string; short_lived_download_url?: string; url?: string }[];
}

export interface BuildAction {
  id: string;
  name: string;
  type?: string;
  script?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
}

export function normalizeRepo(url: string): string {
  return url
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^https:\/\/[^@/]+@/, "https://")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** `https://api.codemagic.io/artifacts/<uuid>/<uuid>/app.apk` → `<uuid>/<uuid>/app.apk` */
export function secureFilenameOf(url: string): string | undefined {
  const m = url.match(/\/artifacts\/(.+)$/);
  return m ? m[1].split("?")[0] : undefined;
}

export function mapStatus(s: string): BuildStatus {
  const known: BuildStatus[] = ["queued", "preparing", "building", "testing", "publishing", "finishing", "finished", "failed", "canceled", "timeout", "skipped"];
  if ((known as string[]).includes(s)) return s as BuildStatus;
  if (["initializing", "waiting"].includes(s)) return "queued";
  if (s === "fetching") return "preparing";
  return "unknown";
}

export function toArtifacts(b: V3Build): Artifact[] {
  return (b.artifacts ?? []).map((a) => ({
    name: a.name,
    url: a.short_lived_download_url ?? a.url ?? "",
    type: a.type,
    size: a.size_in_bytes,
  }));
}

export function buildPageUrl(appId: string, buildId: string) {
  return `https://codemagic.io/app/${appId}/build/${buildId}`;
}

export async function verifyCodemagic(fields: SecretFields): Promise<VerifyResult> {
  try {
    const cm = new Codemagic(fields.token);
    const u = await cm.user();
    const apps = await cm.listApps().catch(() => []);
    return { ok: true, details: { userId: u.id, apps: String(apps.length) } };
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      return { ok: false, error: "Codemagic rejected this token. Copy it again from Codemagic → Teams → Personal Account → Integrations → Codemagic API." };
    }
    return { ok: false, error: (e as Error).message };
  }
}

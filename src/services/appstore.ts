// App Store Connect client: ES256 JWT + the REST flows prompt-to-store needs.
// Flows (screenshot reservation/upload/commit, reviewSubmissions) follow the design of the `asc` CLI.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError, request, sleep, type VerifyResult } from "../lib/http.js";
import type { SecretFields } from "../secrets/index.js";

export const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

export interface AscCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export interface AscOptions {
  /** Poll interval for asset processing (ms). */
  pollMs?: number;
  /** Max polls for asset processing. */
  maxPolls?: number;
  now?: () => number;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Sign an ES256 App Store Connect token. Exported for tests. */
export function signToken(c: AscCredentials, nowSec: number, ttlSec = 1200): string {
  const header = { alg: "ES256", kid: c.keyId, typ: "JWT" };
  const payload = { iss: c.issuerId, iat: nowSec, exp: nowSec + Math.min(ttlSec, 1200), aud: "appstoreconnect-v1" };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: c.privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

export const LIMITS = { name: 30, subtitle: 30, keywordsBytes: 100, promotionalText: 170, description: 4000, whatsNew: 4000 } as const;

export interface MetadataFields {
  name?: string;
  subtitle?: string;
  privacyPolicyUrl?: string;
  description?: string;
  keywords?: string;
  promotionalText?: string;
  whatsNew?: string;
  supportUrl?: string;
  marketingUrl?: string;
}

const INFO_FIELDS = ["name", "subtitle", "privacyPolicyUrl"] as const;
const VERSION_FIELDS = ["description", "keywords", "promotionalText", "whatsNew", "supportUrl", "marketingUrl"] as const;

/** Returns a list of human-readable limit violations (empty = OK). */
export function validateMetadata(m: MetadataFields): string[] {
  const errs: string[] = [];
  const chars = (k: keyof MetadataFields, max: number) => {
    const v = m[k];
    if (v !== undefined && [...v].length > max) errs.push(`${k} is ${[...v].length} characters; the limit is ${max}.`);
  };
  chars("name", LIMITS.name);
  chars("subtitle", LIMITS.subtitle);
  chars("promotionalText", LIMITS.promotionalText);
  chars("description", LIMITS.description);
  chars("whatsNew", LIMITS.whatsNew);
  if (m.keywords !== undefined) {
    const n = Buffer.byteLength(m.keywords, "utf8");
    if (n > LIMITS.keywordsBytes) errs.push(`keywords is ${n} bytes; the limit is ${LIMITS.keywordsBytes} bytes (commas count).`);
  }
  if (m.name !== undefined && [...m.name].length < 2) errs.push("name must be at least 2 characters.");
  for (const k of ["privacyPolicyUrl", "supportUrl", "marketingUrl"] as const) {
    const v = m[k];
    if (v && !/^https?:\/\/\S+$/i.test(v)) errs.push(`${k} must be a valid http(s) URL.`);
  }
  return errs;
}

const EDITABLE_VERSION_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "WAITING_FOR_REVIEW",
  "READY_FOR_REVIEW",
  "INVALID_BINARY",
];
const LIVE_INFO_STATES = ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "IN_REVIEW", "PENDING_APPLE_RELEASE", "PENDING_DEVELOPER_RELEASE", "REMOVED_FROM_SALE"];

export interface AscVersion {
  id: string;
  versionString: string;
  state: string;
  created?: boolean;
}

export interface AscBuild {
  id: string;
  version: string;
  marketingVersion?: string;
  processingState: string;
  uploadedDate?: string;
  usesNonExemptEncryption?: boolean | null;
}

/** Turns an ASC error body into the verbatim "what's missing" text. */
export function describeAscError(e: HttpError): string {
  let parsed: any;
  try {
    parsed = JSON.parse(e.body);
  } catch {
    return e.message;
  }
  const lines: string[] = [];
  for (const err of parsed?.errors ?? []) {
    lines.push(`[${err.code ?? e.status}] ${err.title ?? ""}${err.detail ? ` - ${err.detail}` : ""}`.trim());
    const assoc = err.meta?.associatedErrors;
    if (assoc && typeof assoc === "object") {
      for (const [k, arr] of Object.entries(assoc)) {
        for (const a of Array.isArray(arr) ? arr : [arr]) {
          const x = a as any;
          lines.push(`  - ${k}: ${x?.detail ?? x?.title ?? JSON.stringify(x)}${x?.code ? ` (${x.code})` : ""}`);
        }
      }
    }
  }
  if (!lines.length) return e.message;
  return `App Store Connect returned HTTP ${e.status}:\n${lines.join("\n")}`;
}

export class AppStoreConnect {
  private token?: { jwt: string; expiresAt: number };
  private pollMs: number;
  private maxPolls: number;
  private now: () => number;

  constructor(
    private creds: AscCredentials,
    opts: AscOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 2000;
    this.maxPolls = opts.maxPolls ?? 60;
    this.now = opts.now ?? Date.now;
  }

  static fromSecret(f: SecretFields): AppStoreConnect {
    return new AppStoreConnect({ issuerId: f.issuerId, keyId: f.keyId, privateKey: f.privateKey });
  }

  /** Cached ~15 minutes (tokens are valid up to 20). */
  getToken(): string {
    const nowMs = this.now();
    if (this.token && this.token.expiresAt > nowMs) return this.token.jwt;
    const iat = Math.floor(nowMs / 1000) - 10; // small allowance for clock skew
    const jwt = signToken(this.creds, iat, 1200 - 30);
    this.token = { jwt, expiresAt: nowMs + 15 * 60_000 };
    return jwt;
  }

  /** Raw JSON:API call. `p` is a path under /v1 or an absolute URL (pagination links). */
  async api<T = any>(method: string, p: string, json?: unknown): Promise<T> {
    const url = p.startsWith("http") ? p : `${ASC_BASE}${p}`;
    try {
      return await request<T>(url, { method, json, headers: { authorization: `Bearer ${this.getToken()}` } });
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 401) {
          throw new Error(
            "App Store Connect rejected the API key (401). Check the Issuer ID, Key ID and .p8 file match, the key is not revoked, and the computer clock is correct.",
          );
        }
        if (e.status === 403 && /AGREEMENT/i.test(e.body)) {
          throw new Error("App Store Connect: agreements are missing or expired. The Account Holder must accept the latest agreements at appstoreconnect.apple.com.");
        }
        throw new Error(describeAscError(e));
      }
      throw e;
    }
  }

  private async listAll<T = any>(p: string, max = 5): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = p;
    for (let i = 0; next && i < max; i++) {
      const r: any = await this.api("GET", next);
      out.push(...(r?.data ?? []));
      next = r?.links?.next;
    }
    return out;
  }

  async findAppByBundleId(bundleId: string): Promise<{ id: string; name: string; bundleId: string; primaryLocale?: string } | undefined> {
    const r = await this.api("GET", `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
    const a = r?.data?.[0];
    if (!a) return undefined;
    return { id: a.id, name: a.attributes?.name, bundleId: a.attributes?.bundleId, primaryLocale: a.attributes?.primaryLocale };
  }

  async getEditableVersion(appId: string, versionString?: string, platform = "IOS"): Promise<AscVersion> {
    const states = EDITABLE_VERSION_STATES.join(",");
    const r = await this.api("GET", `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&filter[appStoreState]=${states}&limit=10`);
    const v = r?.data?.[0];
    if (v) return { id: v.id, versionString: v.attributes?.versionString, state: v.attributes?.appStoreState ?? v.attributes?.appVersionState };
    if (!versionString) {
      throw new Error("No editable App Store version exists yet. Pass version_string (e.g. the app's marketing version like 1.0.0) so one can be created.");
    }
    const c = await this.api("POST", "/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: { platform, versionString, releaseType: "AFTER_APPROVAL" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return { id: c.data.id, versionString, state: c.data.attributes?.appStoreState ?? "PREPARE_FOR_SUBMISSION", created: true };
  }

  private async editableAppInfo(appId: string): Promise<string> {
    const r = await this.api("GET", `/apps/${appId}/appInfos`);
    const infos: any[] = r?.data ?? [];
    if (!infos.length) throw new Error("App has no appInfos; open the app once in App Store Connect.");
    const st = (i: any) => i.attributes?.appStoreState ?? i.attributes?.state;
    const pick = infos.find((i) => !LIVE_INFO_STATES.includes(st(i))) ?? infos[0];
    return pick.id;
  }

  private async findLocalization(kind: "appInfos" | "appStoreVersions", parentId: string, locale: string) {
    const type = kind === "appInfos" ? "appInfoLocalizations" : "appStoreVersionLocalizations";
    const rows = await this.listAll(`/${kind}/${parentId}/${type}?limit=200`);
    return rows.find((l: any) => l.attributes?.locale === locale);
  }

  async getMetadata(appId: string, locale: string, versionString?: string) {
    const infoId = await this.editableAppInfo(appId);
    const info = await this.findLocalization("appInfos", infoId, locale);
    let version: AscVersion | undefined;
    try {
      version = await this.getEditableVersion(appId, versionString);
    } catch {
      version = undefined;
    }
    const vloc = version ? await this.findLocalization("appStoreVersions", version.id, locale) : undefined;
    const pick = <K extends string>(src: any, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, src?.attributes?.[k] ?? null]));
    return {
      locale,
      version: version && { id: version.id, versionString: version.versionString, state: version.state },
      appInfoLocalizationId: info?.id,
      versionLocalizationId: vloc?.id,
      ...pick(info, INFO_FIELDS),
      ...pick(vloc, VERSION_FIELDS),
    } as { locale: string; version?: AscVersion; appInfoLocalizationId?: string; versionLocalizationId?: string } & Record<string, any>;
  }

  /** Validates limits, then creates missing localizations and PATCHes the changed fields. */
  async updateMetadata(appId: string, locale: string, fields: MetadataFields, versionString?: string) {
    const errs = validateMetadata(fields);
    if (errs.length) throw new Error(`Metadata exceeds App Store limits, nothing was changed:\n- ${errs.join("\n- ")}`);
    const infoAttrs = Object.fromEntries(INFO_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]));
    const verAttrs = Object.fromEntries(VERSION_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]));
    const updated: string[] = [];
    let infoLocId: string | undefined;
    let verLocId: string | undefined;

    if (Object.keys(infoAttrs).length) {
      const infoId = await this.editableAppInfo(appId);
      const existing = await this.findLocalization("appInfos", infoId, locale);
      if (existing) {
        await this.api("PATCH", `/appInfoLocalizations/${existing.id}`, { data: { type: "appInfoLocalizations", id: existing.id, attributes: infoAttrs } });
        infoLocId = existing.id;
      } else {
        const c = await this.api("POST", "/appInfoLocalizations", {
          data: {
            type: "appInfoLocalizations",
            attributes: { locale, ...infoAttrs },
            relationships: { appInfo: { data: { type: "appInfos", id: infoId } } },
          },
        });
        infoLocId = c.data.id;
      }
      updated.push(...Object.keys(infoAttrs));
    }
    if (Object.keys(verAttrs).length) {
      const version = await this.getEditableVersion(appId, versionString);
      const existing = await this.findLocalization("appStoreVersions", version.id, locale);
      if (existing) {
        await this.api("PATCH", `/appStoreVersionLocalizations/${existing.id}`, {
          data: { type: "appStoreVersionLocalizations", id: existing.id, attributes: verAttrs },
        });
        verLocId = existing.id;
      } else {
        const c = await this.api("POST", "/appStoreVersionLocalizations", {
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale, ...verAttrs },
            relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
          },
        });
        verLocId = c.data.id;
      }
      updated.push(...Object.keys(verAttrs));
    }
    return { locale, updated, appInfoLocalizationId: infoLocId, versionLocalizationId: verLocId };
  }

  /** Finds (or creates) the screenshot set of a display type for a version localization. */
  async ensureScreenshotSet(versionLocalizationId: string, displayType: string): Promise<{ id: string; existing: { id: string }[] }> {
    const sets = await this.listAll(`/appStoreVersionLocalizations/${versionLocalizationId}/appScreenshotSets?limit=200`);
    const found = sets.find((s: any) => s.attributes?.screenshotDisplayType === displayType);
    if (found) {
      const shots = await this.listAll(`/appScreenshotSets/${found.id}/appScreenshots?limit=200`);
      return { id: found.id, existing: shots.map((s: any) => ({ id: s.id })) };
    }
    const c = await this.api("POST", "/appScreenshotSets", {
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: versionLocalizationId } } },
      },
    });
    return { id: c.data.id, existing: [] };
  }

  async uploadScreenshots(versionLocalizationId: string, displayType: string, pngPaths: string[], replace = false) {
    if (!pngPaths.length) throw new Error("No screenshot files given.");
    if (pngPaths.length > 10) throw new Error("App Store Connect allows at most 10 screenshots per set.");
    const files = pngPaths.map((p) => ({ p, buf: fs.readFileSync(p) }));
    const set = await this.ensureScreenshotSet(versionLocalizationId, displayType);
    if (set.existing.length && !replace) {
      throw new Error(`The ${displayType} set already has ${set.existing.length} screenshot(s). Pass replace=true to delete them and upload the new files.`);
    }
    for (const s of set.existing) await this.api("DELETE", `/appScreenshots/${s.id}`);

    const uploaded: { id: string; file: string; state: string }[] = [];
    for (const f of files) {
      const fileName = path.basename(f.p);
      const res = await this.api("POST", "/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileName, fileSize: f.buf.length },
          relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
        },
      });
      const id: string = res.data.id;
      const ops: any[] = res.data.attributes?.uploadOperations ?? [];
      for (const op of ops) {
        const headers: Record<string, string> = {};
        for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
        const slice = f.buf.subarray(op.offset, op.offset + op.length);
        // Pre-signed URL on another host: no Authorization header, so not via this.api().
        await request(op.url, { method: op.method ?? "PUT", headers, body: slice, retries: 2, timeoutMs: 120_000 });
      }
      const md5 = crypto.createHash("md5").update(f.buf).digest("hex");
      await this.api("PATCH", `/appScreenshots/${id}`, {
        data: { type: "appScreenshots", id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
      });
      uploaded.push({ id, file: fileName, state: await this.waitScreenshot(id) });
    }
    return { screenshotSetId: set.id, displayType, deleted: set.existing.length, uploaded };
  }

  private async waitScreenshot(id: string): Promise<string> {
    let state = "UNKNOWN";
    for (let i = 0; i < this.maxPolls; i++) {
      const r = await this.api("GET", `/appScreenshots/${id}`);
      const d = r?.data?.attributes?.assetDeliveryState;
      state = d?.state ?? "UNKNOWN";
      if (state === "COMPLETE") return state;
      if (state === "FAILED") {
        const msg = (d?.errors ?? []).map((e: any) => e.description ?? e.code).join("; ");
        throw new Error(`Apple rejected screenshot ${id}: ${msg || "processing failed"} (check size/format: PNG or JPG, no transparency, correct pixel size for the display type).`);
      }
      await sleep(this.pollMs);
    }
    return state;
  }

  async listBuilds(appId: string, limit = 10): Promise<AscBuild[]> {
    const r = await this.api(
      "GET",
      `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=${limit}&include=preReleaseVersion&fields[builds]=version,uploadedDate,processingState,expired,usesNonExemptEncryption,preReleaseVersion`,
    );
    const pre = new Map<string, string>((r?.included ?? []).filter((i: any) => i.type === "preReleaseVersions").map((i: any) => [i.id, i.attributes?.version]));
    return (r?.data ?? []).map((b: any) => ({
      id: b.id,
      version: b.attributes?.version,
      marketingVersion: pre.get(b.relationships?.preReleaseVersion?.data?.id),
      processingState: b.attributes?.processingState,
      uploadedDate: b.attributes?.uploadedDate,
      usesNonExemptEncryption: b.attributes?.usesNonExemptEncryption,
    }));
  }

  async attachBuild(versionId: string, buildId: string) {
    await this.api("PATCH", `/appStoreVersions/${versionId}/relationships/build`, { data: { type: "builds", id: buildId } });
  }

  /** Attach build (latest VALID if omitted) -> reviewSubmission -> item -> submitted:true. */
  async submitForReview(appId: string, versionId: string, buildId?: string) {
    let build = buildId;
    if (!build) {
      const latest = (await this.listBuilds(appId, 20)).find((b) => b.processingState === "VALID");
      if (!latest) throw new Error("No VALID build found in App Store Connect yet (still PROCESSING?). Check asc_testflight_status and retry once a build is VALID.");
      build = latest.id;
    }
    await this.attachBuild(versionId, build);

    const existing = await this.api(
      "GET",
      `/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`,
    );
    let rsId: string | undefined = existing?.data?.[0]?.id;
    if (!rsId) {
      const c = await this.api("POST", "/reviewSubmissions", {
        data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: appId } } } },
      });
      rsId = c.data.id as string;
    }
    try {
      await this.api("POST", "/reviewSubmissionItems", {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: rsId } },
            appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
          },
        },
      });
    } catch (e) {
      // An item for this version may already be on the reused submission; any other error is surfaced.
      if (!/already|duplicate/i.test((e as Error).message)) throw e;
    }
    const r = await this.api("PATCH", `/reviewSubmissions/${rsId}`, {
      data: { type: "reviewSubmissions", id: rsId, attributes: { submitted: true } },
    });
    return { reviewSubmissionId: rsId, buildId: build, state: r?.data?.attributes?.state as string | undefined };
  }

  async listCustomerReviews(appId: string, limit = 20) {
    const r = await this.api("GET", `/apps/${appId}/customerReviews?sort=-createdDate&limit=${limit}&include=response`);
    const responses = new Map<string, any>((r?.included ?? []).filter((i: any) => i.type === "customerReviewResponses").map((i: any) => [i.id, i]));
    return (r?.data ?? []).map((x: any) => {
      const rid = x.relationships?.response?.data?.id;
      return {
        id: x.id,
        rating: x.attributes?.rating,
        title: x.attributes?.title,
        body: x.attributes?.body,
        reviewer: x.attributes?.reviewerNickname,
        territory: x.attributes?.territory,
        createdDate: x.attributes?.createdDate,
        response: rid ? (responses.get(rid)?.attributes?.responseBody ?? "(reply exists)") : null,
      };
    });
  }

  async replyToReview(reviewId: string, text: string) {
    const r = await this.api("POST", "/customerReviewResponses", {
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody: text },
        relationships: { review: { data: { type: "customerReviews", id: reviewId } } },
      },
    });
    return { id: r?.data?.id as string, state: r?.data?.attributes?.state as string | undefined };
  }
}

export async function verifyAppStore(f: SecretFields): Promise<VerifyResult> {
  const { issuerId, keyId, privateKey } = f;
  if (!issuerId || !keyId || !privateKey) return { ok: false, error: "Issuer ID, Key ID and the .p8 private key are all required." };
  try {
    const key = crypto.createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "ec") throw new Error("not an EC key");
  } catch {
    return { ok: false, error: "The private key is not a valid .p8 (PKCS#8 EC) PEM. Paste the full file contents including the BEGIN/END PRIVATE KEY lines." };
  }
  try {
    const c = new AppStoreConnect({ issuerId, keyId, privateKey });
    const r = await c.api("GET", "/apps?limit=1");
    const total = r?.meta?.paging?.total ?? r?.data?.length ?? 0;
    return { ok: true, details: { keyId, apps: String(total) } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

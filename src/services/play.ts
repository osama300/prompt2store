// Google Play Android Publisher client (API v3). Thin fetch + node:crypto implementation, no googleapis dependency.
import crypto from "node:crypto";
import fs from "node:fs";
import { request, HttpError, type VerifyResult } from "../lib/http.js";
import type { SecretFields } from "../secrets/index.js";

export const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";

export const LISTING_LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 } as const;
export const REPLY_MAX = 350;
export const RELEASE_NOTES_MAX = 500;
export const MAX_IMAGES_PER_TYPE = 8;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const IMAGE_TYPES = ["phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots", "featureGraphic", "icon"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export type TrackName = string;
export type ReleaseStatus = "draft" | "inProgress" | "halted" | "completed";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
  type?: string;
}

export function parseServiceAccount(json: string): ServiceAccount {
  let o: any;
  try {
    o = JSON.parse(json);
  } catch {
    throw new Error("The service account key is not valid JSON. Upload the .json key file downloaded from Google Cloud (Service accounts → Keys → Add key → JSON).");
  }
  if (!o || typeof o !== "object") throw new Error("The service account key must be a JSON object.");
  if (o.type && o.type !== "service_account") {
    throw new Error(`This JSON is of type "${o.type}", not "service_account". Create a service account key (not an OAuth client) in Google Cloud.`);
  }
  if (typeof o.client_email !== "string" || typeof o.private_key !== "string") {
    throw new Error("The service account JSON is missing client_email or private_key. Download a fresh JSON key for the service account.");
  }
  return o as ServiceAccount;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// ---------------------------------------------------------------------------
// Image inspection (PNG / JPEG header parsing)

export interface ImageInfo {
  format: "png" | "jpeg";
  width: number;
  height: number;
  bytes: number;
  hasAlpha: boolean;
  mime: string;
}

export function inspectImage(file: string): ImageInfo {
  if (!fs.existsSync(file)) throw new Error(`Image file not found: ${file}`);
  const buf = fs.readFileSync(file);
  return inspectImageBuffer(buf, file);
}

export function inspectImageBuffer(buf: Buffer, label = "image"): ImageInfo {
  if (buf.length >= 26 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const colorType = buf[25];
    return { format: "png", width, height, bytes: buf.length, hasAlpha: colorType === 4 || colorType === 6, mime: "image/png" };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), bytes: buf.length, hasAlpha: false, mime: "image/jpeg" };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    throw new Error(`${label}: could not read JPEG dimensions.`);
  }
  throw new Error(`${label}: not a PNG or JPEG file. Google Play only accepts PNG or JPEG images.`);
}

/** Returns a list of problems (empty = OK) and non-fatal warnings. */
export function validateImage(type: ImageType, info: ImageInfo, label: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dim = `${info.width}x${info.height}`;
  if (info.bytes > MAX_IMAGE_BYTES) errors.push(`${label}: file is ${(info.bytes / 1048576).toFixed(1)} MB; the maximum is 15 MB.`);
  if (type === "icon") {
    if (info.format !== "png") errors.push(`${label}: the icon must be a PNG.`);
    if (info.width !== 512 || info.height !== 512) errors.push(`${label}: the icon must be exactly 512x512 (got ${dim}).`);
    if (info.bytes > 1024 * 1024) errors.push(`${label}: the icon must be at most 1024 KB.`);
  } else if (type === "featureGraphic") {
    if (info.width !== 1024 || info.height !== 500) errors.push(`${label}: the feature graphic must be exactly 1024x500 (got ${dim}).`);
    if (info.hasAlpha) warnings.push(`${label}: feature graphic should not have an alpha channel.`);
  } else {
    const short = Math.min(info.width, info.height);
    const long = Math.max(info.width, info.height);
    if (short < 320) errors.push(`${label}: screenshots need at least 320 px on the short side (got ${dim}).`);
    if (long > 3840) errors.push(`${label}: screenshots can be at most 3840 px on the long side (got ${dim}).`);
    if (long > short * 2) errors.push(`${label}: the long side may be at most 2x the short side (got ${dim}).`);
    if (info.hasAlpha) warnings.push(`${label}: PNG has an alpha channel; Play prefers 24-bit PNG/JPEG without transparency.`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Error interpretation

export interface PlayHint {
  message: string;
  nextStep: string;
}

/** Maps well-known Play API failures to an actionable next step. Returns undefined for unknown errors. */
export function explainPlayError(e: unknown, pkg?: string): PlayHint | undefined {
  const msg = (e as Error)?.message ?? String(e);
  const status = e instanceof HttpError ? e.status : undefined;
  if (/Only releases with status draft may be created on draft app/i.test(msg)) {
    return {
      message: "This app is still a draft app in Play Console, so only draft releases are accepted.",
      nextStep:
        "Finish the app setup in Play Console (store listing, content rating, target audience, data safety, privacy policy), create the first release there once, and publish it. Until then the API can only create draft releases.",
    };
  }
  if (/changesNotSentForReview/i.test(msg)) {
    return {
      message: "Managed publishing is on (or Google refuses automatic review submission), so the change was not sent for review.",
      nextStep: "The change was saved without being sent for review. Ask the user to open Play Console → Publishing overview and press 'Send changes for review'.",
    };
  }
  if (status === 404 && /(package not found|applicationNotFound|No application was found|app.*not found)/i.test(msg)) {
    return {
      message: `Google Play does not know the app ${pkg ?? "package"} (or the service account cannot see it).`,
      nextStep:
        "The app record cannot be created via the API. Ask the user to create the app in Play Console (All apps → Create app) with exactly this package name, upload the first release manually, and invite the service account email under Users and permissions with release and store-listing permissions. Permission changes can take a while to apply.",
    };
  }
  if ((status === 401 || status === 403) && /(has not been used in project|is disabled|accessNotConfigured|SERVICE_DISABLED)/i.test(msg)) {
    return {
      message: "The Google Play Android Developer API is not enabled in the service account's Google Cloud project.",
      nextStep: "Ask the user to enable 'Google Play Android Developer API' in the Google Cloud console for the service account's project, wait a minute, then retry.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      message: "Google Play rejected the service account (no permission).",
      nextStep:
        "Ask the user to open Play Console → Users and permissions, invite the service account email, and grant this app permissions (release to tracks, manage store presence, reply to reviews). New grants can take minutes to hours to apply.",
    };
  }
  if (/Version code \d+ has already been used/i.test(msg)) {
    return { message: "That versionCode was already uploaded to Google Play.", nextStep: "Increase the build number (version code) in pubspec.yaml / the build config, rebuild with ship_test_build, and publish again." };
  }
  if (/signed with the wrong key|wrong key/i.test(msg)) {
    return { message: "The bundle is signed with a key that does not match the upload key registered in Play Console.", nextStep: "Sign with the registered upload keystore, or reset the upload key in Play Console → App integrity." };
  }
  return undefined;
}

// ---------------------------------------------------------------------------

export interface WithEditOpts {
  /** Commit the edit when fn succeeds (default false: read-only, the edit is deleted). */
  commit?: boolean;
  /** Run edits.validate and then delete the edit; nothing reaches the store. */
  validateOnly?: boolean;
  /** Commit without sending to review (managed publishing). */
  changesNotSentForReview?: boolean;
}

export interface PublishOpts {
  versionCodes?: (number | string)[];
  releaseName?: string;
  releaseNotes?: { language: string; text: string }[];
  status?: ReleaseStatus;
  userFraction?: number;
  validateOnly?: boolean;
}

export class GooglePlay {
  private sa: ServiceAccount;
  private token?: { value: string; expiresAt: number };

  constructor(serviceAccountJson: string) {
    this.sa = parseServiceAccount(serviceAccountJson);
  }

  get clientEmail() {
    return this.sa.client_email;
  }
  get projectId() {
    return this.sa.project_id;
  }

  // ---- auth ---------------------------------------------------------------

  buildAssertion(now = Math.floor(Date.now() / 1000)): string {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({ iss: this.sa.client_email, scope: PLAY_SCOPE, aud: this.sa.token_uri ?? DEFAULT_TOKEN_URI, iat: now, exp: now + 3600 }),
    );
    const input = `${header}.${claims}`;
    const sig = crypto.sign("RSA-SHA256", Buffer.from(input), this.sa.private_key);
    return `${input}.${b64url(sig)}`;
  }

  async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: this.buildAssertion() }).toString();
    const res = await request<{ access_token: string; expires_in?: number }>(this.sa.token_uri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res?.access_token) throw new Error("Google token endpoint returned no access_token.");
    this.token = { value: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async call<T = any>(url: string, opts: { method?: string; json?: unknown; body?: Buffer; contentType?: string } = {}): Promise<T> {
    const token = await this.getToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (opts.contentType) headers["content-type"] = opts.contentType;
    return request<T>(url, {
      method: opts.method,
      headers,
      json: opts.json,
      body: opts.body as unknown as BodyInit | undefined,
      timeoutMs: opts.body ? 300_000 : undefined,
    });
  }

  private app(pkg: string) {
    return `${API}/${encodeURIComponent(pkg)}`;
  }

  // ---- edits --------------------------------------------------------------

  /**
   * Opens an edit, runs fn, then commits (commit), validates and discards (validateOnly) or just discards.
   * The edit is always deleted when anything fails, so no stale edits are left behind.
   */
  async withEdit<T>(pkg: string, fn: (editId: string) => Promise<T>, opts: WithEditOpts = {}): Promise<T> {
    const edit = await this.call<{ id: string }>(`${this.app(pkg)}/edits`, { method: "POST", json: {} });
    const editId = edit.id;
    const discard = async () => {
      try {
        await this.call(`${this.app(pkg)}/edits/${editId}`, { method: "DELETE" });
      } catch {
        /* edit may already be gone */
      }
    };
    try {
      const out = await fn(editId);
      if (opts.validateOnly) {
        await this.call(`${this.app(pkg)}/edits/${editId}:validate`, { method: "POST" });
        await discard();
      } else if (opts.commit) {
        const q = opts.changesNotSentForReview ? "?changesNotSentForReview=true" : "";
        await this.call(`${this.app(pkg)}/edits/${editId}:commit${q}`, { method: "POST" });
      } else {
        await discard();
      }
      return out;
    } catch (e) {
      await discard();
      throw e;
    }
  }

  // ---- listings -----------------------------------------------------------

  async getListing(pkg: string, language: string) {
    return this.withEdit(pkg, (id) => this.call(`${this.app(pkg)}/edits/${id}/listings/${encodeURIComponent(language)}`));
  }

  async listListings(pkg: string) {
    return this.withEdit(pkg, (id) => this.call<{ listings?: any[] }>(`${this.app(pkg)}/edits/${id}/listings`));
  }

  static checkListing(l: { title: string; shortDescription: string; fullDescription: string }) {
    const problems: string[] = [];
    for (const k of Object.keys(LISTING_LIMITS) as (keyof typeof LISTING_LIMITS)[]) {
      const n = [...l[k]].length;
      if (n > LISTING_LIMITS[k]) problems.push(`${k} is ${n} characters; Google Play allows at most ${LISTING_LIMITS[k]}.`);
      if (n === 0) problems.push(`${k} must not be empty.`);
    }
    if (problems.length) throw new Error(`Listing text exceeds Google Play limits: ${problems.join(" ")}`);
  }

  async updateListing(
    pkg: string,
    language: string,
    l: { title: string; shortDescription: string; fullDescription: string; video?: string },
    opts: { validateOnly?: boolean; changesNotSentForReview?: boolean } = {},
  ) {
    GooglePlay.checkListing(l);
    return this.withEdit(
      pkg,
      async (id) => {
        const url = `${this.app(pkg)}/edits/${id}/listings/${encodeURIComponent(language)}`;
        let video = l.video;
        if (video === undefined) {
          try {
            video = (await this.call<any>(url))?.video;
          } catch (e) {
            if (!(e instanceof HttpError && e.status === 404)) throw e;
          }
        }
        return this.call(url, {
          method: "PUT",
          json: { language, title: l.title, shortDescription: l.shortDescription, fullDescription: l.fullDescription, ...(video ? { video } : {}) },
        });
      },
      { commit: !opts.validateOnly, validateOnly: opts.validateOnly, changesNotSentForReview: opts.changesNotSentForReview },
    );
  }

  // ---- images -------------------------------------------------------------

  async listImages(pkg: string, language: string, imageType: ImageType): Promise<any[]> {
    return this.withEdit(pkg, async (id) => (await this.call<{ images?: any[] }>(`${this.app(pkg)}/edits/${id}/listings/${encodeURIComponent(language)}/${imageType}`))?.images ?? []);
  }

  async deleteAllImages(pkg: string, language: string, imageType: ImageType, opts: WithEditOpts = { commit: true }) {
    return this.withEdit(pkg, (id) => this.call(`${this.app(pkg)}/edits/${id}/listings/${encodeURIComponent(language)}/${imageType}`, { method: "DELETE" }), opts);
  }

  /** Local validation of image files (no network). Throws with all problems at once. */
  static preflightImages(imageType: ImageType, files: string[], existingCount = 0, replace = false) {
    const warnings: string[] = [];
    const errors: string[] = [];
    const single = imageType === "icon" || imageType === "featureGraphic";
    if (!files.length) errors.push("No image files given.");
    const total = (single || replace ? 0 : existingCount) + files.length;
    const max = single ? 1 : MAX_IMAGES_PER_TYPE;
    if (total > max) {
      errors.push(
        single
          ? `${imageType} takes exactly one image.`
          : `Google Play allows at most ${MAX_IMAGES_PER_TYPE} ${imageType}; this would make ${total} (${existingCount} already uploaded${replace ? ", replace=true ignores them" : ", pass replace=true to swap them"}).`,
      );
    }
    for (const f of files) {
      try {
        const r = validateImage(imageType, inspectImage(f), f);
        errors.push(...r.errors);
        warnings.push(...r.warnings);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
    return { warnings };
  }

  async uploadImages(
    pkg: string,
    language: string,
    imageType: ImageType,
    files: string[],
    opts: { replace?: boolean; validateOnly?: boolean; changesNotSentForReview?: boolean } = {},
  ) {
    const single = imageType === "icon" || imageType === "featureGraphic";
    return this.withEdit(
      pkg,
      async (id) => {
        const base = `${this.app(pkg)}/edits/${id}/listings/${encodeURIComponent(language)}/${imageType}`;
        const replace = opts.replace || single;
        let existing = 0;
        if (!replace) existing = ((await this.call<{ images?: any[] }>(base))?.images ?? []).length;
        const { warnings } = GooglePlay.preflightImages(imageType, files, existing, replace);
        if (replace) await this.call(base, { method: "DELETE" });
        const uploaded: any[] = [];
        for (const f of files) {
          const info = inspectImage(f);
          const res = await this.call<{ image?: any }>(`${UPLOAD}/${encodeURIComponent(pkg)}/edits/${id}/listings/${encodeURIComponent(language)}/${imageType}?uploadType=media`, {
            method: "POST",
            body: fs.readFileSync(f),
            contentType: info.mime,
          });
          uploaded.push(res?.image ?? res);
        }
        return { uploaded, warnings };
      },
      { commit: !opts.validateOnly, validateOnly: opts.validateOnly, changesNotSentForReview: opts.changesNotSentForReview },
    );
  }

  async uploadImage(pkg: string, language: string, imageType: ImageType, pngPath: string, opts: { replace?: boolean } = {}) {
    return this.uploadImages(pkg, language, imageType, [pngPath], opts);
  }

  // ---- bundles & tracks ---------------------------------------------------

  async getTracks(pkg: string): Promise<{ tracks: any[]; latestVersionCode?: number }> {
    return this.withEdit(pkg, async (id) => {
      const t = await this.call<{ tracks?: any[] }>(`${this.app(pkg)}/edits/${id}/tracks`);
      const b = await this.bundlesInEdit(pkg, id);
      return { tracks: t?.tracks ?? [], latestVersionCode: b.length ? Math.max(...b) : undefined };
    });
  }

  private async bundlesInEdit(pkg: string, editId: string): Promise<number[]> {
    const r = await this.call<{ bundles?: { versionCode: number }[] }>(`${this.app(pkg)}/edits/${editId}/bundles`);
    return (r?.bundles ?? []).map((b) => Number(b.versionCode)).filter((n) => Number.isFinite(n));
  }

  /** Newest versionCode among bundles already uploaded to Play (undefined if none). */
  async latestVersionCode(pkg: string): Promise<number | undefined> {
    return this.withEdit(pkg, async (id) => {
      const b = await this.bundlesInEdit(pkg, id);
      return b.length ? Math.max(...b) : undefined;
    });
  }

  private async setTrackInEdit(pkg: string, editId: string, track: string, o: PublishOpts, status: ReleaseStatus) {
    let codes = o.versionCodes?.map(String);
    if (!codes?.length) {
      const all = await this.bundlesInEdit(pkg, editId);
      if (!all.length) {
        throw new Error("No bundle has been uploaded to Google Play yet, so there is nothing to release. Upload the first .aab (Play Console, or the Codemagic Play publishing step) first.");
      }
      codes = [String(Math.max(...all))];
    }
    if (status === "inProgress" && !(o.userFraction && o.userFraction > 0 && o.userFraction < 1)) {
      throw new Error("status inProgress needs userFraction between 0 and 1 (e.g. 0.1 for a 10% staged rollout).");
    }
    for (const n of o.releaseNotes ?? []) {
      if ([...n.text].length > RELEASE_NOTES_MAX) throw new Error(`Release notes for ${n.language} are ${[...n.text].length} characters; the limit is ${RELEASE_NOTES_MAX}.`);
    }
    const url = `${this.app(pkg)}/edits/${editId}/tracks/${encodeURIComponent(track)}`;
    let existing: any[] = [];
    try {
      existing = (await this.call<any>(url))?.releases ?? [];
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
    const release: any = {
      ...(o.releaseName ? { name: o.releaseName } : {}),
      versionCodes: codes,
      status,
      ...(status === "inProgress" ? { userFraction: o.userFraction } : {}),
      ...(o.releaseNotes?.length ? { releaseNotes: o.releaseNotes } : {}),
    };
    // Keep other releases (e.g. a staged rollout on production); drop any that conflict with the new one.
    const kept = existing.filter((r) => r.status !== status && !(r.versionCodes ?? []).some((c: string) => codes!.includes(String(c))));
    await this.call(url, { method: "PUT", json: { track, releases: [release, ...kept] } });
    return { track, release, preserved: kept.length };
  }

  /**
   * Releases already-uploaded bundle(s) to a track. Falls back to a draft release on draft apps and to
   * "not sent for review" commits when Google requires it.
   */
  async publishToTrack(pkg: string, track: string, o: PublishOpts = {}) {
    let status: ReleaseStatus = o.status ?? "completed";
    let notSent = false;
    const notes: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await this.withEdit(pkg, (id) => this.setTrackInEdit(pkg, id, track, o, status), {
          commit: !o.validateOnly,
          validateOnly: o.validateOnly,
          changesNotSentForReview: notSent,
        });
        return { ...out, status, validated_only: !!o.validateOnly, committed: !o.validateOnly, sentForReview: !notSent, notes };
      } catch (e) {
        const msg = (e as Error).message;
        if (status !== "draft" && /Only releases with status draft may be created on draft app/i.test(msg)) {
          status = "draft";
          notes.push("App is still a draft app in Play Console: created a DRAFT release instead. The user must finish setup and roll it out in Play Console once.");
          continue;
        }
        if (!notSent && /changesNotSentForReview/i.test(msg)) {
          notSent = true;
          notes.push("Changes were committed without being sent for review (managed publishing). The user must press 'Send changes for review' in Play Console.");
          continue;
        }
        throw e;
      }
    }
    throw new Error("Could not publish after retries.");
  }

  /** Uploads a local .aab. With `track` it is also released on that track in the same edit. */
  async uploadBundle(pkg: string, aabPath: string, opts: { track?: string; status?: ReleaseStatus; releaseName?: string; releaseNotes?: { language: string; text: string }[] } = {}) {
    if (!fs.existsSync(aabPath)) throw new Error(`Bundle not found: ${aabPath}`);
    if (!aabPath.endsWith(".aab")) throw new Error("Google Play needs an Android App Bundle (.aab), not an APK. Build with `flutter build appbundle --release`.");
    const data = fs.readFileSync(aabPath);
    let status: ReleaseStatus = opts.status ?? "completed";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.withEdit(
          pkg,
          async (id) => {
            const up = await this.call<{ versionCode: number; sha256?: string }>(`${UPLOAD}/${encodeURIComponent(pkg)}/edits/${id}/bundles?uploadType=media`, {
              method: "POST",
              body: data,
              contentType: "application/octet-stream",
            });
            let release: any;
            if (opts.track) {
              release = await this.setTrackInEdit(pkg, id, opts.track, { versionCodes: [up.versionCode], releaseName: opts.releaseName, releaseNotes: opts.releaseNotes }, status);
            }
            return { versionCode: up.versionCode, sha256: up.sha256, release, status };
          },
          { commit: true },
        );
      } catch (e) {
        if (opts.track && status !== "draft" && /Only releases with status draft may be created on draft app/i.test((e as Error).message)) {
          status = "draft";
          continue;
        }
        throw e;
      }
    }
    throw new Error("Bundle upload failed.");
  }

  // ---- reviews ------------------------------------------------------------

  async listReviews(pkg: string, opts: { maxResults?: number; token?: string; translationLanguage?: string } = {}) {
    const q = new URLSearchParams({ maxResults: String(Math.min(opts.maxResults ?? 20, 100)) });
    if (opts.token) q.set("token", opts.token);
    if (opts.translationLanguage) q.set("translationLanguage", opts.translationLanguage);
    return this.call<{ reviews?: any[]; tokenPagination?: { nextPageToken?: string } }>(`${this.app(pkg)}/reviews?${q}`);
  }

  async replyToReview(pkg: string, reviewId: string, text: string) {
    const n = [...text].length;
    if (!n) throw new Error("Reply text must not be empty.");
    if (n > REPLY_MAX) throw new Error(`Reply is ${n} characters; Google Play allows at most ${REPLY_MAX}. Shorten it.`);
    return this.call(`${this.app(pkg)}/reviews/${encodeURIComponent(reviewId)}:reply`, { method: "POST", json: { replyText: text } });
  }
}

// ---------------------------------------------------------------------------

export async function verifyPlay(fields: SecretFields): Promise<VerifyResult> {
  const raw = fields.serviceAccountJson;
  if (!raw) return { ok: false, error: "No service account JSON provided." };
  let client: GooglePlay;
  try {
    client = new GooglePlay(raw);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    await client.getToken();
  } catch (e) {
    const m = (e as Error).message;
    let hint = "";
    if (/invalid_grant/i.test(m)) hint = " The key may be revoked, expired or malformed, or the computer clock is off. Create a new JSON key.";
    else if (/invalid_client|unauthorized_client/i.test(m)) hint = " Check that this is a service account key and the service account still exists.";
    else if (/DECODER|PEM|asn1|key/i.test(m) && !/HTTP/.test(m)) hint = " The private_key in the JSON could not be read; download the key again.";
    return { ok: false, error: `Google rejected the service account (token exchange failed).${hint} Details: ${m.slice(0, 300)}` };
  }
  return { ok: true, details: { clientEmail: client.clientEmail, projectId: client.projectId ?? "" } };
}

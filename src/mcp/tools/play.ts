import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, GateError, type Ctx, type ToolDef } from "../context.js";
import { requireConnected, requireSuccessfulTestBuild, requireUiApproval, consumeApproval } from "../gates.js";
import { nowIso } from "../../state/store.js";
import type { State } from "../../state/schema.js";
import { GooglePlay, IMAGE_TYPES, explainPlayError, LISTING_LIMITS } from "../../services/play.js";
import { getFetch } from "../../lib/http.js";

const FIRST_RELEASE_NOTE =
  "Google Play limitation: the app record and the very first release must be created manually in Play Console (the API cannot create apps).";

function pkgOf(state: State, override?: string): string {
  const p = override || state.project.bundleId;
  if (!p) throw new GateError("No package name known for this project.", "Call plan_save (it sets the bundle id), or pass package_name explicitly.");
  return p;
}

function client(ctx: Ctx): GooglePlay {
  const f = ctx.secrets.get("play");
  if (!f) throw new GateError("Google Play is not connected.", "Call setup_link(service='play') and ask the user to connect it.");
  return new GooglePlay(f.serviceAccountJson);
}

/** Runs an API call and converts well-known Play failures into actionable GateErrors. */
async function guarded<T>(pkg: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GateError) throw e;
    const hint = explainPlayError(e, pkg);
    if (hint) throw new GateError(`${hint.message} (${(e as Error).message.slice(0, 300)})`, `${hint.nextStep} ${FIRST_RELEASE_NOTE}`);
    throw e;
  }
}

const connected = async (ctx: Ctx, _a: unknown, state: State) => requireConnected(ctx, state, "play");

const pkgArg = z.string().optional().describe("Override the package name (defaults to the project's bundle id)");
const langArg = z.string().default("en-US").describe("BCP-47 language of the store listing, e.g. en-US, de-DE");

export const playListingGet = defineTool({
  name: "play_listing_get",
  title: "Read the Google Play store listing",
  description:
    "Reads the current Google Play store listing (title, short description, full description, video) for one language, plus the number of uploaded images per type. Use it before play_listing_update to see what is live. Read-only. Fails with next steps if the app has not been created in Play Console yet.",
  input: { language: langArg, package_name: pkgArg },
  readOnly: true,
  gate: connected,
  async run(ctx, a) {
    const pkg = pkgOf(ctx.store.read(), a.package_name);
    const gp = client(ctx);
    return guarded(pkg, async () => {
      let listing: any = null;
      try {
        listing = await gp.getListing(pkg, a.language);
      } catch (e) {
        if (!/HTTP 404/.test((e as Error).message) || explainPlayError(e, pkg)) throw e;
      }
      const images: Record<string, number> = {};
      if (listing) for (const t of IMAGE_TYPES) images[t] = (await gp.listImages(pkg, a.language, t)).length;
      return {
        package_name: pkg,
        language: a.language,
        listing,
        images,
        limits: LISTING_LIMITS,
        next_step: listing ? "Use play_listing_update to change it." : `No listing exists for ${a.language} yet; play_listing_update will create it.`,
      };
    });
  },
});

export const playListingUpdate = defineTool({
  name: "play_listing_update",
  title: "Update the Google Play store listing",
  description:
    "Sets title (max 30 chars), short description (max 80) and full description (max 4000) for one language of the Play store listing and commits it (opens an edit, changes it, commits; discards on failure). Limits are checked before any call. Use dry_run=true to validate against Google without changing anything. Do not use for screenshots (play_screenshots_upload). Privacy policy, content rating and data safety cannot be set via the API; the user must do them in Play Console.",
  input: {
    language: langArg,
    title: z.string().describe("App title, max 30 characters"),
    short_description: z.string().describe("Max 80 characters"),
    full_description: z.string().describe("Max 4000 characters"),
    video: z.string().url().optional().describe("Optional YouTube URL"),
    package_name: pkgArg,
  },
  supportsDryRun: true,
  gate: connected,
  async run(ctx, a) {
    const pkg = pkgOf(ctx.store.read(), a.package_name);
    GooglePlay.checkListing({ title: a.title, shortDescription: a.short_description, fullDescription: a.full_description });
    const gp = client(ctx);
    return guarded(pkg, async () => {
      const res = await gp.updateListing(
        pkg,
        a.language,
        { title: a.title, shortDescription: a.short_description, fullDescription: a.full_description, video: a.video },
        { validateOnly: a.dry_run },
      );
      if (!a.dry_run) ctx.store.log("play", `Updated Play listing (${a.language})`, "success");
      return a.dry_run
        ? { dry_run: true, valid: true, would_update: { package_name: pkg, language: a.language, title: a.title, short_description_chars: [...a.short_description].length, full_description_chars: [...a.full_description].length }, next_step: "Call again without dry_run to apply." }
        : { updated: res, next_step: "Listing saved. Upload screenshots with play_screenshots_upload if not done." };
    });
  },
});

function defaultScreens(ctx: Ctx): string[] {
  const dir = path.join(ctx.root, ".prompt-to-store", "checks", "screens", "phone");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export const playScreenshotsUpload = defineTool({
  name: "play_screenshots_upload",
  title: "Upload Google Play screenshots / graphics",
  description:
    "Uploads PNG/JPEG images to the Play store listing for one language. image_type is phoneScreenshots (default; 2-8 needed), sevenInchScreenshots, tenInchScreenshots, featureGraphic (exactly 1024x500) or icon (512x512). If files is omitted, uses the PNGs in .prompt-to-store/checks/screens/phone (produced by check_run). Max 8 per type; replace=true deletes the existing images of that type first. Files are validated locally (format, dimensions) before anything is sent. dry_run=true only validates and shows what would be uploaded.",
  input: {
    language: langArg,
    image_type: z.enum(IMAGE_TYPES).default("phoneScreenshots"),
    files: z.array(z.string()).optional().describe("Image file paths; defaults to .prompt-to-store/checks/screens/phone/*.png"),
    replace: z.boolean().default(false).describe("Delete existing images of this type first"),
    package_name: pkgArg,
  },
  supportsDryRun: true,
  gate: connected,
  async run(ctx, a) {
    const pkg = pkgOf(ctx.store.read(), a.package_name);
    const type = a.image_type ?? "phoneScreenshots";
    const files = (a.files?.length ? a.files : defaultScreens(ctx)).map((f) => path.resolve(ctx.root, f));
    if (!files.length) throw new GateError("No screenshots found.", "Run check_run first (it captures screenshots) or pass `files` with PNG paths.");
    const gp = client(ctx);
    return guarded(pkg, async () => {
      if (a.dry_run) {
        const existing = (await gp.listImages(pkg, a.language, type)).length;
        const { warnings } = GooglePlay.preflightImages(type, files, existing, a.replace);
        return { dry_run: true, would_upload: files, image_type: type, existing_images: existing, replace: a.replace, warnings, next_step: "Call again without dry_run to upload." };
      }
      const res = await gp.uploadImages(pkg, a.language, type, files, { replace: a.replace });
      ctx.store.log("play", `Uploaded ${files.length} ${type} (${a.language})`, "success");
      return { uploaded: res.uploaded.length, warnings: res.warnings, image_type: type, next_step: "Images committed to the listing." };
    });
  },
});

export const playTrackStatus = defineTool({
  name: "play_track_status",
  title: "Google Play track status",
  description:
    "Shows what is released on each Play track (internal, alpha, beta, production): release name, status, version codes, rollout fraction, plus the newest versionCode uploaded. Read-only. Use it before play_publish and after it to confirm.",
  input: { package_name: pkgArg },
  readOnly: true,
  gate: connected,
  async run(ctx, a) {
    const pkg = pkgOf(ctx.store.read(), a.package_name);
    const gp = client(ctx);
    return guarded(pkg, async () => {
      const r = await gp.getTracks(pkg);
      return {
        package_name: pkg,
        latest_uploaded_version_code: r.latestVersionCode ?? null,
        tracks: r.tracks.map((t: any) => ({
          track: t.track,
          releases: (t.releases ?? []).map((x: any) => ({ name: x.name, status: x.status, version_codes: x.versionCodes, user_fraction: x.userFraction })),
        })),
        next_step: r.latestVersionCode ? "Call play_publish to release the newest bundle." : `No bundle uploaded yet. ${FIRST_RELEASE_NOTE}`,
      };
    });
  },
});

export const playPublish = defineTool({
  name: "play_publish",
  title: "Publish a release to a Google Play track",
  description:
    "Releases the newest uploaded app bundle to a Play track (internal default, alpha = closed, beta = open, production). Requires a successful Android test build and the USER's explicit confirmation in the local UI: the first call creates an approval request and returns a link; after the user presses Publish, call again to execute. Other releases on the track are preserved. On a draft app (first release not done in Play Console) it falls back to a draft release. dry_run=true validates with Google without changing anything and shows exactly what would happen. " +
    FIRST_RELEASE_NOTE,
  input: {
    track: z.enum(["internal", "alpha", "beta", "production"]).default("internal"),
    release_notes: z.string().optional().describe("What's new (max 500 chars)"),
    release_name: z.string().optional().describe("Release name, e.g. 1.2.0 (42); defaults to Play's"),
    language: z.string().default("en-US").describe("Language of release_notes"),
    package_name: pkgArg,
  },
  supportsDryRun: true,
  async gate(ctx, _a, state) {
    await requireConnected(ctx, state, "play");
    requireSuccessfulTestBuild(ctx, state, "android");
  },
  async run(ctx, a) {
    const state = ctx.store.read();
    const pkg = pkgOf(state, a.package_name);
    const track = a.track ?? "internal";
    const gp = client(ctx);
    const opts = {
      releaseName: a.release_name,
      releaseNotes: a.release_notes ? [{ language: a.language ?? "en-US", text: a.release_notes }] : undefined,
    };

    // Prefer the newest Codemagic release build's AAB (uploaded on publish).
    const aab = latestReleaseAab(state);
    const uploadedCode = await guarded(pkg, () => gp.latestVersionCode(pkg));
    const versionCode = uploadedCode ?? (aab ? -1 : undefined);
    if (versionCode === undefined) {
      throw new GateError(`No app bundle has been uploaded to Google Play for ${pkg}.`, `Upload the first .aab manually in Play Console (or via the Codemagic Play publishing step). ${FIRST_RELEASE_NOTE}`);
    }

    if (a.dry_run && uploadedCode === undefined) {
      return { dry_run: true, would_do: `Upload the AAB from release build ${aab!.buildId} and release it to the "${track}" track (as a draft if the app is still a draft in Play Console).` };
    }
    if (a.dry_run) {
      const r = await guarded(pkg, () => gp.publishToTrack(pkg, track, { ...opts, versionCodes: [versionCode], validateOnly: true }));
      return {
        dry_run: true,
        valid: true,
        would_do: `Release versionCode ${versionCode} of ${pkg} to the "${track}" track with status "${r.status}"${r.preserved ? ` (keeping ${r.preserved} other release(s))` : ""}.`,
        notes: r.notes,
        next_step: "Call again without dry_run; the user will be asked to confirm in the local UI first.",
      };
    }

    const approvalId = await requireUiApproval(
      ctx,
      `play_publish:${track}`,
      `Publish to Google Play (${track})`,
      `Release ${pkg} ${aab ? `(new build ${aab.buildId})` : `versionCode ${versionCode}`} to the ${track} track${a.release_notes ? ` with release notes: "${a.release_notes.slice(0, 120)}"` : ""}.`,
      { package_name: pkg, track, version_code: versionCode, release_name: a.release_name ?? null, release_notes: a.release_notes ?? null },
    );

    ctx.store.update((s) => {
      s.stages.store = { status: "in_progress", updatedAt: nowIso() };
    });
    try {
      let r: Awaited<ReturnType<typeof gp.publishToTrack>> | undefined;
      if (aab && !consumedAab(state, aab.buildId)) {
        const file = await downloadAab(ctx, aab.url, aab.buildId);
        try {
          const up: any = await guarded(pkg, () => gp.uploadBundle(pkg, file, { track, ...opts }));
          r = { status: up?.status ?? "completed", sentForReview: up?.sentForReview ?? true, preserved: up?.preserved ?? 0, notes: up?.notes ?? [] } as any;
          ctx.store.update((s) => {
            s.log.push({ at: nowIso(), level: "info", source: "play", message: `Uploaded AAB from build ${aab.buildId}` });
            s.approvals.push({ id: `aab_${aab.buildId}`, action: "aab_uploaded", title: aab.buildId, summary: "", payload: {}, status: "consumed", createdAt: nowIso() });
          });
        } catch (e) {
          if (!/already (been )?used|versionCode/i.test((e as Error).message) || uploadedCode === undefined) throw e;
        }
      }
      if (!r) {
        if (uploadedCode === undefined) throw new GateError("No bundle available to publish.", FIRST_RELEASE_NOTE);
        r = await guarded(pkg, () => gp.publishToTrack(pkg, track, { ...opts, versionCodes: [uploadedCode] }));
      }
      consumeApproval(ctx, approvalId);
      const done = r.status !== "draft" && r.sentForReview;
      ctx.store.update((s) => {
        s.stages.store = { status: "done", note: `Play ${track}: v${versionCode} (${r.status})`, updatedAt: nowIso() };
        s.log.push({ at: nowIso(), level: "success", source: "play", message: `Published versionCode ${versionCode} to ${track} (${r.status})` });
      });
      return {
        published: true,
        package_name: pkg,
        track,
        version_code: versionCode,
        status: r.status,
        notes: r.notes,
        next_step: done
          ? "Released. Google may still review it; check play_track_status later."
          : "Saved as a draft / not yet sent for review. Tell the user what to finish in Play Console (see notes), then it can roll out.",
      };
    } catch (e) {
      ctx.store.update((s) => {
        s.stages.store = { status: "failed", note: (e as Error).message.slice(0, 300), updatedAt: nowIso() };
      });
      throw e;
    }
  },
});

export const playReviews = defineTool({
  name: "play_reviews",
  title: "Read Google Play user reviews",
  description:
    "Lists recent Play user reviews (the API only returns reviews from the last 7 days): id, stars, text, app version, and whether the developer already replied. Read-only. Use before play_reply.",
  input: { max_results: z.number().int().min(1).max(100).default(20), page_token: z.string().optional(), package_name: pkgArg },
  readOnly: true,
  gate: connected,
  async run(ctx, a) {
    const pkg = pkgOf(ctx.store.read(), a.package_name);
    const gp = client(ctx);
    return guarded(pkg, async () => {
      const r = await gp.listReviews(pkg, { maxResults: a.max_results, token: a.page_token });
      return {
        reviews: (r.reviews ?? []).map((rv: any) => {
          const u = rv.comments?.find((c: any) => c.userComment)?.userComment ?? {};
          const d = rv.comments?.find((c: any) => c.developerComment)?.developerComment;
          return { review_id: rv.reviewId, author: rv.authorName, stars: u.starRating, text: u.text, app_version: u.appVersionName, replied: !!d, reply: d?.text };
        }),
        next_page_token: r.tokenPagination?.nextPageToken,
        next_step: "Reply to a review with play_reply(review_id, text) (max 350 characters). Ask the user before replying publicly.",
      };
    });
  },
});

export const playReply = defineTool({
  name: "play_reply",
  title: "Reply to a Google Play review",
  description:
    "Posts a public developer reply (max 350 characters) to a Play review by review_id (from play_reviews). Re-posting edits an earlier reply. Replies are public: confirm the wording with the user first.",
  input: { review_id: z.string().min(1), text: z.string().min(1).describe("Max 350 characters"), package_name: pkgArg },
  gate: connected,
  async run(ctx, a) {
    const pkg = pkgOf(ctx.store.read(), a.package_name);
    const gp = client(ctx);
    return guarded(pkg, async () => {
      const r = await gp.replyToReview(pkg, a.review_id, a.text);
      ctx.store.log("play", `Replied to review ${a.review_id}`, "info");
      return { replied: true, result: r };
    });
  },
});

export const playTools: ToolDef<any>[] = [playListingGet, playListingUpdate, playScreenshotsUpload, playTrackStatus, playPublish, playReviews, playReply];

function latestReleaseAab(state: State): { buildId: string; url: string } | undefined {
  const b = [...state.builds].reverse().find((x) => x.kind === "release" && x.platform === "android" && x.status === "finished");
  const art = b?.artifacts.find((x) => x.name.endsWith(".aab"));
  return b && art ? { buildId: b.id, url: art.url } : undefined;
}

function consumedAab(state: State, buildId: string) {
  return state.approvals.some((x) => x.id === `aab_${buildId}`);
}

async function downloadAab(ctx: Ctx, url: string, buildId: string): Promise<string> {
  const token = ctx.secrets.get("codemagic")?.token;
  const res = await getFetch()(url, { headers: token ? { "x-auth-token": token } : {} });
  if (!res.ok) throw new Error(`Could not download the AAB from Codemagic (HTTP ${res.status}). Run build_status for build ${buildId} to refresh links.`);
  const dir = path.join(ctx.store.p.dir, "builds");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${buildId}.aab`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

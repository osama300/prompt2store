import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, GateError, type Ctx, type ToolDef } from "../context.js";
import { consumeApproval, requireConnected, requireSuccessfulTestBuild, requireUiApproval } from "../gates.js";
import { AppStoreConnect, validateMetadata, type MetadataFields } from "../../services/appstore.js";
import { nowIso } from "../../state/store.js";
import type { State } from "../../state/schema.js";

const connected = (ctx: Ctx, _a: unknown, s: State) => requireConnected(ctx, s, "appstore");

function client(ctx: Ctx): AppStoreConnect {
  const f = ctx.secrets.get("appstore");
  if (!f) throw new GateError("App Store Connect is not connected.", "Call setup_link(service='appstore').");
  return AppStoreConnect.fromSecret(f);
}

/** Resolves the app record; if missing, tells the agent the one manual step. */
async function resolveApp(ctx: Ctx, asc: AppStoreConnect, bundleOverride?: string) {
  const bundleId = bundleOverride || ctx.store.read().project.bundleId;
  if (!bundleId) throw new GateError("No bundle id known.", "Call plan_save (sets bundle_id) or pass bundle_id.");
  const app = await asc.findAppByBundleId(bundleId);
  if (!app) {
    throw new GateError(
      `No App Store Connect app record exists for bundle id ${bundleId}.`,
      `The API cannot create app records. Ask the user to create it once: App Store Connect -> My Apps -> + -> New App, choosing bundle id "${bundleId}" (register the bundle id first at developer.apple.com -> Identifiers if it is not in the list). Then call this tool again.`,
    );
  }
  return app;
}

const bundleArg = z.string().optional().describe("Override the bundle id (default: project bundle id from plan_save)");
const localeArg = z.string().default("en-US").describe("App Store locale, e.g. en-US, de-DE");

function logStore(ctx: Ctx, message: string, status?: "in_progress" | "done" | "failed") {
  ctx.store.update((s) => {
    if (status) s.stages.store = { status, updatedAt: nowIso(), note: message };
    s.log.push({ at: nowIso(), level: status === "failed" ? "error" : "info", source: "appstore", message });
  });
}

export const ascMetadataGet = defineTool({
  name: "asc_metadata_get",
  title: "Read App Store listing",
  description:
    "Reads the App Store listing for one locale from App Store Connect: name, subtitle, privacyPolicyUrl, description, keywords, promotionalText, whatsNew, supportUrl, marketingUrl, plus the editable version. Null means not set. Fails with a next step if the app record does not exist yet.",
  input: { bundle_id: bundleArg, locale: localeArg },
  readOnly: true,
  gate: connected,
  async run(ctx, a) {
    const asc = client(ctx);
    const app = await resolveApp(ctx, asc, a.bundle_id);
    return { app, ...(await asc.getMetadata(app.id, a.locale)) };
  },
});

export const ascMetadataUpdate = defineTool({
  name: "asc_metadata_update",
  title: "Update App Store listing",
  description:
    "Creates or updates the App Store listing text for one locale (creating the locale and the editable version if missing). Pass only the fields to change. Limits are enforced before any call: name 30 chars, subtitle 30, promotional_text 170, description 4000, whats_new 4000, keywords 100 BYTES (comma separated). whats_new is not allowed for a first version (1.0). Use dry_run=true to validate and preview without changing anything.",
  input: {
    bundle_id: bundleArg,
    locale: localeArg,
    version_string: z.string().optional().describe("Marketing version to create if no editable version exists, e.g. 1.0.0"),
    name: z.string().optional(),
    subtitle: z.string().optional(),
    privacy_policy_url: z.string().optional(),
    description: z.string().optional(),
    keywords: z.string().optional().describe("Comma-separated, max 100 bytes"),
    promotional_text: z.string().optional(),
    whats_new: z.string().optional(),
    support_url: z.string().optional(),
    marketing_url: z.string().optional(),
  },
  supportsDryRun: true,
  gate: connected,
  async run(ctx, a) {
    const fields: MetadataFields = {
      name: a.name,
      subtitle: a.subtitle,
      privacyPolicyUrl: a.privacy_policy_url,
      description: a.description,
      keywords: a.keywords,
      promotionalText: a.promotional_text,
      whatsNew: a.whats_new,
      supportUrl: a.support_url,
      marketingUrl: a.marketing_url,
    };
    for (const k of Object.keys(fields) as (keyof MetadataFields)[]) if (fields[k] === undefined) delete fields[k];
    if (!Object.keys(fields).length) throw new GateError("No fields to update.", "Pass at least one of name, subtitle, description, keywords, ...");
    const errors = validateMetadata(fields);
    if (a.dry_run) {
      return { dry_run: true, valid: errors.length === 0, errors, would_update: Object.keys(fields), locale: a.locale };
    }
    const asc = client(ctx);
    const app = await resolveApp(ctx, asc, a.bundle_id);
    const r = await asc.updateMetadata(app.id, a.locale, fields, a.version_string);
    logStore(ctx, `Updated App Store ${a.locale} listing: ${r.updated.join(", ")}`, "in_progress");
    return { ok: true, ...r };
  },
});

const DEFAULT_SHOTS = (ctx: Ctx) => path.join(ctx.store.p.screenshots, "phone");

export const ascScreenshotsUpload = defineTool({
  name: "asc_screenshots_upload",
  title: "Upload App Store screenshots",
  description:
    "Uploads PNG/JPG screenshots to the editable App Store version for a locale and display type (reserve -> upload -> md5 commit -> wait for processing). Defaults: files = PNGs in .prompt-to-store/checks/screens/phone (sorted by name), display_type = APP_IPHONE_67 (accepts 1290x2796, the size check_run produces). Max 10 per set; if the set already has screenshots you must pass replace=true. Use dry_run=true to list what would be uploaded.",
  input: {
    bundle_id: bundleArg,
    locale: localeArg,
    display_type: z.string().default("APP_IPHONE_67").describe("e.g. APP_IPHONE_67, APP_IPHONE_65, APP_IPAD_PRO_3GEN_129"),
    files: z.array(z.string()).optional().describe("Paths (absolute or relative to the project). Default: phone screenshots from check_run"),
    replace: z.boolean().default(false).describe("Delete existing screenshots in this set first"),
    version_string: z.string().optional().describe("Marketing version to create if no editable version exists"),
  },
  supportsDryRun: true,
  gate: connected,
  async run(ctx, a) {
    let files: string[];
    if (a.files?.length) files = a.files.map((f) => path.resolve(ctx.root, f));
    else {
      const dir = DEFAULT_SHOTS(ctx);
      files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(dir, f)) : [];
    }
    if (!files.length) throw new GateError("No screenshots found.", "Run `check_run` to generate screenshots, or pass `files`.");
    const missing = files.filter((f) => !fs.existsSync(f));
    if (missing.length) throw new GateError(`Files not found: ${missing.join(", ")}`, "Fix the paths and retry.");
    if (files.length > 10) throw new GateError(`${files.length} files given; App Store Connect allows 10 per set.`, "Pass at most 10 files.");
    if (a.dry_run) return { dry_run: true, display_type: a.display_type, locale: a.locale, replace: a.replace, files };
    const asc = client(ctx);
    const app = await resolveApp(ctx, asc, a.bundle_id);
    const version = await asc.getEditableVersion(app.id, a.version_string);
    const md = await asc.getMetadata(app.id, a.locale, a.version_string);
    let locId = md.versionLocalizationId;
    if (!locId) {
      // Locale has no version localization yet: create an empty one via a harmless update of supportUrl-less attrs.
      const created = await asc.api("POST", "/appStoreVersionLocalizations", {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: { locale: a.locale },
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
        },
      });
      locId = created.data.id;
    }
    const r = await asc.uploadScreenshots(locId!, a.display_type, files, a.replace);
    logStore(ctx, `Uploaded ${r.uploaded.length} ${a.display_type} screenshot(s) for ${a.locale}`, "in_progress");
    return { ok: true, ...r };
  },
});

export const ascTestflightStatus = defineTool({
  name: "asc_testflight_status",
  title: "TestFlight build status",
  description:
    "Lists recent builds in App Store Connect/TestFlight (build number, marketing version, processingState PROCESSING|VALID|FAILED|INVALID, upload date). A build must be VALID before it can be submitted. Poll this after a Codemagic iOS build finishes (processing takes ~5-30 min).",
  input: { bundle_id: bundleArg, limit: z.number().int().min(1).max(50).default(10) },
  readOnly: true,
  gate: connected,
  async run(ctx, a) {
    const asc = client(ctx);
    const app = await resolveApp(ctx, asc, a.bundle_id);
    const builds = await asc.listBuilds(app.id, a.limit);
    const valid = builds.find((b) => b.processingState === "VALID");
    return {
      app: app.name,
      builds,
      latest_valid_build: valid?.id ?? null,
      next_step: valid ? "A VALID build is available; asc_submit_review can attach it." : builds.length ? "Builds are still processing or invalid; poll again later." : "No builds uploaded yet; run ship_test_build for iOS.",
    };
  },
});

export const ascSubmitReview = defineTool({
  name: "asc_submit_review",
  title: "Submit app for App Store review",
  description:
    "Submits the editable App Store version for review: attaches the build (latest VALID if build_id omitted), creates a review submission, and submits it. IRREVERSIBLE from the agent's side and requires the user's explicit confirmation in the local UI (the first call returns a link; call again after they press Publish). Requires a successful iOS test build. If Apple reports missing items (screenshots, age rating, review contact, pricing, privacy answers), they are returned verbatim in the error; fix what the API can (asc_* tools) and tell the user to complete the rest in App Store Connect. dry_run=true shows what would be submitted without asking for approval.",
  input: {
    bundle_id: bundleArg,
    build_id: z.string().optional().describe("Build to attach; default is the latest VALID build"),
    version_string: z.string().optional().describe("Marketing version to create if none is editable"),
  },
  supportsDryRun: true,
  async gate(ctx, _a, s) {
    await requireConnected(ctx, s, "appstore");
    requireSuccessfulTestBuild(ctx, s, "ios");
  },
  async run(ctx, a) {
    const asc = client(ctx);
    const app = await resolveApp(ctx, asc, a.bundle_id);
    const version = await asc.getEditableVersion(app.id, undefined).catch(() => undefined);
    const builds = await asc.listBuilds(app.id, 20);
    const build = a.build_id ? builds.find((b) => b.id === a.build_id) : builds.find((b) => b.processingState === "VALID");
    const plan = {
      app: app.name,
      bundle_id: app.bundleId,
      version: version ? `${version.versionString} (${version.state})` : a.version_string ? `new ${a.version_string}` : null,
      build: build ? `${build.marketingVersion ?? "?"} (${build.version}) ${build.processingState}` : null,
    };
    if (a.dry_run) {
      const problems: string[] = [];
      if (!version && !a.version_string) problems.push("No editable version; pass version_string.");
      if (!build) problems.push(a.build_id ? "build_id not found." : "No VALID build yet.");
      return { dry_run: true, would_submit: plan, problems };
    }
    if (!build && !a.build_id) throw new GateError("No VALID build in App Store Connect yet.", "Poll asc_testflight_status until a build is VALID.");
    const title = `Submit ${app.name} for App Store review`;
    const approvalId = await requireUiApproval(ctx, "asc_submit_review", title, `Version ${plan.version}, build ${plan.build ?? a.build_id}. Apple will review the app and it can go live after approval.`, plan);
    try {
      const v = version ?? (await asc.getEditableVersion(app.id, a.version_string));
      const r = await asc.submitForReview(app.id, v.id, a.build_id);
      consumeApproval(ctx, approvalId);
      logStore(ctx, `Submitted ${app.name} ${v.versionString} for review (${r.reviewSubmissionId})`, "done");
      return { ok: true, submitted: true, version: v.versionString, ...r, next_step: "Waiting for Apple review. Rejection reasons appear only in App Store Connect's Resolution Center / email." };
    } catch (e) {
      logStore(ctx, `Submission failed: ${(e as Error).message}`, "failed");
      throw e;
    }
  },
});

export const ascReviews = defineTool({
  name: "asc_reviews",
  title: "App Store customer reviews",
  description:
    "Lists recent App Store customer reviews (rating, title, body, any existing developer reply). To reply, pass BOTH review_id and reply_text (one reply per review; it is published publicly under the app) - only do so with the user's agreement to the wording.",
  input: {
    bundle_id: bundleArg,
    limit: z.number().int().min(1).max(100).default(20),
    review_id: z.string().optional().describe("Review to reply to"),
    reply_text: z.string().max(5970).optional().describe("Public reply text"),
  },
  gate: connected,
  async run(ctx, a) {
    const asc = client(ctx);
    if (a.review_id || a.reply_text) {
      if (!a.review_id || !a.reply_text) throw new GateError("Both review_id and reply_text are required to reply.", "Provide both, or neither to just list reviews.");
      const r = await asc.replyToReview(a.review_id, a.reply_text);
      logStore(ctx, `Replied to review ${a.review_id}`);
      return { ok: true, replied: true, ...r };
    }
    const app = await resolveApp(ctx, asc, a.bundle_id);
    return { app: app.name, reviews: await asc.listCustomerReviews(app.id, a.limit) };
  },
});

export const appStoreTools: ToolDef<any>[] = [ascMetadataGet, ascMetadataUpdate, ascScreenshotsUpload, ascTestflightStatus, ascSubmitReview, ascReviews];

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFetch } from "../src/lib/http.js";
import { AppStoreConnect, signToken, validateMetadata, verifyAppStore } from "../src/services/appstore.js";
import { appStoreTools } from "../src/mcp/tools/appstore.js";
import { createCtx, invokeTool, type Ctx } from "../src/mcp/context.js";
import { StateStore } from "../src/state/store.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const creds = { issuerId: "issuer-1", keyId: "KEY123", privateKey: PEM };

interface Call { method: string; url: string; headers: Record<string, string>; body: any }
let calls: Call[] = [];
let routes: ((c: Call) => { status?: number; json?: unknown } | undefined)[] = [];

function install() {
  calls = [];
  routes = [];
  setFetch((async (url: any, init: any) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    const c: Call = { method: init?.method ?? "GET", url: String(url), headers: init?.headers ?? {}, body };
    calls.push(c);
    for (const r of routes) {
      const out = r(c);
      if (out) {
        const text = out.json === undefined ? "" : JSON.stringify(out.json);
        return new Response(text, { status: out.status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ errors: [{ detail: `no route ${c.method} ${c.url}` }] }), { status: 404 });
  }) as typeof fetch);
}
const route = (method: string, re: RegExp, json: unknown, status = 200) =>
  routes.push((c) => (c.method === method && re.test(c.url) ? { status, json } : undefined));

beforeEach(install);
afterEach(() => setFetch(((...a: any[]) => (fetch as any)(...a)) as any));

describe("JWT", () => {
  it("signs a verifiable ES256 token", () => {
    const jwt = signToken(creds, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    const pl = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(pl).toEqual({ iss: "issuer-1", iat: 1_700_000_000, exp: 1_700_001_200, aud: "appstoreconnect-v1" });
    const sig = Buffer.from(s, "base64url");
    expect(sig.length).toBe(64);
    expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
  });

  it("caches the token and sends it as Bearer", async () => {
    route("GET", /\/apps\?/, { data: [] });
    let t = 1_700_000_000_000;
    const asc = new AppStoreConnect(creds, { now: () => t });
    await asc.api("GET", "/apps?limit=1");
    t += 60_000;
    await asc.api("GET", "/apps?limit=1");
    expect(calls[0].headers.authorization).toMatch(/^Bearer /);
    expect(calls[0].headers.authorization).toBe(calls[1].headers.authorization);
    t += 16 * 60_000;
    await asc.api("GET", "/apps?limit=1");
    expect(calls[2].headers.authorization).not.toBe(calls[0].headers.authorization);
  });
});

describe("verifyAppStore", () => {
  it("rejects a bad PEM without calling the network", async () => {
    const r = await verifyAppStore({ ...creds, privateKey: "nope" });
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
  it("ok on 200", async () => {
    route("GET", /\/v1\/apps\?limit=1/, { data: [{ id: "1" }], meta: { paging: { total: 3 } } });
    expect(await verifyAppStore(creds)).toEqual({ ok: true, details: { keyId: "KEY123", apps: "3" } });
  });
  it("friendly 401", async () => {
    route("GET", /\/v1\/apps/, { errors: [{ code: "NOT_AUTHORIZED" }] }, 401);
    const r = await verifyAppStore(creds);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Issuer ID, Key ID/);
  });
});

describe("metadata", () => {
  it("enforces limits", () => {
    expect(validateMetadata({ name: "x".repeat(31) })[0]).toMatch(/name/);
    expect(validateMetadata({ subtitle: "x".repeat(31) }).length).toBe(1);
    expect(validateMetadata({ promotionalText: "x".repeat(171) }).length).toBe(1);
    expect(validateMetadata({ description: "x".repeat(4001) }).length).toBe(1);
    expect(validateMetadata({ whatsNew: "x".repeat(4001) }).length).toBe(1);
    expect(validateMetadata({ keywords: "é".repeat(51) })[0]).toMatch(/bytes/); // 102 bytes, 51 chars
    expect(validateMetadata({ keywords: "a".repeat(100), name: "Ok", description: "d".repeat(4000) })).toEqual([]);
  });

  it("does not call the API when limits are violated", async () => {
    const asc = new AppStoreConnect(creds);
    await expect(asc.updateMetadata("1", "en-US", { subtitle: "x".repeat(40) })).rejects.toThrow(/limits/);
    expect(calls.length).toBe(0);
  });

  it("creates missing localizations and patches existing ones", async () => {
    route("GET", /\/apps\/1\/appInfos$/, { data: [{ id: "info1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] });
    route("GET", /\/appInfos\/info1\/appInfoLocalizations/, { data: [{ id: "il1", attributes: { locale: "en-US" } }] });
    route("PATCH", /\/appInfoLocalizations\/il1$/, { data: { id: "il1" } });
    route("GET", /\/apps\/1\/appStoreVersions/, { data: [{ id: "v1", attributes: { versionString: "1.0", appStoreState: "PREPARE_FOR_SUBMISSION" } }] });
    route("GET", /\/appStoreVersions\/v1\/appStoreVersionLocalizations/, { data: [] });
    route("POST", /\/appStoreVersionLocalizations$/, { data: { id: "vl1" } }, 201);
    const asc = new AppStoreConnect(creds);
    const r = await asc.updateMetadata("1", "en-US", { subtitle: "Hi", description: "Desc", keywords: "a,b" });
    expect(r.updated.sort()).toEqual(["description", "keywords", "subtitle"]);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.data.attributes).toEqual({ locale: "en-US", description: "Desc", keywords: "a,b" });
    expect(post.body.data.relationships.appStoreVersion.data).toEqual({ type: "appStoreVersions", id: "v1" });
    expect(calls.find((c) => c.method === "PATCH")!.body.data.attributes).toEqual({ subtitle: "Hi" });
  });
});

describe("409 errors", () => {
  it("surfaces detail and associatedErrors verbatim", async () => {
    route("POST", /reviewSubmissionItems/, {
      errors: [{ code: "ENTITY_ERROR", title: "bad", detail: "Missing screenshots", meta: { associatedErrors: { "/v1/appScreenshotSets": [{ code: "X", detail: "You must upload a 6.7in screenshot" }] } } }],
    }, 409);
    const asc = new AppStoreConnect(creds);
    await expect(asc.api("POST", "/reviewSubmissionItems", {})).rejects.toThrow(/Missing screenshots[\s\S]*You must upload a 6\.7in screenshot/);
  });
});

describe("screenshots", () => {
  it("reserve -> PUT slices with headers -> PATCH md5 -> poll", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asc-"));
    const file = path.join(tmp, "1.png");
    const data = Buffer.from("0123456789abcdef");
    fs.writeFileSync(file, data);
    route("GET", /appStoreVersionLocalizations\/vl1\/appScreenshotSets/, { data: [] });
    route("POST", /\/appScreenshotSets$/, { data: { id: "set1" } }, 201);
    route("POST", /\/appScreenshots$/, {
      data: {
        id: "shot1",
        attributes: {
          uploadOperations: [
            { method: "PUT", url: "https://upload.example/a", offset: 0, length: 10, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
            { method: "PUT", url: "https://upload.example/b", offset: 10, length: 6, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
          ],
        },
      },
    }, 201);
    routes.push((c) => (c.method === "PUT" ? { status: 200 } : undefined));
    route("PATCH", /\/appScreenshots\/shot1$/, { data: { id: "shot1" } });
    route("GET", /\/appScreenshots\/shot1$/, { data: { attributes: { assetDeliveryState: { state: "COMPLETE" } } } });

    const asc = new AppStoreConnect(creds, { pollMs: 1 });
    const r = await asc.uploadScreenshots("vl1", "APP_IPHONE_67", [file], false);
    expect(r.uploaded[0].state).toBe("COMPLETE");

    const seq = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seq).toEqual([
      "GET /v1/appStoreVersionLocalizations/vl1/appScreenshotSets",
      "POST /v1/appScreenshotSets",
      "POST /v1/appScreenshots",
      "PUT /a",
      "PUT /b",
      "PATCH /v1/appScreenshots/shot1",
      "GET /v1/appScreenshots/shot1",
    ]);
    const reserve = calls[2].body.data.attributes;
    expect(reserve).toEqual({ fileName: "1.png", fileSize: 16 });
    const [p1, p2] = [calls[3], calls[4]];
    expect(Buffer.from(p1.body).toString()).toBe("0123456789");
    expect(Buffer.from(p2.body).toString()).toBe("abcdef");
    expect(p1.headers["Content-Type"]).toBe("image/png");
    expect(p1.headers.authorization).toBeUndefined();
    const commit = calls[5].body.data.attributes;
    expect(commit).toEqual({ uploaded: true, sourceFileChecksum: crypto.createHash("md5").update(data).digest("hex") });
  });

  it("refuses to overwrite an existing set without replace", async () => {
    route("GET", /appScreenshotSets\?/, { data: [{ id: "set1", attributes: { screenshotDisplayType: "APP_IPHONE_67" } }] });
    route("GET", /appScreenshotSets\/set1\/appScreenshots/, { data: [{ id: "old" }] });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asc-"));
    fs.writeFileSync(path.join(tmp, "a.png"), "x");
    const asc = new AppStoreConnect(creds);
    await expect(asc.uploadScreenshots("vl1", "APP_IPHONE_67", [path.join(tmp, "a.png")], false)).rejects.toThrow(/replace=true/);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

describe("submit", () => {
  it("attaches latest VALID build, creates submission, adds item, submits", async () => {
    route("GET", /\/builds\?/, {
      data: [
        { id: "b2", attributes: { version: "2", processingState: "PROCESSING" } },
        { id: "b1", attributes: { version: "1", processingState: "VALID" } },
      ],
    });
    route("PATCH", /relationships\/build$/, {});
    route("GET", /\/reviewSubmissions\?/, { data: [] });
    route("POST", /\/reviewSubmissions$/, { data: { id: "rs1" } }, 201);
    route("POST", /\/reviewSubmissionItems$/, { data: { id: "i1" } }, 201);
    route("PATCH", /\/reviewSubmissions\/rs1$/, { data: { attributes: { state: "WAITING_FOR_REVIEW" } } });
    const r = await new AppStoreConnect(creds).submitForReview("app1", "v1");
    expect(r).toEqual({ reviewSubmissionId: "rs1", buildId: "b1", state: "WAITING_FOR_REVIEW" });
    const seq = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seq).toEqual([
      "GET /v1/builds",
      "PATCH /v1/appStoreVersions/v1/relationships/build",
      "GET /v1/reviewSubmissions",
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/rs1",
    ]);
    expect(calls[1].body).toEqual({ data: { type: "builds", id: "b1" } });
    expect(calls[5].body.data.attributes).toEqual({ submitted: true });
  });
});

describe("tools / gates", () => {
  let tmp: string;
  let ctx: Ctx;
  const tool = (n: string) => appStoreTools.find((t) => t.name === n)!;
  const ui = { async ensure() { return { baseUrl: "http://127.0.0.1:1", token: "t" }; }, async link(p: string) { return `http://127.0.0.1:1${p}?t=t`; } };

  beforeEach(() => {
    process.env.P2S_SECRETS_BACKEND = "file";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asc-proj-"));
    new StateStore(tmp).init();
    ctx = createCtx(tmp, ui);
    ctx.store.update((s) => { s.project.bundleId = "com.example.app"; });
  });

  const connect = () => {
    ctx.secrets.set?.("appstore" as any, creds as any);
    ctx.store.update((s) => { s.connections.appstore.connected = true; });
  };
  const text = (r: any) => JSON.parse(r.content[0].text);

  it("exposes the expected tools", () => {
    expect(appStoreTools.map((t) => t.name)).toEqual([
      "asc_metadata_get", "asc_metadata_update", "asc_screenshots_upload", "asc_testflight_status", "asc_submit_review", "asc_reviews",
    ]);
    for (const n of ["asc_metadata_update", "asc_screenshots_upload", "asc_submit_review"]) expect(tool(n).supportsDryRun).toBe(true);
  });

  it("blocks when not connected", async () => {
    const r = await invokeTool(ctx, tool("asc_metadata_get"), {});
    expect(r.isError).toBe(true);
    expect(text(r).blocked).toBe(true);
  });

  it("explains how to create the app record when missing", async () => {
    connect();
    route("GET", /filter\[bundleId\]/, { data: [] });
    const r = await invokeTool(ctx, tool("asc_metadata_get"), {});
    expect(text(r).next_step).toMatch(/My Apps/);
    expect(text(r).next_step).toContain("com.example.app");
  });

  it("dry_run never mutates", async () => {
    connect();
    const r = await invokeTool(ctx, tool("asc_metadata_update"), { dry_run: true, subtitle: "x".repeat(31) });
    expect(text(r).valid).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("submit needs a successful iOS build, then UI approval, then submits", async () => {
    connect();
    let r = await invokeTool(ctx, tool("asc_submit_review"), {});
    expect(text(r).reason).toMatch(/ios build/);

    ctx.store.update((s) => {
      s.builds.push({ id: "bd", provider: "codemagic", workflow: "ios", platform: "ios", kind: "test", status: "finished", startedAt: "now", artifacts: [] } as any);
    });
    route("GET", /filter\[bundleId\]/, { data: [{ id: "app1", attributes: { name: "App", bundleId: "com.example.app" } }] });
    route("GET", /appStoreVersions\?/, { data: [{ id: "v1", attributes: { versionString: "1.0", appStoreState: "PREPARE_FOR_SUBMISSION" } }] });
    route("GET", /\/builds\?/, { data: [{ id: "b1", attributes: { version: "1", processingState: "VALID" } }] });
    route("PATCH", /relationships\/build$/, {});
    route("GET", /\/reviewSubmissions\?/, { data: [] });
    route("POST", /\/reviewSubmissions$/, { data: { id: "rs1" } }, 201);
    route("POST", /\/reviewSubmissionItems$/, { data: { id: "i1" } }, 201);
    route("PATCH", /\/reviewSubmissions\/rs1$/, { data: { attributes: { state: "WAITING_FOR_REVIEW" } } });

    r = await invokeTool(ctx, tool("asc_submit_review"), { dry_run: true });
    expect(text(r).dry_run).toBe(true);
    expect(calls.some((c) => c.method !== "GET")).toBe(false);

    r = await invokeTool(ctx, tool("asc_submit_review"), {});
    expect(text(r).blocked).toBe(true);
    expect(text(r).reason).toMatch(/confirmation/);
    expect(calls.some((c) => c.method !== "GET")).toBe(false);

    ctx.store.update((s) => { s.approvals.find((a) => a.action === "asc_submit_review")!.status = "approved"; });
    r = await invokeTool(ctx, tool("asc_submit_review"), {});
    expect(text(r).submitted).toBe(true);
    const st = ctx.store.read();
    expect(st.approvals.find((a) => a.action === "asc_submit_review")!.status).toBe("consumed");
    expect(st.stages.store.status).toBe("done");
  });
});

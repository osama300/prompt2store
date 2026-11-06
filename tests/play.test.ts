import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { setFetch } from "../src/lib/http.js";
import { GooglePlay, verifyPlay, inspectImageBuffer } from "../src/services/play.js";
import { StateStore } from "../src/state/store.js";
import { createCtx, invokeTool } from "../src/mcp/context.js";
import { playTools } from "../src/mcp/tools/play.js";

process.env.P2S_SECRETS_BACKEND = "file";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const saJson = JSON.stringify({ type: "service_account", client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey, project_id: "proj" });

interface Call {
  method: string;
  url: string;
  body?: any;
  headers: Record<string, string>;
}
type Handler = (c: Call) => { status?: number; json?: unknown } | undefined;

function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  setFetch((async (url: any, init: any) => {
    const call: Call = { method: init?.method ?? "GET", url: String(url), headers: init?.headers ?? {}, body: init?.body };
    calls.push(call);
    if (call.url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    const r = handler(call) ?? { json: {} };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch);
  return calls;
}
const jbody = (c: Call) => (typeof c.body === "string" ? JSON.parse(c.body) : undefined);
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.ex.app";

function png(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(1))), chunk("IEND", Buffer.alloc(0))]);
}

beforeEach(() => {
  mockFetch(() => undefined);
});
afterEach(() => {
  delete process.env.P2S_PLAY_SERVICE_ACCOUNT_JSON;
});

describe("auth", () => {
  it("sends a valid RS256 JWT bearer assertion and caches the token", async () => {
    const calls = mockFetch(() => undefined);
    const gp = new GooglePlay(saJson);
    expect(await gp.getToken()).toBe("tok");
    await gp.getToken();
    const tokenCalls = calls.filter((c) => c.url.includes("oauth2"));
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(tokenCalls[0].body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, s] = form.get("assertion")!.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims.iss).toBe("bot@proj.iam.gserviceaccount.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/androidpublisher");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("verifyPlay: friendly errors and success", async () => {
    expect((await verifyPlay({ serviceAccountJson: "nope" })).error).toMatch(/not valid JSON/);
    expect((await verifyPlay({ serviceAccountJson: JSON.stringify({ type: "authorized_user" }) })).error).toMatch(/service_account/);
    expect((await verifyPlay({ serviceAccountJson: JSON.stringify({ type: "service_account" }) })).error).toMatch(/client_email/);
    const ok = await verifyPlay({ serviceAccountJson: saJson });
    expect(ok).toEqual({ ok: true, details: { clientEmail: "bot@proj.iam.gserviceaccount.com", projectId: "proj" } });
    setFetch((async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch);
    const bad = await verifyPlay({ serviceAccountJson: saJson });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/token exchange failed/);
  });
});

describe("listing", () => {
  it("rejects over-limit text before any HTTP call", async () => {
    const calls = mockFetch(() => undefined);
    const gp = new GooglePlay(saJson);
    await expect(gp.updateListing("com.ex.app", "en-US", { title: "x".repeat(31), shortDescription: "s", fullDescription: "f" })).rejects.toThrow(/title is 31 characters.*30/);
    await expect(gp.updateListing("com.ex.app", "en-US", { title: "t", shortDescription: "s".repeat(81), fullDescription: "f" })).rejects.toThrow(/shortDescription/);
    await expect(gp.updateListing("com.ex.app", "en-US", { title: "t", shortDescription: "s", fullDescription: "f".repeat(4001) })).rejects.toThrow(/fullDescription/);
    expect(calls).toHaveLength(0);
  });

  it("edit lifecycle: insert -> update -> commit", async () => {
    const calls = mockFetch((c) => {
      if (c.method === "POST" && c.url === `${API}/edits`) return { json: { id: "e1" } };
      if (c.method === "GET" && c.url.includes("/listings/")) return { status: 404, json: { error: { message: "nf" } } };
    });
    const gp = new GooglePlay(saJson);
    await gp.updateListing("com.ex.app", "en-US", { title: "T", shortDescription: "S", fullDescription: "F" });
    const seq = calls.filter((c) => !c.url.includes("oauth2")).map((c) => `${c.method} ${c.url.replace(API, "")}`);
    expect(seq).toEqual(["POST /edits", "GET /edits/e1/listings/en-US", "PUT /edits/e1/listings/en-US", "POST /edits/e1:commit"]);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(jbody(put)).toEqual({ language: "en-US", title: "T", shortDescription: "S", fullDescription: "F" });
    expect(put.headers.authorization).toBe("Bearer tok");
  });

  it("deletes the edit when the change fails", async () => {
    const calls = mockFetch((c) => {
      if (c.method === "POST" && c.url === `${API}/edits`) return { json: { id: "e2" } };
      if (c.method === "PUT") return { status: 400, json: { error: { message: "bad" } } };
      if (c.method === "GET") return { status: 404, json: {} };
    });
    const gp = new GooglePlay(saJson);
    await expect(gp.updateListing("com.ex.app", "en-US", { title: "T", shortDescription: "S", fullDescription: "F" })).rejects.toThrow(/HTTP 400/);
    expect(calls.some((c) => c.method === "DELETE" && c.url === `${API}/edits/e2`)).toBe(true);
    expect(calls.some((c) => c.url.includes(":commit"))).toBe(false);
  });

  it("validateOnly validates and discards, never commits", async () => {
    const calls = mockFetch((c) => (c.method === "POST" && c.url === `${API}/edits` ? { json: { id: "e3" } } : c.method === "GET" ? { status: 404, json: {} } : undefined));
    await new GooglePlay(saJson).updateListing("com.ex.app", "en-US", { title: "T", shortDescription: "S", fullDescription: "F" }, { validateOnly: true });
    const urls = calls.map((c) => `${c.method} ${c.url.replace(API, "")}`);
    expect(urls).toContain("POST /edits/e3:validate");
    expect(urls).toContain("DELETE /edits/e3");
    expect(urls.some((u) => u.includes(":commit"))).toBe(false);
  });
});

describe("images", () => {
  it("parses PNG headers and validates dimensions", () => {
    expect(inspectImageBuffer(png(1080, 1920))).toMatchObject({ format: "png", width: 1080, height: 1920, hasAlpha: false });
    expect(() => inspectImageBuffer(Buffer.from("hello world, definitely not an image"))).toThrow(/PNG or JPEG/);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-img-"));
    const good = path.join(tmp, "a.png");
    const tiny = path.join(tmp, "b.png");
    fs.writeFileSync(good, png(1080, 1920));
    fs.writeFileSync(tiny, png(100, 100));
    expect(() => GooglePlay.preflightImages("phoneScreenshots", [good])).not.toThrow();
    expect(() => GooglePlay.preflightImages("phoneScreenshots", [tiny])).toThrow(/at least 320/);
    expect(() => GooglePlay.preflightImages("featureGraphic", [good])).toThrow(/1024x500/);
    expect(() => GooglePlay.preflightImages("phoneScreenshots", Array(5).fill(good), 4)).toThrow(/at most 8/);
    expect(() => GooglePlay.preflightImages("phoneScreenshots", Array(5).fill(good), 4, true)).not.toThrow();
  });
});

describe("publishToTrack", () => {
  const base = (c: Call, extra?: (c: Call) => ReturnType<Handler>) => {
    if (c.method === "POST" && c.url === `${API}/edits`) return { json: { id: "e9" } };
    if (c.url.endsWith("/bundles")) return { json: { bundles: [{ versionCode: 3 }, { versionCode: 7 }] } };
    if (c.method === "GET" && c.url.endsWith("/tracks/production")) return { json: { track: "production", releases: [{ status: "inProgress", versionCodes: ["5"], userFraction: 0.2 }] } };
    return extra?.(c);
  };

  it("uses the newest uploaded versionCode and preserves other releases", async () => {
    const calls = mockFetch((c) => base(c));
    const r = await new GooglePlay(saJson).publishToTrack("com.ex.app", "production", { releaseNotes: [{ language: "en-US", text: "Fixes" }] });
    const put = calls.find((c) => c.method === "PUT")!;
    const b = jbody(put);
    expect(b.releases[0]).toMatchObject({ versionCodes: ["7"], status: "completed", releaseNotes: [{ language: "en-US", text: "Fixes" }] });
    expect(b.releases[1]).toMatchObject({ status: "inProgress", versionCodes: ["5"] });
    expect(r.preserved).toBe(1);
    expect(calls.some((c) => c.url.includes("e9:commit"))).toBe(true);
  });

  it("falls back to draft on draft apps (new edit, old one deleted)", async () => {
    let puts = 0;
    const calls = mockFetch((c) =>
      base(c, (x) => {
        if (x.method === "PUT") {
          puts++;
          if (jbody(x).releases[0].status === "completed") return { status: 400, json: { error: { message: "Only releases with status draft may be created on draft app." } } };
        }
      }),
    );
    const r = await new GooglePlay(saJson).publishToTrack("com.ex.app", "internal", {});
    expect(puts).toBe(2);
    expect(r.status).toBe("draft");
    expect(r.notes.join(" ")).toMatch(/draft/i);
    expect(calls.filter((c) => c.method === "DELETE").length).toBe(1);
    expect(calls.filter((c) => c.url.includes(":commit"))).toHaveLength(1);
  });

  it("requires userFraction for inProgress and errors without bundles", async () => {
    mockFetch((c) => base(c));
    await expect(new GooglePlay(saJson).publishToTrack("com.ex.app", "internal", { status: "inProgress" })).rejects.toThrow(/userFraction/);
    mockFetch((c) => (c.method === "POST" && c.url === `${API}/edits` ? { json: { id: "x" } } : c.url.endsWith("/bundles") ? { json: {} } : undefined));
    await expect(new GooglePlay(saJson).publishToTrack("com.ex.app", "internal", {})).rejects.toThrow(/No bundle/);
  });
});

describe("reviews", () => {
  it("enforces the 350 character reply limit", async () => {
    const calls = mockFetch(() => ({ json: { result: { replyText: "ok" } } }));
    const gp = new GooglePlay(saJson);
    await expect(gp.replyToReview("com.ex.app", "r1", "x".repeat(351))).rejects.toThrow(/350/);
    await gp.replyToReview("com.ex.app", "r1", "Thanks!");
    expect(calls.at(-1)!.url).toBe(`${API}/reviews/r1:reply`);
    expect(jbody(calls.at(-1)!)).toEqual({ replyText: "Thanks!" });
  });
});

describe("tools", () => {
  let tmp: string;
  const ui = {
    async ensure() {
      return { baseUrl: "http://127.0.0.1:1", token: "t" };
    },
    async link(p: string) {
      return `http://127.0.0.1:1${p}`;
    },
  };
  const tool = (n: string) => playTools.find((t) => t.name === n)!;
  const text = (r: any) => JSON.parse(r.content[0].text);

  beforeEach(() => {
    process.env.P2S_SECRETS_BACKEND = "file";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-play-"));
    new StateStore(tmp).init();
    new StateStore(tmp).update((s) => {
      s.project.bundleId = "com.ex.app";
    });
  });

  it("exposes the expected tools", () => {
    expect(playTools.map((t) => t.name)).toEqual(["play_listing_get", "play_listing_update", "play_screenshots_upload", "play_track_status", "play_publish", "play_reviews", "play_reply"]);
    expect(tool("play_publish").supportsDryRun).toBe(true);
  });

  it("blocks every tool until Play is connected", async () => {
    const ctx = createCtx(tmp, ui);
    for (const t of playTools) {
      const r = await invokeTool(ctx, t, { language: "en-US", title: "t", short_description: "s", full_description: "f", review_id: "r", text: "x" });
      expect(r.isError).toBe(true);
      const j = text(r);
      expect(j.blocked).toBe(true);
      expect(j.next_step).toMatch(/connect\/play/);
    }
  });

  async function connected() {
    const ctx = createCtx(tmp, ui);
    ctx.secrets.set("play", { serviceAccountJson: saJson });
    new StateStore(tmp).update((s) => {
      s.connections.play.connected = true;
    });
    return ctx;
  }

  it("play_publish needs a successful Android build, then UI approval", async () => {
    const ctx = await connected();
    let r = text(await invokeTool(ctx, tool("play_publish"), {}));
    expect(r.blocked).toBe(true);
    expect(r.next_step).toMatch(/ship_test_build/);

    new StateStore(tmp).update((s) => {
      s.builds.push({ id: "b1", platform: "android", status: "finished", workflow: "android", startedAt: new Date().toISOString() } as any);
    });
    const calls = mockFetch((c) => {
      if (c.method === "POST" && c.url === `${API}/edits`) return { json: { id: "e1" } };
      if (c.url.endsWith("/bundles")) return { json: { bundles: [{ versionCode: 9 }] } };
      if (c.method === "GET" && c.url.includes("/tracks/")) return { status: 404, json: {} };
    });
    r = text(await invokeTool(ctx, tool("play_publish"), { track: "internal" }));
    expect(r.blocked).toBe(true);
    expect(r.next_step).toMatch(/Publish/);
    expect(calls.some((c) => c.url.includes(":commit"))).toBe(false);
    const st = new StateStore(tmp).read();
    expect(st.approvals).toHaveLength(1);
    expect(st.approvals[0].action).toBe("play_publish:internal");

    // dry run: validates, never commits, no approval needed
    calls.length = 0;
    r = text(await invokeTool(ctx, tool("play_publish"), { track: "internal", dry_run: true }));
    expect(r.dry_run).toBe(true);
    expect(r.would_do).toMatch(/versionCode 9/);
    expect(calls.some((c) => c.url.includes(":commit"))).toBe(false);
    expect(calls.some((c) => c.url.includes(":validate"))).toBe(true);

    // approved -> executes, consumes approval, marks store stage done
    new StateStore(tmp).update((s) => {
      s.approvals[0].status = "approved";
    });
    calls.length = 0;
    r = text(await invokeTool(ctx, tool("play_publish"), { track: "internal", release_notes: "Hello" }));
    expect(r.published).toBe(true);
    expect(calls.some((c) => c.url.includes(":commit"))).toBe(true);
    const after = new StateStore(tmp).read();
    expect(after.approvals[0].status).toBe("consumed");
    expect(after.stages.store.status).toBe("done");
  });

  it("maps a missing app to an actionable next step", async () => {
    const ctx = await connected();
    mockFetch((c) => (c.method === "POST" && c.url === `${API}/edits` ? { status: 404, json: { error: { message: "Package not found: com.ex.app" } } } : undefined));
    const r = text(await invokeTool(ctx, tool("play_track_status"), {}));
    expect(r.blocked).toBe(true);
    expect(r.next_step).toMatch(/Create app/);
  });

  it("play_listing_update dry_run does not commit and validates limits", async () => {
    const ctx = await connected();
    const bad = text(await invokeTool(ctx, tool("play_listing_update"), { language: "en-US", title: "x".repeat(40), short_description: "s", full_description: "f" }));
    expect(bad.error).toMatch(/title/);
    const calls = mockFetch((c) => (c.method === "POST" && c.url === `${API}/edits` ? { json: { id: "e5" } } : c.method === "GET" ? { status: 404, json: {} } : undefined));
    const ok = text(await invokeTool(ctx, tool("play_listing_update"), { language: "en-US", title: "T", short_description: "s", full_description: "f", dry_run: true }));
    expect(ok.dry_run).toBe(true);
    expect(calls.some((c) => c.url.includes(":commit"))).toBe(false);
  });
});

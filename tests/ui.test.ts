import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { StateStore } from "../src/state/store.js";
import { createCtx } from "../src/mcp/context.js";
import { startUi, createUiHandle, type UiServer } from "../src/ui/server.js";
import { setFetch } from "../src/lib/http.js";

let tmp: string;
let ui: UiServer;
let ctx: ReturnType<typeof createCtx>;
const origFetch = globalThis.fetch;
const SECRET = "cm_test_token_1234567890abcdef";

function raw(pathname: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const u = new URL(ui.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path: pathname, method: opts.method ?? "GET", headers: { host: u.host, ...(opts.headers ?? {}) } },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
const auth = () => ({ "x-p2s-token": ui.token });
const post = (p: string, body: unknown, extra: Record<string, string> = {}) =>
  raw(p, { method: "POST", headers: { ...auth(), "content-type": "application/json", ...extra }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.P2S_SECRETS_BACKEND = "file";
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-ui-"));
  new StateStore(tmp).init();
  ctx = createCtx(tmp);
  ui = await startUi(ctx, { port: 4600 });
});

afterAll(async () => {
  await ui.close();
  setFetch(origFetch);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ui server", () => {
  it("is idempotent, binds locally and persists ui.json", async () => {
    const again = await startUi(ctx);
    expect(again.baseUrl).toBe(ui.baseUrl);
    expect(ui.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    const j = JSON.parse(fs.readFileSync(ctx.store.p.ui, "utf8"));
    expect(j.token).toBe(ui.token);
    expect(j.token).toMatch(/^[0-9a-f]{64}$/);
    const link = await createUiHandle(ctx).link("/store?approval=x");
    expect(link).toBe(`${ui.baseUrl}/store?approval=x&t=${ui.token}`);
  });

  it("requires the token", async () => {
    expect((await raw("/api/state")).status).toBe(401);
    expect((await raw("/")).status).toBe(401);
    expect((await raw("/api/state", { headers: { "x-p2s-token": "nope" } })).status).toBe(401);
    expect((await raw("/api/health")).status).toBe(200);
  });

  it("serves the page with a cookie after a valid ?t=", async () => {
    const r = await raw(`/store?t=${ui.token}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("<!doctype html>");
    const cookie = String(r.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const r2 = await raw("/log", { headers: { cookie: cookie.split(";")[0] } });
    expect(r2.status).toBe(200);
  });

  it("rejects foreign Host headers", async () => {
    const r = await raw("/api/state", { headers: { ...auth(), host: "evil.example.com" } });
    expect(r.status).toBe(403);
  });

  it("rejects cross-origin mutations", async () => {
    const r = await post("/api/plan/approve", {}, { origin: "http://evil.example.com" });
    expect(r.status).toBe(403);
  });

  it("returns state without secrets", async () => {
    const r = await raw("/api/state", { headers: auth() });
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.secretsBackend).toBe("file");
    expect(j.hasSecret.codemagic).toBe(false);
    expect(j.stages.plan.status).toBe("pending");
  });

  it("approves the plan", async () => {
    expect((await post("/api/plan/approve", {})).status).toBe(400);
    ctx.store.update((s) => {
      s.plan.summary = "A habit tracker";
    });
    const r = await post("/api/plan/approve", {});
    expect(r.status).toBe(200);
    const s = ctx.store.read();
    expect(s.plan.approved).toBe(true);
    expect(s.plan.approvedVia).toBe("ui");
    expect(s.stages.plan.status).toBe("done");
  });

  it("connects a service, stores the secret, never echoes it", async () => {
    setFetch((async (url: any) => {
      const u = String(url);
      if (u.includes("codemagic.io/api/v3/user")) return new Response(JSON.stringify({ data: { id: "u1" } }), { status: 200 });
      if (u.includes("api.codemagic.io/apps")) return new Response(JSON.stringify({ applications: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
    const bad = await post("/api/connect/codemagic", {});
    expect(bad.status).toBe(400);
    const r = await post("/api/connect/codemagic", { token: SECRET });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(r.body).not.toContain(SECRET);
    expect(ctx.secrets.get("codemagic")?.token).toBe(SECRET);
    const st = await raw("/api/state", { headers: auth() });
    expect(st.body).not.toContain(SECRET);
    expect(JSON.parse(st.body).connections.codemagic.connected).toBe(true);
    expect(JSON.parse(st.body).hasSecret.codemagic).toBe(true);
    const d = await post("/api/disconnect/codemagic", {});
    expect(d.status).toBe(200);
    expect(ctx.secrets.has("codemagic")).toBe(false);
    expect(ctx.store.read().connections.codemagic.connected).toBe(false);
    expect((await post("/api/connect/bogus", {})).status).toBe(404);
  });

  it("does not save a secret when verification fails", async () => {
    setFetch((async () => new Response("unauthorized", { status: 401 })) as typeof fetch);
    const r = await post("/api/connect/github", { token: "ghp_" + "x".repeat(30) });
    const j = JSON.parse(r.body);
    expect(j.ok).toBe(false);
    expect(r.body).not.toContain("x".repeat(30));
    expect(ctx.secrets.has("github")).toBe(false);
  });

  it("handles approvals", async () => {
    ctx.store.update((s) => {
      s.approvals.push({ id: "appr_1", action: "publish", title: "Publish", summary: "s", payload: {}, status: "pending", createdAt: new Date().toISOString() });
      s.approvals.push({ id: "appr_2", action: "publish2", title: "Publish 2", summary: "s", payload: {}, status: "pending", createdAt: new Date().toISOString() });
    });
    expect((await post("/api/approvals/appr_1", { decision: "maybe" })).status).toBe(400);
    expect((await post("/api/approvals/nope", { decision: "approve" })).status).toBe(404);
    expect((await post("/api/approvals/appr_1", { decision: "approve" })).status).toBe(200);
    expect((await post("/api/approvals/appr_2", { decision: "reject" })).status).toBe(200);
    expect((await post("/api/approvals/appr_1", { decision: "approve" })).status).toBe(409);
    const s = ctx.store.read();
    expect(s.approvals.find((a) => a.id === "appr_1")?.status).toBe("approved");
    expect(s.approvals.find((a) => a.id === "appr_2")?.status).toBe("rejected");
  });

  it("serves QR svg", async () => {
    const r = await raw("/api/qr?data=" + encodeURIComponent("https://example.com/app.apk"), { headers: auth() });
    expect(r.status).toBe(200);
    expect(r.body).toContain("<svg");
  });

  it("serves only PNGs under checks and blocks traversal", async () => {
    fs.mkdirSync(ctx.store.p.screenshots, { recursive: true });
    fs.writeFileSync(path.join(ctx.store.p.screenshots, "home.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    fs.writeFileSync(path.join(ctx.store.p.checks, "notes.txt"), "x");
    fs.writeFileSync(ctx.store.p.secrets, "{}");
    const ok = await raw("/files/checks/screens/home.png", { headers: auth() });
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect((await raw("/files/checks/notes.txt", { headers: auth() })).status).toBe(404);
    expect((await raw("/files/checks/..%2Fsecrets.json", { headers: auth() })).status).toBe(404);
    expect((await raw("/files/checks/..%2Fstate.json", { headers: auth() })).status).toBe(404);
    expect((await raw("/files/checks/%2e%2e%2f%2e%2e%2fpackage.png", { headers: auth() })).status).toBe(404);
    expect((await raw("/files/checks/screens/home.png")).status).toBe(401);
  });

  it("streams state over SSE", async () => {
    const u = new URL(ui.baseUrl);
    const first = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: u.hostname, port: u.port, path: "/api/events", headers: { host: u.host, ...auth() } }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (d: string) => {
          if (d.includes("event: state")) {
            resolve(d);
            req.destroy();
          }
        });
      });
      req.on("error", (e) => (String(e).includes("socket hang up") ? undefined : reject(e)));
    });
    expect(first).toContain("event: state");
  });
});

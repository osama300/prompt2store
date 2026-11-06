import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import QRCode from "qrcode";
import type { Ctx, UiHandle } from "../mcp/context.js";
import { SECRET_SPEC, redact } from "../secrets/index.js";
import { VERIFIERS } from "../services/verify.js";
import { SERVICES, type ServiceName } from "../state/schema.js";
import { nowIso } from "../state/store.js";
import { PAGE_HTML } from "./page.js";

export interface UiServer {
  baseUrl: string;
  token: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4477;
const MAX_BODY = 1024 * 1024;
const SPA_ROUTES = [/^\/$/, /^\/connect\/[a-z]+$/, /^\/(store|builds|check|log)$/];

const running = new Map<string, Promise<UiServer>>();

interface UiFile {
  port: number;
  token: string;
  pid: number;
}

function readUiFile(file: string): UiFile | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof j.port === "number" && typeof j.token === "string" && j.token.length >= 32) return j;
  } catch {
    /* none */
  }
  return undefined;
}

function probeHealth(port: number): Promise<{ ok: boolean; root?: string } | undefined> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 800, headers: { host: `127.0.0.1:${port}` } },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
  });
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onErr = (e: NodeJS.ErrnoException) => reject(e);
    server.once("error", onErr);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onErr);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export function startUi(ctx: Ctx, opts: { port?: number; open?: boolean } = {}): Promise<UiServer> {
  const key = path.resolve(ctx.root);
  let p = running.get(key);
  if (!p) {
    p = doStart(ctx, opts, key).catch((e) => {
      running.delete(key);
      throw e;
    });
    running.set(key, p);
  }
  return p;
}

async function doStart(ctx: Ctx, opts: { port?: number }, key: string): Promise<UiServer> {
  const uiFile = ctx.store.p.ui;
  const existing = readUiFile(uiFile);
  if (existing && existing.pid !== process.pid) {
    const h = await probeHealth(existing.port);
    if (h?.ok && h.root && path.resolve(h.root) === key) {
      return { baseUrl: `http://127.0.0.1:${existing.port}`, token: existing.token, close: async () => {} };
    }
  }
  const token = crypto.randomBytes(32).toString("hex");
  let port = 0;
  const sse = new Set<http.ServerResponse>();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: (e as Error).message });
      else res.end();
    });
  });

  const sec = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  };
  function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { ...sec, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }
  function sendText(res: http.ServerResponse, status: number, text: string) {
    res.writeHead(status, { ...sec, "content-type": "text/plain; charset=utf-8" });
    res.end(text);
  }

  const cookieName = () => `p2s_${port}`;
  function parseCookies(h: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (h ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }
  const tokEq = (a: unknown) => {
    if (typeof a !== "string") return false;
    const x = Buffer.from(a);
    const y = Buffer.from(token);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  function authed(req: http.IncomingMessage, url: URL): { ok: boolean; viaQuery: boolean } {
    const q = url.searchParams.get("t");
    if (tokEq(q)) return { ok: true, viaQuery: true };
    if (tokEq(req.headers["x-p2s-token"])) return { ok: true, viaQuery: false };
    if (tokEq(parseCookies(req.headers.cookie)[cookieName()])) return { ok: true, viaQuery: false };
    return { ok: false, viaQuery: false };
  }

  function readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error("Request body too large (limit 1MB)"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  function snapshot() {
    const state = ctx.store.read();
    const hasSecret = {} as Record<ServiceName, boolean>;
    for (const s of SERVICES) {
      try {
        hasSecret[s] = ctx.secrets.has(s);
      } catch {
        hasSecret[s] = false;
      }
    }
    return { ...state, secretsBackend: ctx.secrets.backendKind, hasSecret };
  }

  function broadcast() {
    if (!sse.size) return;
    let data: string;
    try {
      data = JSON.stringify(snapshot());
    } catch {
      return;
    }
    for (const r of sse) r.write(`event: state\ndata: ${data}\n\n`);
  }
  const stopWatch = ctx.store.watch(broadcast);
  const heartbeat = setInterval(() => {
    for (const r of sse) r.write(`: ping\n\n`);
  }, 15_000);
  heartbeat.unref();

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return sendText(res, 403, "Forbidden host");
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (pathname === "/api/health" && method === "GET") return sendJson(res, 200, { ok: true, root: key });

    const auth = authed(req, url);

    // Pages
    if (method === "GET" && SPA_ROUTES.some((r) => r.test(pathname))) {
      if (!auth.ok) {
        return sendText(res, 401, "Unauthorized. Open the link printed by `prompt-to-store ui` (or given by your agent); it contains the access token.");
      }
      const headers: Record<string, string | string[]> = {
        ...sec,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      };
      if (auth.viaQuery) headers["set-cookie"] = `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict`;
      res.writeHead(200, headers);
      return res.end(PAGE_HTML);
    }

    if (!pathname.startsWith("/api/") && !pathname.startsWith("/files/")) return sendText(res, 404, "Not found");
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: "Missing or invalid token" });

    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${host}` && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
        return sendJson(res, 403, { ok: false, error: "Cross-origin request rejected" });
      }
      if (origin === undefined && !tokEq(req.headers["x-p2s-token"])) {
        return sendJson(res, 403, { ok: false, error: "Missing origin" });
      }
    }

    // Static screenshots
    if (pathname.startsWith("/files/checks/") && method === "GET") {
      let rel: string;
      try {
        rel = decodeURIComponent(pathname.slice("/files/checks/".length));
      } catch {
        return sendText(res, 400, "Bad path");
      }
      if (rel.includes("\0") || !rel.toLowerCase().endsWith(".png")) return sendText(res, 404, "Not found");
      const base = path.resolve(ctx.store.p.checks);
      const abs = path.resolve(base, rel);
      if (!abs.startsWith(base + path.sep)) return sendText(res, 404, "Not found");
      try {
        const real = fs.realpathSync(abs);
        const realBase = fs.realpathSync(base);
        if (!real.startsWith(realBase + path.sep)) return sendText(res, 404, "Not found");
        const buf = fs.readFileSync(real);
        res.writeHead(200, { ...sec, "content-type": "image/png", "cache-control": "no-cache" });
        return res.end(buf);
      } catch {
        return sendText(res, 404, "Not found");
      }
    }

    try {
      if (pathname === "/api/state" && method === "GET") return sendJson(res, 200, snapshot());

      if (pathname === "/api/events" && method === "GET") {
        res.writeHead(200, { ...sec, "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" });
        res.write(`retry: 3000\n\n`);
        sse.add(res);
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
        req.on("close", () => sse.delete(res));
        return;
      }

      if (pathname === "/api/qr" && method === "GET") {
        const data = url.searchParams.get("data") ?? "";
        if (!data || data.length > 2000) return sendJson(res, 400, { ok: false, error: "Invalid data" });
        const svg = await QRCode.toString(data, { type: "svg", margin: 1 });
        res.writeHead(200, { ...sec, "content-type": "image/svg+xml", "cache-control": "max-age=3600" });
        return res.end(svg);
      }

      if (pathname === "/api/plan/approve" && method === "POST") {
        const s = ctx.store.read();
        if (!s.plan.summary) return sendJson(res, 400, { ok: false, error: "No plan to approve yet." });
        ctx.store.update((st) => {
          const at = nowIso();
          st.plan.approved = true;
          st.plan.approvedAt = at;
          st.plan.approvedVia = "ui";
          st.stages.plan = { status: "done", updatedAt: at, note: "Approved in the local UI" };
          st.log.push({ at, level: "success", source: "ui", message: "Plan approved in the local UI" });
        });
        return sendJson(res, 200, { ok: true });
      }

      let m = /^\/api\/connect\/([a-z]+)$/.exec(pathname);
      if (m && method === "POST") {
        const service = m[1] as ServiceName;
        if (!(SERVICES as readonly string[]).includes(service)) return sendJson(res, 404, { ok: false, error: "Unknown service" });
        const body = await readBody(req);
        const fields: Record<string, string> = {};
        for (const f of SECRET_SPEC[service]) {
          const v = body?.[f.field];
          if (typeof v !== "string" || !v.trim()) return sendJson(res, 400, { ok: false, error: `Missing ${f.label}` });
          fields[f.field] = v.trim();
        }
        const secretVals = Object.values(fields);
        let result;
        try {
          result = await VERIFIERS[service](fields);
        } catch (e) {
          result = { ok: false, error: (e as Error).message };
        }
        if (!result.ok) {
          const error = redact(result.error ?? "Verification failed", secretVals);
          ctx.store.log("ui", `${service}: verification failed`, "warn");
          return sendJson(res, 200, { ok: false, error });
        }
        ctx.secrets.set(service, fields);
        const details = result.details ?? {};
        ctx.store.update((st) => {
          const at = nowIso();
          st.connections[service] = { connected: true, verifiedAt: at, details };
          st.log.push({ at, level: "success", source: "ui", message: `${service} connected` });
        });
        return sendJson(res, 200, { ok: true, details: JSON.parse(redact(JSON.stringify(details), secretVals)) });
      }

      m = /^\/api\/disconnect\/([a-z]+)$/.exec(pathname);
      if (m && method === "POST") {
        const service = m[1] as ServiceName;
        if (!(SERVICES as readonly string[]).includes(service)) return sendJson(res, 404, { ok: false, error: "Unknown service" });
        ctx.secrets.delete(service);
        ctx.store.update((st) => {
          st.connections[service] = { connected: false, details: {} };
          st.log.push({ at: nowIso(), level: "info", source: "ui", message: `${service} disconnected` });
        });
        return sendJson(res, 200, { ok: true });
      }

      m = /^\/api\/approvals\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (m && method === "POST") {
        const body = await readBody(req);
        const decision = body?.decision;
        if (decision !== "approve" && decision !== "reject") return sendJson(res, 400, { ok: false, error: "decision must be approve or reject" });
        const cur = ctx.store.read().approvals.find((a) => a.id === m![1]);
        if (!cur) return sendJson(res, 404, { ok: false, error: "Approval not found" });
        if (cur.status !== "pending") return sendJson(res, 409, { ok: false, error: `Already ${cur.status}` });
        ctx.store.update((st) => {
          const a = st.approvals.find((x) => x.id === m![1])!;
          const at = nowIso();
          a.status = decision === "approve" ? "approved" : "rejected";
          a.decidedAt = at;
          st.log.push({
            at,
            level: decision === "approve" ? "success" : "warn",
            source: "ui",
            message: `${decision === "approve" ? "Approved" : "Rejected"}: ${a.title}`,
          });
        });
        return sendJson(res, 200, { ok: true });
      }
    } catch (e) {
      const status = (e as any)?.status ?? 500;
      return sendJson(res, status, { ok: false, error: (e as Error).message });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  }

  const want = opts.port ?? DEFAULT_PORT;
  let bound = false;
  for (let i = 0; i < 50 && !bound; i++) {
    try {
      port = await listen(server, want + i);
      bound = true;
    } catch (e: any) {
      if (e.code !== "EADDRINUSE" && e.code !== "EACCES") throw e;
    }
  }
  if (!bound) throw new Error("Could not find a free port for the local UI");

  fs.mkdirSync(ctx.store.p.dir, { recursive: true });
  fs.writeFileSync(uiFile, JSON.stringify({ port, token, pid: process.pid }, null, 2), { mode: 0o600 });

  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    async close() {
      if (closed) return;
      closed = true;
      running.delete(key);
      clearInterval(heartbeat);
      stopWatch();
      for (const r of sse) r.end();
      sse.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      const cur = readUiFile(uiFile);
      if (cur && cur.token === token) fs.rmSync(uiFile, { force: true });
    },
  };
}

export function createUiHandle(ctx: Ctx): UiHandle {
  return {
    async ensure() {
      const s = await startUi(ctx);
      return { baseUrl: s.baseUrl, token: s.token };
    },
    async link(p: string) {
      const s = await startUi(ctx);
      return `${s.baseUrl}${p}${p.includes("?") ? "&" : "?"}t=${s.token}`;
    },
  };
}

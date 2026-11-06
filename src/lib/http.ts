/** Minimal fetch wrapper shared by all service clients. */

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}${new URL(url).pathname}: ${body.slice(0, 800)}`);
  }
}

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  /** Retries on 429/5xx and network errors (default 2). */
  retries?: number;
  timeoutMs?: number;
}

export type FetchLike = typeof fetch;

let fetchImpl: FetchLike = (...a) => fetch(...a);
/** Tests replace the transport. */
export function setFetch(f: FetchLike) {
  fetchImpl = f;
}
export function getFetch(): FetchLike {
  return fetchImpl;
}

export async function request<T = any>(url: string, opts: RequestOpts = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "prompt-to-store", ...(opts.headers ?? {}) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await fetchImpl(url, { method: opts.method ?? "GET", headers, body, signal: ac.signal });
      const text = await res.text();
      if (res.ok) {
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      }
      const err = new HttpError(res.status, url, text);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = err;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw err;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = e;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(`Network error calling ${new URL(url).host}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Result of validating credentials from the local UI. Never contains the secret. */
export interface VerifyResult {
  ok: boolean;
  /** Non-secret facts to show in the UI and save in state.json, e.g. account name. */
  details?: Record<string, string>;
  error?: string;
}

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { setFetch } from "../src/lib/http.js";
import {
  Codemagic,
  normalizeRepo,
  secureFilenameOf,
  mapStatus,
  toArtifacts,
  buildPageUrl,
  verifyCodemagic,
  TERMINAL,
  V3,
  LEGACY,
} from "../src/services/codemagic.js";
import { codemagicYaml, WF, GROUPS, YAML_MARKER } from "../src/services/codemagic-yaml.js";
import { generateDeployKey, parseGithubRemote } from "../src/services/github.js";

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
    const raw = init?.body;
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(url),
      headers: init?.headers ?? {},
      body: typeof raw === "string" ? JSON.parse(raw) : raw,
    };
    calls.push(call);
    const r = handler(call) ?? { json: {} };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch);
  return calls;
}

beforeEach(() => {
  mockFetch(() => undefined);
});

describe("normalizeRepo", () => {
  it("makes ssh, https, token and plain URLs comparable", () => {
    const want = "https://github.com/acme/app";
    for (const u of [
      "git@github.com:acme/app.git",
      "git@github.com:acme/app",
      "ssh://git@github.com/acme/app.git",
      "https://github.com/acme/app.git",
      "https://github.com/acme/app/",
      "https://x-access-token:ghp_abc@github.com/acme/app.git",
      "https://user@github.com/acme/app",
      "  HTTPS://GitHub.com/Acme/App.git  ",
    ]) {
      expect(normalizeRepo(u), u).toBe(want);
    }
  });
  it("keeps different repos different", () => {
    expect(normalizeRepo("https://github.com/acme/a")).not.toBe(normalizeRepo("https://github.com/acme/b"));
  });
  it("supports other hosts", () => {
    expect(normalizeRepo("git@gitlab.com:grp/proj.git")).toBe("https://gitlab.com/grp/proj");
  });
});

describe("secureFilenameOf", () => {
  it("extracts everything after /artifacts/", () => {
    expect(secureFilenameOf("https://api.codemagic.io/artifacts/aaa/bbb/app-release.apk")).toBe("aaa/bbb/app-release.apk");
  });
  it("drops the query string", () => {
    expect(secureFilenameOf("https://api.codemagic.io/artifacts/aaa/bbb/app.apk?token=1&x=2")).toBe("aaa/bbb/app.apk");
  });
  it("returns undefined for other URLs", () => {
    expect(secureFilenameOf("https://example.com/download/app.apk")).toBeUndefined();
  });
});

describe("mapStatus / toArtifacts / misc", () => {
  it("passes known statuses through", () => {
    for (const s of ["queued", "preparing", "building", "testing", "publishing", "finishing", "finished", "failed", "canceled", "timeout", "skipped"]) {
      expect(mapStatus(s)).toBe(s);
    }
  });
  it("maps aliases and unknowns", () => {
    expect(mapStatus("initializing")).toBe("queued");
    expect(mapStatus("waiting")).toBe("queued");
    expect(mapStatus("fetching")).toBe("preparing");
    expect(mapStatus("something-new")).toBe("unknown");
    expect(mapStatus("")).toBe("unknown");
  });
  it("TERMINAL covers exactly the end states", () => {
    expect([...TERMINAL].sort()).toEqual(["canceled", "failed", "finished", "skipped", "timeout"]);
  });
  it("toArtifacts prefers short_lived_download_url, then url", () => {
    const arts = toArtifacts({
      id: "b",
      app_id: "a",
      status: "finished",
      artifacts: [
        { name: "a.apk", type: "apk", size_in_bytes: 10, short_lived_download_url: "https://x/short", url: "https://x/long" },
        { name: "b.aab", url: "https://x/only" },
        { name: "c.txt" },
      ],
    });
    expect(arts).toEqual([
      { name: "a.apk", url: "https://x/short", type: "apk", size: 10 },
      { name: "b.aab", url: "https://x/only", type: undefined, size: undefined },
      { name: "c.txt", url: "", type: undefined, size: undefined },
    ]);
    expect(toArtifacts({ id: "b", app_id: "a", status: "x" })).toEqual([]);
  });
  it("buildPageUrl", () => {
    expect(buildPageUrl("A1", "B2")).toBe("https://codemagic.io/app/A1/build/B2");
  });
});

describe("Codemagic client", () => {
  it("startBuild posts to the v3 path with workflow_id/branch and the auth header", async () => {
    const calls = mockFetch((c) => (c.method === "POST" ? { json: { data: { id: "build123" } } } : undefined));
    const id = await new Codemagic("tkn").startBuild("app9", "p2s-android-test", "main", { FOO: "bar" }, ["prompt-to-store"]);
    expect(id).toBe("build123");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${V3}/apps/app9/builds`);
    expect(calls[0].headers["x-auth-token"]).toBe("tkn");
    expect(calls[0].body).toEqual({
      workflow_id: "p2s-android-test",
      branch: "main",
      labels: ["prompt-to-store"],
      environment: { variables: { FOO: "bar" } },
    });
  });

  it("startBuild does not retry on 5xx (retries: 0)", async () => {
    const calls = mockFetch(() => ({ status: 503, json: { error: "x" } }));
    await expect(new Codemagic("t").startBuild("a", "w", "main")).rejects.toThrow(/HTTP 503/);
    expect(calls).toHaveLength(1);
  });

  it("startBuild falls back to legacy buildId field", async () => {
    mockFetch(() => ({ json: { buildId: "legacy1" } }));
    expect(await new Codemagic("t").startBuild("a", "w", "main")).toBe("legacy1");
  });

  it("putVariableGroup: list -> delete same-name -> create -> bulk secure variables", async () => {
    const calls = mockFetch((c) => {
      if (c.method === "GET" && c.url.startsWith(`${V3}/apps/app1/variable-groups`)) {
        return { json: { data: [{ id: "g-old", name: "p2s_android_signing" }, { id: "g-other", name: "keep_me" }, { id: "g-old2", name: "p2s_android_signing" }] } };
      }
      if (c.method === "POST" && c.url === `${V3}/apps/app1/variable-groups`) return { json: { data: { id: "g-new" } } };
    });
    const id = await new Codemagic("t").putVariableGroup("app1", "p2s_android_signing", { A: "1", B: "2" });
    expect(id).toBe("g-new");
    const seq = calls.map((c) => `${c.method} ${c.url.replace(V3, "")}`);
    expect(seq).toEqual([
      "GET /apps/app1/variable-groups?page_size=100",
      "DELETE /variable-groups/g-old",
      "DELETE /variable-groups/g-old2",
      "POST /apps/app1/variable-groups",
      "POST /variable-groups/g-new/variables",
    ]);
    expect(calls[3].body).toEqual({ name: "p2s_android_signing" });
    expect(calls[4].body).toEqual({
      secure: true,
      variables: [
        { name: "A", value: "1" },
        { name: "B", value: "2" },
      ],
    });
  });

  it("putVariableGroup with no existing group skips delete and accepts a top-level id", async () => {
    const calls = mockFetch((c) => (c.method === "POST" && c.url.endsWith("/variable-groups") ? { json: { id: "gX" } } : undefined));
    expect(await new Codemagic("t").putVariableGroup("app1", "n", { K: "v" })).toBe("gX");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.at(-1)!.url).toBe(`${V3}/variable-groups/gX/variables`);
  });

  it("findAppByRepo matches ssh/https/token remotes and skips archived apps", async () => {
    mockFetch(() => ({
      json: {
        applications: [
          { _id: "arch", appName: "old", archived: true, repository: { htmlUrl: "https://github.com/acme/app" } },
          { _id: "other", appName: "other", repository: { htmlUrl: "https://github.com/acme/other" } },
          { _id: "norepo", appName: "norepo" },
          { _id: "hit", appName: "app", repository: { htmlUrl: "https://github.com/Acme/App.git" } },
        ],
      },
    }));
    const cm = new Codemagic("t");
    expect((await cm.findAppByRepo("git@github.com:acme/app.git"))?._id).toBe("hit");
    expect((await cm.findAppByRepo("https://x-access-token:tok@github.com/acme/app"))?._id).toBe("hit");
    expect(await cm.findAppByRepo("https://github.com/acme/none")).toBeUndefined();
  });

  it("publicUrl POSTs to the legacy artifacts endpoint with an expiry", async () => {
    const calls = mockFetch(() => ({ json: { url: "https://pub/link" } }));
    const before = Math.floor(Date.now() / 1000);
    const u = await new Codemagic("t").publicUrl("https://api.codemagic.io/artifacts/aaa/bbb/app.apk", 3600);
    expect(u).toBe("https://pub/link");
    expect(calls[0].url).toBe(`${LEGACY}/artifacts/aaa/bbb/app.apk/public-url`);
    expect(calls[0].body.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(calls[0].body.expiresAt).toBeLessThanOrEqual(before + 3602);
    // non-artifact URL: no request at all
    calls.length = 0;
    expect(await new Codemagic("t").publicUrl("https://example.com/x.apk")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("addAppWithSshKey base64-encodes the PEM", async () => {
    const calls = mockFetch(() => ({ json: { application: { _id: "n1", appName: "N" } } }));
    const r = await new Codemagic("t").addAppWithSshKey("git@github.com:a/b.git", "PEMDATA");
    expect(r).toEqual({ id: "n1", name: "N" });
    expect(calls[0].url).toBe(`${LEGACY}/apps/new`);
    expect(Buffer.from(calls[0].body.sshKey.data, "base64").toString()).toBe("PEMDATA");
    expect(calls[0].body.repositoryUrl).toBe("git@github.com:a/b.git");
  });

  it("getBuild unwraps data", async () => {
    mockFetch(() => ({ json: { data: { id: "b1", app_id: "a", status: "building" } } }));
    expect((await new Codemagic("t").getBuild("b1")).status).toBe("building");
  });

  it("verifyCodemagic: ok with details, friendly message on 401", async () => {
    mockFetch((c) => (c.url === `${V3}/user` ? { json: { data: { id: "u1" } } } : { json: { applications: [{}, {}] } }));
    expect(await verifyCodemagic({ token: "t" })).toEqual({ ok: true, details: { userId: "u1", apps: "2" } });
    mockFetch(() => ({ status: 401, json: {} }));
    const bad = await verifyCodemagic({ token: "t" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/rejected this token/);
  });
});

describe("codemagicYaml", () => {
  const base = { bundleId: "com.acme.app", emails: [] as string[] };

  it("contains all four workflow ids as top-level workflow keys", () => {
    const y = codemagicYaml(base);
    for (const id of Object.values(WF)) expect(y).toMatch(new RegExp(`^  ${id}:$`, "m"));
    expect(Object.values(WF)).toEqual(["p2s-android-test", "p2s-ios-simulator", "p2s-android-release", "p2s-ios-release"]);
    expect(y.startsWith(YAML_MARKER)).toBe(true);
    expect(y).toMatch(/^workflows:$/m);
  });

  it("each workflow has the standard keys at 4-space indentation, with no tabs", () => {
    const y = codemagicYaml(base);
    expect(y).not.toMatch(/\t/);
    const wfSections = y.split(/^workflows:\n/m)[1].split(/^(?=  p2s-)/m);
    expect(wfSections).toHaveLength(4);
    for (const sec of wfSections) {
      expect(sec).toMatch(/^    name: .+$/m);
      expect(sec).toMatch(/^    instance_type: mac_mini_m2$/m);
      expect(sec).toMatch(/^    max_build_duration: \d+$/m);
      expect(sec).toMatch(/^    scripts:$/m);
      expect(sec).toMatch(/^    artifacts:$/m);
      // every non-empty line in a workflow is indented at least 2 (4 for keys), never less
      for (const line of sec.split("\n").filter(Boolean)) expect(line.match(/^ */)![0].length).toBeGreaterThanOrEqual(2);
    }
    // list items under scripts are indented 6 with name/script at 8
    expect(y).toMatch(/^      - name: Get packages\n        script: flutter pub get$/m);
  });

  it("omits the email block when no emails are given", () => {
    const y = codemagicYaml(base);
    expect(y).not.toMatch(/recipients:/);
    expect(y).not.toMatch(/^\s+email:/m);
    // iOS release still has its own app_store_connect publishing
    expect(y).toMatch(/app_store_connect:/);
  });

  it("emits a recipients block for the test and android-release workflows when emails are given", () => {
    const y = codemagicYaml({ ...base, emails: ["a@x.com", "b@y.org"] });
    expect(y.match(/recipients:/g)).toHaveLength(3); // android-test, ios-simulator, android-release
    expect(y).toMatch(/^      email:\n        recipients:\n          - a@x\.com\n          - b@y\.org\n        notify:\n          success: true\n          failure: true$/m);
    // ios-release must not get email (it publishes via app_store_connect)
    const iosRelease = y.split(/^  p2s-ios-release:$/m)[1];
    expect(iosRelease).not.toMatch(/recipients:/);
    // email is under `publishing:` which is a sibling of artifacts (4-space indent)
    expect(y).toMatch(/^    publishing:\n      email:/m);
  });

  it("adds working_directory to all four workflow headers and prefixes artifact globs", () => {
    const y = codemagicYaml({ ...base, workingDirectory: "apps/mobile" });
    expect(y.match(/^    working_directory: apps\/mobile$/gm)).toHaveLength(4);
    expect(y).toContain("- apps/mobile/build/**/outputs/**/*.apk");
    expect(y).toContain("- apps/mobile/build/**/outputs/**/*.aab");
    expect(y).toContain("- apps/mobile/build/ios/ipa/*.ipa");
  });

  it("has no working_directory and unprefixed artifacts for a repo-root project", () => {
    const y = codemagicYaml(base);
    expect(y).not.toMatch(/working_directory/);
    expect(y).toMatch(/^      - build\/\*\*\/outputs\/\*\*\/\*\.apk$/m);
  });

  it("embeds the bundle id, variable groups and release scripts", () => {
    const y = codemagicYaml(base);
    expect(y).toContain('BUNDLE_ID: "com.acme.app"');
    expect(y).toContain(`- ${GROUPS.androidSigning}`);
    expect(y).toContain(`- ${GROUPS.appStore}`);
    expect(y).toContain("flutter build appbundle --release");
    expect(y).toContain("flutter build apk --release");
    expect(y).toContain("find . -name Podfile -execdir pod install \\;");
  });

  it("the key.properties heredoc lines stay inside the block scalar (indented >= the script indent)", () => {
    const y = codemagicYaml(base);
    const lines = y.split("\n");
    const i = lines.findIndex((l) => l.includes("cat > android/key.properties <<EOF"));
    expect(i).toBeGreaterThan(0);
    const indent = (l: string) => l.match(/^ */)![0].length;
    const base_ = indent(lines[i]);
    for (const l of lines.slice(i + 1, i + 6)) expect(indent(l)).toBe(base_);
    expect(lines[i + 5].trim()).toBe("EOF");
  });
});

describe("github helpers", () => {
  it("parseGithubRemote handles https/ssh/token/trailing slash", () => {
    for (const u of [
      "https://github.com/acme/app.git",
      "https://github.com/acme/app",
      "https://github.com/acme/app/",
      "git@github.com:acme/app.git",
      "ssh://git@github.com/acme/app.git",
      "https://x-access-token:tok@github.com/acme/app.git",
    ]) {
      expect(parseGithubRemote(u), u).toEqual({ owner: "acme", repo: "app" });
    }
  });
  it("parseGithubRemote keeps dots in repo names and rejects non-GitHub", () => {
    expect(parseGithubRemote("https://github.com/acme/my.app.git")).toEqual({ owner: "acme", repo: "my.app" });
    expect(parseGithubRemote("https://gitlab.com/acme/app.git")).toBeUndefined();
    expect(parseGithubRemote("not a url")).toBeUndefined();
  });

  it("generateDeployKey returns a valid OpenSSH public key and a PKCS#1 private key that match", () => {
    const { privateKeyPem, publicKeyOpenSsh } = generateDeployKey("my-comment");
    expect(publicKeyOpenSsh.startsWith("ssh-rsa ")).toBe(true);
    const [type, b64, comment] = publicKeyOpenSsh.split(" ");
    expect(type).toBe("ssh-rsa");
    expect(comment).toBe("my-comment");
    const blob = Buffer.from(b64, "base64");
    let off = 0;
    const readStr = () => {
      const len = blob.readUInt32BE(off);
      off += 4;
      const b = blob.subarray(off, off + len);
      off += len;
      return b;
    };
    expect(readStr().toString()).toBe("ssh-rsa");
    const e = readStr();
    const n = readStr();
    expect(off).toBe(blob.length);
    // mpint: positive, so the leading bit must be clear (a 0x00 pad is used when needed)
    expect(e[0] & 0x80).toBe(0);
    expect(n[0] & 0x80).toBe(0);
    expect(BigInt("0x" + e.toString("hex"))).toBe(65537n);
    expect(privateKeyPem.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(privateKeyPem.trim().endsWith("-----END RSA PRIVATE KEY-----")).toBe(true);
    // the public blob matches the private key
    const priv = crypto.createPrivateKey(privateKeyPem);
    const jwk = crypto.createPublicKey(priv).export({ format: "jwk" }) as { n: string; e: string };
    const stripped = n[0] === 0 ? n.subarray(1) : n;
    expect(stripped.toString("base64url")).toBe(jwk.n);
    expect(priv.asymmetricKeyDetails?.modulusLength).toBe(4096);
  }, 60_000);
});

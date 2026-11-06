import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore, findProjectRoot, DIR_NAME, paths } from "../src/state/store.js";
import { emptyState, State, STAGES } from "../src/state/schema.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "p2s-state-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("schema", () => {
  it("emptyState has every stage pending and every service disconnected", () => {
    const s = emptyState();
    for (const st of STAGES) expect(s.stages[st].status).toBe("pending");
    expect(Object.values(s.connections).every((c) => !c.connected)).toBe(true);
    expect(s.plan.approved).toBe(false);
    expect(s.project.platforms).toEqual(["android", "ios"]);
  });
  it("rejects an unknown stage status", () => {
    expect(State.safeParse({ ...emptyState(), stages: { ...emptyState().stages, plan: { status: "bogus" } } }).success).toBe(false);
  });
});

describe("StateStore", () => {
  it("read() on a fresh project returns an empty state without creating files", () => {
    const store = new StateStore(tmp);
    expect(store.exists()).toBe(false);
    expect(store.read().plan.approved).toBe(false);
    expect(fs.existsSync(path.join(tmp, DIR_NAME))).toBe(false);
  });

  it("init creates state.json and .gitignore, and is idempotent", () => {
    const store = new StateStore(tmp);
    const s = store.init();
    const dir = path.join(tmp, DIR_NAME);
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(true);
    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8").split("\n");
    expect(gi).toContain("secrets.json");
    expect(gi).toContain("ui.json");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).createdAt).toBe(s.createdAt);
    expect(store.init().createdAt).toBe(s.createdAt);
    expect(store.exists()).toBe(true);
  });

  it("init keeps an existing .gitignore and merges the required entries once", () => {
    const dir = path.join(tmp, DIR_NAME);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "custom\n");
    new StateStore(tmp).init();
    new StateStore(tmp).update(() => {});
    const lines = fs.readFileSync(path.join(dir, ".gitignore"), "utf8").split("\n");
    expect(lines[0]).toBe("custom");
    for (const l of ["secrets.json", "ui.json", "keys/"]) expect(lines.filter((x) => x === l)).toHaveLength(1);
  });

  it("update persists changes, bumps updatedAt, and leaves no temp or lock files", () => {
    const store = new StateStore(tmp);
    const before = store.init();
    const out = store.update((s) => {
      s.project.bundleId = "com.ex.app";
    });
    expect(out.project.bundleId).toBe("com.ex.app");
    expect(new StateStore(tmp).read().project.bundleId).toBe("com.ex.app");
    expect(out.updatedAt >= before.updatedAt).toBe(true);
    expect(fs.readdirSync(store.p.dir).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock"))).toEqual([]);
  });

  it("update accepts a mutator that returns a new state", () => {
    const store = new StateStore(tmp);
    const s0 = store.init();
    store.update(() => ({ ...s0, project: { ...s0.project, name: "replaced" } }));
    expect(store.read().project.name).toBe("replaced");
  });

  it("an invalid mutation throws, leaves state.json byte-identical and releases the lock", () => {
    const store = new StateStore(tmp);
    store.init();
    store.update((s) => {
      s.project.name = "ok";
    });
    const before = fs.readFileSync(store.p.state, "utf8");
    expect(() =>
      store.update((s) => {
        (s.stages as any).plan.status = "nonsense";
      }),
    ).toThrow();
    expect(fs.readFileSync(store.p.state, "utf8")).toBe(before);
    expect(fs.existsSync(`${store.p.state}.lock`)).toBe(false);
    expect(fs.readdirSync(store.p.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    // still usable afterwards
    store.update((s) => {
      s.project.name = "after";
    });
    expect(store.read().project.name).toBe("after");
  });

  it("a throwing mutator leaves the file untouched", () => {
    const store = new StateStore(tmp);
    store.init();
    const before = fs.readFileSync(store.p.state, "utf8");
    expect(() =>
      store.update(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(fs.readFileSync(store.p.state, "utf8")).toBe(before);
    expect(fs.existsSync(`${store.p.state}.lock`)).toBe(false);
  });

  it("recovers from a stale lock file (older than 10s)", () => {
    const store = new StateStore(tmp);
    store.init();
    const lock = `${store.p.state}.lock`;
    fs.writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    store.update((s) => {
      s.project.name = "x";
    });
    expect(store.read().project.name).toBe("x");
  });

  it("trims the log to the last 500 entries (and checks to 20, builds to 50)", () => {
    const store = new StateStore(tmp);
    store.init();
    store.update((s) => {
      for (let i = 0; i < 650; i++) s.log.push({ at: "t", level: "info", source: "test", message: `m${i}` });
      for (let i = 0; i < 25; i++) s.checks.push({ id: `c${i}`, startedAt: "t", passed: true, items: [], screenshots: [] });
      for (let i = 0; i < 60; i++) s.builds.push({ id: `b${i}`, provider: "codemagic", workflow: "w", platform: "android", kind: "test", status: "queued", startedAt: "t", artifacts: [] });
    });
    const s = store.read();
    expect(s.log).toHaveLength(500);
    expect(s.log[0].message).toBe("m150");
    expect(s.log.at(-1)!.message).toBe("m649");
    expect(s.checks).toHaveLength(20);
    expect(s.checks[0].id).toBe("c5");
    expect(s.builds).toHaveLength(50);
    expect(s.builds[0].id).toBe("b10");
  });

  it("log() appends entries with level, source and message", () => {
    const store = new StateStore(tmp);
    store.log("src", "hello", "warn");
    const e = store.read().log.at(-1)!;
    expect(e).toMatchObject({ source: "src", message: "hello", level: "warn" });
  });

  it("setStage sets status/note and logs with a level matching the status", () => {
    const store = new StateStore(tmp);
    store.setStage("build", "in_progress", "writing code");
    let s = store.read();
    expect(s.stages.build).toMatchObject({ status: "in_progress", note: "writing code" });
    expect(s.stages.build.updatedAt).toBeTruthy();
    expect(s.log.at(-1)).toMatchObject({ level: "info", source: "stage" });
    expect(s.log.at(-1)!.message).toContain("build");
    store.setStage("build", "done");
    expect(store.read().log.at(-1)!.level).toBe("success");
    store.setStage("check", "failed", "nope");
    s = store.read();
    expect(s.log.at(-1)!.level).toBe("error");
    expect(s.log.at(-1)!.message).toContain("nope");
    // other stages untouched
    expect(s.stages.ship.status).toBe("pending");
  });

  it("read() on corrupt JSON gives a helpful error naming the file", () => {
    const store = new StateStore(tmp);
    store.init();
    fs.writeFileSync(store.p.state, "{ not json");
    expect(() => store.read()).toThrow(/state\.json is not valid JSON/);
    expect(() => store.read()).toThrow(store.p.state);
  });

  it("read() on schema-invalid JSON reports the failing path", () => {
    const store = new StateStore(tmp);
    store.init();
    const j = JSON.parse(fs.readFileSync(store.p.state, "utf8"));
    j.stages.build.status = "wat";
    fs.writeFileSync(store.p.state, JSON.stringify(j));
    expect(() => store.read()).toThrow(/failed validation.*stages\.build\.status/);
  });

  it("update() on corrupt state does not overwrite it", () => {
    const store = new StateStore(tmp);
    store.init();
    fs.writeFileSync(store.p.state, "garbage");
    expect(() => store.update((s) => void (s.project.name = "x"))).toThrow(/not valid JSON/);
    expect(fs.readFileSync(store.p.state, "utf8")).toBe("garbage");
  });

  it("paths() resolves everything under .prompt-to-store", () => {
    const p = paths(tmp);
    expect(p.dir).toBe(path.join(tmp, ".prompt-to-store"));
    expect(p.state).toBe(path.join(p.dir, "state.json"));
    expect(p.secrets).toBe(path.join(p.dir, "secrets.json"));
    expect(p.spec).toBe(path.join(p.dir, "spec.md"));
  });
});

describe("findProjectRoot", () => {
  it("walks up to the nearest dir with pubspec.yaml", () => {
    fs.writeFileSync(path.join(tmp, "pubspec.yaml"), "name: x\n");
    const deep = path.join(tmp, "lib", "src", "deep");
    fs.mkdirSync(deep, { recursive: true });
    expect(findProjectRoot(deep)).toBe(tmp);
    expect(findProjectRoot(tmp)).toBe(tmp);
  });

  it("walks up to an existing .prompt-to-store dir", () => {
    fs.mkdirSync(path.join(tmp, DIR_NAME));
    const sub = path.join(tmp, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(tmp);
  });

  it("prefers the nearest match", () => {
    fs.writeFileSync(path.join(tmp, "pubspec.yaml"), "name: outer\n");
    const inner = path.join(tmp, "packages", "inner");
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, "pubspec.yaml"), "name: inner\n");
    fs.mkdirSync(path.join(inner, "lib"));
    expect(findProjectRoot(path.join(inner, "lib"))).toBe(inner);
  });

  it("falls back to the start dir when nothing is found", () => {
    // tmp is under the OS temp dir which has no pubspec/.prompt-to-store above it
    const sub = path.join(tmp, "empty");
    fs.mkdirSync(sub);
    expect(findProjectRoot(sub)).toBe(sub);
  });
});

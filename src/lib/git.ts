import fs from "node:fs";
import path from "node:path";
import { run } from "../check/flutter.js";

/** Small git wrapper. Tokens are passed as a one-off extra header, never stored in .git/config. */
export class Git {
  constructor(private cwd: string) {}

  async exec(args: string[], extra: string[] = []): Promise<string> {
    const r = await run("git", [...extra, ...args], this.cwd, 5 * 60_000, { GIT_TERMINAL_PROMPT: "0" });
    if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(-1500)}`);
    return r.stdout.trim();
  }

  async toplevel(): Promise<string | undefined> {
    try {
      return await this.exec(["rev-parse", "--show-toplevel"]);
    } catch {
      return undefined;
    }
  }

  async ensureRepo(): Promise<boolean> {
    if (await this.toplevel()) return false;
    await this.exec(["init", "-b", "main"]);
    return true;
  }

  async ensureIdentity() {
    const name = await this.exec(["config", "user.name"]).catch(() => "");
    if (!name) await this.exec(["config", "user.name", "prompt-to-store"]);
    const email = await this.exec(["config", "user.email"]).catch(() => "");
    if (!email) await this.exec(["config", "user.email", "prompt-to-store@users.noreply.github.com"]);
  }

  async branch(): Promise<string> {
    const b = await this.exec(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
    return b && b !== "HEAD" ? b : "main";
  }

  async remoteUrl(name = "origin"): Promise<string | undefined> {
    return this.exec(["remote", "get-url", name]).catch(() => undefined);
  }

  async isDirty(): Promise<boolean> {
    return (await this.exec(["status", "--porcelain"])).length > 0;
  }

  async hasCommits(): Promise<boolean> {
    return this.exec(["rev-parse", "HEAD"]).then(
      () => true,
      () => false,
    );
  }

  /** Stage everything and commit. Returns the new HEAD sha, or undefined if nothing to commit. */
  async commitAll(message: string): Promise<string | undefined> {
    await this.ensureIdentity();
    ensureGitignore(this.cwd);
    await this.exec(["add", "-A"]);
    const staged = await this.exec(["diff", "--cached", "--name-only"]);
    if (!staged && (await this.hasCommits())) return undefined;
    await this.exec(["commit", "-m", message, ...(staged ? [] : ["--allow-empty"])]);
    return this.exec(["rev-parse", "HEAD"]);
  }

  async head(): Promise<string> {
    return this.exec(["rev-parse", "HEAD"]);
  }

  /** Push HEAD to `remote` branch. With a token, authenticate via an extra header (GitHub). */
  async push(remote: string, branch: string, githubToken?: string): Promise<void> {
    const extra = githubToken
      ? ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`]
      : [];
    await this.exec(["push", remote, `HEAD:refs/heads/${branch}`], extra);
  }
}

/** Make sure secrets and build outputs never get committed. */
export function ensureGitignore(root: string) {
  const gi = path.join(root, ".gitignore");
  const need = [".prompt-to-store/secrets.json", ".prompt-to-store/ui.json", ".prompt-to-store/*.p12", "*.p8", "*.jks", "*.keystore", "android/key.properties"];
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const missing = need.filter((l) => !cur.split(/\r?\n/).includes(l));
  if (missing.length) fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}\n# prompt-to-store\n${missing.join("\n")}\n`);
}

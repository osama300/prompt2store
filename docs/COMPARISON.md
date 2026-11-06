# Comparison: prompt-to-store vs. the alternatives

*Last researched: November 2026. Prices and limits change often; every figure links to its source. Items we could not verify on a first-party page are marked **(unverified)**.*

**prompt-to-store** is an open-source, local tool (MCP server + agent skills + companion web UI) that takes a prompt from a coding agent (Claude Code, Codex, Cursor) to a tested **Flutter** app shipped to Google Play / App Store through **Codemagic**, using the user's own accounts. No subscription, and keys never pass through the chat.

---

## 1. Expo + EAS (the main comparison)

Expo (React Native) plus Expo Application Services is the closest "idea to store" experience today. Most of what makes it good is UX we should match; most of what makes it limiting is a closed, hosted, React-Native-only service.

### 1.1 Components

| Component | What it does | Open / closed |
|---|---|---|
| **Expo SDK / Expo Router / CLI** | React Native framework and local tooling | Open source |
| **Expo Go** | Prebuilt client app: scan a QR code and run your project on a real device with no build | Free app; works only with the Expo SDK's bundled native modules |
| **EAS Build** | Cloud builds for iOS/Android, with managed credentials | Hosted, metered service |
| **EAS Submit** (`eas submit`) | Uploads a build to App Store Connect / Google Play | Hosted, part of the plans |
| **`eas build --auto-submit`** | One command: build, then hand off to Submit. Uses the submit profile with the same name as the build profile, or `--auto-submit-with-profile=<name>` ([docs](https://docs.expo.dev/build/automate-submissions/)) | CLI is open; the build and submit run on Expo's servers |
| **EAS Update** | Over-the-air JS/asset updates, priced per monthly active user | Hosted, metered |
| **EAS Workflows** | CI/CD pipelines in YAML on Expo infrastructure (billed per minute) | Hosted, metered |
| **EAS Metadata** (`store.config.json`) | Store listing text managed as code; `eas metadata:pull/push`. Apple only; documented as beta ([docs](https://docs.expo.dev/eas/metadata/config/)) | CLI open; applies via Expo service |
| **EAS Observe / Hosting / Simulators** | Production metrics, web hosting, cloud simulators (newer paid add-ons) | Hosted, metered |
| **Expo MCP server** | Official remote MCP server at `https://mcp.expo.dev/mcp` (OAuth with Expo account). Tools for docs search, listing/running/cancelling EAS builds and workflows, submitting builds, reading TestFlight/App Store/Play crash and review data, Observe metrics, cloud simulators, UI automation. Local-only tools need the `expo-mcp` package and SDK 54+. Docs search needs a paid plan. Also exposed as a Claude Connector ([docs](https://docs.expo.dev/eas/ai/mcp/)) | Hosted by Expo, requires an Expo account |

### 1.2 Pricing and limits (from [expo.dev/pricing](https://expo.dev/pricing.md), checked Nov 2026)

| | Free | Starter | Production | Enterprise |
|---|---|---|---|---|
| Price | $0 | $19/mo + usage | $199/mo + usage | Custom |
| Build credit | up to 15 Android + 15 iOS builds/mo | $45, then usage-based | $225, then usage-based | from $1,000 |
| Queue | Low priority | High | High | High |
| Concurrency | 5 total, 1 macOS | 5 total, 2 macOS | 15 total, 10 macOS | 20 total, 15 macOS |
| EAS Update MAUs | 1,000 (hard cap, no overage) | 3,000 then usage | 50,000 then usage | volume-based |

Other free-tier limits: 45-minute build timeout, 60 CI/CD Workflow minutes, 25 projects, community support only.

On-demand build prices: Android $1 (medium) / $2 (large); iOS $2 (medium) / $4 (large). Workflow minutes: Linux $0.018-0.035/min, macOS $0.075-0.150/min. Update overage starts at $0.005/MAU.

**How the free tier works in practice:** it is genuinely usable (30 builds a month, store submission included), but builds sit in a low-priority queue that can wait a long time at peak hours, and OTA updates stop at 1,000 users. Past the free limits, cost is predictable but usage-metered. The Expo account is required for everything; there is no self-hosted EAS Build you can point at your own machines for free ([Expo docs on local builds exist via `eas build --local`, which runs the build step on your own machine but still uses the Expo account and credential service](https://docs.expo.dev/build-reference/local-builds/) **(unverified in this pass)**).

### 1.3 Credentials: what EAS does well

- Running `eas build` with no credentials prompts EAS to **generate** them: an iOS distribution certificate, provisioning profile and push key (needs an Apple Developer Program membership), and an Android keystore. They are stored on Expo's servers and reused ([docs](https://docs.expo.dev/app-signing/managed-credentials/)).
- Collaborators on an organization can build with their own Expo accounts and need no Apple Developer team access once iOS credentials exist.
- `eas credentials` lets you view, modify, remove and sync credentials to local files, so lock-in is soft but real: the happy path keeps your signing material on Expo's servers.

### 1.4 What we should copy

1. **Zero-friction device install.** Expo Go's scan-a-QR flow is the best part of the loop. For Flutter, the equivalent is a QR / install link to the Codemagic artifact (Android APK, iOS TestFlight/ad hoc link) shown in our companion UI.
2. **Managed credentials with a guided first run.** Detect missing keystore/certs, generate what can be generated locally, and walk through the two things only the user can do (Apple API key, Play service account) in the local UI, never in chat.
3. **One command build-and-submit** (`eas build --auto-submit`). Offer a single `ship` tool/skill with the same shape and a named profile concept.
4. **Store metadata as code** (`store.config.json`). Keep listing text, screenshots and age rating in a versioned file in the repo, with pull/push.
5. **An MCP server that covers the whole lifecycle** (build status, logs, submit, crash and review data), not just scaffolding.
6. **Build profiles** (`eas.json`: development / preview / production) as a mental model.

### 1.5 Where we win

| Expo + EAS | prompt-to-store |
|---|---|
| React Native / JS only | **Flutter** (Dart, single codebase, own renderer) |
| Hosted Expo account required; metered builds, queue priority sold | Your own Codemagic account (500 free macOS M2 min/mo on a personal account, then $0.095/min, per [Codemagic docs](https://docs.codemagic.io/billing/pricing/)); no middleman fee |
| Signing material on Expo's servers by default | Signing material stays in the user's own Codemagic / local keychain |
| MCP server is remote and account-bound | Local MCP server, works offline for scaffolding and tests |
| Closed services (Build, Submit, Update) | Open source end to end; every step is plain Codemagic YAML + fastlane-style commands you can run by hand |
| AI is bolted on | Agent-native: designed for Claude Code / Codex / Cursor from day one |

Honest weaknesses to keep in mind: Expo has a much larger ecosystem, OTA updates (Flutter has no first-party equivalent; Shorebird is a third-party option), and a polished dev-time loop (Expo Go, fast refresh). Flutter's equivalent of Expo Go does not exist, so the dev loop leans on emulators/simulators and Codemagic preview builds.

---

## 2. AI app builders

| Tool | Stack | Pricing (published) | How it publishes to stores | Code ownership |
|---|---|---|---|---|
| **[Dreamflow](https://dreamflow.app/)** (from the FlutterFlow team) | Flutter / Dart; agentic + visual + code modes | Free $0 (10 one-time credits, web deploy); Hobby $20/mo (store deploy, code export, 100 credits); Pro $90/mo (Git, 500 credits); Enterprise custom | One-click App Store / Google Play deployment on Hobby and above | Full Flutter project export on Hobby+ |
| **[FlutterFlow](https://www.flutterflow.io/pricing)** | Flutter, visual builder + AI | Free $0; Basic $39/mo ($29 yearly); Pro $80 ($60); Max $150 ($113). Shares an AI allowance with its Studio product | One-click store deploy on Basic+, not on Free | Source code download and APK on Basic+; Push to GitHub only on Pro and Max |
| **Rork** | React Native / Expo | Third-party sources: entry plan about $20-25/mo, Rork Max about $200/mo ([vp0](https://vp0.com/blogs/rork-pricing-plans-2026/), [nocode.mba](https://www.nocode.mba/articles/rork-pricing)); vendor pricing page gave no figures when fetched **(unverified)** | Guided publish via Expo's build service (user supplies Apple account and Expo token); Rork Max reportedly uses its own cloud Mac fleet for native iOS builds | Sources disagree on whether export is paid-only; GitHub sync reported |
| **[Anything](https://www.anything.com/pricing)** (the company has previously used the name "Create"; the pricing page does not confirm this **(unverified)**) | Prompt-to-app, web and mobile | Pro $19/mo (20k credits) or $199/yr; a $199/mo tier (about 200k credits); a Max tier | Pricing table lists "Submit to App Store"; Google Play not confirmed on the page | Code export is listed as a feature; plan gating unclear |
| **Vibecode** | Native/React Native apps from a phone | Free plus roughly $20 / $50 / $200 per month tiers per a [directory listing](https://vibecoding.gallery/en/tools/vibecode/) | Builds and publishes to the App Store from an iPhone; a March 2026 report says Apple blocked updates of some vibe-coding apps ([stork.ai](https://www.stork.ai/en/vibecode)) | Not verified |
| **Bolt (Bolt Expo), Lovable mobile, a0.dev** | Bolt has an Expo mode; Lovable is web-first; a0.dev targets React Native | Not verified in this pass: no first-party pricing pages were retrieved | Typically Expo-based; user ends up in EAS for builds | Typically GitHub export |

**Patterns across the category**

- Pricing is **credit-based and subscription-based**; the store fees ($99/yr Apple, $25 one-time Google) and build costs are on top.
- Publishing is usually a thin wrapper over **Expo EAS** (React Native tools) or a proprietary pipeline (FlutterFlow/Dreamflow). The user is tied to the vendor's cloud for the "last mile."
- Export is gated behind paid plans, and "one-click" publishing commonly breaks on first-time store setup (review noted in the Rork sources above).
- Almost none are agent-native: they have their own chat UI, not your coding agent.

---

## 3. Agent-native dev tools we mirror

### 3.1 Reference projects

| Project | What it is | Install / setup | License / status |
|---|---|---|---|
| **[claude-task-master](https://github.com/eyaltoledano/claude-task-master)** | Task management MCP server for coding agents | `claude mcp add taskmaster-ai -- npx -y task-master-ai`; Cursor/Windsurf/VS Code/Amazon Q via JSON; `task-master init [--rules cursor,windsurf,vscode]` writes `.taskmaster/` and editor rules. API keys go in `.env` or the MCP `env` block (so keys do touch config files, which we want to avoid) | Open source |
| **[Backlog.md](https://github.com/MrLesk/Backlog.md)** | Markdown + git task board with CLI, web UI and MCP | `npm i -g backlog.md`, then `backlog init "Project"`: a wizard offers CLI instructions (writes AGENTS.md), an MCP connector for Claude Code / Codex / Gemini CLI / Kiro / Cursor, or skip. Also prints `claude mcp add backlog --scope user -- backlog mcp start`, `codex mcp add backlog -- backlog mcp start`, `gemini mcp add backlog -s user backlog mcp start` | MIT |
| **[vibe-kanban](https://github.com/BloopAI/vibe-kanban)** | Local web UI to orchestrate many coding agents in parallel workspaces | `npx vibe-kanban` starts a local server bound to 127.0.0.1; supports Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode and more | Apache-2.0; **README says the project is sunsetting** |
| **[mobile-mcp](https://github.com/mobile-next/mobile-mcp)** | Drive iOS/Android simulators and devices from an agent | Claude Code plugin (`/plugin marketplace add mobile-next/mobile-mcp`, `/plugin install mobile-mcp@mobile-mcp`) or `claude mcp add mobile-mcp -- npx -y @mobilenext/mobile-mcp@latest`; `npx @mobilenext/mobile-mcp@latest install` **detects installed MCP clients and configures the ones you pick** | Open source |
| **Expo MCP** | See section 1 | `claude mcp add --transport http expo https://mcp.expo.dev/mcp` | Hosted |

**What they teach us**

1. The winning install story is a **single `npx` command** that detects clients and writes their config (mobile-mcp `install`, Backlog.md `init`).
2. A **short instruction file** (AGENTS.md / CLAUDE.md pointing at a skill or MCP resource) beats pasting long prompts.
3. Local web UI + MCP (vibe-kanban, Backlog.md) is an accepted pattern. The sunsetting of vibe-kanban is a reminder to keep the project small and dependency-light.
4. Task Master puts API keys into editor JSON; our "keys never pass through the chat or config" stance is a differentiator.

### 3.2 Exact config formats for a stdio MCP server

Examples use a hypothetical `p2s` server run as `npx -y prompt-to-store mcp`.

**Claude Code** ([MCP docs](https://code.claude.com/docs/en/mcp))

```bash
claude mcp add [--scope local|project|user] [--env KEY=value] p2s -- npx -y prompt-to-store mcp
```

Scopes: `local` (default; stored per project inside `~/.claude.json`), `user` (all projects; `~/.claude.json`), `project` (shared via `.mcp.json` in the repo root; users are asked to approve it). Project file:

```json
{
  "mcpServers": {
    "p2s": {
      "command": "npx",
      "args": ["-y", "prompt-to-store", "mcp"],
      "env": { "P2S_HOME": "${P2S_HOME:-~/.prompt-to-store}" }
    }
  }
}
```

An entry with no `type` is stdio. `${VAR}` and `${VAR:-default}` expansion works in `command`, `args`, `env`, `url`, `headers`. `CLAUDE_PROJECT_DIR` is set in the server's environment.

**Cursor** ([docs](https://cursor.com/docs/context/mcp)): `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project)

```json
{
  "mcpServers": {
    "p2s": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "prompt-to-store", "mcp"],
      "env": { "P2S_HOME": "${env:P2S_HOME}" }
    }
  }
}
```

Interpolation: `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`. Optional `envFile`. (Note: Task Master and mobile-mcp omit `type` and work, but the docs list it as required for stdio.)

**Codex** ([docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)): `~/.codex/config.toml`, or `.codex/config.toml` (trusted projects only)

```toml
[mcp_servers.p2s]
command = "npx"
args = ["-y", "prompt-to-store", "mcp"]
env_vars = ["P2S_HOME"]          # forward from the local environment
startup_timeout_sec = 20         # default 10
tool_timeout_sec = 120           # default 60

[mcp_servers.p2s.env]
P2S_MODE = "local"
```

CLI: `codex mcp add p2s --env P2S_MODE=local -- npx -y prompt-to-store mcp`; list with `codex mcp list`. Other keys: `cwd`, `enabled`, `required`, `enabled_tools`, `disabled_tools`.

**Windsurf**: `~/.codeium/windsurf/mcp_config.json` (Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`) per [third-party guides](https://fast.io/resources/windsurf-mcp-setup-guide/); Windsurf's own docs have moved to docs.devin.ai and we could not confirm the file path from first-party text **(unverified)**.

```json
{
  "mcpServers": {
    "p2s": {
      "command": "npx",
      "args": ["-y", "prompt-to-store", "mcp"],
      "env": { "P2S_HOME": "${env:P2S_HOME}" }
    }
  }
}
```

Restart after editing; a JSON syntax error silently drops the file; Windsurf caps total tools at 100 across servers.

**Gemini CLI** ([docs](https://geminicli.com/docs/tools/mcp-server/)): `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project)

```json
{
  "mcpServers": {
    "p2s": {
      "command": "npx",
      "args": ["-y", "prompt-to-store", "mcp"],
      "env": { "P2S_HOME": "$P2S_HOME" },
      "cwd": ".",
      "timeout": 600000,
      "trust": false,
      "includeTools": ["p2s_status", "p2s_build"]
    }
  }
}
```

CLI: `gemini mcp add [-s user|project] [-e KEY=value] p2s npx -y prompt-to-store mcp` (project is the default scope). Avoid underscores in the server name. Note: the docs state Gemini CLI was replaced by Antigravity CLI on 18 June 2026 for unpaid-tier and Google One users, so verify which CLI the audience has.

**VS Code / Copilot** (also covered by Task Master docs): `.vscode/mcp.json` uses top-level `servers` and `"type": "stdio"`.

### 3.3 Claude Code plugin format

Bundling skills and the MCP server as a plugin gives a two-command install ([reference](https://code.claude.com/docs/en/plugins-reference), [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)).

```
prompt-to-store/                    # repo root doubles as the marketplace
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── skills/
│   └── ship-flutter-app/
│       └── SKILL.md
├── .mcp.json                       # plugin-provided MCP servers
└── hooks/hooks.json                # optional
```

`.claude-plugin/plugin.json` (`name` is the only required field; kebab-case; names beginning `claude-` or `anthropic-` are reserved, so avoid them):

```json
{
  "name": "prompt-to-store",
  "version": "0.1.0",
  "description": "Prompt to a tested Flutter app on Google Play / App Store via Codemagic",
  "author": { "name": "prompt-to-store contributors" },
  "homepage": "https://github.com/OWNER/prompt-to-store",
  "repository": "https://github.com/OWNER/prompt-to-store",
  "license": "MIT",
  "keywords": ["flutter", "codemagic", "mobile", "mcp"],
  "mcpServers": {
    "p2s": {
      "command": "npx",
      "args": ["-y", "prompt-to-store", "mcp"]
    }
  }
}
```

Use `${CLAUDE_PLUGIN_ROOT}` for bundled files, `${CLAUDE_PLUGIN_DATA}` for state that must survive updates. For secrets, `userConfig` with `"sensitive": true` stores values in the OS credential store. Components are namespaced, so the skill is invoked as `/prompt-to-store:ship-flutter-app`.

`.claude-plugin/marketplace.json` (`name`, `owner` and `plugins[]` required; each plugin needs `name` and `source`):

```json
{
  "name": "prompt-to-store",
  "description": "Ship Flutter apps from a prompt",
  "owner": { "name": "prompt-to-store contributors" },
  "plugins": [
    {
      "name": "prompt-to-store",
      "source": "./",
      "description": "MCP server + skills for Flutter to Play/App Store via Codemagic"
    }
  ]
}
```

Other `source` forms: `{ "source": "github", "repo": "owner/repo" }`, `git-subdir`, `url`, `archive`, `npm`, `command`. Users install with:

```
/plugin marketplace add OWNER/prompt-to-store
/plugin install prompt-to-store@prompt-to-store
```

Validate with `claude plugin validate .` (catches path, naming and MCP entry errors).

### 3.4 SKILL.md frontmatter ([skills docs](https://code.claude.com/docs/en/skills))

```markdown
---
name: ship-flutter-app
description: Builds, tests and publishes the current Flutter app to Google Play / App Store through Codemagic using prompt-to-store MCP tools. Use when the user asks to ship, release, publish or submit a mobile app.
disable-model-invocation: false
allowed-tools: mcp__p2s__status mcp__p2s__build Bash(flutter test *)
---

# Instructions...
```

- Location: `.claude/skills/<name>/SKILL.md` (project), `~/.claude/skills/<name>/SKILL.md` (personal), or `skills/<name>/SKILL.md` inside a plugin.
- Frontmatter must start on line 1. All fields optional, but `description` is what triggers loading (put the use case first; `description` + `when_to_use` truncated at 1,536 characters combined).
- Other fields: `when_to_use`, `argument-hint`, `arguments`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `shell`.
- Use `disable-model-invocation: true` for side-effectful steps like "submit to store" so the user must trigger them explicitly.
- Portable subset (what claude.ai and the Skills API accept): `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. Keep portable skills to these.
- Keep SKILL.md under about 500 lines; put reference material in sibling files. `${CLAUDE_SKILL_DIR}` points to the skill's folder.
- For Codex and Cursor, mirror the same guidance in `AGENTS.md` (Backlog.md's `init` does this).

---

## 4. Feature comparison

Legend: Y = yes, P = partial, N = no. "Manual" = fastlane + Codemagic configured by hand.

| Capability | prompt-to-store | Expo EAS | FlutterFlow / Dreamflow | Rork | Anything | fastlane + Codemagic (manual) |
|---|---|---|---|---|---|---|
| Framework | Flutter | React Native | Flutter | React Native (Expo) | Prompt-to-app (mobile via its own stack) | Any |
| Works inside your own coding agent | Y | P (Expo MCP + skills) | N (own editor; Dreamflow has agent mode in-app) | N | N | Y (but no agent tooling) |
| Source code in your own repo, no export gate | Y | Y | P (paid; GitHub push on Pro+ for FlutterFlow) | P (reported paid) | P (unclear) | Y |
| Runs locally | Y | P (local builds possible, Expo account still involved) | N | N | N | Y |
| Cloud iOS builds without owning a Mac | Y (Codemagic) | Y | Y | Y | Y | Y (Codemagic) |
| Subscription required | N | Free tier, then $19-199/mo | Free tier; $20-150/mo for store deploy | About $20-200/mo | $19-199/mo | N |
| Build cost | Your Codemagic account (500 free min/mo personal, then $0.095/min macOS M2) | 30 free builds/mo, then per-build | Included in plan | Via Expo/own fleet | Included in plan | Same Codemagic cost |
| Managed signing (generate keystore/certs) | Y (planned: guided, local) | Y (best in class) | Y | Y (via Expo) | Y | N (manual) |
| One-command build and submit | Y | Y (`--auto-submit`) | Y (one-click) | Y (guided) | Y | P (YAML + scripts) |
| Store metadata as code | Y (planned) | P (Apple only, beta) | N | N | N | Y (fastlane `deliver`/`supply`) |
| Device install via QR | Y (planned) | Y (Expo Go and build QR) | P (test mode / emulators) | Y (Expo Go) | P | N |
| OTA updates | N | Y | N | Y (via Expo) | N | N |
| Automated tests before ship | Y | P (workflows) | N | N | N | Y (if you write them) |
| Secrets stay out of chat/vendor | Y | N (stored on Expo) | N | N | N | Y |
| Open source | Y | P (client open, services closed) | N | N | N | Y (fastlane) |
| Setup effort | Low (one command) | Low | Lowest | Low | Lowest | High |

---

## 5. Ten product recommendations ("build like a competitor")

1. **One-command installer that edits client configs (from mobile-mcp / Backlog.md).** `npx prompt-to-store setup` detects Claude Code, Cursor, Codex, Gemini CLI and Windsurf, shows what it will change, and writes the right file (or shells out to `claude mcp add` / `codex mcp add` / `gemini mcp add`). Idempotent, with `--dry-run` and `uninstall`.
2. **Ship as a Claude Code plugin and marketplace** so Claude users get `/plugin marketplace add OWNER/prompt-to-store` then `/plugin install`. Bundle skills, `.mcp.json` and AGENTS.md snippets from one repo.
3. **A QR / install-link step (from Expo Go).** After each Codemagic build, surface a scannable link in the companion UI (Android APK, TestFlight public link). This is the single biggest "it feels real" moment.
4. **Guided managed credentials (from EAS).** First `ship` detects missing signing assets, generates keystores locally, and walks the user through Apple API key and Play service account in the local UI only. Store them in the OS keychain or the user's Codemagic secrets, never in chat, MCP arguments or `.mcp.json` env. Make this a headline difference against Task Master's `.env`/JSON keys.
5. **`ship` with named profiles and `--auto-submit` semantics.** `ship --profile preview|production`, where preview stops at an installable build and production continues to store submission (internal track / TestFlight first).
6. **`store.config.json`-style metadata in the repo.** One versioned file for title, description, keywords, screenshots, privacy URL and age rating, with `metadata pull/push`, covering both stores (EAS currently covers Apple only, in beta).
7. **A read side in the MCP (from the Expo MCP).** Expose build status and logs, submission state, and TestFlight/Play crash and review data, so the agent can close the loop ("build failed on step X, here is the fix") without leaving the chat.
8. **Pre-flight checklist before first submission.** Bundle ID uniqueness, icons and splash, permission strings, privacy policy URL, Play data-safety form hints, Apple review-guideline lint. This is where AI builders' "one-click" flows fail first (see the Rork publish reports above), so it is a real quality edge.
9. **Cost transparency.** Before any cloud build, show the expected Codemagic minutes and dollars (500 free personal M2 minutes, then $0.095/min), and the store fees ($99/yr Apple, $25 one-time Google). Position as "no subscription, you pay only your own providers."
10. **Escape hatch everywhere (against lock-in).** Generated `codemagic.yaml`, `fastlane/` lanes and a README with the equivalent manual commands live in the repo. Anyone can stop using prompt-to-store and keep shipping. Also keep the tool small and dependency-light; vibe-kanban's sunsetting shows the risk of large orchestration platforms.

Also worth tracking: a Flutter OTA story (Shorebird integration), a Flutter equivalent of Expo Go (hot-reload to a debug build via QR), and Windsurf/Antigravity CLI config changes as those vendors consolidate.

---

## Sources

- Expo: [pricing](https://expo.dev/pricing.md), [plans](https://docs.expo.dev/billing/plans/), [automate submissions](https://docs.expo.dev/build/automate-submissions/), [managed credentials](https://docs.expo.dev/app-signing/managed-credentials/), [EAS Metadata](https://docs.expo.dev/eas/metadata/config/), [Expo MCP server](https://docs.expo.dev/eas/ai/mcp/)
- Builders: [FlutterFlow pricing](https://www.flutterflow.io/pricing), [Dreamflow](https://dreamflow.app/), [Anything pricing](https://www.anything.com/pricing), [Rork pricing roundup](https://vp0.com/blogs/rork-pricing-plans-2026/), [Rork reviews](https://www.nocode.mba/articles/rork-pricing), [Vibecode listing](https://vibecoding.gallery/en/tools/vibecode/)
- CI: [Codemagic pricing docs](https://docs.codemagic.io/billing/pricing/)
- Agent tools: [claude-task-master](https://github.com/eyaltoledano/claude-task-master), [Backlog.md](https://github.com/MrLesk/Backlog.md), [vibe-kanban](https://github.com/BloopAI/vibe-kanban), [mobile-mcp](https://github.com/mobile-next/mobile-mcp)
- Client config: [Claude Code MCP](https://code.claude.com/docs/en/mcp), [plugin reference](https://code.claude.com/docs/en/plugins-reference), [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [skills](https://code.claude.com/docs/en/skills), [Cursor MCP](https://cursor.com/docs/context/mcp), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/), [Windsurf guide (third party)](https://fast.io/resources/windsurf-mcp-setup-guide/)

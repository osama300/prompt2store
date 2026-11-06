# 🚢 prompt-to-store

> **From one prompt to Google Play and the App Store — inside your coding agent. Open source.**

[العربية](README.ar.md) · [Comparison with Expo EAS, FlutterFlow, Rork…](docs/COMPARISON.md)

You talk to your coding agent (Claude Code, Codex, Cursor, Gemini CLI, Windsurf) like you always do.
prompt-to-store gives it the tools to **plan, build, check and ship a Flutter app**: you get an installable
test build on your phone, then — when *you* decide — a release on Google Play and the App Store.

```text
Build a habit tracker with daily streaks and send me a test build.
```

```
Plan ──► Build ──► Check ──► Ship (test build: link + QR) ──► Store (when you press Publish)
```

- **No experience needed.** The agent installs Flutter if it's missing, writes the app, tests it, renders screenshots, builds it in the cloud and sends you the link.
- **Your code, your accounts.** Code lives in your folder / your GitHub. Builds run on *your* Codemagic account (500 free macOS minutes/month). No subscription, no lock-in: everything is a plain `codemagic.yaml` and Flutter project.
- **The agent never sees a key.** Keys are entered in a local page (`localhost`) and stored in your OS keychain or a private file; the agent gets a link, never the secret.
- **Gates, not hope.** Every MCP tool checks the stage order: no shipping before checks pass, no publishing without your explicit click.

## Install

```bash
npx prompt-to-store setup
```

It detects your agents, shows exactly what it will change, asks for confirmation and backs up every file it touches. Restart your agent and ask for an app. (Flags: `--dry-run`, `--yes`, `--agents claude,codex`, `--uninstall`.)

Claude Code plugin alternative:

```text
/plugin marketplace add taymaapp/prompt2store
/plugin install prompt-to-store@prompt-to-store
```

## What happens

| Stage | In the chat | In the local UI (`npx prompt-to-store ui`) |
|---|---|---|
| **Plan** | The agent proposes screens + decisions | Plan + **Approve** button |
| **Build** | The agent writes the Flutter app | Live stage progress |
| **Check** | "Found a warning, fix it?" | Analyzer/test results + **screenshots of every screen** |
| **Connect Codemagic** | "Open this link to connect Codemagic" | Step-by-step page, paste the token, ✓ verified |
| **Ship** | "Your test build is ready" | Install link + **QR code** |
| **Store** | "Publish to Google Play internal testing" | Listing preview + **Publish** button |

### Check without an emulator
`check_run` runs `flutter analyze`, your tests, and a generated widget test that renders **every screen to a 1290×2796 PNG with real fonts** — headless, no emulator, no device. The agent looks at the images and fixes layout bugs, and the same PNGs are valid store screenshots. With [mobile-mcp](https://github.com/mobile-next/mobile-mcp) installed it can also drive a real emulator/device.

### Ship
`ship_test_build` writes `codemagic.yaml`, commits, pushes (creating a private GitHub repo if needed), registers the app on Codemagic (adding a read-only deploy key for private repos), and starts the build. You get a public install link + QR (Android APK) and an email if you gave tester addresses. iOS without an Apple account builds for the Simulator; with an App Store Connect key, `ship_release_build` signs automatically and uploads to TestFlight.

### Store
`ship_release_build` produces a signed AAB (an upload key is generated for you, backed up locally and stored in a secure Codemagic variable group) or a TestFlight build (certificates/profiles created automatically through the App Store Connect API). Listing text, screenshots, release tracks, review submission and review replies are tools — publishing always waits for your click in the UI.

## Tools (26)

| Group | Tools | Gate |
|---|---|---|
| State | `state_get` · `plan_save` · `stage_update` · `setup_link` | — |
| Environment | `env_check` (installs Flutter on request) | — |
| Check | `check_run` · `check_results` | plan approved + Flutter project |
| Codemagic | `cm_connect_status` · `ship_test_build` · `ship_release_build` · `build_status` · `build_logs` · `build_cancel` | last check passed + Codemagic connected |
| Google Play | `play_listing_get` · `play_listing_update` · `play_screenshots_upload` · `play_track_status` · `play_publish` · `play_reviews` · `play_reply` | Play connected; `play_publish` needs a successful build + UI confirmation |
| App Store | `asc_metadata_get` · `asc_metadata_update` · `asc_screenshots_upload` · `asc_testflight_status` · `asc_submit_review` · `asc_reviews` | App Store Connect connected; submit needs a successful build + UI confirmation |

Mutating tools accept `dry_run: true`. A tool called out of order returns `{ "blocked": true, "reason": …, "next_step": … }` so the agent always knows what to do next.

## Skills

`prompt-to-store` (the pipeline and when to stop and ask) · `check` · `ship` · `store-listing` (limits and policies per store) · `doctor` + [`rejections.md`](skills/doctor/rejections.md) (41 known build failures and store rejections with fixes).

## Security

| Rule | How |
|---|---|
| Keys never pass through the chat | Entered on a `127.0.0.1` page protected by a per-project token, Host and Origin checks |
| The agent can't read keys | macOS Keychain or `.prompt-to-store/secrets.json` (mode 600, gitignored) + `deny` rules added to the agent config; tool output is redacted |
| Nothing is installed without consent | `setup` shows a diff, asks, and backs up |
| Publishing needs an explicit click | `play_publish` / `asc_submit_review` create an approval only you can grant in the UI |
| Signing keys stay yours | Generated locally, backed up in `.prompt-to-store/keys/` (gitignored), stored in *your* Codemagic account |

## Files in your project

```
.prompt-to-store/
├── state.json     ← shared by the agent and the UI (stages, connections, builds, approvals, log)
├── secrets.json   ← only when no OS keychain; never read by the agent; gitignored
├── spec.md        ← the plan
├── checks/        ← check results and screenshots
└── keys/          ← your upload/signing keys (gitignored) — back them up
codemagic.yaml     ← plain Codemagic config you can edit
```

## How it compares

|  | prompt-to-store | Expo EAS | FlutterFlow / Dreamflow | Rork / Anything |
|---|---|---|---|---|
| Works inside your agent | ✅ | MCP (hosted) | ❌ | ❌ |
| Framework | Flutter | React Native | Flutter | React Native |
| Code ownership | your folder / repo | yours | export on paid plans | export varies |
| Build & submit pipeline | open (your Codemagic) | hosted, metered | hosted, paid tiers | hosted, paid |
| Price | free + Codemagic free tier | free tier 15+15 builds/mo, then from $19/mo | from $39/mo for deploy | from ~$20/mo |
| Keys outside the chat | ✅ by design | managed by Expo | managed by vendor | managed by vendor |

Details and sources: [docs/COMPARISON.md](docs/COMPARISON.md).

## Development

```bash
npm install
npm run build && npm test
npx tsx src/cli.ts doctor
npx tsx scripts/try-tool.ts examples/habit_streaks state_get   # call any tool directly
npx prompt-to-store setup --local                               # point your agents at this checkout
```

Layout: `src/mcp` (server, tools, gates) · `src/state` · `src/secrets` · `src/services` (codemagic, github, play, appstore, signing) · `src/check` · `src/ui` · `src/setup` · `skills/` · `templates/` · `examples/habit_streaks` (demo app built with the tool).

Contributions welcome — see [AGENTS.md](AGENTS.md). MIT licensed.

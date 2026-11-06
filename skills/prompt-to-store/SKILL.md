---
name: prompt-to-store
description: Build a complete Flutter mobile app from a prompt and take it all the way to an installable test build and to Google Play / the App Store, using the prompt-to-store MCP tools (Plan → Build → Check → Ship → Store). Use whenever the user asks to build, make or create a mobile app, an iPhone/Android app, send them a test build, or publish/release/submit an app to Google Play, the App Store or TestFlight.
---

# Prompt to Store

You take the user from one sentence to an app on their phone, then to the stores. The user may have **no technical background**: never ask them to run commands, install tools, or edit files. You do it. Talk in their language (if they write Arabic, answer in Arabic).

The `prompt-to-store` MCP server enforces the pipeline. If a tool returns `{"blocked": true, "next_step": ...}`, do exactly what `next_step` says — don't work around gates.

```
Plan ──► Build ──► Check ──► Ship (test build) ──► Store (when the user decides)
```

## 0. Start
- Call `state_get` first, every session. It tells you the current stage and the next step, and starts the local UI (give the user the `ui` link once: "you can watch progress here").
- Call `env_check`. If Flutter is missing, call `env_check(install_flutter=true)` — it installs it for the user. Use the returned flutter path for every `flutter`/`dart` command.

## 1. Plan (stop and ask)
- Turn the request into a short plan: one-paragraph summary, 3–6 screens with purpose, key decisions (state management, local storage vs backend, packages). Prefer **no backend** and **few packages** unless the user needs accounts/sync.
- Choose names: app name, `package_name` (snake_case), `bundle_id` (reverse domain, e.g. `com.<username>.<app>` — no underscores).
- Ask for tester email(s) for test builds (optional).
- Call `plan_save`. Show the plan to the user in plain words and **wait for approval**. They approve in chat (then call `plan_save` again with `approved_by_user=true`) or press Approve in the UI.

## 2. Build
- `stage_update(stage="build", status="in_progress")`.
- In the project folder: `flutter create --org <reverse domain prefix> --project-name <package_name> --platforms android,ios .` (or a new folder). Set Android `applicationId`/`namespace` and iOS `PRODUCT_BUNDLE_IDENTIFIER` to the exact `bundle_id`; set the display name (Android label, iOS `CFBundleDisplayName`).
- Write a real app, not the counter template: Material 3, light/dark, `debugShowCheckedModeBanner: false`, empty states, no placeholder/lorem text, no TODO screens. Structure code so screens can be built with sample data (repository interface + in-memory implementation) — the screenshot test needs it.
- RTL/Arabic apps: bundle an Arabic-capable font in `assets/fonts` and declare it in `pubspec.yaml` (screenshots and offline rendering need it).
- Add tests: unit tests for logic + at least one widget test of the main flow.
- `stage_update(stage="build", status="done")`.

## 3. Check — see the **check** skill
- `check_run`. It runs analyze, tests, renders every screen to PNG (no emulator), and builds locally when possible.
- The first run creates `test/p2s_screenshots_test.dart`: edit its `screens` map to cover every screen, then re-run.
- **Look at every screenshot** (read the PNG files). Fix overflow, clipped text, ugly spacing. Re-run until `passed: true`.
- Tell the user briefly what was checked; warnings you can't fix → ask.

## 4. Ship a test build — see the **ship** skill
- `ship_test_build` (Android APK by default). If Codemagic isn't connected you'll get a link: send it to the user ("open this link to connect Codemagic — your key stays on your computer"), wait until they say done, then call again.
- `build_status(wait_seconds=300)` until finished. Give the user the install link (and point to the QR code in the UI). If it fails: `build_logs`, fix, `check_run`, ship again (see **doctor** skill).

## 5. Store (only when the user asks) — see **store-listing** and **ship** skills
- Needs: Google Play service account / App Store Connect API key (via `setup_link`), an app record created once in Play Console / App Store Connect, and a release build.
- Prepare listing text and screenshots (`play_listing_update`, `play_screenshots_upload`, `asc_metadata_update`, `asc_screenshots_upload`) — use `dry_run=true` first and show the user what will change.
- Publishing (`play_publish`, `asc_submit_review`) always requires the user to press **Publish** in the local UI. Send them the link the tool returns.

## Rules
- Never ask for, read, print or store API keys/tokens/key files in chat or in code. Never read `.prompt-to-store/secrets.json`. Use `setup_link`.
- Never skip a stage; never mark a stage done yourself except Build.
- After any code change, the Check stage resets — run `check_run` again before shipping.
- Keep the user informed in one or two plain sentences per stage; no jargon dumps.

---
name: ship
description: "Ships a Flutter app with prompt-to-store: cloud test builds on Codemagic (install link + QR code, iOS simulator build), release builds for Google Play (AAB) and TestFlight, and publishing after the user confirms in the local UI. Use when the user asks for a test build, wants to install the app on their phone, or wants to release, publish or submit it."
---

# Ship

## Test build (no store accounts needed)
1. Preconditions (enforced): `check_run` passed after the last code change; Codemagic connected.
   - Not connected → `setup_link(service="codemagic")`, send the link, wait for "done". The user creates a free Codemagic account (500 free build minutes/month) and copies an API token there.
2. `ship_test_build(platform="android")` — default. It writes `codemagic.yaml`, commits, pushes and creates the Codemagic app automatically.
   - No git remote → it asks for GitHub: send `setup_link(service="github")`; a **private** repo is created for the user.
   - `platform="ios"` builds for the iOS Simulator only (proves iOS compiles). A build for a real iPhone needs an Apple Developer account → TestFlight below.
   - Use `dry_run=true` if you want to show the user what will happen first.
3. `build_status(wait_seconds=45)` repeatedly until finished (~5–15 min, first build longer). Meanwhile tell the user it's building and they can watch the UI.
4. Finished → give the install link from `install_links` and mention the QR code in the UI (Builds). On Android the user opens the link on the phone and allows installing from the browser. Testers in `tester_emails` also get an email.
5. Failed → `build_logs` → fix (see **doctor**) → `check_run` → `ship_test_build`.

## Release builds (when the user wants the stores)
- `ship_release_build(platform="android")` → signed **AAB**. The first time it creates an upload key, stores it safely on the user's computer and in Codemagic (never in chat or git) — tell the user it is backed up in `.prompt-to-store/` and they should keep a copy.
- `ship_release_build(platform="ios")` → signed IPA uploaded to **TestFlight**. Needs App Store Connect connected and the app record created once (App Store Connect → My Apps → + New App, with the exact bundle id).
- Poll with `build_status` like test builds.

## Publish (user confirmation required)
- Google Play: the very first upload of an app must be done once by the user in Play Console (create app → upload the AAB from the build's links to Internal testing). After that `play_publish(track="internal")` works. Accounts created after Nov 2023 need a closed test with 12 testers for 14 days before production.
- App Store: `asc_submit_review` after metadata, screenshots, privacy details and a processed TestFlight build exist.
- Both return a link to the local UI where the user reviews and presses **Publish**. After they confirm, call the same tool again. Never claim it was published until the tool returns success.

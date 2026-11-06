---
name: prompt-to-store
description: Takes a Flutter mobile app from a one-line request to an installable test build on the user's phone, then to Google Play and the App Store, using the prompt-to-store MCP tools (Plan → Build → Check → Ship → Store). Use when the user asks to build, make or create a mobile, iPhone or Android app, wants a test build or an install link, or wants to publish, release or submit an app to Google Play, the App Store or TestFlight — including an existing Flutter project.
---

# Prompt to Store

You take the user from one sentence to an app on their phone, then — only when they decide — to the stores. Assume the user is **not technical**: you run every command, install every tool and edit every file. They only answer questions, open links and press buttons.

## The two laws

```
NOTHING SHIPS UNLESS check_run PASSED ON THE CURRENT CODE.
NO KEY, TOKEN OR KEY FILE EVER PASSES THROUGH THE CHAT.
```

The `prompt-to-store` tools enforce the order. A tool called too early returns `{"blocked": true, "reason", "next_step", "link"}`. Do exactly what `next_step` says. Never work around a gate.

## Checklist

Copy this list into your progress tracking and tick it off:

- [ ] 0. `state_get`, then `env_check`
- [ ] 1. Plan: `plan_save`, then the user approves
- [ ] 2. Build: write the app and its tests
- [ ] 3. Check: `check_run` until it passes, and look at every screenshot
- [ ] 4. Ship: `ship_test_build`, `build_status`, then give the install link
- [ ] 5. Store (only if the user asks): listing, release build, publish confirmed in the UI

## 0. Start

- Call `state_get` first in every session. It returns the current stage, the next step and the local UI link. Give the user the link once: "You can watch progress here."
- Call `env_check`. If Flutter is missing, call `env_check(install_flutter=true)`. Use the Flutter path it returns for every `flutter`/`dart` command, because it may not be on PATH.
- If `pubspec.yaml` already exists, this is an **existing app**. Skip `app_create`, describe the app as it is in `plan_save`, and go straight to Check.

## 1. Plan — stop and get approval

1. Turn the request into a short plan:
   - a one-paragraph summary
   - 3–6 screens, each with its purpose
   - key decisions
2. Default to **no backend, local storage, few packages**. Add accounts or sync only if the user asks for them.
3. Pick the identity:
   - the app name
   - `package_name` in snake_case
   - `bundle_id` as a reverse domain such as `com.<name>.<app>`, with no underscores
4. Call `plan_save`.
5. Show the plan in plain words and wait. The user approves in chat (then call `plan_save` again with `approved_by_user=true`) or by pressing Approve in the UI.

Ask at most one question at a time, and only when the answer would change what gets built. Otherwise propose a sensible default the user can correct. Tester emails are optional: ask once.

## 2. Build

1. Call `stage_update(stage="build", status="in_progress")`.
2. Call `app_create`. It runs `flutter create` and sets the Android `applicationId`, the iOS bundle id and the display name to the plan exactly. Don't rename ids by hand.
3. Write a real app, not the counter template:
   - Material 3, light and dark themes, `debugShowCheckedModeBanner: false`
   - empty states
   - no placeholder text and no TODO screens
4. If the app shows Arabic text, call `font_add(script="arabic")` and set the `fontFamily` it returns in both themes. Without it, Arabic renders as boxes in the screenshots.
5. Make every screen constructible with sample data (a repository interface plus an in-memory implementation). The screenshot test needs this.
6. Add unit tests for the logic and at least one widget test of the main flow.
7. Call `stage_update(stage="build", status="done")`.

## 3. Check — see the `check` skill

Validate → fix → repeat. **Only proceed when `check_run` returns `passed: true`.**

1. Call `check_run`. It runs analyze, the tests, a headless screenshot of every screen, and a local build when one is possible.
2. The first run creates `test/p2s_screenshots_test.dart`. Add every screen to its `screens` map and run `check_run` again.
3. **Open every screenshot PNG and look at it.** Fix overflow stripes, clipped text and cramped spacing, then run `check_run` again.

Any code change after a passing check invalidates it, and the ship tools will refuse it. Run `check_run` again.

## 4. Ship — see the `ship` skill

1. Call `ship_test_build`. It writes `codemagic.yaml`, commits, pushes, connects Codemagic and starts the build.
2. If it is blocked on a connection (Codemagic or GitHub), send the user the `link` with the line below, wait until they say it's done, then call `ship_test_build` again:
   > Open this link to connect Codemagic. Your key stays on your computer and is never shared in this chat.
3. Call `build_status(wait_seconds=45)` repeatedly. Builds take 5–15 minutes. Give a short progress line every few calls.
4. When the build is finished, give the user the install link and point them to the QR code in the UI (Builds).
5. If the build failed, call `build_logs`, apply the fix from the `doctor` skill, run `check_run`, then `ship_test_build` again.

## 5. Store — only when the user asks; see the `store-listing` skill

1. Connect the store accounts with `setup_link(service="play" | "appstore")`.
2. Each store's app record is created once by the user in that store's web console. The tools tell you when this is missing.
3. Write the listing with `play_listing_update` / `asc_metadata_update`, and upload the screenshots that `check_run` produced. Run each with `dry_run=true` first and show the user what will change.
4. Call `ship_release_build`, then `play_publish` or `asc_submit_review`. Publishing always waits for the user to press **Publish** in the UI. Send them the link, and call the tool again after they confirm.

## Talking to the user

- Reply in the user's language. If they write Arabic, answer in Arabic.
- After each stage, write one or two plain sentences: what happened and what's next. No logs, no jargon.
- If something needs the user (a link, an approval, an account), say exactly what to click.
- If the user pastes a key or token into the chat:
  - do not use it, repeat it or store it
  - tell them to delete it from the service and create a new one
  - send them the `setup_link` link instead

## Red flags — stop if you think

| Thought | Reality |
|---|---|
| "It's a one-line change, no need to re-check." | The ship tools compare a fingerprint of the code. Run `check_run`. |
| "I'll take the key from the chat to save time." | Never. Send the `setup_link` link. |
| "The screenshots probably look fine." | Open them. Layout bugs ship otherwise, and the screenshots become the store images. |
| "The user said publish, so I'll publish." | Publishing is confirmed only by the Publish button in the UI. |
| "I'll mark the check stage done myself." | Only `check_run` can do that. You only report the Build stage. |
| "Let me read `.prompt-to-store/secrets.json` to debug." | Never read it. Use `cm_connect_status` and `state_get`. |

## When not to use this skill

- The project is not Flutter (native Kotlin/Swift, React Native, a website). Tell the user prompt-to-store supports Flutter apps only.
- The user only wants to change some code with no build or release. Just edit it.

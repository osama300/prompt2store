---
name: doctor
description: Diagnoses and fixes failed Flutter builds (local or Codemagic) and Google Play / App Store rejections, using prompt-to-store's build_logs and the known-issues list in rejections.md. Use when a build fails, a store rejects the app, or a publish tool returns an error.
---

# Doctor

1. Get facts: `build_logs(build_id)` for cloud builds (failed step + script + log tails), `check_results` for local checks, or the exact error returned by a store tool (Apple 409 errors list what is missing — read them verbatim).
2. Match the error against **rejections.md** (in this skill folder): build failures, App Store rejections, Google Play rejections — each with a fix.
3. Fix in code/config, run `check_run`, then rebuild. Change one thing at a time; don't guess-loop more than 3 times — after that explain the problem to the user plainly and ask.
4. Things only the user can do (accept agreements, create the app record, fill content rating/privacy forms, enroll in the Apple Developer Program, closed testing period) — tell them exactly where to click, in their language.

Quick triage:
- `flutter analyze` fine but Codemagic fails in **Get packages** → pubspec constraints vs `flutter: stable`; commit `pubspec.lock`.
- Fails in **Build APK** with Gradle/Java/Kotlin errors → see rejections.md §Build (JDK 17, AGP/Kotlin versions, minSdk).
- iOS **Pods** errors → Podfile platform version, `pod repo update`.
- Signing errors → see rejections.md §Signing; never commit keys.
- "versionCode/build number already used" → builds use `$BUILD_NUMBER`; bump `version:` in pubspec for a new release.

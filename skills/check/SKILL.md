---
name: check
description: "Runs and reads the prompt-to-store Check stage for a Flutter app (check_run, check_results): analyzer, tests, headless screenshots of every screen, a local build, and optional on-device checks with mobile-mcp. Use when about to ship any build, when check_run fails, or when screenshots need fixing."
---

# Check

`check_run` runs, in the project root:

| Item | Fails the check when | Fix |
|---|---|---|
| dependencies | `flutter pub get` fails | fix `pubspec.yaml` versions; `flutter pub outdated` |
| analyze | any **error** (warnings only warn) | fix each `file:line:col`; aim for zero warnings too |
| format | never (warning) | `dart format lib test` |
| tests | any test fails; warning if there are none | fix code or the test; add widget tests for the main flow |
| screenshots | the screenshot test throws or renders nothing | see below |
| build | local `flutter build apk --debug` fails (only when an Android SDK exists) | read the error; see the doctor skill |

## Screenshots without an emulator
`test/p2s_screenshots_test.dart` renders each entry of its `screens` map at 430×932 @3x = **1290×2796 PNG** (valid App Store 6.7"/6.9" and Google Play phone size) into `.prompt-to-store/checks/screens/phone/`.
- Add one entry per screen, built directly with sample data, e.g. `'02_detail': () => MaterialApp(theme: appTheme, home: HabitDetailScreen(habit: sampleHabit))`. Prefix names with `01_`, `02_`… to set store order.
- Real fonts are loaded (Roboto, Material Icons and every font in `pubspec.yaml`). System fonts are **not** used: Arabic text shows as boxes unless the app bundles a font. Call `font_add(script="arabic")` and set its `fontFamily` in the theme.
- No network in tests: inject fake repositories; `google_fonts` must be bundled (`GoogleFonts.config.allowRuntimeFetching = false` + asset fonts) or replaced.
- **Always open the PNGs and look at them.** Yellow/black stripes = overflow. Fix layout bugs before shipping — they are also your store screenshots.

## Reading results
`check_run` returns a summary; `check_results` returns every detail and absolute screenshot paths. Fix all failures, then re-run until `passed: true`. Any later code change resets the stage (call `check_run` again).

## On a real device or emulator (optional, if mobile-mcp is installed)
If the `mobile-mcp` tools are available and a device/emulator is running:
1. `mobile_list_available_devices` → pick one.
2. Install the build (`build/app/outputs/flutter-apk/app-debug.apk` or the downloaded Codemagic APK) with `mobile_install_app`, then `mobile_launch_app` with the bundle id.
3. Walk the main flow: `mobile_list_elements_on_screen`, `mobile_click_on_screen_at_coordinates`, `mobile_type_keys`, `mobile_save_screenshot` to `.prompt-to-store/checks/screens/device/<n>.png`.
4. `mobile_get_device_logs` / `mobile_list_crashes` for crashes. Add `Semantics` labels to important widgets so elements are discoverable.
Never ask a non-technical user to set up an emulator — the headless screenshots are enough to ship.

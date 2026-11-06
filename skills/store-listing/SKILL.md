---
name: store-listing
description: Writes and uploads Google Play and App Store listings (titles, descriptions, keywords, screenshots) within each store's limits and policies, using prompt-to-store tools (play_listing_*, play_screenshots_upload, asc_metadata_*, asc_screenshots_upload). Use when preparing a store release or when the user asks to change store text or screenshots.
---

# Store listing

## Limits (enforced by the tools)
| Field | Google Play | App Store |
|---|---|---|
| Name / title | 30 | 30 (name) |
| Subtitle / short description | 80 (short description) | 30 (subtitle) |
| Long description | 4000 | 4000 |
| Keywords | — | 100 **bytes**, comma-separated, no spaces after commas |
| Promotional text | — | 170 (editable without review) |
| What's new | 500 (release notes) | 4000 (not on the first version) |

## Screenshots
- `check_run` already produced **1290×2796** PNGs of every screen in `.prompt-to-store/checks/screens/phone/` — valid for App Store `APP_IPHONE_67` and Google Play `phoneScreenshots`. Order = file name order (`01_`, `02_`…).
- Play: 2–8 phone screenshots. App Store: 1–10 per display type. Show real app UI only: no other platform's device frames, no "#1"/"best"/price claims.
- Google Play also needs a 512×512 icon and a 1024×500 feature graphic (create them in Flutter with a screenshot entry or ask the user).

## Writing
- Name: brand + one key benefit ("Habit Streaks: Daily Tracker"). No "free", "best", emojis, ALL CAPS or competitor names.
- First 2 lines of the description sell the app; then features as short lines; end with privacy (what is stored where).
- Write in the user's language; offer English + Arabic (`ar` / `ar-SA` locales) when relevant.
- Required URLs: privacy policy (both stores), support URL (App Store). If the user has none, offer to create a simple privacy page (e.g. GitHub Pages) and ask them to confirm the content.

## Flow
1. `*_get` to read what exists. 2. Draft text → show the user. 3. `*_update` with `dry_run=true` → then for real. 4. Upload screenshots (`replace=true` to replace). 5. Things the APIs can't do — tell the user to do them once in the web console: Play content rating, target audience, data safety, app access; App Store privacy "nutrition labels", age rating, price/availability.

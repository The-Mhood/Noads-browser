# Testing and validation

## Automated (run in CI or locally)

```bash
npm test           # 96 unit tests over pure logic modules
npm run typecheck  # strict TS: renderer + main process
npm run build      # vite (renderer) + esbuild (main/preload)
```

Unit coverage: blocklist matching, navigation resolution, settings
validation/migration, search provider registry, cosmetic-filter building,
YouTube/Spotify URL policies, fullscreen state machine, long-press payload
validation, history store, shield selectors.

## In-app smoke test (real Chromium session)

```bash
# desktop:
NOADS_SMOKE=1 npx electron . --user-data-dir=.smoke-profile
# headless Linux:
rm -rf .smoke-profile && NOADS_SMOKE=1 xvfb-run -a npx electron . \
  --no-sandbox --enable-unsafe-swiftshader --user-data-dir=.smoke-profile
```

Verifies: home renders → normal request passes → blocklisted request is
cancelled and counted → a real page loads. Exit code 0/1. Screenshots land in
`smoke/`.

## Manual validation matrix

| # | Action | Expected |
|---|--------|----------|
| 1 | Launch | Home screen (warm light theme) with search, quick links, bookmarks; restore offer if a previous session existed |
| 2 | Visit an ad-heavy site (news) | Ad slots empty; shield badge counts up; shield popover lists recent blocked hosts |
| 3 | Shield → "Update now" | Lists refresh; status shows provenance + age; failure keeps old lists with a warning |
| 4 | Shield → "Allow ads on this site" | Site added to Never block; ads load after reload; toggle reverses |
| 5 | Popup-heavy site | No windows spawn; "popups stopped" increments |
| 6 | YouTube: play several videos | No playable pre-roll where blockable; sponsored cards hidden; skip controls auto-clicked; content playback, subtitles, fullscreen and quality selection unaffected |
| 7 | Spotify Web Player | Music plays; only unrelated ad/tracker requests blocked |
| 8 | Ctrl+F in a page | Find bar opens top-right; live match count; Enter/Shift+Enter steps; Esc closes and clears highlights |
| 9 | Ctrl +/-/0 | Zoom steps with toast feedback; per-tab |
| 10 | Tabs: drag to reorder, right-click menu | Duplicate/pin/mute/close-others all work; pinned tabs compact and kept by "close others"; muted tab shows 🔇 |
| 11 | History (clock button) | Visited pages listed newest-first; Clear empties; survives restart unless cleared |
| 12 | Settings | Toggles + domain lists + search provider persist across restarts; invalid domains rejected with inline errors |
| 13 | Bookmarks | Star toggles gold; home manager add/remove; Ctrl+D; persist across restarts |
| 14 | Type `javascript:alert(1)` | Inline error, no navigation |
| 15 | Type a dead domain | One toast, then Google results (no loop) |
| 16 | Long-press link / image | Link copied / save dialog |
| 17 | Video fullscreen + Esc | Same-window fullscreen; Esc restores |
| 18 | Offline first launch | Bundled filters active with a shield warning, no silent unprotected window |

## Known limits of automated validation

- Live-site behaviour (YouTube, Spotify, ad networks) cannot be exercised in
  sandboxed CI: filter lists and page structure change constantly, and these
  sites are not reliably reachable from build runners. The smoke test covers
  the blocking pipeline; the matrix above is the repeatable manual procedure.
- The Electron binary could not be downloaded in the authoring environment
  (release CDN unreachable), so packaging (`npm run package:win|mac`) and the
  smoke test were verified as far as the environment allows: typecheck, unit
  tests and both production bundles all pass.

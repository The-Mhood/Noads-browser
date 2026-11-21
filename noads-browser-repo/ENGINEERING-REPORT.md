# NoAds Browser — Engineering Report

Date: 2026-11-21 · Version: 0.2.0 · Branch: `arena/bba6def9-noads-browser`

## 1. Original architecture assessment

**Stack:** Electron 41 + React 19 + TypeScript, Vite (renderer) + esbuild
(main), Vitest, electron-builder.

**What worked (retained):**
- Main-process architecture: tab engine (`WebContentsView` per tab, only the
  active view attached), consolidated `browser:state` push channel, validated
  IPC routes, atomic debounced settings persistence.
- Ad blocking: `@ghostery/adblocker-electron` maintained engine with cache →
  network → bundled-snapshot → custom-domain fallback chain; custom
  Always/Never-block domain policy compiled to EasyList rules; YouTube and
  Spotify URL policies; curated cosmetic filters + overlay scanner.
- Popup denial via trusted-gesture matching; unreachable-address → search
  fallback; fullscreen tracker; long-press copy/download; context menus.

**What was broken or missing:**
- **The entire renderer UI layer was absent** — `src/components/*` and
  `src/context/*` referenced by `App.tsx` did not exist, so the product did
  not build or run. `tests/selectors.test.ts` also referenced a missing
  module.
- Theme was purple/dark, not the product identity (maroon/ash/charcoal).
- No favicons, per-tab stats, history, find-in-page, zoom, tab pin/mute/
  reorder, or filter-list status visibility.
- `android-tv/` was Gradle scaffolding with no `:app` module; the documented
  CI workflow did not exist.
- Unused `ogl` dependency; no `.gitignore`.

## 2. New architecture

Unchanged where sound (main-process authority, mirror renderer, typed IPC).
Extended with: engine provenance (`FilterEngineStatus`), per-tab block
attribution via `webContentsId`, a bounded persisted history store
(`electron/history.ts`, pure + tested), find-in-page state owned by main,
page-level shortcut interception (`before-input-event`), and a third popover
class (history, find) alongside settings/shield. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 3. Features implemented (this iteration)

- Complete renderer rebuild: tab strip (favicons, pin, mute, drag-reorder,
  context menu: duplicate/pin/mute/close others), toolbar (security
  indicator, address suggestions, shield with badge + warning dot, bookmark
  star, history, settings), home screen (search, quick links, bookmark
  manager, recent history, session-restore offer), error screen, toast,
  settings panel, protection dashboard, history panel, find bar.
- Protection dashboard: real counters (session requests blocked, popups
  stopped, per-tab blocks), filter-list source + age + manual update,
  per-site allow toggle, recent blocked hosts. No fabricated numbers.
- Browsing history (local, 500-entry bound, deduped, clearable).
- Find in page (Ctrl+F — works while the page is focused; live match counts).
- Zoom controls (Ctrl/Cmd +/-/0, per-tab, clamped 25–500%).
- Media: per-tab audible/muted indicators with one-click mute.
- Keyboard shortcuts at page level and chrome level (T/W/L/R/F/D/zoom/Esc).

## 4. Features redesigned

- Full design system: matte-charcoal chrome, ivory text, light-maroon
  accents, warm-brown highlights; warm light internal screens. Consistent
  radii, focus rings, scrollbars, states. No gradients/glassmorphism excess.
- Shield popover upgraded from status list to a real dashboard.

## 5. Ad-blocking capabilities verified

- 96 unit tests pass (blocklist matching, domain-rule compilation, YouTube/
  Spotify URL policies, cosmetic CSS building, settings validation, history,
  selectors, fullscreen, long-press payloads).
- Layers: maintained EasyList/uBO engine (network + cosmetic + scriptlets),
  custom domain policy with `@@` exceptions, YouTube first-party ad-endpoint
  policy, popup denial, overlay/dialog cosmetic scan.

## 6. YouTube testing results and limitations

- Policies unit-tested (`tests/youtubePolicy.test.ts`): ad endpoints blocked,
  `googlevideo.com/videoplayback` and Spotify audio explicitly never blocked.
- Player-side handling: curated cosmetic selectors, skip-control automation
  (real input events via a validated relay), mute-during-unskippable-ads with
  audio restore — never seeks or replaces the content video.
- **Limitation (documented, not hidden):** server-side stitched ads are
  indistinguishable from content at the network layer; YouTube changes its
  player often, so cosmetic/skip strategies degrade gracefully. Live YouTube
  playback could not be exercised in this environment (no Electron binary);
  the manual matrix in docs/TESTING.md covers it.

## 7. Performance

- Block stats broadcast throttled (100 ms); per-tab attribution is O(1).
- Home backdrop is a lightweight canvas (26 rects), no WebGL dependency.
- Filter engine loaded asynchronously; bundled snapshot covers first paint.
- Renderer bundle: ~77 kB gzip JS + ~3.5 kB CSS.
- Not measured on-device in this environment (no runnable Electron).

## 8. Security improvements

- Kept `sandbox`/`contextIsolation`/no-node everywhere; CSP on the chrome.
- Esc key is mirrored, never consumed, so page behavior is unaffected.
- History is local-only; all site permissions remain denied by default.
- No credentials or signing keys in the repo; macOS packaging explicitly
  unsigned.

## 9. Test results

- `npm test`: **96/96 passed** (14 files).
- `npm run typecheck`: clean (renderer + main, strict).
- `npm run build`: renderer (vite) + main/preload (esbuild) succeed.
- In-app smoke test: not run here (Electron binary CDN unreachable from this
  sandbox); retained and updated to the new UI selectors.

## 10. Production build locations

- `dist/` (renderer bundle), `dist-electron/` (main/preload bundles) build
  successfully.
- Installers: `npm run package:win` (NSIS x64/arm64) and
  `npm run package:mac` (zip x64/arm64, unsigned) configured; CI workflow
  `.github/workflows/ci.yml` runs verify + packaging on GitHub runners
  (which can download Electron). Packages could not be produced in this
  sandbox.

## 11. Remaining known limitations

- Android phone / Android TV / iOS require native rebuilds (Electron cannot
  target them); `android-tv/` is scaffolding only. Strategy and honest
  capability matrix: [docs/PLATFORMS.md](docs/PLATFORMS.md).
- Picture-in-picture: no reliable Electron API surface; not implemented
  rather than faked.
- Downloads have save-as dialogs but no in-app downloads panel yet.
- Filter categorization (ads vs trackers vs malware split) is not reported
  because the engine does not expose honest per-category attribution.

## 12. Git commits (this iteration)

- `bf34652` — renderer rebuild, dashboard, history, find, zoom, tab ops.
- `0f65856` — docs, hygiene, Esc-handling fix.
- Final: CI workflow + this report.

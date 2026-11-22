# Noads Browser

A desktop web browser (Electron + React + TypeScript) that blocks ads,
trackers and popups at the network level using maintained
EasyList/uBlock-compatible filter lists, with per-site controls, a protection
dashboard and a warm, entertainment-oriented design (matte charcoal chrome,
ivory text, light-maroon accents).

## Features

- **Multi-tab browsing** — favicons, drag-to-reorder, middle-click close,
  right-click tab menu (duplicate, pin, mute, close others), session restore.
- **Network-level ad blocking** — maintained EasyList/uBlock-compatible
  engine (`@ghostery/adblocker-electron`) with a bundled snapshot for
  first-run/offline protection and a weekly cache refresh. Custom
  *Always block* / *Never block* domain lists sit on top.
- **Protection dashboard** (shield button) — real counters only: requests
  blocked this session, popups stopped, blocks on the current tab, filter-list
  provenance and age, manual *Update filters now*, recent blocked hosts, and a
  per-site allow toggle.
- **YouTube protection** — known ad endpoints blocked at the network layer,
  curated cosmetic rules for ad surfaces, and a conservative in-player monitor
  that clicks YouTube's own Skip/Close controls (never seeks or replaces the
  content video; mutes non-skippable pre-rolls instead). See
  [docs/PLATFORMS.md](docs/PLATFORMS.md) for honest limitations.
- **Cosmetic filtering** — EasyList cosmetic rules injected by the engine,
  plus an app layer that removes ad-iframe overlays and suspicious
  notification/age-gate popups.
- **Navigation** — address bar with URL/search detection, domain completions,
  HTTPS indicator, unreachable-address → search fallback (no loops).
- **Productivity** — bookmarks (star, home manager, Ctrl+D), browsing history
  (local, bounded, clearable, Ctrl+H via toolbar clock), find in page
  (Ctrl+F, works while the page is focused), zoom (Ctrl +/-/0), downloads with
  save-as dialogs, long-press to copy links / save media, full page context
  menus.
- **Media** — per-tab audio indicator + mute, same-window native fullscreen
  for video players, Spotify playback allowlist so music never breaks.
- **Privacy** — all website permission requests (notifications, camera, mic,
  location) denied by default; no telemetry; history stays on-device.

## Run

```bash
npm install
npm start          # builds renderer + main process, then launches Electron
```

Requires Node 18+ (Node 20 tested). On Linux without a sandbox user, launch
with `npx electron . --no-sandbox` after `npm run build`.

## Verify

```bash
npm test           # Vitest unit tests (96) over the pure logic modules
npm run typecheck  # strict TS, renderer + main process
npm run build      # vite build (renderer) + esbuild (main/preload)
```

In-app smoke test (real Chromium session) and the full manual validation
matrix: [docs/TESTING.md](docs/TESTING.md).

```bash
NOADS_SMOKE=1 npx electron . --user-data-dir=.smoke-profile
```

## Package

```bash
npm run package:win   # Windows NSIS installer (x64 + arm64)
npm run package:mac   # macOS zip (x64 + arm64), unsigned
```

macOS signing/notarization requires Apple credentials and is intentionally
not automated. Mobile/TV platform strategy: [docs/PLATFORMS.md](docs/PLATFORMS.md).

## Architecture

Short version: the **main process owns everything** (tabs as
`WebContentsView`s, the filter engine, settings/history persistence, popup
policy); the **React renderer is a mirror** driven by one consolidated
`browser:state` push channel. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

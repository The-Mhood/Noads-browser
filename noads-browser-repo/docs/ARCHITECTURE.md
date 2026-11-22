# Architecture

## Processes

- **Main process (`electron/`)** — authoritative. Owns the Chromium session,
  all tabs, the filter engine, popup policy, downloads, persistence and every
  security decision. The renderer can only *request* things through validated
  IPC routes.
- **Chrome renderer (`src/`)** — React UI for the tab strip, toolbar and
  internal screens (home/error). It is a pure mirror of main-process state:
  one `browser:state` push channel feeds a reducer (`src/context/
  BrowserContext.tsx`), and components call a typed repository
  (`src/data/ipc.ts`) — never `window.browser` directly.
- **Popover renderers** — settings / shield dashboard / history / find bar are
  small native `WebContentsView`s overlaid above the page, so the page stays
  live and clickable outside them. They run the same React bundle with
  `?overlay=<kind>`.
- **Page preload (`electron/pagePreload.ts`)** — tiny, string-in/string-out
  bridge for untrusted pages (long-press reporting, YouTube skip-control
  relay, trusted user gestures, fullscreen fallback). Every payload is
  re-validated in main.

## Tabs

`electron/tabs.ts` — each `Tab` owns a `WebContentsView`; only the active
tab's view is attached. Home and error are per-tab *modes* rendered by React,
so history is preserved and Back works from home. Popup policy:
`window.open`/`target=_blank` is allowed only when it matches a trusted
user-gesture link (or a same-site gesture) — everything else is denied and
counted as a popup.

## Ad blocking

Layers, in order:

1. **Maintained engine** (`@ghostery/adblocker-electron`, EasyList/uBO
   compatible) — network blocking, EasyList cosmetic injection and
   scriptlets. Loaded from (in priority order): weekly-refreshed userData
   cache → network download → bundled snapshot (`assets/adblock-engine.bin`)
   → custom-domain fallback listener. Degraded states surface a shield
   warning instead of failing silently.
2. **Custom policy** — user *Always block* / *Never block* domains compiled
   to EasyList-style rules (`@@||…^` exceptions win) via
   `engine.updateFromDiff`.
3. **URL policies** — narrow, explicit rules: YouTube ad endpoints
   (`electron/youtubePolicy.ts`) and Spotify playback protection
   (`electron/mediaPolicy.ts`). Both are deliberately conservative: YouTube
   media (`googlevideo.com/videoplayback`) is never blocked, because ads and
   content can share that pipeline.
4. **Cosmetic layer** (`electron/cosmeticFilters.ts`) — curated per-site CSS
   + a runtime scan that hides ad-iframe overlays and suspicious dialogs.

Per-tab counters are attributed by `webContentsId` (`Request.tabId` for
engine events). All dashboard numbers come from real engine events.

## State and persistence

- `userData/settings.json` — settings + bookmarks + last-session tabs
  (sanitized on load, validated on update, atomic debounced writes).
- `userData/history.json` — bounded local history (500 entries,
  `electron/history.ts` is pure and unit-tested).
- `userData/adblock-engine.{bin,json}` — serialized filter cache + freshness
  metadata.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  everywhere.
- All website permission requests denied in the session handler.
- No remote code in the chrome; CSP in `index.html` restricts the renderer to
  self.
- Untrusted input (typed URLs, settings.json, page payloads) is validated in
  main before any effect.

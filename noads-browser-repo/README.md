# Noads Browser

A desktop web browser (Electron + React + TypeScript) that uses maintained
EasyList/uBlock-compatible filter lists to block ads, trackers, and cosmetic
page ads at the network and document level, while also denying popups before
they can open. The v0.1.10 desktop chrome uses an ash/grey/black/white and
royal-purple cinematic raised UI, and user-initiated target=_blank links open
as new browser tabs rather than separate windows.

**Features:** multi-tab browsing · home button + animated home screen ·
long-press a link to copy its URL, long-press an image/video to save it ·
**right-click / two-finger-click context menu** (open in new tab, copy
address, save as…) · **bookmarks** (home-screen manager, toolbar star,
context menu) · addresses that can't be reached automatically become Google
searches · configurable search provider (DuckDuckGo/Google/Bing/Wikipedia) ·
allow/block domain lists · **address-bar predictions** (common domains and
`.com` completion after a trailing dot) · **in-page (cosmetic) ad filtering**
— hides rendered ad elements and ad-iframe popup dialog boxes (YouTube ad
slots, in-player ad surface, in-page popups) · **shield status popover** with
scrollable recent blocked-host history · **same-window native fullscreen for video**
(the player enters macOS fullscreen without opening a second window; the Noads
browser view remains the same page, and Esc exits). Custom player controls
labeled Fullscreen, Maximize Player, or Expand Player are recognized without
seeking or replacing the page-owned video.

**Shortcuts:** `Cmd/Ctrl+T` new tab · `Cmd/Ctrl+W` close tab · `Cmd/Ctrl+L` focus address bar · `Esc` reset/clear the bar.

## Run

```bash
npm install
npm start          # builds renderer + main process, then launches Electron
```

Requires Node 18+ (Node 20 tested). On Linux without a sandbox user, launch
with `npx electron . --no-sandbox` after `npm run build`.

## Verify (manual checklist)

| # | Action | Expected |
|---|--------|----------|
| 1 | Start the app | The app opens on a home screen with animated AcidSquares background and quick links; if a previous session exists, a Restore tabs / Not now choice is shown |
| 2 | Click a quick link (e.g. Wikipedia) | Page loads; address bar syncs to the URL; indeterminate bar while loading |
| 3 | Open an ad-heavy site (BBC, CNN, ESPN) | Ad slots render empty; shield badge increments as requests are blocked; click the shield to see the recent blocked-host history (five rows visible, more scrollable) |
| 4 | On any page, look for `window.open`/popup behavior (or open a known popup site) | No popup window appears; "popups stopped" count increments in the shield status popover |
| 5 | Type `cats` + Enter | DuckDuckGo HTML search results; address bar shows `cats` (the query, not the full URL) |
| 6 | Type `goo` and pause, then press Enter; repeat with `google.` | The address bar suggests `google.com`; Enter accepts either completion and opens the domain |
| 7 | Settings (gear) → Search engine → Bing; type `weather` + Enter | Results from Bing; choice persists across restarts |
| 8 | Settings → "Always block" → add any real host (e.g. `en.wikipedia.org`); revisit | Host is blocked; navigating to it directly shows the "This page is blocked" error screen |
| 9 | Settings → "Never block" → add a blocked ad domain (e.g. `doubleclick.net`); revisit an ad site | That domain's requests go through (allowlist wins) |
| 10 | Settings → uncheck "Block ads, trackers and popups" | Shield goes muted; ads load; shield tooltip says "blocking disabled" |
| 11 | Type `javascript:alert(1)` + Enter | Inline error under the address bar, no navigation |
| 12 | **Tabs:** `+` (or `Cmd/Ctrl+T`) opens a new home tab; load different sites in 2–3 tabs; click tabs to switch | Switching is instant (inactive tabs stay alive); close (`×` or `Cmd/Ctrl+W`) works; closing the last tab spawns a fresh home tab |
| 13 | **Home button:** house icon in the toolbar | Active tab goes to the home screen; **Back** still returns to the previous page |
| 14 | **Unreachable URL:** type a nonsense domain, e.g. `this-domain-does-not-exist-98127.com` + Enter | Brief toast "wasn't reachable — showing Google search results", then Google results for that address (never an infinite bounce: if Google itself is unreachable you get the normal error screen) |
| 15 | **Long-press:** on any page, press-and-hold a link for ~½ second | Its URL is copied to the clipboard; a "Link copied" toast appears; releasing does NOT navigate |
| 16 | **Long-press image:** hold an image for ~½ second | A save dialog opens; the file is saved (extension added when the URL has none); a "Saved …" toast appears. Same for `<video>`/`<audio>`/`<object>` elements |
| 17 | **Context menu:** right-click (or two-finger-click) a link | Menu with "Open link in new tab", "Copy link address", "Save link as…", plus Bookmark/Save page/Back/Forward/Reload/Go home. On an image: "Open image in new tab", "Copy image address", "Save image as…". On selected text: "Copy". Opening in a new tab really opens a new tab |
| 18 | **Bookmarks:** on the home screen, add a site (e.g. `en.wikipedia.org` + name) | It appears in "Your bookmarks"; clicking the chip opens the site; × removes it; invalid/already-bookmarked input shows an inline error. While browsing, the star in the toolbar toggles the current page (gold when bookmarked) — and "Bookmark this page" works from the context menu too. Bookmarks survive a restart |
| 19 | With the network disabled, open a page | Error screen with the Chromium error code; "Try again" retries in place; Back still works |
| 20 | Restart the app | The app opens on Home; the previous tabs remain available through the Restore tabs choice, while bookmarks still restore automatically |
| 21 | **Video fullscreen:** open a video page (e.g. YouTube), press Fullscreen/Maximize Player/Expand Player or double-click the video; separately test the macOS green button | The existing Noads Browser window enters native macOS fullscreen—no second window is created, and the macOS menu bar is hidden. **Esc** (or the player’s exit control) restores the same window. Ordinary macOS maximize/green-button fullscreen remains independent. |
| 22 | **In-page ads (cosmetic filtering):** play a video on YouTube or visit an ad-heavy streaming site | Ad cards, sponsored cards, current YouTube player ad layers, suspicious age/notification/"turn off ads" dialogs, and known ad-iframe overlays are removed or suppressed. The YouTube monitor clicks available skip controls without seeking the content video. Toggle: Settings → "Hide in-page ads & popups" (reloads of the page pick up the change) |
| 23 | **Spotify playback:** open Spotify Web Player and play a track | Spotify metadata and audio playback work while unrelated ad/tracker requests remain subject to the blocker |

DevTools for the chrome UI: `NOADS_DEVTOOLS=1 npm start`.

## Automations

```bash
npm test           # Vitest unit tests: blocklist matcher, navigation resolution,
                   # settings validation, provider registry, selectors
npm run typecheck  # strict TS, both renderer and main process
npm run build      # vite build (renderer) + esbuild (main/preload)
```

### Filter engine behavior

The browser loads the maintained `@ghostery/adblocker-electron` engine with
EasyList/uBlock-compatible ads, tracking, annoyance, cosmetic, and scriptlet
rules. The first
successful startup downloads the current ads/tracking lists and caches the
serialized engine under Electron's `userData` directory. The cache is refreshed
weekly; if refresh fails, a stale cache is used with a visible shield warning.
If there is no valid cache on the first offline startup, the browser continues
with the bundled/custom domain rules and surfaces that degraded mode instead of
silently claiming full coverage.

The Settings panel's main blocking toggle controls the maintained network and
cosmetic engine. The separate cosmetic toggle controls document-level visual
filtering and takes effect on the next page load. The existing Electron popup
window denial and permission lockdown remain active independently.

The maintained engine substantially improves coverage but cannot guarantee
that every future, first-party, obfuscated, or deliberately adversarial ad will
be blocked. Filter lists and site markup change over time; the shield warning
and request count expose degraded operation rather than hiding it.

### Smoke test (in-app e2e, real Chromium session)

```bash
# desktop:
NOADS_SMOKE=1 npx electron . --user-data-dir=.smoke-profile
# headless Linux:
rm -rf .smoke-profile && NOADS_SMOKE=1 xvfb-run -a npx electron . \
  --no-sandbox --enable-unsafe-swiftshader --user-data-dir=.smoke-profile
```

The `--user-data-dir` flag gives the smoke a fresh profile (deterministic
home-first startup); add it to `.gitignore` or clean it afterwards.

Automatically verifies: home screen renders → normal request passes →
blocklisted request is cancelled and counted → a real page loads. Screenshots
are written to `smoke/`. Exit code 0/1 reflects the result.

## Architecture (short version)

- **Main process = backend.** Owns the Chromium session: maintained
  EasyList/uBlock-compatible network and cosmetic filtering through
  `@ghostery/adblocker-electron`, the existing bundled/custom domain policy,
  popup denial via `setWindowOpenHandler`, permission lockdown (no notification
  boxes), filter-engine caching/status, settings persistence
  (`userData/settings.json`, debounced, atomic writes, tab-session restore),
  and one consolidated `browser:state` push to the renderer.
- **Tabs** (`electron/tabs.ts`). Each tab owns a `WebContentsView`; only the
  active tab's view is attached. Home/error are per-tab modes; closing the
  last tab spawns a fresh home tab. Unreachable addresses auto-redirect to a
  Google search (armed once, never on search URLs — no loops).
- **Renderer = mirror.** React Context + reducer holds a copy of main's
  state; components never touch IPC directly (repository seam in
  `src/data/ipc.ts` — swap for a real API later without touching components).
  Settings and shield dropdowns are rendered in a bounded native popover view,
  so the page remains live and clickable outside the dropdown.
- **Internal screens.** Home (empty state) and error screens render in the
  React layer with the AcidSquares WebGL background; the tab's native view is
  detached while they show, so history is preserved.
- **Long-press copy/download** (`electron/longpress.ts`, `electron/pagePreload.ts`).
  A one-function preload + an idempotent injected listener (delegated,
  450 ms hold, 6 px tolerance) report completed holds to main, which
  re-validates every payload before touching clipboard or disk.
- **Cosmetic filtering** (`@ghostery/adblocker-electron` plus
  `electron/cosmeticFilters.ts`). The maintained engine injects the
  EasyList/uBlock-compatible page rules and scriptlets through a registered
  preload. The app-specific layer adds curated YouTube selectors and a
  conservative runtime filter for large fixed/absolute overlays that embed an
  iframe to a blocked ad domain. The app toggle and allowlist are checked by
  both layers.
- **Search providers.** Registry in `shared/searchProviders.ts`; adding one
  is a one-line entry. Unknown/missing ids fall back to DuckDuckGo HTML.
- **Untrusted input.** Typed URLs, settings (including settings.json on
  disk), and page→main long-press payloads are all validated in the main
  process before any effect; errors are returned to the UI as values, never
  swallowed.

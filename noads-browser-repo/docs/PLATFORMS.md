# Platform support and strategy

NoAds Browser targets one ecosystem with platform-specific implementations.
This document is the honest record of what exists, what is buildable, and
what each platform requires — including limitations we will not paper over.

## Support matrix

| Platform | Status | Engine | Ad blocking | Notes |
|---|---|---|---|---|
| Windows | ✅ Implemented (this repo) | Chromium (Electron) | Network + cosmetic + scriptlets | NSIS packaging configured (`npm run package:win`) |
| macOS | ✅ Implemented (this repo) | Chromium (Electron) | Network + cosmetic + scriptlets | zip packaging configured; signing/notarization needs Apple credentials |
| Linux | ✅ Runs (dev target) | Chromium (Electron) | Network + cosmetic + scriptlets | Launch with `--no-sandbox` where required |
| Android phones | ✅ Implemented (`android-tv/`) | Android WebView | Domain-level network blocking | Touch UI; shares APK with TV |
| iOS / iPadOS | ⛔ Not implemented | WKWebView (Apple mandate) | Safari content-blocker rules only | See below |
| Android TV / Google TV | ✅ Implemented (`android-tv/`) | Android WebView | Domain-level network blocking | Leanback 10-foot D-pad UI; sideload APK |
| Other Smart TVs (Tizen, webOS) | ⛔ Not supported | proprietary | — | No third-party browser sideload route; would need per-vendor apps |

## What "implemented" means here

The desktop browser is a single TypeScript codebase whose renderer,
ad-blocking engine, settings and history are platform-neutral; only the
Electron shell differs per OS. Feature parity across Windows/macOS/Linux is
therefore real, not per-port.

## Mobile and TV: the honest engineering position

Electron/Chromium cannot be shipped on Android, iOS or TV devices. Those
ports require native applications that share the NoAds *policy and design
system* but not the desktop engine APIs:

- **Android (phone + TV):** Kotlin/Java app (`android-tv/`) on Android
  WebView with `WebViewClient.shouldInterceptRequest` blocking against the
  same bundled blocklist as desktop. Phone and TV are separate activities in
  one APK: a touch UI, and a leanback 10-foot D-pad UI with focusable
  controls, remote address entry (system on-screen keyboard) and video
  fullscreen. YouTube ad blocking on WebView covers third-party ad endpoints;
  first-party stitched ads are not reliably blockable.
- **iOS:** Apple requires WKWebView. Ad blocking is possible only through
  Safari content-blocker rule lists (compiled JSON) applied to
  `WKContentRuleListStore` — a strictly weaker model than desktop
  (no scriptlets, limited rule counts, no network-level request engine).
  YouTube ad blocking on iOS is correspondingly limited and must not be
  promised at desktop parity.
- **Smart TVs (Tizen/webOS):** no supported third-party browser
  distribution; any claim of compatibility would be fabricated.

## YouTube: cross-platform honesty

- **Desktop:** layered approach (network ad-endpoint blocking + curated
  cosmetic rules + skip-control automation). It removes most pre-rolls and
  ad surfaces, but YouTube changes its player frequently and server-side
  stitched ads cannot be distinguished from content at the network layer.
  When a strategy stops working, protection degrades to "mute + hide + skip
  when possible" — never to a broken player.
- **Android WebView:** request interception covers third-party ad endpoints;
  first-party stitched ads are not reliably blockable.
- **iOS WKWebView:** content-blocker rules hide/blocked matched resources
  only; no runtime player automation. Expect reduced effectiveness.

We do not claim permanent or universal YouTube ad elimination.

# Android + Android TV package

The `android-tv/` Gradle project builds the Noads Browser APK that serves
**both Android phones/tablets and Android TV / Google TV** from one module
(`app/`):

- **Phone/tablet** (`PhoneActivity`): touch-first chrome — address bar,
  back/forward/reload/home, shield counter.
- **Android TV** (`TvActivity`): 10-foot leanback UI — large D-pad-focusable
  controls, remote-friendly address dialog (system on-screen keyboard),
  WebView arrow-key scrolling, video fullscreen.

Both share `BrowserActivity`: WebView with network-level ad/tracker blocking
(`shouldInterceptRequest` against the same bundled `blocklist.json` the
desktop app ships), HTML5 video fullscreen support, and a live blocked-count
indicator.

## Build

The APK is built by `.github/workflows/release.yml` (at the repository root)
and attached to GitHub Releases. Locally, with the Android SDK installed:

```bash
cd android-tv
gradle :app:assembleDebug   # debug-signed, sideloadable APK
# output: app/build/outputs/apk/debug/app-debug.apk
```

Install on a TV via `adb install app-debug.apk`; it appears in the TV app row
(leanback launcher). Release signing requires a keystore that is not committed
to this repository.

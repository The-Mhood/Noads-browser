# Noads Browser for Android TV

This is the generic Android TV port of Noads Browser. It is designed for Android TV and Google TV boxes connected to televisions, including devices from Xiaomi, Chromecast, NVIDIA, onn., and other vendors.

## What is included

- Android TV and regular Android launcher entries.
- Remote/D-pad friendly landscape browser chrome.
- A visible on-screen pointer: arrows move it, OK/Enter clicks, and page-edge movement scrolls.
- Free smooth pointer navigation: the cursor moves normally and only receives a small magnetic snap when it is already touching a link or control; there is no link-to-link lock.
- Pointer mode can be toggled from the toolbar; a normal webpage focus mode is also available.
- Multiple tabs, address/search bar, back/forward/reload/home controls; the Android TV keyboard closes immediately after address submission.
- System WebView page rendering with JavaScript and DOM storage enabled.
- Defense-in-depth ad blocking: bundled network domain filtering, 204 subresource aborts, third-party-cookie blocking, popup-window rejection, dynamic DOM cleanup, and YouTube ad UI/skip handling. YouTube media hosts are deliberately not blanked so videos do not turn into black frames.
- Chrome-inspired raised/gradient TV chrome, sliding header, and transparent scroll arrows. The header hides after 12.5 seconds without navigation and returns on navigation.
- Inline HTML5/video fullscreen below the browser toolbar, so the tab/address controls remain available.
- Download handling through Android's Download Manager.
- No native CPU-specific libraries: the APK is universal and uses the WebView supplied by the device.

The Android build is a native WebView port. The existing Windows/macOS Electron executable is not used on Android TV because Electron does not run as an Android TV runtime.

## Build locally

```bash
./gradlew assembleDebug
```

The installable debug APK is written to:

```text
app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with the build machine's debug key and is suitable for sideloading. For a public app or reliable updates, configure a private release keystore through Gradle/GitHub Actions secrets; never commit a keystore or password to the repository.

## GitHub installation

1. Create a GitHub Release in the repository.
2. Attach `app-debug.apk` (or a privately signed release APK) to the release.
3. On the Android TV device, install Downloader or a file manager/browser that can open the release asset URL.
4. Enable installation from unknown sources for that installer when Android TV asks.
5. Install the APK. The app has `LEANBACK_LAUNCHER`, so it appears in the Android TV apps row.

A GitHub source file by itself is not an Android TV app store listing. A GitHub Release asset is the easiest direct sideload route. Google Play distribution requires a Play Console release and a properly managed signing key.

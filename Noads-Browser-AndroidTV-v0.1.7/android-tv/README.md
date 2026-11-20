# Noads Browser for Android TV

This is the generic Android TV port of Noads Browser. It is designed for Android TV and Google TV boxes connected to televisions, including devices from Xiaomi, Chromecast, NVIDIA, onn., and other vendors.

## What is included

- Android TV and regular Android launcher entries.
- Remote/D-pad friendly landscape browser chrome.
- Multiple tabs, address/search bar, back/forward/reload/home controls.
- System WebView page rendering with JavaScript and DOM storage enabled.
- Bundled network ad-domain blocking and conservative cosmetic filtering.
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

# Android TV package

The Android TV port is in [`android-tv/`](android-tv/). It builds a universal APK for Android TV/Google TV devices and is independent of the desktop Electron package.

Use the GitHub Actions workflow at `.github/workflows/build-android-tv.yml` to build an APK artifact, then attach that APK to a GitHub Release for sideloading on the TV device.

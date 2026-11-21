# Android TV package — status

The `android-tv/` directory currently contains **only the Gradle wrapper and
project scaffolding** for a future native Android TV application. There is no
`:app` module yet, and the previously referenced CI workflow does not exist —
nothing here builds an APK today.

A real Android TV port requires the Android SDK/Gradle toolchain and a
dedicated 10-foot, D-pad-navigable interface (see
[`docs/PLATFORMS.md`](../docs/PLATFORMS.md) for the platform strategy and the
honest capability matrix). It is scheduled as a separate native module that
shares NoAds' filter policy and design tokens, not a rescaled desktop or
phone layout.

# The CFB Hub — Android App

Native Android Kotlin WebView wrapper (`com.thecfbhub.app`) for **The CFB Hub** web application hosted at `https://thecfbhub.netlify.app/`.

## Features
- Full parity across all 7 tabs (`Schedule`, `Live`, `Watch`, `Standings`, `Rankings`, `Teams`, and `Transitive W/Ls`)
- Edge-to-edge layout with Light/Dark status and navigation bar theme sync matching the in-app Stadium Emerald theme toggle
- Smart hardware back navigation: closes Game Center modal sheets, exits Watch multistream fullscreen, triggers the web app's in-app `#nav-back-btn` / `#back-to-teams-btn` before WebView history
- Pull-to-refresh triggering the in-app data refresh without interrupting active Watch streams
- Fullscreen HTML5 `<video>` playback support and popup blocking for third-party stream embeds
- Chrome Custom Tabs for external `http`/`https` links and HTTPS deep-link intent handling for `https://thecfbhub.netlify.app/`

## Requirements
- JDK 17 or newer (JDK 21 compatible)
- Android SDK Platform `36` (`platforms/android-36`) and `build-tools/36.0.0` (plus `platform-tools` / `adb`)
- `android/local.properties` pointing `sdk.dir` to your local Android SDK directory

## Build & Test
From `android/`:

```powershell
# Run JVM unit tests and build the debug APK
.\gradlew.bat testDebugUnitTest assembleDebug

# Build a release APK (unsigned unless signing config is added)
.\gradlew.bat assembleRelease
```

The generated debug APK will be located at:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Install & Launch on Device or Emulator
Connect an Android device with USB debugging enabled (or start an AVD), then run from `android/` or the repo root:

```powershell
# Using adb
adb install -r android\app\build\outputs\apk\debug\app-debug.apk

# Or using Android CLI from android/
android run
```

## Changing the Hosted URL
Update `buildConfigField("String", "APP_URL", "\"https://thecfbhub.netlify.app/\"")` inside `android/app/build.gradle.kts`, and update the `<data android:host="..." />` deep-link filter in `android/app/src/main/AndroidManifest.xml` if changing the domain.

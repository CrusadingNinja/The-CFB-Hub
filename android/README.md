# The CFB Hub — Native Android App

Full Native Kotlin + Jetpack Compose Android application (`com.thecfbhub.app`, `v2.0.0`) for **The CFB Hub** with direct ESPN College Football API integration and Netlify backend support (`https://thecfbhub.netlify.app`).

## Native Screens & Features
- **Schedule**: FBS/FCS division toggle, Regular Season/Postseason phases, horizontal Week Strip, Status/Top-25/Conference filters, pull-to-refresh, chronological ordering, and FLEX/TBD kickoff formatting (`America/New_York` anchored when `timeValid == false`)
- **Live**: Live scoreboard monitor with pulsing indicators, down-and-distance/Red Zone situations, 15s background-safe auto-refresh, and upcoming slate
- **Watch**: Native stream directory across `ppv.st`, `tim-streams.com`, and `strmfree.pk` with multi-feed switching, fullscreen WebView video playback, and Chrome Custom Tabs fallback
- **Standings**: FBS conference tables sortable by seed, win percentage, point differential, and streak
- **Rankings**: CFP & AP Top 25 polls across seasons and weekly releases with ranking delta badges, conference filters, and others receiving votes
- **Teams**: Searchable NCAA FBS/FCS directory and native Team Pages (hero banner, record splits, season selector, schedule, and team/opponent season statistics)
- **Transitive W/Ls**: On-device Kotlin shortest-degree diverse transitive chain solver (`TransitiveEngine`) supporting up to 5 Win chains and 5 Loss chains (`Degree n`) plus the **Farthest Chains by School** eccentricity leaderboard
- **Game Center**: Material Design 3 Modal Bottom Sheet with quarter-by-quarter linescore, Play-by-Play drives, Scoring Plays, Boxscore comparison bars, and Team Leaders
- **In-App Navigation & Theme**: Link-history **Back** button, smart Android hardware back handling, global search, and persistent Light/Dark Stadium Emerald MD3 theme

## Requirements
- JDK 17 or newer (JDK 21 compatible)
- Android SDK Platform `36` (`platforms/android-36`), `build-tools/36.0.0`, and `platform-tools` (`adb`)
- `android/local.properties` pointing `sdk.dir` to your local Android SDK directory

## Build & Test
From `android/`:

```powershell
# Run JVM unit tests and compile the debug APK
.\gradlew.bat testDebugUnitTest --rerun assembleDebug --no-daemon

# Build a release APK (unsigned unless signing config is added)
.\gradlew.bat assembleRelease
```

Debug APK output:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Install on Device
```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

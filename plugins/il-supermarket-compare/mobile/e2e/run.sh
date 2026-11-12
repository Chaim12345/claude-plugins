#!/usr/bin/env bash
# Runs inside the emulator job: installs the APK, places the emulator in Ramat Gan, runs the
# Maestro flows and collects screenshots and the device log in e2e/out/.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/out"
apk="$here/../android/app/build/outputs/apk/release/app-release.apk"
mkdir -p "$out"

adb wait-for-device
adb install -r "$apk"
adb shell pm grant il.salzol.app android.permission.ACCESS_FINE_LOCATION || true
adb shell pm grant il.salzol.app android.permission.ACCESS_COARSE_LOCATION || true
# The emulator image ships with location services off; a phone user would have them on.
adb shell cmd location set-location-enabled true || true
adb shell settings put secure location_mode 3 || true
# Bialik St, Ramat Gan (longitude latitude). Keep sending fixes, as a real GPS does: Android's fused
# provider waits for a fresh one.
( while true; do adb emu geo fix 34.8140 32.0842 >/dev/null 2>&1; sleep 2; done ) &
geopid=$!
adb logcat -c
adb logcat -v time > "$out/logcat.txt" &
logpid=$!

status=0
cd "$out"
maestro test --format junit --output "$out/report.xml" "$here/1-geocode.yaml" "$here/2-gps-sync-cart.yaml" || status=$?

kill "$logpid" "$geopid" 2>/dev/null || true
# Screenshots land next to the flows or in Maestro's own test folder, depending on its version.
mkdir -p "$out/screens"
find "$here" -maxdepth 1 -name '*.png' -exec mv {} "$out/screens/" \; 2>/dev/null || true
find "$out" -maxdepth 1 -name '*.png' -exec mv {} "$out/screens/" \; 2>/dev/null || true
[ -d "$HOME/.maestro/tests" ] && cp -r "$HOME/.maestro/tests" "$out/maestro-tests" || true
grep -E "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS" "$out/logcat.txt" | tail -60 > "$out/logcat-app.txt" || true
if grep -q "FATAL EXCEPTION" "$out/logcat.txt"; then
  echo "The app crashed:"; grep -A20 "FATAL EXCEPTION" "$out/logcat.txt" | head -60
  status=1
fi
cat "$out/logcat-app.txt" | tail -30
exit $status

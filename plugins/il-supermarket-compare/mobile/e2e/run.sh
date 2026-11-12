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
adb emu geo fix 34.8140 32.0842   # longitude latitude: Bialik St, Ramat Gan
adb logcat -c
adb logcat -v time > "$out/logcat.txt" &
logpid=$!

status=0
cd "$out"
maestro test --format junit --output "$out/report.xml" --debug-output "$out/debug" "$here/1-geocode.yaml" "$here/2-gps-sync-cart.yaml" || status=$?

kill "$logpid" 2>/dev/null || true
grep -E "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS" "$out/logcat.txt" | tail -60 > "$out/logcat-app.txt" || true
if grep -q "FATAL EXCEPTION" "$out/logcat.txt"; then
  echo "The app crashed:"; grep -A20 "FATAL EXCEPTION" "$out/logcat.txt" | head -60
  status=1
fi
cat "$out/logcat-app.txt" | tail -30
exit $status

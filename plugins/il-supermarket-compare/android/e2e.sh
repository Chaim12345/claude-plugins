#!/usr/bin/env bash
# Runs the native app on an emulator: sets a place (Ramat Gan) through the launch extras, waits for the
# sync, and screenshots each tab. Output in android/out/.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/out"; mkdir -p "$out"
pkg=il.salzol.go
adb wait-for-device
adb install -r "$here/app/build/outputs/apk/release/app-release.apk" > "$out/install.txt" 2>&1
adb shell pm grant $pkg android.permission.POST_NOTIFICATIONS 2>/dev/null
adb logcat -c
adb shell am start -W -n $pkg/.MainActivity --ed lat 32.0842 --ed lon 34.814 --es place "ביאליק 50, רמת גן" > "$out/start.txt"
shot() { adb exec-out screencap -p > "$out/$1.png"; }
sleep 8; shot 1-syncing
for i in $(seq 1 60); do  # the sync: up to 5 minutes
  adb exec-out uiautomator dump /dev/tty 2>/dev/null | grep -q "מחירון אחרון" && break
  sleep 5
done
sleep 5; shot 2-home
for t in products deals cart more; do
  adb shell am start -n $pkg/.MainActivity --es tab $t > /dev/null; sleep 4; shot "3-$t"
done
adb shell am start -n $pkg/.MainActivity --es tab ai > /dev/null; sleep 3; shot 4-ai
adb logcat -d | grep -iE "salzol|AndroidRuntime|FATAL|GoLog" | tail -200 > "$out/logcat.txt"
adb shell dumpsys meminfo $pkg | head -30 > "$out/meminfo.txt"
grep -c FATAL "$out/logcat.txt" && echo "crash found" || echo "no crash"
exit 0

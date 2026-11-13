#!/usr/bin/env bash
# Runs the Compose UI test on the emulator: launches it, screenshots each self-test step, and keeps
# its timing log and the frame statistics. Output in research/ui-spikes/compose/out/.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/out"; mkdir -p "$out"
apk="$here/app/build/outputs/apk/release/app-release.apk"
pkg=il.salzol.spikeapp
adb wait-for-device
adb shell settings put system user_rotation 0
adb install -r "$apk" > "$out/install.txt" 2>&1
adb logcat -c
adb shell am start -W -n $pkg/.MainActivity > "$out/start.txt" 2>&1   # TotalTime = cold start
shot() { adb exec-out screencap -p > "$out/$1.png"; }
sleep 2;   shot 1-start
sleep 2.8; shot 2-search-cheese          # "גבינה צהובה"
sleep 1.8; shot 3-search-milk            # "חלב 3%"
sleep 1.8; shot 4-search-bamba           # "במבה"
for i in $(seq 1 60); do adb logcat -d -s SPIKE:I | grep -q "selftest done" && break; sleep 1; done
shot 5-after-scroll
adb logcat -d -s SPIKE:I > "$out/selftest.txt"
adb shell dumpsys gfxinfo $pkg > "$out/gfxinfo.txt"
adb shell dumpsys meminfo $pkg | head -40 > "$out/meminfo.txt"
cat "$out/start.txt" "$out/selftest.txt"
grep -E "Total frames|Janky|percentile" "$out/gfxinfo.txt" | head -8
exit 0

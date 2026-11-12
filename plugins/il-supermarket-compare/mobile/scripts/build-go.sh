#!/usr/bin/env bash
# Builds the Go sync engine (../core) into the native module.
#   Android: needs the Android SDK + NDK (ANDROID_HOME, ANDROID_NDK_HOME).
#   iOS:     needs macOS with Xcode.
# Usage: scripts/build-go.sh [android|ios|all]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
core="$here/../core"
mod="$here/modules/salzol-native"
target="${1:-all}"

command -v gomobile >/dev/null || { go install golang.org/x/mobile/cmd/gomobile@latest && gomobile init; }
cd "$core"
go get golang.org/x/mobile/bind >/dev/null 2>&1 || true

if [[ "$target" == android || "$target" == all ]]; then
  gomobile bind -target=android -androidapi 24 -javapkg il.salzol.core -o "$mod/android/libs/salzol.aar" ./mobile
  echo "built $mod/android/libs/salzol.aar"
fi
if [[ "$target" == ios || "$target" == all ]]; then
  [[ "$(uname)" == Darwin ]] || { echo "iOS builds need macOS with Xcode"; exit 1; }
  rm -rf "$mod/ios/Frameworks/Salzol.xcframework"
  gomobile bind -target=ios -o "$mod/ios/Frameworks/Salzol.xcframework" ./mobile
  echo "built $mod/ios/Frameworks/Salzol.xcframework"
fi

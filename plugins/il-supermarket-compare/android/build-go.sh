#!/usr/bin/env bash
# Builds the Go engine (core/droid) into app/libs/salzol.aar for phones (arm64) and the emulator (x86_64).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export PATH="$PATH:$(go env GOPATH)/bin"
mkdir -p "$here/app/libs"
cd "$here/../core"
gomobile bind -target=android/arm64,android/amd64 -androidapi 26 -javapkg il.salzol.core -o "$here/app/libs/salzol.aar" ./droid
echo "built $here/app/libs/salzol.aar"

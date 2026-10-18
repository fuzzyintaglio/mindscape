#!/bin/bash
# Builds experiments/HelloMindscape.app on the dev Mac (Apple Silicon).
# Ad-hoc signed (the free local signature); no Apple Developer account.
set -euo pipefail
cd "$(dirname "$0")"
APP=../HelloMindscape.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O -target arm64-apple-macos14 -framework Cocoa -framework WebKit main.swift -o "$APP/Contents/MacOS/HelloMindscape"
codesign --force --sign - "$APP"
codesign --verify --strict --verbose=2 "$APP"

#!/bin/bash
# The MacBook app's update packages — pack.ps1's Mac twin. Runs on a Mac with the .NET 8 SDK and
# `dotnet tool install -g vpk` (the CI's package-macos job):
#
#   desktop-native/packaging/macos/pack.sh [--channel osx|osx-beta] [--out DIR]
#
#   1. build-app.sh --app-only: out/MasterSAT.app (universal dylib, island, Release build);
#   2. vpk pack: puts UpdateMac and sq.version into the bundle and signs it again (ad-hoc unless
#      MACOS_SIGN_IDENTITY is set; hardened runtime with velopack.entitlements). In DIR:
#      MasterSAT.Exam-<version>-<channel>-full.nupkg, releases.<channel>.json and
#      assets.<channel>.json — the feed, published beside the Windows one — plus a .pkg and a
#      Portable.zip;
#   3. MasterSAT-<version>.dmg from that packed .app: what /download offers. A student's first
#      copy must come from here — a DMG from build-app.sh alone has no UpdateMac and never updates.
#
# The channels are `osx` and `osx-beta` (UpdateChannel.feedChannel): one feed folder, two apps.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DN=$(cd "$HERE/../.." && pwd)
CHANNEL=osx
OUT="$HERE/out/velopack"
while [ $# -gt 0 ]; do
  case "$1" in
    --channel) CHANNEL="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done
case "$CHANNEL" in osx|osx-beta) ;; *) echo "channel must be osx or osx-beta"; exit 2 ;; esac
VERSION=${MS_APP_VERSION:-$(tr -d '[:space:]' < "$DN/VERSION")}
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION '$VERSION' is not x.y.z"; exit 2; }
command -v vpk >/dev/null || { echo "vpk is not installed (dotnet tool install -g vpk)"; exit 1; }

echo "== MasterSAT for macOS $VERSION, channel $CHANNEL"
MS_APP_VERSION="$VERSION" "$HERE/build-app.sh" --app-only
APP="$HERE/out/MasterSAT.app"

echo "== vpk pack"
rm -rf "$OUT"
mkdir -p "$OUT"
vpk pack \
  --packId MasterSAT.Exam \
  --packVersion "$VERSION" \
  --packDir "$APP" \
  --mainExe MasterSAT \
  --packTitle MasterSAT \
  --packAuthors MasterSAT \
  --channel "$CHANNEL" \
  --outputDir "$OUT" \
  --signAppIdentity "${MACOS_SIGN_IDENTITY:--}" \
  --signEntitlements "$HERE/velopack.entitlements"
ls -la "$OUT"

echo "== the packed app, checked"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ditto -x -k "$(ls "$OUT"/*-Portable.zip)" "$STAGE/unzipped"
PACKED=$(find "$STAGE/unzipped" -maxdepth 2 -name '*.app' -type d | head -1)
[ -n "$PACKED" ] || { echo "no .app in the portable zip"; exit 1; }
[ -x "$PACKED/Contents/MacOS/UpdateMac" ] || { echo "the packed app has no UpdateMac"; exit 1; }
[ -e "$PACKED/Contents/MacOS/sq.version" ] || { echo "the packed app has no sq.version"; exit 1; }
grep -q "<version>$VERSION</version>" "$PACKED/Contents/MacOS/sq.version" || { echo "sq.version is not $VERSION"; exit 1; }
codesign --verify --deep --strict "$PACKED"
codesign -dv "$PACKED" 2>&1 | grep -E "^(Signature|CodeDirectory)" || true
echo "   $(lipo -archs "$PACKED/Contents/MacOS/MasterSAT") / UpdateMac $(lipo -archs "$PACKED/Contents/MacOS/UpdateMac")"

echo "== disk image"
mkdir -p "$STAGE/dmg"
ditto "$PACKED" "$STAGE/dmg/MasterSAT.app"
ln -s /Applications "$STAGE/dmg/Applications"
hdiutil create -volname "MasterSAT $VERSION" -srcfolder "$STAGE/dmg" -ov -format UDZO "$OUT/MasterSAT-$VERSION.dmg" >/dev/null
hdiutil verify "$OUT/MasterSAT-$VERSION.dmg" >/dev/null
ls -la "$OUT"
echo "done: $OUT"

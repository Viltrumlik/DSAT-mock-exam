#!/usr/bin/env bash
# Build the universal macOS MasterSAT.app (Apple Silicon + Intel) and sign it.
#
#   desktop-native/packaging/macos/build-app.sh <version> <build-number> <out-dir>
#
# Steps, the macOS counterpart of the Windows job in .github/workflows/desktop-native.yml:
#   1. mastersat_native.dylib for aarch64 AND x86_64 (release, `updates`, the proof key if set),
#      lipo'd into one universal dylib;
#   2. the island pages (npm run build);
#   3. flutter build macos --release (the Flutter engine + Runner are already universal);
#   4. embed the dylib (Contents/Frameworks) and the island (Contents/Resources/island);
#   5. prove both the exe and the dylib are universal and the dylib carries no development key;
#   6. codesign - Developer ID + hardened runtime when MACOS_SIGN_IDENTITY is set, else ad-hoc.
#
# Nothing here reaches production (the app opens on the sign-in screen and makes no request).
set -euo pipefail

VERSION="${1:?version}"
BUILD_NUMBER="${2:?build number}"
OUT="${3:?out dir}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
mkdir -p "$OUT"

echo "::group::mastersat_native.dylib (universal)"
pushd "$ROOT/desktop-native/native" >/dev/null
rustup target add aarch64-apple-darwin x86_64-apple-darwin
# Compile the native dylib against a macOS 12.0 floor (Flutter 3.47 / Xcode 27's minimum) so both
# the Intel and Apple-Silicon slices load on macOS 12 and every later release, including Sequoia.
export MACOSX_DEPLOYMENT_TARGET=12.0
# DESKTOP_PROOF_KEY (key_id:hex) is embedded when present; without it a release build has NO key
# and refuses midterms (ms_prove -> MS_ERR_NO_KEY), exactly like the Windows build.
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  cargo build --release --locked -p mastersat-native --target "$target" --features updates
done
DYLIB="$OUT/libmastersat_native.dylib"
lipo -create \
  "target/aarch64-apple-darwin/release/libmastersat_native.dylib" \
  "target/x86_64-apple-darwin/release/libmastersat_native.dylib" \
  -output "$DYLIB"
lipo -archs "$DYLIB"
# The development key must never ship in a release dylib.
if strings "$DYLIB" | grep -q "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"; then
  echo "::error::the release dylib carries the development proof key"; exit 1
fi
popd >/dev/null
echo "::endgroup::"

echo "::group::island"
pushd "$ROOT/desktop-native/island" >/dev/null
npm ci
npm run build
test -f build/island/content.html
test -f build/island/desmos.html
popd >/dev/null
echo "::endgroup::"

echo "::group::flutter build macos --release"
pushd "$ROOT/desktop-native/app" >/dev/null
flutter --version
flutter pub get
flutter build macos --release \
  --build-name "$VERSION" --build-number "$BUILD_NUMBER" \
  --dart-define=MASTERSAT_APP_VERSION="$VERSION"
APP="$ROOT/desktop-native/app/build/macos/Build/Products/Release/MasterSAT.app"
test -d "$APP" || { echo "::error::MasterSAT.app was not built"; exit 1; }
popd >/dev/null
echo "::endgroup::"

echo "::group::embed dylib + island"
mkdir -p "$APP/Contents/Frameworks"
cp "$DYLIB" "$APP/Contents/Frameworks/libmastersat_native.dylib"
install_name_tool -id "@rpath/libmastersat_native.dylib" "$APP/Contents/Frameworks/libmastersat_native.dylib" || true
DEST_ISLAND="$APP/Contents/Resources/island"
if [ -d "$DEST_ISLAND" ]; then find "$DEST_ISLAND" -mindepth 1 -delete; fi
mkdir -p "$DEST_ISLAND"
cp -R "$ROOT/desktop-native/island/build/island/." "$DEST_ISLAND/"
echo "island files: $(find "$DEST_ISLAND" -type f | wc -l | tr -d ' ')"
echo "::endgroup::"

echo "::group::verify universal + wiring"
EXE="$APP/Contents/MacOS/MasterSAT"
for bin in "$EXE" "$APP/Contents/Frameworks/libmastersat_native.dylib"; do
  archs="$(lipo -archs "$bin")"
  echo "$bin -> $archs"
  case "$archs" in
    *arm64*x86_64*|*x86_64*arm64*) ;;
    *) echo "::error::$bin is not universal (got: $archs)"; exit 1 ;;
  esac
done
nm -gU "$APP/Contents/Frameworks/libmastersat_native.dylib" | grep -q "_ms_init" || { echo "::error::the dylib does not export ms_init"; exit 1; }
test -f "$APP/Contents/Resources/island/content.html" || { echo "::error::the island is missing from the app"; exit 1; }
echo "::endgroup::"

echo "::group::deployment target (diagnose + enforce a macOS 12 launch floor)"
# Sequoia 15.8.2 shows "You can't use this version ... with this version of macOS" even though we
# set MACOSX_DEPLOYMENT_TARGET = 12.0, which means the Flutter 3.47 / Xcode 27 toolchain stamped a
# newer minimum than we asked for. Print what actually landed (LaunchServices reads the app's
# LSMinimumSystemVersion; dyld reads each Mach-O's LC_BUILD_VERSION minos) so we can see the real
# floor, then pin LSMinimumSystemVersion back to 12.0.
PLIST="$APP/Contents/Info.plist"
echo "Xcode: $(xcodebuild -version 2>/dev/null | tr '\n' ' ')"
echo "macOS SDK: $(xcrun --show-sdk-version 2>/dev/null || true)"
echo "LSMinimumSystemVersion (as built): $(plutil -extract LSMinimumSystemVersion raw "$PLIST" 2>/dev/null || echo '?')"
for b in "$EXE" \
         "$APP/Contents/Frameworks/FlutterMacOS.framework/FlutterMacOS" \
         "$APP/Contents/Frameworks/App.framework/App" \
         "$APP/Contents/Frameworks/libmastersat_native.dylib"; do
  [ -e "$b" ] || continue
  echo "--- ${b##*Frameworks/} ($(basename "$b"))"
  otool -l "$b" 2>/dev/null | grep -A4 'LC_BUILD_VERSION' | grep -E 'platform|minos|sdk' || true
done
# Force the LaunchServices gate down to macOS 12.0 (codesign below re-seals the patched plist).
plutil -replace LSMinimumSystemVersion -string "12.0" "$PLIST"
echo "LSMinimumSystemVersion (enforced): $(plutil -extract LSMinimumSystemVersion raw "$PLIST" 2>/dev/null || echo '?')"
echo "::endgroup::"

echo "::group::codesign"
ENTITLEMENTS="$ROOT/desktop-native/app/macos/Runner/Release.entitlements"
if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
  echo "Developer ID: $MACOS_SIGN_IDENTITY (hardened runtime)"
  while IFS= read -r -d "" item; do
    codesign --force --timestamp --options runtime -s "$MACOS_SIGN_IDENTITY" "$item"
  done < <(find "$APP/Contents/Frameworks" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) -print0)
  codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" -s "$MACOS_SIGN_IDENTITY" "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
else
  echo "::warning::MACOS_SIGN_IDENTITY is not set - ad-hoc signing (not notarizable; opens with right-click > Open)"
  while IFS= read -r -d "" item; do
    codesign --force -s - "$item"
  done < <(find "$APP/Contents/Frameworks" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) -print0)
  codesign --force --options runtime --entitlements "$ENTITLEMENTS" -s - "$APP"
fi
echo "::endgroup::"

echo "::group::launch smoke test (runner macOS $(sw_vers -productVersion 2>/dev/null))"
# This runner is macOS 15, the same family as the user's 15.8.2, so a version/SDK rejection will
# reproduce here. dyld enforces each Mach-O's platform/minos when the binary is exec'd; open(1)
# routes through LaunchServices (the LSMinimumSystemVersion gate that showed the user the dialog).
set +e
echo "--- dyld: exec the universal binary directly ---"
"$EXE" >/tmp/ms_exec.out 2>&1 &
epid=$!; sleep 3; kill "$epid" 2>/dev/null; wait "$epid" 2>/dev/null
echo "exec rc=$?"; sed -n '1,20p' /tmp/ms_exec.out 2>/dev/null
echo "--- LaunchServices: open the bundle ---"
open -n -g "$APP" 2>/tmp/ms_open.err; echo "open rc=$?"
sed -n '1,20p' /tmp/ms_open.err 2>/dev/null
sleep 2; pkill -x MasterSAT 2>/dev/null
set -e
echo "::endgroup::"

echo "built $APP"

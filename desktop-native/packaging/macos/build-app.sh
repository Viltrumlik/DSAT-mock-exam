#!/bin/bash
# Builds the MacBook app (the Windows app's sibling — same Flutter app, macOS runner):
#
#   desktop-native/packaging/macos/build-app.sh            # → out/MasterSAT.app + out/MasterSAT-<version>.dmg
#   desktop-native/packaging/macos/build-app.sh --install  # … and copies it to /Applications
#   desktop-native/packaging/macos/build-app.sh --app-only # just out/MasterSAT.app (pack.sh)
#
# What a bare `flutter build macos` leaves out, and this adds:
#   * mastersat_native.dylib → Contents/Frameworks/ (FfiNativeBridge looks there; a release build
#     without it shows "MasterSAT needs to be installed again"). Universal (x86_64 + arm64) when
#     both Rust targets are installed (`rustup target add aarch64-apple-darwin`), else this Mac's.
#   * the question pages (island build) → Contents/Resources/island (bundledIslandSource).
#   * a signature over all of it: ad-hoc by default (runs on the Mac that built it); set
#     MACOS_SIGN_IDENTITY="Developer ID Application: …" for one other Macs accept (then notarize).
#
# The version is desktop-native/VERSION, as for Windows (MS_APP_VERSION overrides it for a test
# build). A DMG from here has no updater: what students install comes from pack.sh.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DN=$(cd "$HERE/../.." && pwd)
VERSION=${MS_APP_VERSION:-$(tr -d '[:space:]' < "$DN/VERSION")}
OUT="$HERE/out"
APP="$OUT/MasterSAT.app"
INSTALL=0
APP_ONLY=0
[ "${1:-}" = "--install" ] && INSTALL=1
[ "${1:-}" = "--app-only" ] && APP_ONLY=1

# shellcheck source=/dev/null
source "$DN/tool/env.sh" >/dev/null

echo "== MasterSAT for macOS $VERSION"
mkdir -p "$OUT"

echo "== 1/5 native library"
cd "$DN/native"
libs=()
installed=$(rustup target list --installed)
for target in x86_64-apple-darwin aarch64-apple-darwin; do
  if grep -qx "$target" <<<"$installed"; then
    cargo build --release --locked -p mastersat-native --target "$target"
    libs+=("$DN/native/target/$target/release/libmastersat_native.dylib")
  fi
done
[ ${#libs[@]} -gt 0 ] || { echo "no macOS Rust target installed"; exit 1; }
lipo -create "${libs[@]}" -output "$OUT/libmastersat_native.dylib"
install_name_tool -id @rpath/libmastersat_native.dylib "$OUT/libmastersat_native.dylib"
echo "   $(lipo -archs "$OUT/libmastersat_native.dylib")"

echo "== 2/5 question pages (island)"
cd "$DN/island"
[ -d node_modules ] || npm ci
npm run build --silent

echo "== 3/5 app"
cd "$DN/app"
flutter build macos --release --build-name "$VERSION" --dart-define=MASTERSAT_APP_VERSION="$VERSION"
rm -rf "$APP"
cp -R "$DN/app/build/macos/Build/Products/Release/MasterSAT.app" "$APP"
mkdir -p "$APP/Contents/Frameworks"
cp "$OUT/libmastersat_native.dylib" "$APP/Contents/Frameworks/"
rm -rf "$APP/Contents/Resources/island"
cp -R "$DN/island/build/island" "$APP/Contents/Resources/island"

echo "== 4/5 sign"
IDENTITY=${MACOS_SIGN_IDENTITY:--}
codesign --force --sign "$IDENTITY" "$APP/Contents/Frameworks/libmastersat_native.dylib"
codesign --force --sign "$IDENTITY" --entitlements "$DN/app/macos/Runner/Release.entitlements" "$APP"
codesign --verify --deep --strict "$APP"
echo "   signed ($([ "$IDENTITY" = - ] && echo ad-hoc || echo "$IDENTITY"))"
if [ $APP_ONLY = 1 ]; then
  echo "done: $APP"
  exit 0
fi

echo "== 5/5 disk image"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT/MasterSAT-$VERSION.dmg"
hdiutil create -volname "MasterSAT $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$OUT/MasterSAT-$VERSION.dmg" >/dev/null
rm -rf "$STAGE"
ls -la "$OUT/MasterSAT-$VERSION.dmg"

if [ $INSTALL = 1 ]; then
  echo "== install → /Applications/MasterSAT.app"
  rm -rf /Applications/MasterSAT.app
  cp -R "$APP" /Applications/MasterSAT.app
fi
echo "done: $APP"

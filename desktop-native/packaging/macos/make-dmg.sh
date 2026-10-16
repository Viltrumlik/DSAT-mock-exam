#!/usr/bin/env bash
# Wrap MasterSAT.app in a DMG (with the usual drag-to-Applications), and notarize + staple it
# when notary credentials are present.
#
#   desktop-native/packaging/macos/make-dmg.sh <MasterSAT.app> <out-dir> <version>
set -euo pipefail

APP="${1:?app}"
OUT="${2:?out dir}"
VERSION="${3:?version}"
mkdir -p "$OUT"
DMG="$OUT/MasterSAT-$VERSION.dmg"

# A fresh staging folder (the CI runner is ephemeral, so it needs no cleanup).
STAGING="$(mktemp -d)/MasterSAT"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "MasterSAT" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
echo "DMG: $DMG ($(du -h "$DMG" | cut -f1))"

# Notarize when the three secrets are set; otherwise the DMG is not notarized and the owner opens
# it with right-click > Open (or clears the quarantine attribute) on a test Mac.
if [ -n "${MACOS_NOTARY_APPLE_ID:-}" ] && [ -n "${MACOS_NOTARY_TEAM_ID:-}" ] && [ -n "${MACOS_NOTARY_PASSWORD:-}" ]; then
  echo "::group::notarize"
  xcrun notarytool submit "$DMG" \
    --apple-id "$MACOS_NOTARY_APPLE_ID" \
    --team-id "$MACOS_NOTARY_TEAM_ID" \
    --password "$MACOS_NOTARY_PASSWORD" \
    --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  echo "::endgroup::"
else
  echo "::warning::notary credentials not set - the DMG is not notarized"
fi

# Also publish the DMG at the stable name the app's update link points at.
cp "$DMG" "$OUT/MasterSAT.dmg"
echo "copied to $OUT/MasterSAT.dmg"

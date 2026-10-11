# Source this file before running flutter/dart for desktop-native:
#   source desktop-native/tool/env.sh
# It pins the side-by-side Flutter SDK the native app is built with (see ../.flutter-version).
# Do NOT use /usr/local/bin/flutter (3.41.9): the WebView2 texture plugin needs Flutter >= 3.44.
export FLUTTER_ROOT="${MASTERSAT_FLUTTER_ROOT:-/Users/macbook/development/flutter-3.47}"
export FLUTTER="$FLUTTER_ROOT/bin/flutter"
export DART="$FLUTTER_ROOT/bin/dart"
case ":$PATH:" in
  *":$FLUTTER_ROOT/bin:"*) ;;
  *) export PATH="$FLUTTER_ROOT/bin:$PATH" ;;
esac
# Keep analytics/prompts out of agent and CI runs.
export FLUTTER_SUPPRESS_ANALYTICS=true
export CI="${CI:-}"

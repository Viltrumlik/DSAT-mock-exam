// Which renderer the Windows runner started the engine with. The runner (windows/runner/
// main.cpp) picks Skia unless launched with `--impeller`, and tells Dart through an
// entrypoint argument `--ms-renderer=skia|impeller`; diagnostics and the S1 harness report it.

/// `skia`, `impeller`, or `unknown` (macOS development, tests).
String get launchRenderer => _renderer;
String _renderer = 'unknown';

/// Reads `--ms-renderer=…` from the launch arguments (call once, first thing in main).
void noteLaunchRenderer(List<String> args) {
  const prefix = '--ms-renderer=';
  for (final a in args) {
    if (a.startsWith(prefix)) {
      final v = a.substring(prefix.length).trim();
      if (v.isNotEmpty) _renderer = v;
    }
  }
}

// Picks the IslandHost implementation for this platform (architecture §2.6):
//
//   Windows        TextureIslandHost  (WebView2 in a Flutter texture, ms_webview2)
//   macOS          MacosIslandHost    (WKWebView, same protocol; the MacBook app and dev runs)
//   flutter test   FakeIslandHost     (and on any other platform)
//
// The runner and the engine only ever see IslandHost; they get their factory from
// [islandHostFactory] (or a test's own factory).
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'fake_island_host.dart';
import 'island_host.dart';
import 'macos_island_host.dart';
import 'texture_island_host.dart';

/// Which kind of host [islandHostFactory] builds.
enum IslandHostMode {
  /// WebView2 in a texture (Windows).
  texture,

  /// WKWebView (macOS development runner).
  macosDev,

  /// FakeIslandHost (tests, fixture mode, unsupported platforms).
  fake,
}

/// Tests and harnesses may replace the factory globally (null = decide by platform).
IslandHostFactory? islandHostFactoryOverride;

/// The mode for this process. `MS_ISLAND_HOST=fake` forces the fake in development builds; a
/// `flutter test` run (FLUTTER_TEST) always gets the fake.
IslandHostMode islandHostModeFor({TargetPlatform? platform, Map<String, String>? environment, bool? releaseMode}) {
  final env = environment ?? _environment();
  final release = releaseMode ?? kReleaseMode;
  if (env.containsKey('FLUTTER_TEST')) return IslandHostMode.fake;
  if (!release && env['MS_ISLAND_HOST'] == 'fake') return IslandHostMode.fake;
  return switch (platform ?? defaultTargetPlatform) {
    TargetPlatform.windows => IslandHostMode.texture,
    TargetPlatform.macOS => IslandHostMode.macosDev,
    _ => IslandHostMode.fake,
  };
}

/// The factory for this platform.
///
/// * Windows: `TextureIslandHost`. Development builds honour `MS_ISLAND_DIR` (serve the island
///   from that folder instead of `<exe dir>\data\island`); release builds never do.
/// * macOS: `MacosIslandHost` over [macosSource]. A release build uses only the island bundled
///   in the app (bundledIslandSource); a development run resolveDevIslandSource(), then the
///   bundled one (a test copy installed outside the repository).
IslandHostFactory islandHostFactory({
  IslandHostMode? mode,
  Map<String, String>? environment,
  IslandSource? macosSource,
  bool? releaseMode,
}) {
  final override = islandHostFactoryOverride;
  if (override != null) return override;
  final env = environment ?? _environment();
  final release = releaseMode ?? kReleaseMode;
  switch (mode ?? islandHostModeFor(environment: env, releaseMode: release)) {
    case IslandHostMode.texture:
      final dir = release ? null : env['MS_ISLAND_DIR'];
      final folder = dir != null && dir.trim().isNotEmpty ? dir.trim() : null;
      return (kind) => TextureIslandHost(kind, islandFolder: folder);
    case IslandHostMode.macosDev:
      final source = macosSource ??
          (release ? bundledIslandSource() : resolveDevIslandSource(environment: env) ?? bundledIslandSource());
      if (source == null) {
        return (kind) => MacosIslandHost.unavailable(
          kind,
          release
              ? 'this copy of MasterSAT has no question pages inside it; install it again'
              : 'build the island (cd desktop-native/island && npm ci && npm run build) '
                  'or set MS_ISLAND_DIR / MS_ISLAND_URL',
        );
      }
      return (kind) => MacosIslandHost(kind, source: source);
    case IslandHostMode.fake:
      return (kind) => FakeIslandHost(kind);
  }
}

Map<String, String> _environment() {
  try {
    return Platform.environment;
  } on UnsupportedError {
    return const {};
  }
}

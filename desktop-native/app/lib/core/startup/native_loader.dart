// Which NativeBridge this process runs on (the rust workstream's request):
//
//   Windows   FfiNativeBridge.open() — the mastersat_native.dll the runner already loaded.
//   macOS     the same, over the cargo-built dylib, when it exists (development).
//   else      FakeNativeBridge (development only).
//
// A RELEASE build never falls back to the fake bridge: without the DLL tokens could not be
// sealed with DPAPI and a midterm could not lock the machine. It shows [MissingPartApp] instead
// of starting — a plain native screen, not a crash.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../native/fake_native_bridge.dart';
import '../../native/ffi_native_bridge.dart';
import '../../native/native_bridge.dart';
import '../theme/app_theme.dart';
import '../theme/controls.dart';
import '../theme/tokens.dart';

/// What [loadNativeBridge] found.
@immutable
class NativeLoad {
  const NativeLoad._(this.bridge, this.problem, {this.isFake = false});

  /// The bridge to run on, or null when the app must not start ([problem] says why).
  final NativeBridge? bridge;

  /// Why the real library could not be used (diagnostics), or null.
  final String? problem;

  /// True when [bridge] is the development fake.
  final bool isFake;

  bool get canStart => bridge != null;
}

/// Opens the native library. [open] and [releaseMode] are injectable for tests.
NativeLoad loadNativeBridge({
  required String appVersion,
  NativeBridge Function()? open,
  bool releaseMode = kReleaseMode,
}) {
  try {
    final bridge = (open ?? () => FfiNativeBridge.open(devAppVersion: appVersion))();
    return NativeLoad._(bridge, null);
  } on Object catch (e) {
    // NativeLibraryUnavailable (no DLL / dylib), or a DLL that lacks a symbol (a broken
    // install). Development builds keep working on the fake; a shipped build stops here.
    final why = e is NativeLibraryUnavailable ? 'mastersat_native is not available: $e' : 'mastersat_native failed to load: $e';
    if (releaseMode) return NativeLoad._(null, why);
    return NativeLoad._(FakeNativeBridge(appVersion: appVersion), why, isFake: true);
  }
}

/// The download page the reinstall message points at.
final Uri reinstallUrl = Uri.parse('https://mastersat.uz');

/// Shown instead of the app when a release build cannot load mastersat_native.dll.
class MissingPartApp extends StatelessWidget {
  const MissingPartApp({super.key, this.detail, this.openUrl});

  /// Diagnostics (shown small, so a student can read it out to support).
  final String? detail;

  /// Opens the website (tests replace it).
  final Future<bool> Function(Uri url)? openUrl;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MasterSAT',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: MissingPartScreen(detail: detail, openUrl: openUrl),
    );
  }
}

class MissingPartScreen extends StatelessWidget {
  const MissingPartScreen({super.key, this.detail, this.openUrl});

  final String? detail;
  final Future<bool> Function(Uri url)? openUrl;

  static const title = 'MasterSAT needs to be installed again';
  static const message = 'A part of the app is missing, so it can’t start. Download MasterSAT again from '
      'mastersat.uz and install it — your saved work on this computer stays safe.';

  @override
  Widget build(BuildContext context) {
    final open = openUrl ?? (url) => launchUrl(url, mode: LaunchMode.externalApplication);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                EmptyState(
                  icon: LucideIcons.packageX,
                  title: title,
                  message: message,
                  actionLabel: 'Open mastersat.uz',
                  actionIcon: LucideIcons.externalLink,
                  onAction: () => open(reinstallUrl),
                ),
                if (detail != null) ...[
                  const SizedBox(height: 14),
                  Text(detail!, textAlign: TextAlign.center, style: AppText.caption),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// Real fonts in widget tests and goldens. flutter_test draws every glyph as a box (the
// "FlutterTest" font) unless fonts are loaded by hand.
//
// * Icons: every font in the test asset bundle's FontManifest (lucide_icons_flutter).
// * Text: the app asks for "Segoe UI" (Windows' system font, architecture §2.3).
//     - Windows: the real Segoe UI from C:\Windows\Fonts.
//     - macOS: Segoe UI is not installed (and not redistributable); its open metric-compatible
//       twin Selawik is not installed either, so the system Arial is loaded under the
//       "Segoe UI" family name. Arial is a few percent narrower than Segoe UI at the same size,
//       so a line can break slightly differently from Windows; overflow, clipping and overlap
//       still show.
//     - Linux: Liberation Sans or DejaVu Sans when present.
//   Without any of these, text stays in the test font.
// * Goldens are recorded and compared on macOS only ([goldensSupported]).
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

const _macArial = '/System/Library/Fonts/Supplemental';

/// The faces standing in for (or being) Segoe UI on this machine.
List<File> _segoeFaces() {
  if (Platform.isWindows) {
    final dir = '${Platform.environment['WINDIR'] ?? r'C:\Windows'}\\Fonts';
    return [for (final f in ['segoeui.ttf', 'segoeuib.ttf', 'seguisb.ttf', 'segoeuii.ttf']) File('$dir\\$f')];
  }
  if (Platform.isMacOS) {
    return [for (final f in ['Arial.ttf', 'Arial Bold.ttf', 'Arial Italic.ttf', 'Arial Bold Italic.ttf']) File('$_macArial/$f')];
  }
  return [
    for (final f in [
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    ])
      File(f),
  ];
}

/// The time-zone offset the goldens were recorded in (Asia/Tashkent, like the students): a few
/// labels are local times ("updated 14:00", "Opens Oct 12").
const goldenTimeZoneOffset = Duration(hours: 5);

/// Goldens are compared only where they were recorded: macOS with the system Arial, in the
/// recording time zone.
bool get goldensSupported =>
    Platform.isMacOS &&
    File('$_macArial/Arial.ttf').existsSync() &&
    DateTime.now().timeZoneOffset == goldenTimeZoneOffset;

/// Why goldens are skipped elsewhere.
String? get goldenSkipReason => goldensSupported
    ? null
    : 'Goldens are recorded on macOS (system Arial standing in for Segoe UI) at UTC+5; font '
        'rasterisation and local-time labels differ elsewhere.';

bool _loaded = false;

/// Loads the icon fonts and Segoe UI (or its stand-in) once per test isolate.
Future<void> loadAppFonts() async {
  if (_loaded) return;
  _loaded = true;

  final manifest = jsonDecode(await rootBundle.loadString('FontManifest.json')) as List<Object?>;
  for (final entry in manifest.cast<Map<String, Object?>>()) {
    final loader = FontLoader(entry['family']! as String);
    for (final font in (entry['fonts']! as List<Object?>).cast<Map<String, Object?>>()) {
      loader.addFont(rootBundle.load(font['asset']! as String));
    }
    await loader.load();
  }

  final faces = _segoeFaces().where((f) => f.existsSync()).toList();
  if (faces.isEmpty) return;
  for (final family in const ['Segoe UI', 'Arial']) {
    final loader = FontLoader(family);
    for (final f in faces) {
      loader.addFont(Future.value(ByteData.sublistView(f.readAsBytesSync())));
    }
    await loader.load();
  }
}

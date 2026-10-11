// Loads Segoe UI (or its stand-in) and the icon font before every test in this folder, so
// layouts are measured with real glyphs (see test/core/harness/fonts.dart).
import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter_test/flutter_test.dart';

import '../../core/harness/fonts.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Every test opens its own in-memory database on purpose.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  await loadAppFonts();
  await testMain();
}

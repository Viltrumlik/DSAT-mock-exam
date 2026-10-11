// Every test folder without its own flutter_test_config.dart: on CI, goldens tolerate a tiny
// anti-aliasing drift (see ci_golden_tolerance.dart). Nothing else changes.
import 'dart:async';

import 'ci_golden_tolerance.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  useCiGoldenTolerance();
  await testMain();
}

// Golden tolerance on CI only.
//
// The goldens are recorded on a developer's Mac. CI's macOS runner draws the same frames with
// the same fonts, but its anti-aliasing occasionally differs by a few dozen pixels (run
// 38147057274: midterm_offscreen_warning.png, 53 px = 0.01 %). On CI (CI=true, which GitHub
// Actions sets) a golden passes when at most 0.1 % of its pixels differ, and every such pass is
// printed so the drift stays visible. A different image size still fails. Locally (CI unset,
// as tool/env.sh leaves it) comparisons stay exact, so a real 1-2 px layout change is still
// caught where goldens are recorded.
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// The share of pixels a golden may differ by on CI (0.001 = 0.1 %).
const double ciGoldenTolerance = 0.001;

/// Whether this run is on CI.
bool get isCiRun => (Platform.environment['CI'] ?? '').toLowerCase() == 'true';

/// Call first in a `flutter_test_config.dart`: on CI, wraps the per-file [LocalFileComparator]
/// the test runner installed with one that tolerates [ciGoldenTolerance]. No-op locally.
void useCiGoldenTolerance() {
  final current = goldenFileComparator;
  if (!isCiRun || current is! LocalFileComparator || current is CiTolerantGoldenComparator) return;
  // basedir is the test file's folder; any file name in it gives the same basedir.
  goldenFileComparator = CiTolerantGoldenComparator(current.basedir.resolve('flutter_test_config.dart'));
}

/// [LocalFileComparator] that passes a golden differing in at most [tolerance] of its pixels.
class CiTolerantGoldenComparator extends LocalFileComparator {
  CiTolerantGoldenComparator(super.testFile, {this.tolerance = ciGoldenTolerance});

  final double tolerance;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final result = await GoldenFileComparator.compareLists(imageBytes, await getGoldenBytes(golden));
    if (result.passed) {
      result.dispose();
      return true;
    }
    if (result.diffPercent <= tolerance) {
      debugPrint(
        'golden $golden: ${(result.diffPercent * 100).toStringAsFixed(3)} % of pixels differ '
        '(CI tolerance ${(tolerance * 100).toStringAsFixed(1)} %) - passed',
      );
      result.dispose();
      return true;
    }
    final error = await generateFailureOutput(result, golden, basedir);
    result.dispose();
    throw FlutterError(error);
  }
}

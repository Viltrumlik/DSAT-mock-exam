// A tour of every non-exam screen in the REAL app on the macOS dev runner (real engine, real
// system fonts, runMasterSat with the in-process fixture API), saving a PNG of each screen as
// the engine drew it. This is the visual check that does not depend on the test font loader.
//
//   source desktop-native/tool/env.sh && cd desktop-native/app
//   flutter test integration_test/app_core_tour_test.dart -d macos
//
// The PNGs land in the app container's temp folder (the macOS runner is sandboxed); the path
// is printed at the end. Copy them to test/screenshots/ (gitignored) to look at them.
import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/library/history_dialog.dart';
import 'package:mastersat_app/features/library/pastpaper_model.dart';
import 'package:mastersat_app/features/signin/sign_in_screen.dart';
import 'package:mastersat_app/main.dart' as app;

const _size = Size(1280, 820);

Future<void> _settle(WidgetTester tester, [int frames = 20]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('tour: sign-in → Home → library → history → result → settings → midterm result', (tester) async {
    tester.view.physicalSize = _size;
    tester.view.devicePixelRatio = 1;

    // Start clean: no stored session from an earlier run.
    final paths = await AppPaths.resolve();
    for (final f in [paths.authFile, paths.pendingSignInFile]) {
      if (f.existsSync()) f.deleteSync();
    }

    final out = await Directory.systemTemp.createTemp('mastersat-tour-');
    var n = 0;
    Future<void> shot(String name) async {
      await _settle(tester);
      final view = tester.binding.renderViews.first;
      final layer = view.debugLayer! as OffsetLayer;
      final image = await layer.toImage(Offset.zero & _size);
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      n++;
      File('${out.path}/${n.toString().padLeft(2, '0')}_$name.png').writeAsBytesSync(png!.buffer.asUint8List());
    }

    await app.runMasterSat();
    await _settle(tester, 40);
    expect(find.byType(SignInScreen), findsOneWidget);
    await shot('signin');

    // Navigation goes through the app's own entry points rather than synthesized clicks: on
    // the live macOS window real mouse events race synthesized ones. The buttons themselves
    // are covered by test/features/home/every_button_sweep_test.dart.
    final services = AppScope.of(tester.element(find.byType(Navigator)));
    final nav = services.navigatorKey.currentState!;
    BuildContext ctx() => services.navigatorKey.currentContext!;

    await services.auth.signIn(); // debug + in-process fixtures: no browser trip
    await _settle(tester, 40);
    expect(find.byType(HomeScreen), findsOneWidget);
    await shot('home');

    await tester.ensureVisible(find.text('OCTOBER 2025'));
    await shot('library');

    services.library.setQuery('august');
    await shot('library_search');
    services.library.clear();
    await _settle(tester);

    final paper = services.home.home!.pastpapers.firstWhere((p) => p.id == 43);
    unawaited(showHistory(ctx(), paper));
    await shot('history');
    nav.pop();
    await _settle(tester);

    unawaited(openPastpaperResult(ctx(), attemptId: 8801, paper: paper));
    await shot('result_pastpaper');
    nav.pop();
    await _settle(tester);

    unawaited(openSettings(ctx()));
    await shot('settings');
    nav.pop();
    await _settle(tester);

    final midterm = services.home.home!.midterms.firstWhere((m) => m.midtermId == 9);
    unawaited(openMidtermResult(ctx(), row: midterm));
    await shot('result_midterm');
    nav.pop();
    await _settle(tester);

    // The real runner now (the integrator wired the launcher); its own tour, with the island,
    // is integration_test/wired_app_tour_test.dart.
    unawaited(openExam(ctx(), PastpaperExamRequest(paper: services.home.home!.pastpapers.first, action: PaperAction.start)));
    await shot('exam_runner');
    nav.pop();
    await _settle(tester);

    await services.auth.signOut();
    await _settle(tester, 30);
    expect(find.byType(SignInScreen), findsOneWidget);

    debugPrint('MASTERSAT_TOUR_DIR=${out.path}');
  });
}

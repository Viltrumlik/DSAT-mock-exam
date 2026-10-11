// The WIRED app on the macOS dev runner: runMasterSat with the real exam launcher, the real
// engine and database, the in-process fixture API, and the REAL island (island/build/island)
// in WKWebView through MacosIslandHost. Saves a PNG of each screen:
//
//   home · runner_rw (a Reading & Writing question) · welcome_math · runner_math (KaTeX) ·
//   runner_math_figure (a question image) · check_your_work · result · review ·
//   midterm_rules
//
//   cd desktop-native/island && npm ci && npm run build      (once)
//   source desktop-native/tool/env.sh && cd desktop-native/app
//   flutter test integration_test/wired_app_tour_test.dart -d macos
//
// Each frame is Flutter's own layer (OffsetLayer.toImage) with the islands' WKWebView
// snapshots (macos/Runner/MainFlutterWindow.swift "mastersat/dev_capture") drawn into their
// rectangles: this Mac gives no Screen Recording permission, and a platform view is not in
// Flutter's layer. The PNGs land in the sandboxed app's temp folder; the path is printed
// (MASTERSAT_WIRED_TOUR_DIR=…).
//
// Navigation goes through the app's own entry points (openExam, the engine's actions), not
// synthesized clicks: on the live window real mouse events race synthesized ones. The buttons
// are covered by the widget tests (test/integration/**, the every-button sweeps).
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/core/store/app_paths.dart';
import 'package:mastersat_app/exam/launch/exam_launcher.dart';
import 'package:mastersat_app/exam/launch/pastpaper_sitting.dart';
import 'package:mastersat_app/exam/runner/runner.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/library/pastpaper_model.dart';
import 'package:mastersat_app/features/results/pastpaper_result_screen.dart';
import 'package:mastersat_app/island/island_host_factory.dart';
import 'package:mastersat_app/main.dart' as app;

const _capture = MethodChannel('mastersat/dev_capture');

Future<void> _wait(WidgetTester tester, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    await tester.pump();
  }
}

Future<void> _until(WidgetTester tester, bool Function() ok, {Duration within = const Duration(seconds: 20), String? what}) async {
  final end = DateTime.now().add(within);
  while (!ok()) {
    if (DateTime.now().isAfter(end)) throw TimeoutException('not reached: ${what ?? 'condition'}', within);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    await tester.pump();
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('wired tour: Home → past papers on the real island → result → review → midterm rules', (tester) async {
    final paths = await AppPaths.resolve();
    for (final f in [paths.authFile, paths.pendingSignInFile]) {
      if (f.existsSync()) f.deleteSync();
    }
    // A clean exam database: earlier runs' sittings would resume instead of starting.
    for (final f in Directory(paths.root).listSync().whereType<File>()) {
      if (f.path.contains('${Platform.pathSeparator}exam-')) f.deleteSync();
    }
    await _capture.invokeMethod<bool>('setContentSize', {'width': 1366, 'height': 768});

    final out = await Directory.systemTemp.createTemp('mastersat-wired-tour-');
    var n = 0;
    Future<void> shot(String name) async {
      await _wait(tester, const Duration(milliseconds: 600));
      final view = tester.binding.renderViews.first;
      final fv = view.flutterView;
      final physical = fv.physicalSize;
      final dpr = fv.devicePixelRatio;
      final layer = view.debugLayer! as OffsetLayer;
      final base = await layer.toImage(Offset.zero & physical);
      final shots = await _capture.invokeListMethod<Map<Object?, Object?>>('snapshotWebViews') ?? const [];
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);
      canvas.drawImage(base, Offset.zero, Paint());
      for (final s in shots) {
        final bytes = s['png']! as Uint8List;
        final img = await decodeImageFromList(bytes);
        double d(String k) => (s[k]! as num).toDouble();
        canvas.drawImageRect(
          img,
          Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
          Rect.fromLTWH(d('x') * dpr, d('y') * dpr, d('width') * dpr, d('height') * dpr),
          Paint()..filterQuality = FilterQuality.high,
        );
      }
      final image = await recorder.endRecording().toImage(physical.width.round(), physical.height.round());
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      n++;
      final file = File('${out.path}/${n.toString().padLeft(2, '0')}_$name.png');
      file.writeAsBytesSync(png!.buffer.asUint8List());
      debugPrint('shot $name: ${physical.width.round()}x${physical.height.round()} @${dpr}x, ${shots.length} web view(s)');
    }

    // The real island in WKWebView, whatever the process environment says.
    await app.runMasterSat(
      examLauncher: ExamLauncherWiring(islandFactory: islandHostFactory(mode: IslandHostMode.macosDev)).call,
    );
    await _wait(tester, const Duration(seconds: 2));
    final services = AppScope.of(tester.element(find.byType(Navigator)));
    BuildContext ctx() => services.navigatorKey.currentContext!;

    await services.auth.signIn(); // debug + in-process fixtures: no browser trip
    await _until(tester, () => find.byType(HomeScreen).evaluate().isNotEmpty && services.home.home != null, what: 'Home');
    await _until(tester, () => services.exams?.runtime != null, what: 'the exam runtime');
    await shot('home');

    ExamRunnerScreenState runner() => tester.state<ExamRunnerScreenState>(find.byType(ExamRunnerScreen));
    Future<void> islandShowing(int qid) => _until(
          tester,
          () =>
              find.byType(ExamRunnerScreen).evaluate().isNotEmpty &&
              runner().bridge.ready &&
              runner().bridge.shownQuestionId == qid,
          within: const Duration(seconds: 30),
          what: 'the island showing question $qid',
        );

    // ---- Reading & Writing: practice test 51, resumed in module 1 -------------------------
    final rw = services.home.home!.pastpapers.firstWhere((p) => p.id == 51);
    unawaited(openExam(ctx(), PastpaperExamRequest(paper: rw, action: PaperAction.resume)));
    await _until(tester, () => find.byType(ExamRunnerScreen).evaluate().isNotEmpty, what: 'the R&W runner');
    final rwEngine = tester.widget<PastpaperSittingScreen>(find.byType(PastpaperSittingScreen)).engine;
    await _until(tester, () => rwEngine.phase == ExamPhase.running, what: 'R&W running');
    await islandShowing(rwEngine.currentQuestion.id);
    await _wait(tester, const Duration(seconds: 1)); // KaTeX / fonts settle in the page
    await shot('runner_rw');
    await rwEngine.saveAndExit();
    await _until(tester, () => find.byType(PastpaperSittingScreen).evaluate().isEmpty, what: 'back Home');

    // ---- Math: practice test 52, fresh → Welcome → running ---------------------------------
    final math = services.home.home!.pastpapers.firstWhere((p) => p.id == 52);
    unawaited(openExam(ctx(), PastpaperExamRequest(paper: math, action: PaperAction.start)));
    await _until(tester, () => find.byKey(const ValueKey('welcome.start')).evaluate().isNotEmpty, what: 'Welcome');
    await shot('welcome_math');
    final mathEngine = tester.widget<PastpaperSittingScreen>(find.byType(PastpaperSittingScreen)).engine;
    await mathEngine.start();
    await islandShowing(mathEngine.currentQuestion.id);
    await _wait(tester, const Duration(seconds: 1));
    await shot('runner_math');
    // Question 4 carries a figure (an image through media.put).
    mathEngine.goTo(3);
    await islandShowing(mathEngine.currentQuestion.id);
    await _wait(tester, const Duration(seconds: 1));
    await shot('runner_math_figure');

    mathEngine.openReview();
    await _until(tester, () => find.text('Check Your Work').evaluate().isNotEmpty, what: 'Check Your Work');
    await shot('check_your_work');

    // Module 1 handed in → module 2 → handed in → the result (openExam opens it).
    await mathEngine.submitModule();
    await _until(tester, () => mathEngine.moduleOrder == 2 && mathEngine.phase == ExamPhase.running, what: 'module 2');
    mathEngine.openReview();
    await mathEngine.submitModule();
    await _until(tester, () => find.byType(PastpaperResultScreen).evaluate().isNotEmpty,
        within: const Duration(seconds: 30), what: 'the result');
    await _until(tester, () => find.text('Review questions').evaluate().isNotEmpty,
        within: const Duration(seconds: 30), what: 'the scored result');
    await shot('result');

    // ---- Review questions: the island in review mode ---------------------------------------
    final attemptId = mathEngine.attemptId;
    final result = await services.api.pastpaperResult(attemptId);
    unawaited(openExam(ctx(), ReviewExamRequest(result: result, paper: math, questionId: result.questions.first.id)));
    await _wait(tester, const Duration(seconds: 4));
    await shot('review');
    services.navigatorKey.currentState!.popUntil((r) => r.isFirst);
    await _wait(tester, const Duration(seconds: 1));

    // ---- Midterm 14: the rules screen -------------------------------------------------------
    final midterm = services.home.home!.midterms.firstWhere((m) => m.midtermId == 14);
    unawaited(openExam(ctx(), MidtermExamRequest(midterm: midterm)));
    await _until(tester, () => find.text("I'm ready — continue").evaluate().isNotEmpty, what: 'midterm rules');
    await shot('midterm_rules');
    services.navigatorKey.currentState!.popUntil((r) => r.isFirst);
    await _wait(tester, const Duration(seconds: 1));

    debugPrint('MASTERSAT_WIRED_TOUR_DIR=${out.path}');
  });
}

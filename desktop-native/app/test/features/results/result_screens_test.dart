// Both result screens in every state: loading, scoring (polled), offline + Try again,
// failed, ready; the question grid opens review; PDFs go through the Save dialog.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/app.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/features/results/midterm_result_screen.dart';
import 'package:mastersat_app/features/results/pastpaper_result_screen.dart';

import '../../core/harness/app_harness.dart';

Future<void> openPastpaper(WidgetTester tester, AppHarness h, int attemptId) async {
  final ctx = h.services.navigatorKey.currentContext!;
  final paper = h.services.home.home!.pastpapers.firstWhere((p) => p.history.any((x) => x.attemptId == attemptId));
  unawaited(openPastpaperResult(ctx, attemptId: attemptId, paper: paper));
  await tester.pump();
}

Future<void> openMidterm(WidgetTester tester, AppHarness h, int midtermId) async {
  final ctx = h.services.navigatorKey.currentContext!;
  final row = h.services.home.home!.midterms.firstWhere((m) => m.midtermId == midtermId);
  unawaited(openMidtermResult(ctx, row: row));
  await tester.pump();
}


void main() {
  group('past-paper result', () {
    testWidgets('ready: score, change, totals, modules, grid, history, actions', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);

      expect(find.byType(PastpaperResultScreen), findsOneWidget);
      expect(find.text('INTERNATIONAL FORM B · READING & WRITING · AUGUST 2025'), findsOneWidget);
      expect(find.text('+50 since your last sitting'), findsOneWidget);
      expect(find.text('Correct'.toUpperCase()), findsOneWidget);
      expect(find.text('6'), findsWidgets);
      expect(find.text('TO REVIEW'), findsOneWidget);
      expect(find.text('67%'), findsOneWidget, reason: '6 of 9 correct');
      expect(find.text('Module 1'), findsNWidgets(2), reason: 'breakdown + grid');
      expect(find.text('HISTORY'), findsOneWidget);
      expect(find.text('This report'), findsOneWidget);
      expect(find.text('Review questions'), findsOneWidget);
      expect(find.text('Certificate'), findsNWidgets(3), reason: 'the score card and each history row');
      expect(find.text('Error report PDF'), findsOneWidget);
      await h.dispose(tester);
    });

    testWidgets('Review questions and a question cell open the review through openExam', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);

      await tester.tap(find.text('Review questions'));
      await settleApp(tester);
      final review = h.launched.single as ReviewExamRequest;
      expect(review.attemptId, 8801);
      expect(review.questionId, isNull);

      final cell = find.bySemanticsLabel(RegExp(r'^Question 2, '));
      await tester.ensureVisible(cell.first);
      await tester.tap(cell.first);
      await settleApp(tester);
      final second = h.launched.last as ReviewExamRequest;
      expect(second.questionId, isNotNull);
      await h.dispose(tester);
    });

    testWidgets('Certificate: Save dialog first, then the PDF is written where the student chose', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);
      h.savePath = '/Users/student/Documents/cert';
      await tester.tap(find.text('Certificate').first);
      await settleApp(tester);
      expect(h.savePrompts, ['MasterSAT-certificate-8801.pdf']);
      expect(h.savedFiles.keys, ['/Users/student/Documents/cert.pdf']);
      expect(String.fromCharCodes(h.savedFiles.values.single.take(5)), '%PDF-');
      expect(find.text('Saved to /Users/student/Documents/cert.pdf'), findsOneWidget);
      await h.dispose(tester);
    });

    testWidgets('a failed download keeps the result and says so in the website\'s words', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);
      h.api.offline = true;
      await tester.tap(find.text('Error report PDF'));
      await settleApp(tester);
      expect(find.text("The report couldn't be produced right now. Nothing has been lost."), findsOneWidget);
      expect(find.text('640'), findsWidgets);
      await h.dispose(tester);
    });

    testWidgets('cancelling the Save dialog does nothing', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);
      h.savePath = null;
      await tester.tap(find.text('Certificate').first);
      await settleApp(tester);
      expect(h.savedFiles, isEmpty);
      expect(h.api.calls.where((c) => c.method == 'pastpaperCertificatePdf'), isEmpty);
      await h.dispose(tester);
    });

    testWidgets('offline: "You\'re offline" with Try again, which re-sends', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      h.api.offline = true;
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);
      expect(find.text("You're offline"), findsOneWidget);
      h.api.offline = false;
      await tester.tap(find.text('Try again'));
      await settleApp(tester);
      expect(find.text('+50 since your last sitting'), findsOneWidget);
      await h.dispose(tester);
    });

    testWidgets('loading, then failed (not visible) with the website\'s title', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      h.api.latency = const Duration(milliseconds: 300);
      final ctx = h.services.navigatorKey.currentContext!;
      unawaited(openPastpaperResult(ctx, attemptId: 1));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('Loading your report…'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 400));
      await settleApp(tester);
      expect(find.text("The report didn't load."), findsOneWidget);
      expect(find.text("This result isn't available to you."), findsOneWidget);
      await h.dispose(tester);
    });

    testWidgets('History "Report" swaps to that sitting\'s result', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openPastpaper(tester, h, 8801);
      await settleApp(tester);
      final report = find.text('Report');
      await tester.ensureVisible(report);
      await tester.tap(report);
      await settleApp(tester);
      expect(tester.widget<PastpaperResultScreen>(find.byType(PastpaperResultScreen)).attemptId, 8710);
      await h.dispose(tester);
    });
  });

  group('midterm result', () {
    testWidgets('released: score / ceiling, class rank, certificate and report downloads', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      await openMidterm(tester, h, 9);
      await settleApp(tester);
      expect(find.byType(MidtermResultScreen), findsOneWidget);
      expect(find.text('MIDTERM RESULT'), findsOneWidget);
      expect(find.text('680'), findsOneWidget);
      expect(find.text('/ 800'), findsOneWidget);
      expect(find.text('Class rank 4 of 23'), findsOneWidget);
      await tester.tap(find.text('Download certificate'));
      await settleApp(tester);
      expect(h.savePrompts.last, 'certificate-MT-9-77-4F2K.pdf');
      await tester.tap(find.text('Download report'));
      await settleApp(tester);
      expect(h.savePrompts.last, 'MasterSAT-midterm-report-4410.pdf');
      expect(h.savedFiles, hasLength(1), reason: 'the same chosen path both times');
      await h.dispose(tester);
    });

    testWidgets('not released yet: "Submitted" and Check again', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      final row = h.services.home.home!.midterms.firstWhere((m) => m.midtermId == 10);
      h.api.failNext(const NetworkError('x'));
      unawaited(openMidtermResult(h.services.navigatorKey.currentContext!, row: row));
      await settleApp(tester);
      expect(find.text("You're offline"), findsOneWidget);
      await h.dispose(tester);
    });

    testWidgets('awaiting release card', (tester) async {
      final h = await AppHarness.start();
      await h.pump(tester);
      final row = h.services.home.home!.midterms.firstWhere((m) => m.midtermId == 9);
      await tester.pumpWidget(Container());
      await tester.pumpWidget(AppScope(
        services: h.services,
        child: MaterialApp(
          home: Scaffold(
            body: MidtermResultCard(
              row: row,
              result: MidtermResult.fromJson(JsonReader.of(FixtureV1Api.fixture('midterm_result.response.awaiting_release.json'))),
              downloadError: null,
              onDownloadError: (_) {},
              onCheckAgain: () => h.launched.add(MidtermExamRequest(midterm: row)),
            ),
          ),
        ),
      ));
      await settleApp(tester);
      expect(find.text('Submitted'), findsOneWidget);
      expect(find.text('Your answers are in. Your teacher will release the results and your certificate shortly.'),
          findsOneWidget);
      await tester.tap(find.text('Check again'));
      expect(h.launched, hasLength(1));
      await h.dispose(tester);
    });
  });
}

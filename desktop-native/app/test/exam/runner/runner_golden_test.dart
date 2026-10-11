// Goldens of the runner frame at the two window sizes the owner tests on (architecture §3,
// §9 tier A): 1366×768 and 1920×1080, drawn with the system's Arial and Georgia. The content
// island is the FakeIslandHost placeholder. Recorded on macOS; other platforms skip them
// (font rasterisation differs).
@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/runner_harness.dart';

const sizes = {'1366x768': Size(1366, 768), '1920x1080': Size(1920, 1080)};

void main() {
  setUpAll(loadRunnerFonts);
  final skip = !Platform.isMacOS ? 'goldens are recorded on macOS' : null;

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pump();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/$name.png'));
  }

  // Real (blurred) shadows, so the goldens look like the app; the binding's default turns them
  // into solid blocks. Set before the first paint, reset before the test ends (the binding
  // checks it).
  void golden(String name, Future<void> Function(WidgetTester tester) body) => testWidgets(name, (tester) async {
        debugDisableShadows = false;
        try {
          await body(tester);
        } finally {
          debugDisableShadows = true;
        }
      }, skip: skip != null);

  for (final e in sizes.entries) {
    final tag = e.key;
    final size = e.value;

    golden('R&W running $tag', (tester) async {
      await RunnerHarness.pump(tester, size: size, battery: okBattery);
      await shot(tester, 'rw_running_$tag');
    });

    golden('Math running, calculator + reference $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size, session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false));
      await h.tap(find.text('Calculator'));
      await h.tap(find.text('Reference'));
      await shot(tester, 'math_tools_$tag');
    });

    golden('navigator $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size);
      await h.tap(find.text('Question 1 of 6'));
      await shot(tester, 'navigator_$tag');
    });

    golden('more menu $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size);
      await h.tap(find.text('More'));
      await shot(tester, 'more_menu_$tag');
    });

    golden('directions $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size);
      await h.tap(find.text('Directions'));
      await shot(tester, 'directions_$tag');
    });

    golden('check your work $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size);
      h.session.openReview();
      await tester.pump();
      await shot(tester, 'review_$tag');
    });

    golden('check your work, midterm $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size, session: FakeExamSession.midterm(tick: false));
      h.session.openReview();
      await tester.pump();
      await shot(tester, 'review_midterm_$tag');
    });

    golden('welcome $tag', (tester) async {
      await RunnerHarness.pump(tester, size: size, session: FakeExamSession.math(tick: false));
      await shot(tester, 'welcome_$tag');
    });

    golden('report a problem $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size);
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      await tester.pump(const Duration(milliseconds: 500));
      await shot(tester, 'report_$tag');
    });

    golden('timer warning, help $tag', (tester) async {
      final h = await RunnerHarness.pump(tester, size: size, battery: lowBattery);
      h.session.setRemaining(const Duration(minutes: 4, seconds: 59));
      await tester.pump();
      await h.key(LogicalKeyboardKey.slash, character: '?');
      await shot(tester, 'warning_help_$tag');
    });
  }
}

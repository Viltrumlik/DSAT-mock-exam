// Forced full screen in the runner (ExamRunnerPage.tsx:405-470, 786-795; FullscreenWarning.tsx):
// where the window's full screen is held for the sitting (a past paper's lockdown), leaving it
// while a module is on screen raises the website's warning after 400 ms, counts down 10 s and
// then runs the More menu's Save & Exit. Never on Welcome, loading, the transition, Check Your
// Work, or a midterm. Driven over FakeExamSession + FakeRunnerWindowControls(fullscreenLocked).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/fullscreen_warning.dart';
import 'package:mastersat_app/exam/runner/runner.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/runner_harness.dart';

/// A runner whose full screen is held by a lockdown, in full screen now.
Future<RunnerHarness> lockedRunner(WidgetTester tester, {FakeExamSession? session, bool full = true, bool canDrawOverIsland = true}) =>
    RunnerHarness.pump(
      tester,
      session: session,
      canDrawOverIsland: canDrawOverIsland,
      window: FakeRunnerWindowControls(fullscreenLocked: true, initial: full),
    );

Finder get warning => find.byType(FullscreenWarning);

void main() {
  setUpAll(loadRunnerFonts);

  testWidgets('leaving full screen: nothing for 400 ms, then the warning counts 10…1 and Save & Exit runs', (
    tester,
  ) async {
    final h = await lockedRunner(tester);
    expect(h.session.phase, ExamPhase.running);
    h.window!.simulateExternal(false);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 399));
    expect(warning, findsNothing, reason: 'the grace: a transient change never flashes it');
    expect(h.state.fullscreenWarningVisible, isFalse);

    await tester.pump(const Duration(milliseconds: 1));
    expect(warning, findsOneWidget);
    // The website's copy, exactly.
    expect(find.text('Return to full screen'), findsNWidgets(2)); // the title and the button
    expect(find.text(FullscreenWarningCopy.body), findsOneWidget);
    expect(
      FullscreenWarningCopy.body,
      'This test must be taken in full screen. You exited full screen — your timer is still running.',
    );
    expect(find.text('You’ll be removed from the test in 10 seconds.'), findsOneWidget);
    expect(find.text('Your answers are saved — you can resume where you left off.'), findsOneWidget);
    expect(h.state.shortcutsEnabled, isFalse, reason: 'the runner is inert under the warning');

    for (var left = 9; left >= 1; left--) {
      await tester.pump(const Duration(seconds: 1));
      expect(
        find.text('You’ll be removed from the test in $left ${left == 1 ? 'second' : 'seconds'}.'),
        findsOneWidget,
        reason: '$left left',
      );
      expect(h.session.log, isNot(contains('saveAndExit')));
    }
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(h.session.log, contains('saveAndExit'), reason: 'the More menu’s Save & Exit, at 0');
    expect(h.session.phase, ExamPhase.done);
    expect(h.exits, [const RunnerExit(ExamDoneReason.savedAndExited, pausedOnServer: true)]);
    expect(warning, findsNothing);
  });

  testWidgets('"Return to full screen" before 0 asks the window again and dismisses it', (tester) async {
    final h = await lockedRunner(tester);
    h.window!.simulateExternal(false);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(seconds: 4));
    expect(find.text('You’ll be removed from the test in 6 seconds.'), findsOneWidget);

    await h.tap(find.byKey(const ValueKey('fullscreenWarning.return')));
    expect(h.window!.log, ['fullscreen on']);
    expect(warning, findsNothing);
    expect(h.state.fullscreenSecondsLeft, isNull);
    await tester.pump(const Duration(seconds: 15));
    expect(h.session.log, isNot(contains('saveAndExit')), reason: 'the countdown stopped');
    expect(h.exits, isEmpty);
    expect(h.state.shortcutsEnabled, isTrue);
  });

  testWidgets('a refused return keeps the warning (the owner covers the runner with its reason)', (tester) async {
    final h = await lockedRunner(tester);
    h.window!
      ..refuse = StateError('the pre-check failed')
      ..simulateExternal(false);
    await tester.pump(const Duration(milliseconds: 400));
    await h.tap(find.byKey(const ValueKey('fullscreenWarning.return')));
    expect(warning, findsOneWidget);
    expect(h.diagnostics.single, contains('return to full screen refused'));
  });

  testWidgets('back within the grace: it never shows', (tester) async {
    final h = await lockedRunner(tester);
    h.window!.simulateExternal(false);
    await tester.pump(const Duration(milliseconds: 200));
    h.window!.simulateExternal(true);
    await tester.pump(const Duration(seconds: 12));
    expect(warning, findsNothing);
    expect(h.session.log, isNot(contains('saveAndExit')));
  });

  testWidgets('it is modal: no clicks, keys or shortcuts reach the runner; Tab + Enter press its button', (tester) async {
    final h = await lockedRunner(tester);
    h.window!.simulateExternal(false);
    await tester.pump(const Duration(milliseconds: 400));
    expect(warning, findsOneWidget);
    final before = h.session.log.length;

    await tester.tap(find.byKey(const ValueKey('footer.next')), warnIfMissed: false);
    await tester.tap(find.text('More'), warnIfMissed: false);
    await tester.pump();
    expect(h.state.tools.moreOpen, isFalse, reason: 'Pause / Save & Exit only through the warning’s own flow');
    await h.key(LogicalKeyboardKey.keyB);
    await h.key(LogicalKeyboardKey.arrowRight);
    expect(h.session.log.length, before, reason: 'nothing reached the session');

    await h.key(LogicalKeyboardKey.tab);
    await h.key(LogicalKeyboardKey.enter);
    expect(h.window!.log, ['fullscreen on']);
    expect(warning, findsNothing);
  });

  testWidgets('it closes the More menu and anything floating when it rises', (tester) async {
    final h = await lockedRunner(tester);
    await h.tap(find.text('More'));
    expect(h.state.tools.moreOpen, isTrue);
    h.window!.simulateExternal(false);
    await tester.pump(const Duration(milliseconds: 400));
    expect(h.state.tools.moreOpen, isFalse);
    expect(warning, findsOneWidget);
  });

  testWidgets('never on Welcome, and Start without full screen does not start the clock', (tester) async {
    final h = await lockedRunner(tester, session: FakeExamSession.math(tick: false), full: false);
    expect(h.session.phase, ExamPhase.welcome);
    await tester.pump(const Duration(seconds: 2));
    expect(warning, findsNothing);

    h.window!.refuse = StateError('the pre-check failed');
    await h.tap(find.text('Start'));
    expect(h.window!.log, ['fullscreen on']);
    expect(h.session.log, isNot(contains('start')), reason: 'a locked full screen is mandatory');
    expect(h.session.phase, ExamPhase.welcome);

    h.window!.refuse = null;
    await h.tap(find.text('Start'));
    expect(h.session.phase, ExamPhase.running);
    expect(h.window!.isFullscreen.value, isTrue);
  });

  testWidgets('an unlocked window that refuses still starts (the website: full screen is best-effort)', (
    tester,
  ) async {
    final window = FakeRunnerWindowControls()..refuse = StateError('no');
    final h = await RunnerHarness.pump(tester, session: FakeExamSession.math(tick: false), window: window);
    await h.tap(find.text('Start'));
    expect(h.session.phase, ExamPhase.running);
  });

  testWidgets('never on loading, Check Your Work or the module transition', (tester) async {
    final loading = await lockedRunner(
      tester,
      session: FakeExamSession.math(initialPhase: ExamPhase.loading, tick: false),
      full: false,
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Loading exam…'), findsOneWidget);
    expect(warning, findsNothing);
    expect(loading.state.fullscreenWarningVisible, isFalse);

    final h = await lockedRunner(tester, full: false);
    // Running and out of full screen: it is coming…
    await tester.pump(const Duration(milliseconds: 200));
    h.session.openReview(); // …but Check Your Work is not a module on screen.
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('Check Your Work'), findsOneWidget);
    expect(warning, findsNothing);

    // Back to a question: enforced again, after a fresh grace.
    h.session.goTo(0);
    await tester.pump(const Duration(milliseconds: 399));
    expect(warning, findsNothing);
    await tester.pump(const Duration(milliseconds: 1));
    expect(warning, findsOneWidget);

    // The module ends (0:00): the transition hides it, module 2 brings it back after the grace.
    h.session.setRemaining(Duration.zero);
    await tester.pump();
    expect(h.session.phase, ExamPhase.transition);
    expect(warning, findsNothing);
    await tester.pump(const Duration(milliseconds: 299));
    expect(warning, findsNothing);
    await tester.pump(const Duration(milliseconds: 1));
    expect(h.session.phase, ExamPhase.running);
    expect(h.session.moduleOrder, 2);
    await tester.pump(const Duration(milliseconds: 399));
    expect(warning, findsNothing);
    await tester.pump(const Duration(milliseconds: 1));
    expect(warning, findsOneWidget);
  });

  testWidgets('never under a screen the owner draws over the runner', (tester) async {
    await RunnerHarness.pump(
      tester,
      overlay: const ColoredBox(color: Colors.white),
      window: FakeRunnerWindowControls(fullscreenLocked: true),
    );
    await tester.pump(const Duration(seconds: 2));
    expect(warning, findsNothing);
  });

  testWidgets('a midterm never shows it — its off-screen rule supersedes it', (tester) async {
    final h = await lockedRunner(tester, session: FakeExamSession.midterm(tick: false), full: false);
    await tester.pump(const Duration(seconds: 12));
    expect(warning, findsNothing);
    expect(h.session.log, isNot(contains('saveAndExit')));
  });

  testWidgets('an ordinary (unlocked) window never forces it', (tester) async {
    final h = await RunnerHarness.pump(tester, window: FakeRunnerWindowControls());
    await tester.pump(const Duration(seconds: 12));
    expect(warning, findsNothing);
    expect(h.window!.isFullscreen.value, isFalse);
  });

  group('More menu', () {
    testWidgets('a locked full screen hides "Full screen"; Save & Exit stays', (tester) async {
      final h = await lockedRunner(tester);
      await h.tap(find.text('More'));
      expect(find.byKey(const ValueKey('more.fullscreen')), findsNothing);
      expect(find.text('Full screen'), findsNothing);
      expect(find.text('Exit full screen'), findsNothing);
      expect(find.text('Save & Exit'), findsOneWidget);
    });

    testWidgets('an ordinary window keeps it', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('More'));
      expect(find.text('Full screen'), findsOneWidget);
    });
  });

  testWidgets('windowed fallback: the question card is frozen under the warning, live again after', (tester) async {
    final h = await lockedRunner(tester, canDrawOverIsland: false);
    expect(h.content.visible, isTrue);
    h.window!.simulateExternal(false);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.pump();
    expect(warning, findsOneWidget);
    expect(h.content.visible, isFalse, reason: 'the native island window must not draw over the warning');
    await h.tap(find.byKey(const ValueKey('fullscreenWarning.return')));
    await tester.pump();
    await tester.pump();
    expect(warning, findsNothing);
    expect(h.content.visible, isTrue);
  });

  test('the countdown copy', () {
    expect(FullscreenWarningCopy.removedIn(10), 'You’ll be removed from the test in 10 seconds.');
    expect(FullscreenWarningCopy.removedIn(1), 'You’ll be removed from the test in 1 second.');
    expect(FullscreenWarningCopy.removedIn(0), 'You’ll be removed from the test in 0 seconds.');
    expect(FullscreenWarningCopy.removedIn(-3), 'You’ll be removed from the test in 0 seconds.');
    expect(fullscreenWarningGrace, const Duration(milliseconds: 400));
    expect(fullscreenWarningSeconds, 10);
  });
}

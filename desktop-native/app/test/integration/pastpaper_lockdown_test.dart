// A past paper's lockdown through the WHOLE app (0.2.4, the learning center's request: "full
// screen is mandatory on a past paper; leaving it shows the website's 10-second warning; unless
// they Save & Exit, it stays in lockdown like a midterm"). Real services, launcher, sitting,
// runner and engine; the native library is the fake bridge, which records every lock call.
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/engine/exam_engine.dart' show EngineProblem, EngineProblemKind;
import 'package:mastersat_app/exam/launch/island_guard.dart' show IslandUnavailableCopy;
import 'package:mastersat_app/exam/launch/pastpaper_sitting.dart';
import 'package:mastersat_app/exam/runner/fullscreen_warning.dart';
import 'package:mastersat_app/exam/runner/runner.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/midterm/precheck_screen.dart';
import 'package:mastersat_app/features/results/pastpaper_result_screen.dart';
import 'package:mastersat_app/island/protocol.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import '../exam/runner/support/runner_harness.dart' show loadRunnerFonts;
import 'pastpaper_e2e_test.dart' show engineOf, pressCard, toLastQuestion;
import 'support/app_rig.dart';

const telegram = BlockedApp(exe: 'Telegram.exe', name: 'Telegram', closable: true);

int count(AppRig rig, String call) => rig.native.calls.where((c) => c == call).length;

Finder get warning => find.byType(FullscreenWarning);
Finder get runner => find.byType(ExamRunnerScreen);
Finder get precheck => find.byType(MidtermPrecheckScreen);

/// Home → Start → Welcome (nothing locked yet).
Future<AppRig> toWelcome(WidgetTester tester) async {
  final rig = await AppRig.start(tester);
  await rig.pump();
  await pressCard(rig, 52, 'Start');
  expect(find.byKey(const ValueKey('welcome.start')), findsOneWidget);
  return rig;
}

/// Welcome → Start, locked.
Future<AppRig> startedLocked(WidgetTester tester) async {
  final rig = await toWelcome(tester);
  await rig.tapKey('welcome.start');
  expect(engineOf(tester).phase, ExamPhase.running);
  expect(rig.native.locked, isTrue);
  return rig;
}

/// The watchdog let go and the silent re-lock failed (a chat app opened in the gap).
Future<void> loseTheLock(AppRig rig) async {
  final e = engineOf(rig.tester);
  rig.native
    ..apps = [telegram]
    ..watchdogReleased = true;
  expect(e.lockdown.beat(), isFalse);
  expect(e.lockdown.lost, isTrue);
  await rig.tester.pump();
}

void main() {
  setUpAll(loadRunnerFonts);

  group('the lock', () {
    testWidgets('Start locks the machine (heartbeat every 3 s); Welcome does not', (tester) async {
      final rig = await toWelcome(tester);
      expect(rig.native.locked, isFalse, reason: 'Welcome: nothing has started');
      expect(count(rig, 'lockEnter'), 0);
      await tester.pump(const Duration(seconds: 2));
      expect(warning, findsNothing, reason: 'never on Welcome');

      await rig.tapKey('welcome.start');
      expect(count(rig, 'lockEnter'), 1);
      expect(rig.native.locked, isTrue);
      final beats = rig.native.heartbeats;
      await tester.pump(const Duration(seconds: 6));
      expect(rig.native.heartbeats - beats, 2);
      expect(warning, findsNothing);
      expect(count(rig, 'prove 9123'), 0, reason: 'local lockdown: no proof, no server session');
      await rig.dispose();
    });

    testWidgets('the More menu has no Full screen while locked; Save & Exit releases it and goes Home', (
      tester,
    ) async {
      final rig = await startedLocked(tester);
      await rig.tapKey('header.more');
      expect(find.text('Full screen'), findsNothing);
      expect(find.text('Exit full screen'), findsNothing);
      expect(find.text('Save & Exit'), findsOneWidget);

      await rig.tapKey('more.saveExit');
      await rig.settle(const Duration(milliseconds: 100), 10);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(rig.native.locked, isFalse);
      expect(count(rig, 'lockExit'), greaterThanOrEqualTo(1));
      expect(rig.api.calls.any((c) => c.method == 'pastpaperPause'), isTrue);
      await rig.dispose();
    });

    testWidgets('reopening a running sitting locks at once (Resume)', (tester) async {
      final rig = await startedLocked(tester);
      await rig.tapKey('header.more');
      await rig.tapKey('more.saveExit');
      await rig.settle(const Duration(milliseconds: 100), 10);
      expect(rig.native.locked, isFalse);

      await pressCard(rig, 52, 'Resume');
      await rig.settle(const Duration(milliseconds: 100), 6);
      expect(engineOf(tester).paused, isTrue);
      expect(count(rig, 'lockEnter'), 2);
      expect(rig.native.locked, isTrue);
      expect(runner, findsOneWidget);
      await rig.dispose();
    });

    testWidgets('held through module 1 → module 2; released at the hand-in, before the result', (tester) async {
      final rig = await startedLocked(tester);
      final e = engineOf(tester);
      bool? lockedWhenHandedIn;
      e.addListener(() {
        if (e.phase == ExamPhase.submitting || e.phase == ExamPhase.done) lockedWhenHandedIn ??= rig.native.locked;
      });
      rig.content.emit(const AnswerChooseMessage(qid: 1001, key: 'B'));
      await rig.settle();
      await toLastQuestion(rig, e);
      await rig.tapKey('footer.submit');
      await rig.tapKey('review.submit');
      await rig.settle(const Duration(milliseconds: 100), 10);
      expect(e.moduleId, 302);
      expect(rig.native.locked, isTrue, reason: 'the transition keeps the lock');
      expect(count(rig, 'lockExit'), 0);

      await toLastQuestion(rig, e);
      await rig.tapKey('footer.submit');
      await rig.tapKey('review.submit');
      await rig.settle(const Duration(milliseconds: 200), 10);
      await rig.settle(const Duration(seconds: 1), 6);
      expect(lockedWhenHandedIn, isFalse, reason: 'released the moment the paper was in');
      expect(find.byType(PastpaperResultScreen), findsOneWidget);
      expect(rig.native.locked, isFalse);
      await rig.dispose();
    });

    testWidgets('leaving the sitting screen any other way releases it (dispose)', (tester) async {
      final rig = await startedLocked(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(rig.native.locked, isFalse);
      await rig.dispose();
    });

    testWidgets('the window closing releases it, and nothing takes it again', (tester) async {
      final rig = await startedLocked(tester);
      final e = engineOf(tester);
      var closed = false;
      unawaited(e.closeGracefully().then((_) => closed = true));
      await rig.settle(const Duration(milliseconds: 100), 30);
      expect(closed, isTrue);
      expect(rig.native.locked, isFalse);
      expect(e.lockdownWanted, isFalse, reason: 'the sitting must not lock again behind the closing window');
      await rig.dispose();
    });

    testWidgets('an error that takes the student Home releases it (questions cannot be shown)', (tester) async {
      final rig = await AppRig.start(tester, islandOpenFails: true);
      await rig.pump();
      await pressCard(rig, 52, 'Start');
      await rig.settle();
      expect(find.text(IslandUnavailableCopy.title), findsOneWidget);
      // A running sitting under the message (as a reopen would be): locked even there.
      final e = engineOf(tester);
      e.lock();
      await e.start();
      await rig.settle();
      expect(rig.native.locked, isTrue);
      expect(warning, findsNothing, reason: 'never under a screen covering the runner');

      await rig.tapText('Back to Home');
      await rig.settle(const Duration(milliseconds: 100), 10);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(rig.native.locked, isFalse);
      expect(rig.api.calls.any((c) => c.method == 'pastpaperPause'), isTrue, reason: 'saved and paused first');
      await rig.dispose();
    });
  });

  group('the pre-check', () {
    testWidgets('a refused Start shows the pre-check (saying "test"); Close; Lock and start', (tester) async {
      final rig = await toWelcome(tester);
      rig.native.apps = [telegram];
      await rig.tapKey('welcome.start');
      expect(precheck, findsOneWidget);
      expect(runner, findsNothing);
      expect(engineOf(tester).phase, ExamPhase.welcome, reason: 'a past paper never starts unlocked');
      expect(rig.native.locked, isFalse);
      expect(find.text('Get this computer ready'), findsOneWidget);
      expect(
        find.text(
          'When you continue, MasterSAT locks this computer until your test ends. Other apps, '
          'notifications, screenshots and copying are turned off.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('midterm'), findsNothing);
      expect(find.textContaining('Midterm'), findsNothing);
      expect(find.text('Close Telegram'), findsOneWidget);
      expect(find.text('Back to Home'), findsOneWidget);

      // Nothing locks while it fails.
      await rig.tapText('Lock and start');
      expect(rig.native.locked, isFalse);

      await rig.tapText('Close');
      expect(rig.native.calls, contains('closeApp Telegram.exe'));
      await tester.pump(const Duration(seconds: 2)); // the re-check every 2 s
      expect(find.text('No chat or screen-sharing apps open'), findsOneWidget);

      await rig.tapText('Lock and start');
      await rig.settle();
      expect(rig.native.locked, isTrue);
      expect(engineOf(tester).phase, ExamPhase.running);
      expect(precheck, findsNothing);
      expect(runner, findsOneWidget);
      await rig.dispose();
    });

    testWidgets('Back to Home from the Start pre-check: nothing ran, nothing locked', (tester) async {
      final rig = await toWelcome(tester);
      rig.native.apps = [telegram];
      await rig.tapKey('welcome.start');
      await rig.tapText('Back to Home');
      await rig.settle(const Duration(milliseconds: 100), 6);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(rig.native.locked, isFalse);
      expect(rig.api.calls.any((c) => c.method == 'pastpaperStart'), isFalse);
      await rig.dispose();
    });

    testWidgets('a refused reopen covers the paper with "Resume your test"; Lock and resume', (tester) async {
      final rig = await startedLocked(tester);
      await rig.tapKey('header.more');
      await rig.tapKey('more.saveExit');
      await rig.settle(const Duration(milliseconds: 100), 10);

      rig.native.apps = [telegram];
      await pressCard(rig, 52, 'Resume');
      await rig.settle(const Duration(milliseconds: 100), 6);
      expect(precheck, findsOneWidget);
      expect(runner, findsNothing, reason: 'a running paper is never on screen unlocked');
      expect(find.text('Resume your test'), findsOneWidget);
      expect(rig.native.locked, isFalse);

      await rig.tapText('Close');
      await tester.pump(const Duration(seconds: 2));
      await rig.tapText('Lock and resume');
      await rig.settle();
      expect(rig.native.locked, isTrue);
      expect(runner, findsOneWidget);
      await rig.dispose();
    });

    testWidgets('Back to Home over a running paper saves and exits first', (tester) async {
      final rig = await startedLocked(tester);
      await rig.tapKey('header.more');
      await rig.tapKey('more.saveExit');
      await rig.settle(const Duration(milliseconds: 100), 10);
      final pausesBefore = rig.api.calls.where((c) => c.method == 'pastpaperPause').length;
      await rig.settle(const Duration(milliseconds: 200), 5);

      rig.native.apps = [telegram];
      await pressCard(rig, 52, 'Resume');
      await rig.settle(const Duration(milliseconds: 100), 6);
      expect(find.text('Resume your test'), findsOneWidget);
      // The reopened sitting is paused (the website reopens it paused); resume it on the server
      // first so Back has a running clock to stop.
      final e = engineOf(tester);
      await e.resume();
      await rig.settle();
      await rig.tapText('Back to Home');
      await rig.settle(const Duration(milliseconds: 100), 10);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(rig.native.locked, isFalse);
      expect(rig.api.calls.where((c) => c.method == 'pastpaperPause').length, greaterThan(pausesBefore));
      await rig.dispose();
    });
  });

  group('forced full screen', () {
    testWidgets('lock lost: nothing for 400 ms, the warning counts 10…1, then Save & Exit → released → Home', (
      tester,
    ) async {
      final rig = await startedLocked(tester);
      await loseTheLock(rig);
      await tester.pump(const Duration(milliseconds: 399));
      expect(warning, findsNothing);
      await tester.pump(const Duration(milliseconds: 1));
      expect(warning, findsOneWidget);
      expect(find.text('You’ll be removed from the test in 10 seconds.'), findsOneWidget);
      final runnerState = tester.state<ExamRunnerScreenState>(runner);
      expect(runnerState.shortcutsEnabled, isFalse);

      for (var left = 9; left >= 1; left--) {
        await tester.pump(const Duration(seconds: 1));
        expect(
          find.text('You’ll be removed from the test in $left ${left == 1 ? 'second' : 'seconds'}.'),
          findsOneWidget,
        );
        expect(find.byType(PastpaperSittingScreen), findsOneWidget);
      }
      final exitsBefore = count(rig, 'lockExit');
      await tester.pump(const Duration(seconds: 1));
      await rig.settle(const Duration(milliseconds: 100), 10);
      expect(find.byType(PastpaperSittingScreen), findsNothing);
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(rig.native.locked, isFalse);
      expect(count(rig, 'lockExit'), greaterThan(exitsBefore), reason: 'released');
      expect(rig.api.calls.any((c) => c.method == 'pastpaperPause'), isTrue, reason: 'resumable: paused on the server');
      await rig.dispose();
    });

    testWidgets('"Return to full screen" before 0 re-locks and dismisses it', (tester) async {
      final rig = await startedLocked(tester);
      await loseTheLock(rig);
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(seconds: 3));
      expect(warning, findsOneWidget);

      rig.native.apps = []; // the student closed it
      final locks = count(rig, 'lockEnter');
      await rig.tapKey('fullscreenWarning.return');
      expect(count(rig, 'lockEnter'), locks + 1);
      expect(rig.native.locked, isTrue);
      expect(engineOf(tester).lockdown.lost, isFalse);
      expect(warning, findsNothing);
      await tester.pump(const Duration(seconds: 12));
      expect(find.byType(PastpaperSittingScreen), findsOneWidget, reason: 'the countdown stopped');
      expect(rig.api.calls.any((c) => c.method == 'pastpaperPause'), isFalse);
      await rig.dispose();
    });

    testWidgets('a refused return covers the paper with the pre-check; Lock and resume', (tester) async {
      final rig = await startedLocked(tester);
      await loseTheLock(rig);
      await tester.pump(const Duration(milliseconds: 400));
      await rig.tapKey('fullscreenWarning.return'); // Telegram is still open
      expect(warning, findsNothing);
      expect(runner, findsNothing);
      expect(find.text('Resume your test'), findsOneWidget);
      expect(find.text('Close Telegram'), findsOneWidget);

      await rig.tapText('Close');
      await tester.pump(const Duration(seconds: 2));
      await rig.tapText('Lock and resume');
      await rig.settle();
      expect(rig.native.locked, isTrue);
      expect(runner, findsOneWidget);
      expect(engineOf(tester).phase, ExamPhase.running);
      await tester.pump(const Duration(seconds: 12));
      expect(warning, findsNothing);
      await rig.dispose();
    });

    testWidgets('a required update lets the machine go and never counts the student out', (tester) async {
      final rig = await startedLocked(tester);
      final e = engineOf(tester);
      e.setProblem(const EngineProblem(EngineProblemKind.updateRequired, 'Update the MasterSAT app to keep going.'));
      await tester.pump();
      expect(rig.native.locked, isFalse);
      await tester.pump(const Duration(seconds: 12));
      expect(warning, findsNothing);
      expect(rig.native.locked, isFalse, reason: 'not taken again behind the update card');
      expect(find.byType(PastpaperSittingScreen), findsOneWidget);
      await rig.dispose();
    });

    testWidgets('no warning on Check Your Work; it comes back on a question', (tester) async {
      final rig = await startedLocked(tester);
      final e = engineOf(tester);
      await toLastQuestion(rig, e);
      await rig.tapKey('footer.submit');
      expect(find.text('Check Your Work'), findsOneWidget);
      await loseTheLock(rig);
      await tester.pump(const Duration(seconds: 2));
      expect(warning, findsNothing);
      e.goTo(0);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(warning, findsOneWidget);
      await rig.dispose();
    });
  });
}

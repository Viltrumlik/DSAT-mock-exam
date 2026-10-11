// Keyboard shortcuts (useKeyboardShortcuts.ts): ←/→, A–D, M, R, ? — from Flutter and from the
// island's forwarded `key` messages — and every state that turns them off.
import 'package:flutter/services.dart' hide KeyMessage;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/exam_runner_screen.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/exam/tools/keyboard_shortcuts.dart';
import 'package:mastersat_app/island/protocol.dart';

import 'support/runner_harness.dart';

Future<void> press(WidgetTester tester, LogicalKeyboardKey key, [String? ch]) async {
  await tester.sendKeyEvent(key, character: ch);
  await tester.pump();
}

Future<void> letter(WidgetTester tester, String ch) =>
    press(tester, LogicalKeyboardKey(LogicalKeyboardKey.keyA.keyId + ch.toLowerCase().codeUnitAt(0) - 97), ch);

void main() {
  setUpAll(loadRunnerFonts);

  group('the key table (useKeyboardShortcuts.ts:39-49)', () {
    test('DOM keys', () {
      expect(shortcutForDomKey('ArrowLeft'), RunnerShortcut.previous);
      expect(shortcutForDomKey('ArrowRight'), RunnerShortcut.next);
      for (final (k, s) in [
        ('a', RunnerShortcut.choiceA),
        ('B', RunnerShortcut.choiceB),
        ('c', RunnerShortcut.choiceC),
        ('D', RunnerShortcut.choiceD),
        ('m', RunnerShortcut.mark),
        ('R', RunnerShortcut.navigator),
        ('?', RunnerShortcut.help),
      ]) {
        expect(shortcutForDomKey(k), s, reason: k);
      }
      expect(shortcutForDomKey('e'), isNull);
      expect(shortcutForDomKey('Enter'), isNull);
      expect(shortcutForDomKey('Escape'), isNull);
      expect(RunnerShortcut.choiceC.choiceIndex, 2);
      expect(RunnerShortcut.mark.choiceIndex, isNull);
    });

    test('the help rows are the website\'s', () {
      expect(shortcutHelpRows.map((r) => r.keys), ['← / →', 'A B C D', 'M', 'R', '?']);
    });

    test('runnerShortcutsEnabled: on only while answering with nothing in the way', () {
      expect(runnerShortcutsEnabled(phase: ExamPhase.running, inputLocked: false), isTrue);
      for (final p in ExamPhase.values.where((p) => p != ExamPhase.running)) {
        expect(runnerShortcutsEnabled(phase: p, inputLocked: false), isFalse, reason: p.name);
      }
      expect(runnerShortcutsEnabled(phase: ExamPhase.running, inputLocked: true), isFalse);
      expect(
        runnerShortcutsEnabled(phase: ExamPhase.running, inputLocked: false, offscreenCountingDown: true),
        isFalse,
      );
      expect(runnerShortcutsEnabled(phase: ExamPhase.running, inputLocked: false, dialogOpen: true), isFalse);
      expect(runnerShortcutsEnabled(phase: ExamPhase.running, inputLocked: false, inert: true), isFalse);
      expect(runnerShortcutsEnabled(phase: ExamPhase.running, inputLocked: false, busy: true), isFalse);
    });
  });

  group('from the keyboard', () {
    testWidgets('→ / ← move, with the 500 ms freeze', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(h.session.currentIndex, 1);
      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(h.session.currentIndex, 1, reason: 'a held key cannot skip a question');
      await tester.pump(const Duration(milliseconds: 500));
      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(h.session.currentIndex, 2);
      await tester.pump(const Duration(milliseconds: 500));
      await press(tester, LogicalKeyboardKey.arrowLeft);
      expect(h.session.currentIndex, 1);
      await tester.pump(const Duration(milliseconds: 500));
    });

    testWidgets('A–D choose; M marks; R toggles the navigator; ? toggles the help', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await letter(tester, 'c');
      expect(h.session.answerFor(2001), 'C');
      await letter(tester, 'D');
      expect(h.session.answerFor(2001), 'D');
      await letter(tester, 'm');
      expect(h.session.isFlagged(2001), isTrue);
      await letter(tester, 'r');
      expect(find.byKey(const ValueKey('navigator.card')), findsOneWidget);
      await letter(tester, 'r');
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
      await press(tester, LogicalKeyboardKey.slash, '?');
      expect(find.byKey(const ValueKey('help.card')), findsOneWidget);
      await press(tester, LogicalKeyboardKey.slash, '?');
      expect(find.byKey(const ValueKey('help.card')), findsNothing);
    });

    testWidgets('while the help is open only ? works', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await press(tester, LogicalKeyboardKey.slash, '?');
      await letter(tester, 'a');
      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(h.session.answerFor(2001), 'B');
      expect(h.session.currentIndex, 0);
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byKey(const ValueKey('help.card')), findsNothing);
    });

    testWidgets('A–D do nothing on a grid-in', (tester) async {
      final h = await RunnerHarness.pump(
        tester,
        session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
      );
      h.session.goTo(1); // grid-in
      await tester.pump();
      await letter(tester, 'a');
      expect(h.session.answerFor(1002), isNull);
      expect(h.session.log.where((l) => l.startsWith('select')), isEmpty);
    });

    testWidgets('Ctrl/Alt/Meta + letter is never a shortcut', (tester) async {
      final h = await RunnerHarness.pump(tester);
      for (final mod in [LogicalKeyboardKey.controlLeft, LogicalKeyboardKey.altLeft, LogicalKeyboardKey.metaLeft]) {
        await tester.sendKeyDownEvent(mod);
        await tester.sendKeyEvent(LogicalKeyboardKey.keyC, character: 'c');
        await tester.sendKeyUpEvent(mod);
        await tester.pump();
      }
      expect(h.session.answerFor(2001), 'B');
    });

    testWidgets('Escape closes the topmost thing: the navigator, then Directions; and the More menu', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('Directions'));
      await letter(tester, 'r');
      expect(find.byKey(const ValueKey('navigator.card')), findsOneWidget);
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
      expect(find.byKey(const ValueKey('directions.card')), findsOneWidget);
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byKey(const ValueKey('directions.card')), findsNothing);
      await h.tap(find.text('More'));
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byKey(const ValueKey('more.menu')), findsNothing);
    });

    testWidgets('R while the More menu is open swaps it for the navigator', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('More'));
      await letter(tester, 'r');
      expect(find.byKey(const ValueKey('more.menu')), findsNothing);
      expect(find.byKey(const ValueKey('navigator.card')), findsOneWidget);
    });
  });

  group('forwarded by the island', () {
    testWidgets('the same table runs from `key` messages', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.content.emit(const KeyMessage(key: 'a'));
      await tester.pump();
      await tester.pump();
      expect(h.session.answerFor(2001), 'A');
      h.content.emit(const KeyMessage(key: 'ArrowRight'));
      await tester.pump();
      await tester.pump();
      expect(h.session.currentIndex, 1);
      await tester.pump(const Duration(milliseconds: 500));
      h.content.emit(const KeyMessage(key: 'm'));
      await tester.pump();
      await tester.pump();
      expect(h.session.isFlagged(2002), isTrue);
    });

    testWidgets('Escape from the island takes the keyboard back and closes the toolbar', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await tester.tapAt(const Offset(600, 400)); // into the island
      await tester.pump();
      expect(h.content.focused, isTrue);
      h.content.emit(const KeyMessage(key: 'Escape'));
      await tester.pump();
      await tester.pump();
      expect(h.content.focused, isFalse);
      expect(h.content.postedOf<FocusReleaseMessage>(), hasLength(1));
    });
  });

  group('off', () {
    Future<void> expectDead(WidgetTester tester, RunnerHarness h, {int qid = 2001, String? answer = 'B'}) async {
      final before = (h.session.answerFor(qid), h.session.currentIndex, h.session.isFlagged(qid));
      await letter(tester, 'a');
      await press(tester, LogicalKeyboardKey.arrowRight);
      await letter(tester, 'm');
      h.content.emit(const KeyMessage(key: 'c'));
      await tester.pump();
      await tester.pump();
      expect((h.session.answerFor(qid), h.session.currentIndex, h.session.isFlagged(qid)), before);
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
    }

    testWidgets('while the Report dialog is open (typing or not)', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      await tester.pump();
      await expectDead(tester, h);
      await letter(tester, 'r');
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('report.message')));
      await tester.pump();
      await letter(tester, 'b');
      expect(h.session.answerFor(2001), 'B');
    });

    testWidgets('on Check Your Work', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.openReview();
      await tester.pump();
      await press(tester, LogicalKeyboardKey.arrowLeft);
      await letter(tester, 'r');
      expect(h.session.phase, ExamPhase.review);
      expect(h.session.currentIndex, 0);
    });

    testWidgets('on the Welcome screen', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.math(tick: false));
      await press(tester, LogicalKeyboardKey.arrowRight);
      await letter(tester, 'a');
      expect(h.session.phase, ExamPhase.welcome);
      expect(h.session.log, isEmpty);
    });

    testWidgets('during the module transition', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.openReview();
      await tester.pump();
      await h.tap(find.byKey(const ValueKey('review.submit')));
      expect(h.session.phase, ExamPhase.transition);
      final logBefore = h.session.log.length;
      await press(tester, LogicalKeyboardKey.arrowRight);
      await letter(tester, 'a');
      expect(h.session.log.length, logBefore);
      await tester.pump(const Duration(milliseconds: 300));
    });

    testWidgets('during the off-screen countdown, and back on after the return', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      h.session.simulateOffscreen();
      await tester.pump();
      await expectDead(tester, h, qid: 3001, answer: null);
      h.session.simulateReturn();
      await tester.pump();
      await letter(tester, 'b');
      expect(h.session.answerFor(3001), 'B');
    });

    testWidgets('while input is locked at 0:00', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      h.session.online = false; // the hand-in waits: input stays locked on the offline screen
      h.session.setRemaining(Duration.zero);
      await tester.pump();
      expect(h.session.inputLocked, isTrue);
      final logBefore = h.session.log.length;
      await letter(tester, 'a');
      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(h.session.log.length, logBefore);
    });

    testWidgets('while the runner is inert under a lockdown/midterm screen', (tester) async {
      final h = await RunnerHarness.pump(tester, inert: true);
      await expectDead(tester, h);
    });

    testWidgets('while typing in Notes', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.state.tools.toggleNotes();
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('notes.field')));
      await tester.pump();
      await letter(tester, 'a');
      await letter(tester, 'r');
      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(h.session.answerFor(2001), 'B');
      expect(h.session.currentIndex, 0);
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
    });

    testWidgets('while Save & Exit is in flight', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.online = false;
      await tester.pump();
      await h.tap(find.text('More'));
      await h.tap(find.text('Save & Exit'));
      await tester.pump();
      expect(h.state.shortcutsEnabled, isFalse);
    });
  });
}

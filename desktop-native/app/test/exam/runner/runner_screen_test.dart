// Widget tests for every control and state of the runner frame (ExamRunnerScreen over a
// FakeExamSession + FakeIslandHost).
import 'package:flutter/gestures.dart' show kSecondaryButton;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/exam_runner_screen.dart';
import 'package:mastersat_app/exam/runner/icons/lucide_glyphs.dart';
import 'package:mastersat_app/exam/runner/icons/lucide_icon.dart';
import 'package:mastersat_app/exam/runner/sat_color_rule.dart';
import 'package:mastersat_app/exam/runner/welcome_screen.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/exam/tokens/bluebook_tokens.dart';
import 'package:mastersat_app/exam/tools/calculator/scientific_calculator.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/island/protocol.dart';

import 'support/runner_harness.dart';

Color? textColor(WidgetTester tester, String text) => tester.widget<Text>(find.text(text)).style?.color;

void main() {
  setUpAll(loadRunnerFonts);

  group('header', () {
    testWidgets('title, Directions, timer, tools for a R&W past paper', (tester) async {
      await RunnerHarness.pump(tester);
      expect(find.text('Section 1, Module 1: Reading and Writing'), findsOneWidget);
      expect(find.text('22:00'), findsOneWidget);
      expect(find.text('Hide'), findsOneWidget);
      expect(find.text('Pause'), findsOneWidget);
      expect(find.text('Highlights & Notes'), findsOneWidget);
      expect(find.text('More'), findsOneWidget);
      // R&W: no calculator, no reference sheet.
      expect(find.text('Calculator'), findsNothing);
      expect(find.text('Reference'), findsNothing);
    });

    testWidgets('Math past paper shows Calculator and Reference; a midterm never shows Reference or Pause', (
      tester,
    ) async {
      final h = await RunnerHarness.pump(
        tester,
        session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
      );
      expect(find.text('Calculator'), findsOneWidget);
      expect(find.text('Reference'), findsOneWidget);
      expect(find.text('Pause'), findsOneWidget);
      h.session.dispose();
    });

    testWidgets('midterm header', (tester) async {
      await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      expect(find.text('October Midterm · Math — Module 1'), findsOneWidget);
      expect(find.text('Calculator'), findsOneWidget);
      expect(find.text('Reference'), findsNothing);
      expect(find.text('Pause'), findsNothing);
    });

    testWidgets('Directions opens the overlay with the section copy and closes', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('Directions'));
      expect(find.byKey(const ValueKey('directions.card')), findsOneWidget);
      expect(find.textContaining('important reading and writing skills'), findsOneWidget);
      // Hangs 6 px under the header block (header + colour rule).
      final card = tester.getRect(find.byKey(const ValueKey('directions.card')));
      final rule = tester.getRect(find.byType(SatColorRule).first);
      expect(card.top, closeTo(rule.bottom + 6, 0.5));
      // Covers the passage half + 44 px.
      expect(card.width, closeTo(1366 * 0.5 + 44, 0.5));
      await h.tap(find.byKey(const ValueKey('directions.close')));
      expect(find.byKey(const ValueKey('directions.card')), findsNothing);
      await h.tap(find.text('Directions'));
      await h.tap(find.text('Directions'));
      expect(find.byKey(const ValueKey('directions.card')), findsNothing);
    });

    testWidgets('Math directions copy', (tester) async {
      final h = await RunnerHarness.pump(
        tester,
        session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
      );
      await h.tap(find.text('Directions'));
      expect(find.textContaining('important math skills'), findsOneWidget);
    });

    testWidgets('Hide/Show swaps the clock for the clock icon', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('Hide'));
      expect(find.text('22:00'), findsNothing);
      expect(find.byKey(const ValueKey('timer.hiddenClock')), findsOneWidget);
      expect(find.text('Show'), findsOneWidget);
      await h.tap(find.text('Show'));
      expect(find.text('22:00'), findsOneWidget);
    });

    testWidgets('under five minutes the clock turns red with the badge, even when hidden', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.setRemaining(const Duration(minutes: 4, seconds: 59));
      await tester.pump();
      expect(find.text('4:59'), findsOneWidget);
      expect(textColor(tester, '4:59'), BluebookTokens.timerWarningColor);
      expect(find.text('LESS THAN 5 MINUTES'), findsOneWidget);
      await h.tap(find.text('Hide'));
      final icon = tester.widget<LucideIcon>(find.byKey(const ValueKey('timer.hiddenClock')));
      expect(icon.color, BluebookTokens.timerWarningColor);
    });

    testWidgets('Pause / Resume on the pill', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('Pause'));
      expect(h.session.paused, isTrue);
      expect(find.text('Resume'), findsOneWidget);
      await h.tap(find.text('Resume'));
      expect(h.session.paused, isFalse);
    });

    testWidgets('Pause offline is faded and explains why', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.online = false;
      await tester.pump();
      final pill = find.ancestor(of: find.text('Pause'), matching: find.byType(Opacity)).first;
      expect(tester.widget<Opacity>(pill).opacity, 0.5);
      await h.tap(find.text('Pause'));
      expect(h.session.paused, isFalse);
      expect(find.text(ExamNotice.pauseNeedsConnection.message), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      expect(find.text(ExamNotice.pauseNeedsConnection.message), findsNothing);
    });

    testWidgets('Highlights & Notes toggles the highlighter (active colour)', (tester) async {
      final h = await RunnerHarness.pump(tester);
      expect(textColor(tester, 'Highlights & Notes'), BluebookTokens.toolColor);
      await h.tap(find.text('Highlights & Notes'));
      expect(h.session.highlighterOn, isTrue);
      expect(textColor(tester, 'Highlights & Notes'), BluebookTokens.toolActiveColor);
      expect(h.content.postedOf<ViewSetMessage>().last.highlighterOn, isTrue);
    });

    testWidgets('battery: low shows red reading + banner (dismissable); OK shows the reading only', (tester) async {
      final h = await RunnerHarness.pump(tester, battery: lowBattery);
      expect(find.text('18%'), findsOneWidget);
      expect(textColor(tester, '18%'), TwColors.red600);
      expect(find.text('Your battery is low (18%). Plug in your device.'), findsOneWidget);
      await h.tap(find.byKey(const ValueKey('battery.dismiss')));
      expect(find.byKey(const ValueKey('battery.banner')), findsNothing);
      h.battery!.value = okBattery;
      await tester.pump();
      expect(find.text('76%'), findsOneWidget);
      expect(find.byKey(const ValueKey('battery.banner')), findsNothing);
      // A new low spell warns again.
      h.battery!.value = lowBattery;
      await tester.pump();
      expect(find.byKey(const ValueKey('battery.banner')), findsOneWidget);
    });
  });

  group('More menu', () {
    testWidgets('lists the website items in order and closes on an outside click', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('More'));
      final labels = [
        'Full screen',
        'Highlighter: Off',
        'Notes',
        'Report a problem',
        'Zoom in',
        'Zoom out',
        'Pause',
        'Keyboard shortcuts',
        'Save & Exit',
      ];
      double lastY = 0;
      for (final l in labels) {
        final f = find.descendant(of: find.byKey(const ValueKey('more.menu')), matching: find.text(l));
        expect(f, findsOneWidget, reason: l);
        final y = tester.getCenter(f).dy;
        expect(y, greaterThan(lastY), reason: '$l is below the previous item');
        lastY = y;
      }
      // Hung under the More button, right edges aligned.
      final menu = tester.getRect(find.byKey(const ValueKey('more.menu')));
      final button = tester.getRect(find.byKey(const ValueKey('header.more')));
      expect(menu.right, closeTo(button.right, 0.5));
      expect(menu.top, closeTo(button.bottom + 8, 0.5));
      expect(menu.width, 240);
      await tester.tapAt(const Offset(600, 400));
      await tester.pump();
      expect(find.byKey(const ValueKey('more.menu')), findsNothing);
    });

    testWidgets('the More button toggles the menu', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('More'));
      expect(find.byKey(const ValueKey('more.menu')), findsOneWidget);
      await h.tap(find.text('More'));
      expect(find.byKey(const ValueKey('more.menu')), findsNothing);
    });

    Future<RunnerHarness> openMore(WidgetTester tester, {FakeExamSession? session}) async {
      final h = await RunnerHarness.pump(tester, session: session);
      await h.tap(find.text('More'));
      return h;
    }

    testWidgets('Full screen ⇄ Exit full screen', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.text('Full screen'));
      expect(h.window!.log, ['fullscreen on']);
      expect(find.byKey(const ValueKey('more.menu')), findsNothing);
      await h.tap(find.text('More'));
      expect(find.text('Exit full screen'), findsOneWidget);
      await h.tap(find.text('Exit full screen'));
      expect(h.window!.log, ['fullscreen on', 'fullscreen off']);
    });

    testWidgets('no window controls → no Full screen item', (tester) async {
      final h = await RunnerHarness.pump(tester, windowControls: false);
      await h.tap(find.text('More'));
      expect(find.text('Full screen'), findsNothing);
    });

    testWidgets('Highlighter item toggles and reads On/Off', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.text('Highlighter: Off'));
      expect(h.session.highlighterOn, isTrue);
      await h.tap(find.text('More'));
      expect(find.text('Highlighter: On'), findsOneWidget);
    });

    testWidgets('Notes opens the notes panel', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.text('Notes'));
      expect(find.byKey(const ValueKey('panel.notes')), findsOneWidget);
    });

    testWidgets('Zoom in / out step by 0.1 within 0.8–1.6', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.text('Zoom in'));
      expect(h.session.zoom, closeTo(1.1, 1e-9));
      for (var i = 0; i < 8; i++) {
        await h.tap(find.text('More'));
        await h.tap(find.text('Zoom in'));
      }
      expect(h.session.zoom, closeTo(1.6, 1e-9));
      for (var i = 0; i < 10; i++) {
        await h.tap(find.text('More'));
        await h.tap(find.text('Zoom out'));
      }
      expect(h.session.zoom, closeTo(0.8, 1e-9));
      expect(h.content.postedOf<ViewSetMessage>().last.zoom, closeTo(0.8, 1e-9));
    });

    testWidgets('Pause item', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.descendant(of: find.byKey(const ValueKey('more.menu')), matching: find.text('Pause')));
      expect(h.session.paused, isTrue);
    });

    testWidgets('Keyboard shortcuts opens the help; its close and scrim close it', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.text('Keyboard shortcuts'));
      expect(find.byKey(const ValueKey('help.card')), findsOneWidget);
      expect(find.text('Previous / Next question'), findsOneWidget);
      await h.tap(find.byKey(const ValueKey('help.close')));
      expect(find.byKey(const ValueKey('help.card')), findsNothing);
      await h.tap(find.text('More'));
      await h.tap(find.text('Keyboard shortcuts'));
      await tester.tapAt(const Offset(20, 300));
      await tester.pump();
      expect(find.byKey(const ValueKey('help.card')), findsNothing);
    });

    testWidgets('Save & Exit online pauses, then leaves', (tester) async {
      final h = await openMore(tester);
      await h.tap(find.text('Save & Exit'));
      await tester.pump();
      expect(h.exits, [const RunnerExit(ExamDoneReason.savedAndExited, pausedOnServer: true)]);
      expect(h.session.log, contains('saveAndExit'));
    });

    testWidgets('Save & Exit offline says the timer keeps running, then leaves on request', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.online = false;
      await tester.pump();
      await h.tap(find.text('More'));
      await h.tap(find.text('Save & Exit'));
      await tester.pump();
      expect(find.text('Your answers are saved on this computer'), findsOneWidget);
      expect(find.textContaining('timer keeps running'), findsOneWidget);
      expect(h.exits, isEmpty);
      await h.tap(find.text('Back to Home'));
      expect(h.exits, [const RunnerExit(ExamDoneReason.savedAndExited, pausedOnServer: false)]);
    });

    testWidgets('midterm: no Pause, no Save & Exit', (tester) async {
      await openMore(tester, session: FakeExamSession.midterm(tick: false));
      expect(find.descendant(of: find.byKey(const ValueKey('more.menu')), matching: find.text('Pause')), findsNothing);
      expect(find.text('Save & Exit'), findsNothing);
      expect(find.text('Report a problem'), findsOneWidget);
    });
  });

  group('footer and navigation', () {
    testWidgets('name, pill, Back disabled on Q1, Next moves with the 500 ms freeze', (tester) async {
      final h = await RunnerHarness.pump(tester);
      expect(find.text('Aziza Karimova'), findsOneWidget);
      expect(find.text('Question 1 of 6'), findsOneWidget);
      final back = find.ancestor(of: find.text('Back'), matching: find.byType(Opacity)).first;
      expect(tester.widget<Opacity>(back).opacity, BluebookTokens.backDisabledOpacity);
      await h.tap(find.text('Next'));
      expect(h.session.currentIndex, 1);
      expect(find.text('Question 2 of 6'), findsOneWidget);
      // Frozen: a second click within 500 ms does nothing.
      await h.tap(find.text('Next'));
      expect(h.session.currentIndex, 1);
      await tester.pump(const Duration(milliseconds: 500));
      await h.tap(find.text('Next'));
      expect(h.session.currentIndex, 2);
      await tester.pump(const Duration(milliseconds: 500));
      await h.tap(find.text('Back'));
      expect(h.session.currentIndex, 1);
      await tester.pump(const Duration(milliseconds: 500));
    });

    testWidgets('the last question says Submit and opens Check Your Work', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.goTo(5);
      await tester.pump();
      expect(find.text('Next'), findsNothing);
      await h.tap(find.text('Submit'));
      expect(h.session.phase, ExamPhase.review);
      expect(find.text('Check Your Work'), findsOneWidget);
    });

    testWidgets('navigator: legend, states, jump, scrim, close, review', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('Question 1 of 6'));
      expect(find.text('Section 1, Module 1: Reading and Writing Questions'), findsOneWidget);
      expect(find.text('Current'), findsOneWidget);
      expect(find.text('Unanswered'), findsOneWidget);
      expect(find.text('For Review'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Question 1, answered, current')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Question 3, unanswered, marked for review')), findsOneWidget);
      expect(find.byKey(const ValueKey('navigator.pin')), findsOneWidget);
      // The card sits 68 px above the window bottom.
      expect(tester.getRect(find.byKey(const ValueKey('navigator.card'))).bottom, closeTo(768 - 68, 0.5));
      await h.tap(find.byKey(const ValueKey('cell.3')));
      expect(h.session.currentIndex, 3);
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
      await h.tap(find.text('Question 4 of 6'));
      await tester.tapAt(const Offset(30, 200)); // scrim
      await tester.pump();
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
      await h.tap(find.text('Question 4 of 6'));
      await h.tap(find.byKey(const ValueKey('navigator.close')));
      expect(find.byKey(const ValueKey('navigator.card')), findsNothing);
      await h.tap(find.text('Question 4 of 6'));
      await h.tap(find.text('Go to Review Page'));
      expect(h.session.phase, ExamPhase.review);
    });
  });

  group('Check Your Work', () {
    testWidgets('past paper module 1: grid, Back, jump, Next hands the module in', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.openReview();
      await tester.pump();
      expect(find.text('Check Your Work'), findsOneWidget);
      expect(find.textContaining('On test day'), findsOneWidget);
      expect(find.text('Section 1, Module 1: Reading and Writing Questions'), findsOneWidget);
      expect(find.byKey(const ValueKey('review.submit')), findsOneWidget);
      expect(find.text('Next'), findsOneWidget);
      // No "current" marking on the review grid.
      expect(find.bySemanticsLabel(RegExp(r'current$')), findsNothing);
      await h.tap(find.byKey(const ValueKey('review.back')));
      expect(h.session.phase, ExamPhase.running);
      h.session.openReview();
      await tester.pump();
      await h.tap(find.byKey(const ValueKey('cell.4')));
      expect(h.session.phase, ExamPhase.running);
      expect(h.session.currentIndex, 4);
      h.session.openReview();
      await tester.pump();
      await h.tap(find.byKey(const ValueKey('review.submit')));
      expect(h.session.phase, ExamPhase.transition);
      expect(find.text('Continuing to Module 2'), findsOneWidget);
      expect(find.text('Section 1, Module 2: Reading and Writing'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      expect(h.session.phase, ExamPhase.running);
      expect(find.text('Section 1, Module 2: Reading and Writing'), findsOneWidget);
      expect(find.text('Question 1 of 3'), findsOneWidget);
    });

    testWidgets('last module says Submit; the hand-in shows Submitting… then exits', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.openReview();
      await tester.pump();
      await h.tap(find.byKey(const ValueKey('review.submit')));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      h.session.openReview();
      await tester.pump();
      expect(find.text('Submit'), findsOneWidget);
      await h.tap(find.text('Submit'));
      expect(find.text('Submitting…'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      await tester.pump();
      expect(h.session.phase, ExamPhase.done);
      expect(h.exits, [const RunnerExit(ExamDoneReason.submitted)]);
    });

    testWidgets('midterm: the locked note instead of Next/Submit', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      h.session.openReview();
      await tester.pump();
      expect(find.byKey(const ValueKey('review.submit')), findsNothing);
      expect(
        find.text(
          "Keep reviewing your answers — you can't submit early. The midterm submits automatically when time runs out.",
        ),
        findsOneWidget,
      );
    });
  });

  group('screens', () {
    testWidgets('Welcome: Start enters full screen and starts the clock', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.math(tick: false));
      expect(find.text('PAST PAPER'), findsOneWidget);
      expect(find.text('Section 2, Module 1: Math'), findsOneWidget);
      expect(find.text('35 min'), findsOneWidget);
      expect(find.text('6'), findsOneWidget);
      expect(find.text(welcomeFullscreenBullet), findsOneWidget);
      expect(h.session.phase, ExamPhase.welcome);
      await h.tap(find.text('Start'));
      expect(h.window!.log, ['fullscreen on']);
      expect(h.session.phase, ExamPhase.running);
      expect(h.session.log.first, 'start');
    });

    testWidgets('Welcome without window controls: no full-screen line', (tester) async {
      await RunnerHarness.pump(tester, session: FakeExamSession.math(tick: false), windowControls: false);
      expect(find.text(welcomeFullscreenBullet), findsNothing);
    });

    testWidgets('Loading', (tester) async {
      await RunnerHarness.pump(tester, session: FakeExamSession.math(initialPhase: ExamPhase.loading, tick: false));
      expect(find.text('Loading exam…'), findsOneWidget);
    });

    testWidgets('midterm transition waits for module 2 and says so', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      h.session.setRemaining(Duration.zero);
      await tester.pump();
      expect(find.text('Continuing to Module 2'), findsOneWidget);
      expect(find.textContaining('opens as soon as it arrives'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      expect(find.text('October Midterm · Math — Module 2'), findsOneWidget);
    });

    testWidgets('midterm offline at the boundary waits with the saved-on-this-computer screen', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      h.session.online = false;
      h.session.setRemaining(Duration.zero);
      await tester.pump();
      expect(h.session.phase, ExamPhase.offlineWaiting);
      expect(find.text('Saved on this computer — will send when you’re back online'), findsOneWidget);
      h.session.online = true;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      expect(h.session.phase, ExamPhase.running);
    });

    testWidgets('a terminated midterm leaves the runner', (tester) async {
      final h = await RunnerHarness.pump(tester, session: FakeExamSession.midterm(tick: false));
      h.session.simulateOffscreen(violations: 3);
      await tester.pump();
      await tester.pump();
      expect(h.exits, [const RunnerExit(ExamDoneReason.terminated)]);
    });

    testWidgets('an external overlay is drawn on top and the runner goes inert', (tester) async {
      await RunnerHarness.pump(
        tester,
        overlay: const ColoredBox(key: ValueKey('ext'), color: Color(0x80000000)),
      );
      expect(find.byKey(const ValueKey('ext')), findsOneWidget);
      final state = tester.state<ExamRunnerScreenState>(find.byType(ExamRunnerScreen));
      expect(state.shortcutsEnabled, isFalse);
    });
  });

  group('timer toasts', () {
    testWidgets('5 minutes, 1 minute and time up, once each per module', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.session.setRemaining(const Duration(seconds: 300));
      await tester.pump();
      expect(find.text('5 minutes remaining in this module.'), findsOneWidget);
      h.session.setRemaining(const Duration(seconds: 250));
      await tester.pump(const Duration(seconds: 8));
      expect(find.text('5 minutes remaining in this module.'), findsNothing, reason: 'fires once, shown 8 s');
      h.session.setRemaining(const Duration(seconds: 60));
      await tester.pump();
      expect(find.text('1 minute remaining in this module.'), findsOneWidget);
      h.session.setRemaining(Duration.zero);
      await tester.pump();
      expect(
        find.text('Time’s up — submitting this module…'),
        findsNothing,
        reason: 'the transition screen replaces the frame; the pill only shows while answering',
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(seconds: 9));
    });
  });

  group('report a problem', () {
    Future<RunnerHarness> openReport(WidgetTester tester, {bool custom = true}) async {
      final h = await RunnerHarness.pump(tester, customSubmitter: custom);
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      await tester.pump(const Duration(milliseconds: 500));
      return h;
    }

    testWidgets('sends {system, question_id, category, message, attempt_id} and thanks', (tester) async {
      final h = await openReport(tester);
      expect(find.text('Question 1 — tell us what looks wrong.'), findsOneWidget);
      await h.tap(find.byKey(const ValueKey('report.category')));
      await h.tap(find.byKey(const ValueKey('report.category.answer_key')));
      expect(find.text('Answer key looks wrong'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('report.message')), '  B is right  ');
      await h.tap(find.text('Send report'));
      await tester.pump();
      final r = h.reports.single;
      expect(r.toJson(), {
        'system': 'exam',
        'question_id': 2001,
        'category': 'answer_key',
        'message': 'B is right',
        'attempt_id': h.session.attemptId,
      });
      expect(find.byKey(const ValueKey('report.card')), findsNothing);
      expect(find.text('Thanks! Your report was sent to our team.'), findsOneWidget);
    });

    testWidgets('deduped and queued outcomes', (tester) async {
      final h = await openReport(tester);
      h.reportOutcome = ReportOutcome.deduped;
      await h.tap(find.text('Send report'));
      await tester.pump();
      expect(find.text("You've already reported this question — thanks!"), findsOneWidget);
    });

    testWidgets('a failed send keeps the dialog open with the error', (tester) async {
      final h = await openReport(tester);
      h.reportError = const ApiError(
        status: 400,
        body: ApiErrorBody(code: 'bad', detail: 'Message is too long.'),
      );
      await h.tap(find.text('Send report'));
      await tester.pump();
      expect(find.byKey(const ValueKey('report.card')), findsOneWidget);
      expect(find.text('Message is too long.'), findsOneWidget);
      expect(find.text('Error'), findsOneWidget);
    });

    testWidgets('Cancel, ×, Escape and the scrim close it', (tester) async {
      final h = await openReport(tester);
      await h.tap(find.text('Cancel'));
      expect(find.byKey(const ValueKey('report.card')), findsNothing);
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      await h.tap(find.byKey(const ValueKey('report.close')));
      expect(find.byKey(const ValueKey('report.card')), findsNothing);
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      await tester.pump();
      await h.key(LogicalKeyboardKey.escape);
      expect(find.byKey(const ValueKey('report.card')), findsNothing);
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      await tester.tapAt(const Offset(30, 400));
      await tester.pump();
      expect(find.byKey(const ValueKey('report.card')), findsNothing);
    });

    testWidgets('the default submitter goes through ExamSession.reportProblem', (tester) async {
      final h = await openReport(tester, custom: false);
      await h.tap(find.text('Send report'));
      await tester.pump();
      expect(h.session.log, contains('reportProblem 2001 wrong_answer'));
      expect(find.text('Thanks! Your report was sent to our team.'), findsOneWidget);
    });

    testWidgets('the student\'s selection pre-fills the details as a quote', (tester) async {
      final h = await RunnerHarness.pump(tester, scriptedContent: false);
      h.content.emit(const ReadyMessage(build: 'test', protocol: islandProtocolVersion));
      await tester.pump();
      await h.tap(find.text('More'));
      await h.tap(find.text('Report a problem'));
      final get = h.content.postedOf<SelectionGetMessage>().single;
      h.content.emit(SelectionCurrentMessage(req: get.req, qid: 2001, container: 'passage', text: 'thirty-one'));
      await tester.pump();
      await tester.pump();
      final field = tester.widget<TextField>(find.byKey(const ValueKey('report.message')));
      expect(field.controller!.text, '"thirty-one"\n');
    });
  });

  group('highlight toolbar', () {
    Future<RunnerHarness> withSelection(WidgetTester tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('Highlights & Notes'));
      h.content.emit(
        const SelectionMessage(
          selectionId: 'sel-1',
          qid: 2001,
          container: 'passage',
          start: 4,
          end: 12,
          text: 'quiet bay',
          rect: IslandRect(x: 300, y: 200, w: 120, h: 20),
        ),
      );
      await tester.pump();
      await tester.pump();
      return h;
    }

    testWidgets('a selection is painted yellow at once and the toolbar opens over it', (tester) async {
      final h = await withSelection(tester);
      final apply = h.content.postedOf<AnnotApplyMessage>().single;
      expect(apply.selectionId, 'sel-1');
      expect(apply.op, 'highlight');
      expect(apply.color, 'yellow');
      final bar = tester.getRect(find.byKey(const ValueKey('toolbar')));
      // The island starts under the header's colour rule, at the window's left edge.
      final islandTop = tester.getRect(find.byType(SatColorRule).first).bottom;
      // Centred on the selection, 10 px above it, in window coordinates.
      expect(bar.center.dx, closeTo(360, 0.5));
      expect(bar.bottom, closeTo(islandTop + 200 - 10, 0.5));
    });

    testWidgets('recolour, underline, note, delete', (tester) async {
      final h = await withSelection(tester);
      await h.tap(find.byKey(const ValueKey('toolbar.color.blue')));
      var apply = h.content.postedOf<AnnotApplyMessage>().last;
      expect((apply.op, apply.color, apply.selectionId), ('highlight', 'blue', 'sel-1'));
      expect(h.state.tools.activeColor, HighlightColor.blue);
      await h.tap(find.byKey(const ValueKey('toolbar.underline.dashed')));
      apply = h.content.postedOf<AnnotApplyMessage>().last;
      expect((apply.op, apply.underline), ('underline', 'dashed'));
      await h.tap(find.byKey(const ValueKey('toolbar.note')));
      expect(find.byKey(const ValueKey('panel.notes')), findsOneWidget);
      expect(h.session.notes, '> "quiet bay"\n');
      await h.tap(find.byKey(const ValueKey('toolbar.delete')));
      apply = h.content.postedOf<AnnotApplyMessage>().last;
      expect(apply.op, 'remove');
      expect(find.byKey(const ValueKey('toolbar')), findsNothing);
    });

    testWidgets('the next selection uses the last colour picked', (tester) async {
      final h = await withSelection(tester);
      await h.tap(find.byKey(const ValueKey('toolbar.color.pink')));
      h.content.emit(
        const SelectionMessage(
          selectionId: 'sel-2',
          qid: 2001,
          container: 'question',
          start: 0,
          end: 3,
          text: 'Which',
          rect: IslandRect(x: 10, y: 400, w: 40, h: 18),
        ),
      );
      await tester.pump();
      await tester.pump();
      final apply = h.content.postedOf<AnnotApplyMessage>().last;
      expect((apply.selectionId, apply.color), ('sel-2', 'pink'));
    });

    testWidgets('selection.clear, Escape and an outside click dismiss it', (tester) async {
      final h = await withSelection(tester);
      h.content.emit(const SelectionClearMessage());
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('toolbar')), findsNothing);
      h.content.emit(
        const AnnotClickMessage(
          annotId: 'a-1',
          qid: 2001,
          container: 'passage',
          rect: IslandRect(x: 50, y: 300, w: 60, h: 18),
          current: IslandAnnotationStyle(color: 'blue', underline: 'solid'),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('toolbar')), findsOneWidget);
      expect(find.bySemanticsLabel('Blue highlight'), findsOneWidget);
      await h.key(LogicalKeyboardKey.escape);
      expect(find.byKey(const ValueKey('toolbar')), findsNothing);
      h.content.emit(
        const AnnotClickMessage(
          annotId: 'a-1',
          qid: 2001,
          container: 'passage',
          rect: IslandRect(x: 50, y: 300, w: 60, h: 18),
          current: IslandAnnotationStyle(),
        ),
      );
      await tester.pump();
      await tester.pump();
      await tester.tapAt(const Offset(30, 40)); // the header
      await tester.pump();
      expect(find.byKey(const ValueKey('toolbar')), findsNothing);
    });

    testWidgets('a selection for another question is ignored', (tester) async {
      final h = await RunnerHarness.pump(tester);
      h.content.emit(
        const SelectionMessage(
          selectionId: 's',
          qid: 2005,
          container: 'passage',
          start: 0,
          end: 1,
          text: 'x',
          rect: IslandRect(x: 1, y: 1, w: 1, h: 1),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('toolbar')), findsNothing);
      expect(h.content.postedOf<AnnotApplyMessage>(), isEmpty);
    });
  });

  group('calculator', () {
    Future<RunnerHarness> math(WidgetTester tester, {bool native = true}) => RunnerHarness.pump(
      tester,
      session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
      nativeScientificOnly: native,
    );

    testWidgets('first open creates the Desmos island and initialises it from the saved state', (tester) async {
      final h = await math(tester);
      h.session.saveDesmosState({'graph': 1});
      await h.tap(find.text('Calculator'));
      await tester.pump();
      await tester.pump();
      expect(h.desmosHosts, hasLength(1));
      final desmos = h.desmosHosts.single;
      expect(desmos.kind, IslandKind.desmos);
      final init = desmos.postedOf<DesmosInitMessage>().single;
      expect(init.mode, 'graphing');
      expect(init.state, {'graph': 1});
      expect(find.byKey(const ValueKey('calc.loading')), findsNothing);
      expect(find.text('Graphing'), findsOneWidget);
      // The question keeps 500 px free for it.
      expect(h.content.postedOf<ViewSetMessage>().last.calcReservePx, 500);
    });

    testWidgets('tabs, enlarge, close; reopening keeps the island and starts at normal size', (tester) async {
      final h = await math(tester);
      await h.tap(find.text('Calculator'));
      await tester.pump();
      final desmos = h.desmosHosts.single;
      await h.tap(find.text('Scientific'));
      await tester.pump();
      expect(desmos.postedOf<DesmosModeMessage>().last.mode, 'scientific');
      await h.tap(find.byKey(const ValueKey('calc.enlarge')));
      expect(tester.getSize(find.byKey(const ValueKey('panel.calculator'))), const Size(720, 700));
      expect(h.content.postedOf<ViewSetMessage>().last.calcReservePx, 760);
      await h.tap(find.byKey(const ValueKey('panel.close.Calculator')));
      expect(find.byKey(const ValueKey('panel.calculator')), findsNothing);
      expect(desmos.visible, isFalse);
      expect(h.content.postedOf<ViewSetMessage>().last.calcReservePx, 0);
      await h.tap(find.text('Calculator'));
      await tester.pump();
      expect(h.desmosHosts, hasLength(1), reason: 'the island is kept until the runner closes');
      expect(tester.getSize(find.byKey(const ValueKey('panel.calculator'))), const Size(460, 560));
      expect(desmos.visible, isTrue);
    });

    testWidgets('graph changes are saved through the session', (tester) async {
      final h = await math(tester);
      await h.tap(find.text('Calculator'));
      await tester.pump();
      final desmos = h.desmosHosts.single;
      desmos.desmosStateValue = {'expressions': 2};
      desmos.emit(const DesmosChangedMessage());
      await tester.pump();
      await tester.pump();
      expect(h.session.desmosState, {'expressions': 2});
    });

    testWidgets('Desmos failing (offline) falls back to the native scientific calculator', (tester) async {
      final h = await math(tester);
      await h.tap(find.text('Calculator'));
      await tester.pump();
      h.desmosHosts.single.emit(const DesmosFailedMessage(reason: 'offline'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(ScientificCalculator), findsOneWidget);
      await h.tap(find.byKey(const ValueKey('sci.key.7')));
      await h.tap(find.byKey(const ValueKey('sci.key.×')));
      await h.tap(find.byKey(const ValueKey('sci.key.6')));
      await h.tap(find.byKey(const ValueKey('sci.equals')));
      expect(find.text('42'), findsWidgets);
    });

    testWidgets('scientific-only midterm: native scientific calculator, no Desmos island, no tabs', (tester) async {
      final h = await RunnerHarness.pump(tester, session: scientificMidterm());
      await h.tap(find.text('Calculator'));
      await tester.pump();
      expect(find.text('Scientific Calculator'), findsOneWidget);
      expect(find.text('Graphing'), findsNothing);
      expect(find.byType(ScientificCalculator), findsOneWidget);
      expect(h.desmosHosts, isEmpty);
    });

    testWidgets('no calculator reserve on a grid-in question', (tester) async {
      final h = await math(tester);
      await h.tap(find.text('Calculator'));
      await tester.pump();
      h.session.goTo(1); // 1002 is a grid-in
      await tester.pump();
      await tester.pump();
      expect(h.content.postedOf<ViewSetMessage>().last.calcReservePx, 0);
    });

    testWidgets('the panel drags by its title bar and stays on screen', (tester) async {
      final h = await math(tester);
      await h.tap(find.text('Calculator'));
      await tester.pump();
      final before = tester.getTopLeft(find.byKey(const ValueKey('panel.calculator')));
      await tester.drag(find.byKey(const ValueKey('panel.titlebar')).first, const Offset(200, 50));
      await tester.pump();
      final after = tester.getTopLeft(find.byKey(const ValueKey('panel.calculator')));
      expect(after - before, const Offset(200, 50));
      await tester.drag(find.byKey(const ValueKey('panel.titlebar')).first, const Offset(5000, 5000));
      await tester.pump();
      final clamped = tester.getTopLeft(find.byKey(const ValueKey('panel.calculator')));
      expect(clamped, const Offset(1366 - 120, 768 - 60));
    });
  });

  group('reference and notes', () {
    testWidgets('Reference opens the sheet and its × closes it', (tester) async {
      final h = await RunnerHarness.pump(
        tester,
        session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
      );
      await h.tap(find.text('Reference'));
      expect(find.text('Reference Sheet'), findsOneWidget);
      expect(find.text('The number of radians of arc in a circle is 2π.'), findsOneWidget);
      await h.tap(find.byKey(const ValueKey('panel.close.Reference Sheet')));
      expect(find.text('Reference Sheet'), findsNothing);
    });

    testWidgets('Notes: typing saves to the attempt\'s local notes; shortcuts stay off while typing', (tester) async {
      final h = await RunnerHarness.pump(tester);
      await h.tap(find.text('More'));
      await h.tap(find.text('Notes'));
      await tester.tap(find.byKey(const ValueKey('notes.field')));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('notes.field')), 'came back to 4');
      await tester.pump();
      expect(h.session.notes, 'came back to 4');
      await h.key(LogicalKeyboardKey.keyC, character: 'c');
      expect(h.session.answerFor(2001), 'B', reason: 'C typed into notes is not an answer');
      // Clicking outside the field gives the keys back to the runner.
      await tester.tapAt(const Offset(500, 30));
      await tester.pump();
      await h.key(LogicalKeyboardKey.keyC, character: 'c');
      expect(h.session.answerFor(2001), 'C');
      await h.tap(find.byKey(const ValueKey('panel.close.Notes')));
      expect(find.byKey(const ValueKey('panel.notes')), findsNothing);
    });
  });

  group('island focus and browser habits', () {
    testWidgets('a click on the card hands the keyboard to the island; a click on the frame takes it back', (
      tester,
    ) async {
      final h = await RunnerHarness.pump(tester);
      await tester.tapAt(const Offset(683, 400));
      await tester.pump();
      expect(h.content.focused, isTrue);
      await tester.tapAt(const Offset(40, 30));
      await tester.pump();
      expect(h.content.focused, isFalse);
    });

    testWidgets('no hand cursor anywhere in the frame', (tester) async {
      final h = await RunnerHarness.pump(
        tester,
        session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
      );
      await h.tap(find.text('More'));
      final regions = tester.widgetList<MouseRegion>(
        find.descendant(of: find.byType(ExamRunnerScreen), matching: find.byType(MouseRegion)),
      );
      expect(regions.where((r) => r.cursor == SystemMouseCursors.click), isEmpty);
    });

    testWidgets('right-click does nothing', (tester) async {
      final h = await RunnerHarness.pump(tester);
      final before = h.fingerprint();
      await tester.tapAt(const Offset(60, 30), buttons: kSecondaryButton);
      await tester.pump();
      expect(h.fingerprint(), before);
    });
  });

  group('windowed fallback (no drawing over the island)', () {
    testWidgets('overlays freeze the island first, then show; closing restores it', (tester) async {
      final h = await RunnerHarness.pump(tester, canDrawOverIsland: false);
      expect(h.content.visible, isTrue);
      await h.tap(find.text('More'));
      await tester.pump();
      await tester.pump();
      expect(h.content.visible, isFalse);
      expect(find.byKey(const ValueKey('more.menu')), findsOneWidget);
      await tester.tapAt(const Offset(600, 400));
      await tester.pump();
      await tester.pump();
      expect(h.content.visible, isTrue);
    });

    testWidgets('Notes docks beside the card', (tester) async {
      final h = await RunnerHarness.pump(tester, canDrawOverIsland: false);
      h.state.tools.toggleNotes();
      await tester.pump();
      final notes = tester.getRect(find.byKey(const ValueKey('panel.notes')));
      expect(notes.right, 1366);
      expect(notes.width, 360);
      expect(h.content.bounds, isNotNull);
      expect(h.content.bounds!.width, 1366 - 360);
    });
  });

  testWidgets('dispose releases the island and the Desmos host', (tester) async {
    final h = await RunnerHarness.pump(
      tester,
      session: FakeExamSession.math(initialPhase: ExamPhase.running, tick: false),
    );
    await h.tap(find.text('Calculator'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    expect(h.desmosHosts.single.state, IslandHostState.disposed);
    expect(h.content.state, isNot(IslandHostState.disposed), reason: 'the integrator owns a host it passed in');
  });

  test('pure helpers', () {
    expect(calcReserveFor(isMath: true, calculatorOpen: true, enlarged: false, isGridIn: false), 500);
    expect(calcReserveFor(isMath: true, calculatorOpen: true, enlarged: true, isGridIn: false), 760);
    expect(calcReserveFor(isMath: true, calculatorOpen: true, enlarged: true, isGridIn: true), 0);
    expect(calcReserveFor(isMath: false, calculatorOpen: true, enlarged: false, isGridIn: false), 0);
    expect(calcReserveFor(isMath: true, calculatorOpen: false, enlarged: false, isGridIn: false), 0);
    expect(zoomStep(1.0, 1), 1.1);
    expect(zoomStep(1.6, 1), 1.6);
    expect(zoomStep(0.8, -1), 0.8);
    expect(zoomStep(1.3, -1), 1.2);
  });

  test('glyphs used by the runner exist', () {
    expect(LucideGlyphs.calculator.paths, isNotEmpty);
  });
}

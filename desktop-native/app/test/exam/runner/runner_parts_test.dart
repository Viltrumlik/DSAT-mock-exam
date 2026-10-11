// Unit tests for the runner's small parts: the colour rule, the clock format and warning,
// the battery rule, RunnerTools (incl. the 500 ms navigation freeze), the toasts, the tokens.
import 'package:fake_async/fake_async.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/runner/exam_header.dart';
import 'package:mastersat_app/exam/runner/runner_toasts.dart';
import 'package:mastersat_app/exam/runner/runner_tools.dart';
import 'package:mastersat_app/exam/runner/sat_color_rule.dart';
import 'package:mastersat_app/exam/tokens/bluebook_tokens.dart';
import 'package:mastersat_app/native/native_bridge.dart' show BatteryStatus;

void main() {
  group('SatColorRule (SatColorRule.tsx:15)', () {
    test('48 px dashes with 6 px gaps: red, amber, green, navy, repeating every 216 px', () {
      const red = Color(0xFFB91C1C), amber = Color(0xFFCA8A04), green = Color(0xFF15803D), navy = Color(0xFF0F172A);
      expect(SatColorRulePainter.period, 216);
      expect(SatColorRulePainter.colorAt(0), red);
      expect(SatColorRulePainter.colorAt(47.9), red);
      expect(SatColorRulePainter.colorAt(48), isNull);
      expect(SatColorRulePainter.colorAt(53.9), isNull);
      expect(SatColorRulePainter.colorAt(54), amber);
      expect(SatColorRulePainter.colorAt(101.9), amber);
      expect(SatColorRulePainter.colorAt(108), green);
      expect(SatColorRulePainter.colorAt(162), navy);
      expect(SatColorRulePainter.colorAt(209.9), navy);
      expect(SatColorRulePainter.colorAt(212), isNull);
      expect(SatColorRulePainter.colorAt(216), red);
      expect(SatColorRulePainter.colorAt(216 * 7 + 60), amber);
    });

    testWidgets('is 3 px tall and full width', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(width: 500, child: SatColorRule()),
          ),
        ),
      );
      expect(tester.getSize(find.byType(SatColorRule)), const Size(500, 3));
    });
  });

  test('formatClock (utils/time.ts:4-9)', () {
    expect(formatClock(1920), '32:00');
    expect(formatClock(299), '4:59');
    expect(formatClock(61), '1:01');
    expect(formatClock(9), '0:09');
    expect(formatClock(0), '0:00');
    expect(formatClock(-5), '0:00');
    expect(formatClock(3600), '60:00');
  });

  test('timer warning: ≤ 5:00 and > 0', () {
    expect(timerWarningFor(const Duration(seconds: 301)), isFalse);
    expect(timerWarningFor(const Duration(seconds: 300)), isTrue);
    expect(timerWarningFor(const Duration(seconds: 1)), isTrue);
    expect(timerWarningFor(Duration.zero), isFalse);
  });

  test('low battery: a laptop, unplugged, under 25 %', () {
    expect(isLowBattery(null), isFalse);
    expect(isLowBattery(const BatteryStatus(percent: 24, charging: false, hasBattery: true)), isTrue);
    expect(isLowBattery(const BatteryStatus(percent: 25, charging: false, hasBattery: true)), isFalse);
    expect(isLowBattery(const BatteryStatus(percent: 10, charging: true, hasBattery: true)), isFalse);
    expect(isLowBattery(const BatteryStatus(percent: 10, charging: false, hasBattery: false)), isFalse);
    expect(isLowBattery(const BatteryStatus(charging: false, hasBattery: true)), isFalse);
  });

  group('RunnerTools', () {
    test('calculator opens and closes at the normal size (useExamTools.ts:42-46)', () {
      final t = RunnerTools();
      t.toggleCalculator();
      t.toggleCalculatorEnlarge();
      expect((t.calculatorOpen, t.calculatorEnlarged), (true, true));
      t.toggleCalculator();
      expect((t.calculatorOpen, t.calculatorEnlarged), (false, false));
      t.toggleCalculator();
      expect(t.calculatorEnlarged, isFalse);
      t.dispose();
    });

    test('withNavLock runs once, then freezes for 500 ms', () {
      fakeAsync((async) {
        final t = RunnerTools();
        var moves = 0;
        expect(t.withNavLock(() => moves++), isTrue);
        expect(t.navLocked, isTrue);
        expect(t.withNavLock(() => moves++), isFalse);
        async.elapse(const Duration(milliseconds: 499));
        expect(t.withNavLock(() => moves++), isFalse);
        async.elapse(const Duration(milliseconds: 1));
        expect(t.navLocked, isFalse);
        expect(t.withNavLock(() => moves++), isTrue);
        expect(moves, 2);
        t.dispose();
        async.flushTimers();
      });
    });

    test('closeTransient drops what hangs over the card, keeps the floating tools', () {
      final t = RunnerTools()
        ..toggleNavigator()
        ..toggleMore()
        ..toggleDirections()
        ..toggleNotes()
        ..toggleReference()
        ..showToolbar(
          const ToolbarRequest(
            qid: 1,
            container: AnnotationContainer.passage,
            x: 0,
            top: 0,
            bottom: 0,
            selectionId: 's',
          ),
        );
      t.closeTransient();
      expect((t.navigatorOpen, t.moreOpen, t.directionsOpen, t.toolbar), (false, false, false, null));
      expect((t.notesOpen, t.referenceOpen), (true, true));
      t.dispose();
    });

    test('openReport captures the question; the fingerprint follows every field', () {
      final t = RunnerTools();
      final seen = <String>{t.fingerprint};
      void step(VoidCallback f) {
        f();
        expect(seen.add(t.fingerprint), isTrue);
      }

      step(t.toggleCalculator);
      step(t.toggleCalculatorEnlarge);
      step(() => t.setCalculatorTab(CalculatorTab.scientific));
      step(t.toggleReference);
      step(t.toggleNotes);
      step(t.toggleHelp);
      step(t.toggleDirections);
      step(t.toggleNavigator);
      step(t.toggleMore);
      step(t.toggleTimerHidden);
      step(() => t.openReport(questionId: 7, questionNumber: 3));
      step(() => t.setActiveColor(HighlightColor.pink));
      expect((t.reportQuestionId, t.reportQuestionNumber), (7, 3));
      t.dispose();
    });

    test('nothing happens after dispose', () {
      final t = RunnerTools()..dispose();
      t.toggleNotes();
      expect(t.notesOpen, isFalse);
      expect(t.withNavLock(() {}), isFalse);
    });
  });

  group('toasts', () {
    test('timer toast thresholds (ExamRunnerPage.tsx:614-616)', () {
      expect(timerToastFor(301), isNull);
      expect(timerToastFor(300), '5 minutes remaining in this module.');
      expect(timerToastFor(61), '5 minutes remaining in this module.');
      expect(timerToastFor(60), '1 minute remaining in this module.');
      expect(timerToastFor(0), 'Time’s up — submitting this module…');
      expect([300, 120, 60, 1, 0].map(timerToastThreshold), [300, 300, 60, 60, 0]);
    });

    test('notices: newest first, at most three, each for 3.2 s; the timer pill for 8 s', () {
      fakeAsync((async) {
        final t = RunnerToasts();
        for (final m in ['a', 'b', 'c', 'd']) {
          t.push(m);
          async.elapse(const Duration(milliseconds: 100));
        }
        expect(t.notices.map((n) => n.message), ['d', 'c', 'b']);
        async.elapse(const Duration(milliseconds: 3000));
        expect(t.notices.map((n) => n.message), ['d']);
        async.elapse(const Duration(milliseconds: 200));
        expect(t.notices, isEmpty);
        t.showTimer('5 minutes remaining in this module.');
        async.elapse(const Duration(seconds: 7));
        expect(t.timerMessage, isNotNull);
        async.elapse(const Duration(seconds: 1));
        expect(t.timerMessage, isNull);
        t.dispose();
      });
    });
  });

  test('tokens carry the website values the owner named', () {
    expect(BluebookTokens.ruleColors, const [
      Color(0xFFB91C1C),
      Color(0xFFCA8A04),
      Color(0xFF15803D),
      Color(0xFF0F172A),
    ]);
    expect((BluebookTokens.ruleHeight, BluebookTokens.ruleDash, BluebookTokens.ruleGap), (3.0, 48.0, 6.0));
    expect(BluebookTokens.navPillBackground, const Color(0xFF151515));
    expect(BluebookTokens.primaryButton, const Color(0xFF253985));
    expect(BluebookTokens.chromeFont, 'Arial');
    expect(BluebookTokens.readingFont, 'Georgia');
    expect((BluebookTokens.calcReserve, BluebookTokens.calcReserveEnlarged), (500.0, 760.0));
    expect(BluebookTokens.navLock, const Duration(milliseconds: 500));
  });
}

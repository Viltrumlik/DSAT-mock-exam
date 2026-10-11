// "Every button does something" (architecture §9 tier A): in each runner state, every
// visible, enabled click target is pressed on a fresh runner, and something observable must
// change — the session (its action log, phase, zoom, notes), the runner's tool state, a
// message to an island, the window, a toast, an exit, a report, or the text on screen.
// Disabled targets must be on the short list of controls the website disables too.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/runner_style.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/island/protocol.dart';

import 'support/runner_harness.dart';

typedef Scenario = Future<RunnerHarness> Function(WidgetTester tester);

/// "12+3" in the scientific calculator, so C, ⌫, = and 0 each have something to change.
Future<void> typeExpression(RunnerHarness h) async {
  for (final k in ['1', '2', '+', '3']) {
    await h.tap(find.byKey(ValueKey('sci.key.$k')));
  }
}

FakeExamSession mathRunning() => FakeExamSession.math(initialPhase: ExamPhase.running, tick: false);

Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

final scenarios = <String, Scenario>{
  'R&W frame': (t) => RunnerHarness.pump(t, battery: okBattery),
  'R&W frame on the last question': (t) async {
    final h = await RunnerHarness.pump(t);
    h.session.goTo(5);
    await settle(t);
    return h;
  },
  'Math frame': (t) => RunnerHarness.pump(t, session: mathRunning()),
  'midterm frame': (t) => RunnerHarness.pump(t, session: FakeExamSession.midterm(tick: false)),
  'timer hidden and paused': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('Hide'));
    await h.tap(find.text('Pause'));
    return h;
  },
  'low battery': (t) => RunnerHarness.pump(t, battery: lowBattery),
  'More menu': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('More'));
    return h;
  },
  'More menu, midterm': (t) async {
    final h = await RunnerHarness.pump(t, session: FakeExamSession.midterm(tick: false));
    await h.tap(find.text('More'));
    return h;
  },
  'navigator': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('Question 1 of 6'));
    return h;
  },
  'Directions': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('Directions'));
    return h;
  },
  'shortcuts help': (t) async {
    final h = await RunnerHarness.pump(t);
    h.state.tools.toggleHelp();
    await settle(t);
    return h;
  },
  'Check Your Work': (t) async {
    final h = await RunnerHarness.pump(t);
    h.session.openReview();
    await settle(t);
    return h;
  },
  'Check Your Work, midterm': (t) async {
    final h = await RunnerHarness.pump(t, session: FakeExamSession.midterm(tick: false));
    h.session.openReview();
    await settle(t);
    return h;
  },
  'Welcome': (t) => RunnerHarness.pump(t, session: FakeExamSession.math(tick: false)),
  'calculator (Desmos)': (t) async {
    final h = await RunnerHarness.pump(t, session: mathRunning());
    await h.tap(find.text('Calculator'));
    await settle(t);
    return h;
  },
  'calculator (scientific fallback)': (t) async {
    final h = await RunnerHarness.pump(t, session: mathRunning());
    await h.tap(find.text('Calculator'));
    await settle(t);
    h.desmosHosts.single.emit(const DesmosFailedMessage(reason: 'offline'));
    await settle(t);
    await typeExpression(h);
    return h;
  },
  'scientific-only calculator': (t) async {
    final h = await RunnerHarness.pump(t, session: scientificMidterm());
    await h.tap(find.text('Calculator'));
    await typeExpression(h);
    return h;
  },
  'Reference sheet': (t) async {
    final h = await RunnerHarness.pump(t, session: mathRunning());
    await h.tap(find.text('Reference'));
    return h;
  },
  'Notes': (t) async {
    final h = await RunnerHarness.pump(t);
    h.state.tools.toggleNotes();
    await settle(t);
    return h;
  },
  'Report a problem': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('More'));
    await h.tap(find.text('Report a problem'));
    return h;
  },
  'Report a problem, category list': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('More'));
    await h.tap(find.text('Report a problem'));
    await h.tap(find.byKey(const ValueKey('report.category')));
    return h;
  },
  'highlight toolbar': (t) async {
    final h = await RunnerHarness.pump(t);
    await h.tap(find.text('Highlights & Notes'));
    h.content.emit(const SelectionMessage(
        selectionId: 's',
        qid: 2001,
        container: 'passage',
        start: 0,
        end: 5,
        text: 'quiet',
        rect: IslandRect(x: 400, y: 260, w: 80, h: 18)));
    await settle(t);
    return h;
  },
  'Save & Exit offline': (t) async {
    final h = await RunnerHarness.pump(t);
    h.session.online = false;
    await settle(t);
    await h.tap(find.text('More'));
    await h.tap(find.text('Save & Exit'));
    await settle(t);
    return h;
  },
};

/// Targets the website also disables in these states.
const allowedDisabled = {'Back'};

Finder visiblePressables() => find.byType(Pressable).hitTestable();

String labelOf(WidgetTester tester, Element e) {
  final w = e.widget as Pressable;
  return w.semanticLabel ?? w.key.toString();
}

void main() {
  setUpAll(loadRunnerFonts);

  for (final entry in scenarios.entries) {
    testWidgets('every button does something — ${entry.key}', (tester) async {
      final first = await entry.value(tester);
      expect(tester.takeException(), isNull);
      final targets = visiblePressables().evaluate().toList();
      final labels = [for (final e in targets) labelOf(tester, e)];
      expect(labels, isNotEmpty, reason: '${entry.key} shows no buttons');
      final disabled = <String>[];
      for (var i = 0; i < targets.length; i++) {
        final w = targets[i].widget as Pressable;
        if (!w.enabled || w.onTap == null) disabled.add(labels[i]);
        // The calculator's active tab is a no-op, as on the website (setMode to the same mode).
        if (w.selected == true && (labels[i] == 'Graphing' || labels[i] == 'Scientific')) disabled.add(labels[i]);
      }
      expect(disabled.where((l) => !allowedDisabled.contains(l) && l != 'Graphing' && l != 'Scientific'), isEmpty,
          reason: 'unexpectedly disabled in ${entry.key}: $disabled');
      await first.tester.pump(const Duration(seconds: 1));

      final dead = <String>[];
      for (var i = 0; i < labels.length; i++) {
        if (disabled.contains(labels[i])) continue;
        final h = await entry.value(tester);
        final now = visiblePressables().evaluate().toList();
        expect(now.length, labels.length, reason: '${entry.key} is not deterministic');
        expect(labelOf(tester, now[i]), labels[i]);
        final before = h.fingerprint();
        await tester.tap(find.byWidget(now[i].widget).hitTestable().first);
        await settle(tester);
        final after = h.fingerprint();
        if (after == before) dead.add(labels[i]);
        expect(tester.takeException(), isNull, reason: 'pressing ${labels[i]} threw');
        // Let delayed work (the nav freeze, a module switch) finish before the next fresh runner.
        await tester.pump(const Duration(seconds: 1));
        await tester.pump(const Duration(seconds: 9));
      }
      expect(dead, isEmpty, reason: 'buttons that changed nothing in ${entry.key}: $dead (of $labels)');
      // ignore: avoid_print
      print('sweep ${entry.key}: ${labels.length - disabled.length} pressed, ${disabled.length} disabled ($disabled)');
    });
  }
}

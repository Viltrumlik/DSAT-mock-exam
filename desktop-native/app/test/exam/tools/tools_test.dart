// The runner's tools on their own: FloatingPanel, Notes, Report a problem, the Reference
// sheet (its SVG assets), the highlight toolbar's placement, the Desmos controller and panel,
// the scientific calculator, Directions and the shortcuts help.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/runner/runner_tools.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/exam/tokens/bluebook_tokens.dart';
import 'package:mastersat_app/exam/tools/annotation_toolbar.dart';
import 'package:mastersat_app/exam/tools/calculator/desmos_controller.dart';
import 'package:mastersat_app/exam/tools/calculator/desmos_panel.dart';
import 'package:mastersat_app/exam/tools/calculator/scientific_calculator.dart';
import 'package:mastersat_app/exam/tools/directions_overlay.dart';
import 'package:mastersat_app/exam/tools/floating_panel.dart';
import 'package:mastersat_app/exam/tools/keyboard_shortcuts.dart';
import 'package:mastersat_app/exam/tools/notes_panel.dart';
import 'package:mastersat_app/exam/tools/reference_sheet.dart';
import 'package:mastersat_app/exam/tools/report_problem_dialog.dart';
import 'package:mastersat_app/island/fake_island_host.dart';
import 'package:mastersat_app/island/island_host.dart';
import 'package:mastersat_app/island/protocol.dart';

import '../runner/support/runner_harness.dart';

Widget host(Widget child, {Size size = const Size(1366, 768)}) => runnerApp(
  MediaQuery(
    data: MediaQueryData(size: size),
    child: Stack(children: [child]),
  ),
);

Future<void> settle() async {
  for (var i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  setUpAll(loadRunnerFonts);

  group('FloatingPanel (FloatingPanel.tsx)', () {
    testWidgets('resizes from the grip down to its minimum; × closes', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      var closed = 0;
      await tester.pumpWidget(
        host(
          FloatingPanel(
            panelKey: const ValueKey('p'),
            title: 'Notes',
            onClose: () => closed++,
            initial: const Rect.fromLTWH(100, 100, 360, 420),
            minSize: const Size(260, 220),
            child: const SizedBox.expand(),
          ),
        ),
      );
      expect(tester.getRect(find.byKey(const ValueKey('p'))), const Rect.fromLTWH(100, 100, 360, 420));
      await tester.drag(find.byKey(const ValueKey('panel.grip')), const Offset(40, 30));
      await tester.pump();
      expect(tester.getSize(find.byKey(const ValueKey('p'))), const Size(400, 450));
      await tester.drag(find.byKey(const ValueKey('panel.grip')), const Offset(-1000, -1000));
      await tester.pump();
      expect(tester.getSize(find.byKey(const ValueKey('p'))), const Size(260, 220));
      await tester.tap(find.byKey(const ValueKey('panel.close.Notes')));
      expect(closed, 1);
    });

    testWidgets('docked: fills its parent, no drag, no grip', (tester) async {
      setWindowSize(tester, const Size(800, 600));
      await tester.pumpWidget(
        runnerApp(
          Row(
            children: [
              const Expanded(child: SizedBox()),
              SizedBox(
                width: 300,
                child: FloatingPanel(
                  panelKey: const ValueKey('p'),
                  docked: true,
                  title: 'Notes',
                  onClose: () {},
                  child: const SizedBox.expand(),
                ),
              ),
            ],
          ),
        ),
      );
      expect(tester.getRect(find.byKey(const ValueKey('p'))), const Rect.fromLTWH(500, 0, 300, 600));
      expect(find.byKey(const ValueKey('panel.grip')), findsNothing);
      await tester.drag(find.byKey(const ValueKey('panel.titlebar')), const Offset(-100, 50));
      await tester.pump();
      expect(tester.getTopLeft(find.byKey(const ValueKey('p'))), const Offset(500, 0));
    });
  });

  group('NotesPanel (notes/NotesPanel.tsx)', () {
    testWidgets('shows the attempt\'s notes, saves typing, follows outside changes', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      final s = FakeExamSession.readingWriting(tick: false)..setNotes('first');
      await tester.pumpWidget(host(NotesPanel(session: s, onClose: () {})));
      expect(find.text('first'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('notes.field')), 'second');
      expect(s.notes, 'second');
      s.setNotes('second\n> "quote"\n');
      await tester.pump();
      final field = tester.widget<TextField>(find.byKey(const ValueKey('notes.field')));
      expect(field.controller!.text, 'second\n> "quote"\n');
      expect(tester.getRect(find.byKey(const ValueKey('panel.notes'))), BluebookTokens.notesRect);
      s.dispose();
    });

    testWidgets('placeholder says it stays on this device', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      final s = FakeExamSession.readingWriting(tick: false);
      await tester.pumpWidget(host(NotesPanel(session: s, onClose: () {})));
      expect(find.text(notesPlaceholder), findsOneWidget);
      s.dispose();
    });
  });

  group('ReportProblemDialog (ReportProblemModal.tsx)', () {
    Future<(List<QuestionReportRequest>, List<(String, bool)>, List<int>)> pump(
      WidgetTester tester, {
      Future<ReportOutcome> Function(QuestionReportRequest r)? submit,
      Future<String?> Function()? prefill,
    }) async {
      setWindowSize(tester, const Size(1366, 768));
      final sent = <QuestionReportRequest>[];
      final toasts = <(String, bool)>[];
      final closes = <int>[];
      await tester.pumpWidget(
        host(
          Positioned.fill(
            child: ReportProblemDialog(
              questionId: 41,
              questionNumber: 7,
              attemptId: 900,
              submit:
                  submit ??
                  (r) async {
                    sent.add(r);
                    return ReportOutcome.sent;
                  },
              onClose: () => closes.add(1),
              onToast: (m, {error = false}) => toasts.add((m, error)),
              prefill: prefill,
            ),
          ),
        ),
      );
      await tester.pump();
      return (sent, toasts, closes);
    }

    testWidgets('the five categories, in the website\'s words', (tester) async {
      await pump(tester);
      await tester.tap(find.byKey(const ValueKey('report.category')));
      await tester.pump();
      for (final c in ReportCategory.values) {
        expect(find.byKey(ValueKey('report.category.${c.wire}')), findsOneWidget);
      }
      expect(reportCategoryLabels.values, [
        'Wrong / no correct answer',
        'Answer key looks wrong',
        'Typo / unclear wording',
        'Image / figure problem',
        'Something else',
      ]);
      await tester.tap(find.byKey(const ValueKey('report.category.image_figure')));
      await tester.pump();
      expect(find.byKey(const ValueKey('report.category.menu')), findsNothing);
      expect(find.text('Image / figure problem'), findsOneWidget);
    });

    testWidgets('while sending, the buttons are disabled and Send shows a spinner', (tester) async {
      final gate = Completer<ReportOutcome>();
      final (_, toasts, closes) = await pump(tester, submit: (r) => gate.future);
      await tester.tap(find.text('Send report'));
      await tester.pump();
      final state = tester.state<ReportProblemDialogState>(find.byType(ReportProblemDialog));
      expect(state.submitting, isTrue);
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      expect(closes, isEmpty, reason: 'cannot cancel mid-send');
      gate.complete(ReportOutcome.queued);
      await tester.pump();
      expect(closes, [1]);
      expect(toasts.single, (ExamNotice.reportQueued.message, false));
    });

    testWidgets('a failure without detail gets the generic message', (tester) async {
      final (_, toasts, closes) = await pump(tester, submit: (r) async => throw const NetworkError('down'));
      await tester.tap(find.text('Send report'));
      await tester.pump();
      expect(toasts.single, ("We couldn't send your report just now. Please try again.", true));
      expect(closes, isEmpty);
      expect(reportErrorMessage(const ApiError(status: 400, body: ApiErrorBody(detail: 'Too long.'))), 'Too long.');
      expect(reportOutcomeMessage(ReportOutcome.sent), 'Thanks! Your report was sent to our team.');
      expect(reportOutcomeMessage(ReportOutcome.deduped), "You've already reported this question — thanks!");
    });

    testWidgets('the message is capped at 2000 characters and trimmed', (tester) async {
      final (sent, _, _) = await pump(tester);
      await tester.enterText(find.byKey(const ValueKey('report.message')), '  ${'x' * 2100}');
      await tester.pump();
      final field = tester.widget<TextField>(find.byKey(const ValueKey('report.message')));
      expect(field.controller!.text.length, 2000);
      await tester.tap(find.text('Send report'));
      await tester.pump();
      expect(sent.single.message, 'x' * 1998);
      expect(sent.single.questionId, 41);
      expect(sent.single.attemptId, 900);
      expect(sent.single.system, 'exam');
    });

    testWidgets('the subtitle names the question; a selection pre-fills a quote', (tester) async {
      await pump(tester, prefill: () async => '  the bay  ');
      await tester.pump();
      expect(find.text('Question 7 — tell us what looks wrong.'), findsOneWidget);
      final field = tester.widget<TextField>(find.byKey(const ValueKey('report.message')));
      expect(field.controller!.text, '"the bay"\n');
    });
  });

  group('ReferenceSheet (ReferenceSheet.tsx)', () {
    testWidgets('every figure asset is bundled and parses; formulas and notes are there', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      for (final f in [...referencePlaneFigures, ...referenceSolids]) {
        final data = await rootBundle.loadString('assets/runner/reference/${f.asset}.svg');
        expect(data, contains('viewBox="0 0 120 90"'), reason: f.asset);
      }
      await tester.pumpWidget(host(ReferenceSheet(onClose: () {})));
      await tester.pumpAndSettle();
      expect(find.byType(SvgPicture), findsNWidgets(11));
      expect(find.text('REFERENCE'), findsOneWidget);
      expect(find.text('Special Right Triangles'), findsOneWidget);
      for (final n in referenceNotes) {
        expect(find.text(n), findsOneWidget);
      }
      expect(find.textContaining('C = 2πr', findRichText: true), findsOneWidget);
      expect(find.textContaining('V = ℓwh', findRichText: true), findsOneWidget);
      expect(tester.getRect(find.byKey(const ValueKey('panel.reference'))), BluebookTokens.referenceRect);
      expect(tester.takeException(), isNull);
    });
  });

  group('AnnotationToolbar placement (AnnotationToolbar.tsx:44-56)', () {
    const window = Size(1366, 768);
    const bar = Size(300, 44);

    test('centred on the selection, 10 px above it', () {
      expect(toolbarPosition(window, bar, x: 600, top: 300, bottom: 320), const Offset(450, 246));
    });

    test('flips below when there is no room above', () {
      expect(toolbarPosition(window, bar, x: 600, top: 40, bottom: 60), const Offset(450, 70));
    });

    test('kept 8 px inside the window', () {
      expect(toolbarPosition(window, bar, x: 20, top: 300, bottom: 320).dx, 8);
      expect(toolbarPosition(window, bar, x: 1360, top: 300, bottom: 320).dx, 1366 - 300 - 8);
      expect(toolbarPosition(window, bar, x: 600, top: 20, bottom: 760).dy, 768 - 44 - 8);
    });

    testWidgets('the buttons report what they are', (tester) async {
      setWindowSize(tester, window);
      final calls = <String>[];
      await tester.pumpWidget(
        host(
          Positioned.fill(
            child: AnnotationToolbar(
              anchorX: 600,
              anchorTop: 300,
              anchorBottom: 320,
              activeColor: HighlightColor.blue,
              activeUnderline: UnderlineStyle.dotted,
              onColor: (c) => calls.add('color ${c.wire}'),
              onUnderline: (u) => calls.add('underline ${u.wire}'),
              onDelete: () => calls.add('delete'),
              onAddNote: () => calls.add('note'),
            ),
          ),
        ),
      );
      for (final k in [
        'toolbar.color.yellow',
        'toolbar.color.pink',
        'toolbar.underline.solid',
        'toolbar.underline.dashed',
        'toolbar.delete',
        'toolbar.note',
      ]) {
        await tester.tap(find.byKey(ValueKey(k)));
      }
      expect(calls, ['color yellow', 'color pink', 'underline solid', 'underline dashed', 'delete', 'note']);
      final rect = tester.getRect(find.byKey(const ValueKey('toolbar')));
      expect(rect.center.dx, closeTo(600, 0.5));
      expect(rect.bottom, closeTo(290, 0.5));
    });
  });

  group('DesmosController', () {
    late FakeExamSession session;
    late List<FakeIslandHost> hosts;
    setUp(() {
      session = FakeExamSession.math(initialPhase: ExamPhase.running, tick: false);
      hosts = [];
    });
    tearDown(() => session.dispose());

    DesmosController make({bool scripted = true, Duration timeout = const Duration(seconds: 8)}) => DesmosController(
      session: session,
      readyTimeout: timeout,
      factory: (kind) {
        final h = FakeIslandHost(kind, scripted: scripted);
        hosts.add(h);
        return h;
      },
    );

    test('opens once; ready → init with the saved state and mode; tabs → desmos.mode', () async {
      session.saveDesmosState({'e': 1});
      final c = make();
      await c.ensureOpen(CalculatorTab.scientific);
      await settle();
      expect(c.status, DesmosStatus.ready);
      final init = hosts.single.postedOf<DesmosInitMessage>().single;
      expect(init.mode, 'scientific');
      expect(init.state, {'e': 1});
      c.setMode(CalculatorTab.graphing);
      expect(hosts.single.postedOf<DesmosModeMessage>().single.mode, 'graphing');
      c.setMode(CalculatorTab.graphing);
      expect(hosts.single.postedOf<DesmosModeMessage>(), hasLength(1));
      await c.ensureOpen(CalculatorTab.graphing);
      expect(hosts, hasLength(1));
      c.dispose();
    });

    test('desmos.changed asks for the state and saves it', () async {
      final c = make();
      await c.ensureOpen(CalculatorTab.graphing);
      await settle();
      hosts.single.desmosStateValue = {
        'list': [1, 2],
      };
      hosts.single.emit(const DesmosChangedMessage());
      await settle();
      expect(session.desmosState, {
        'list': [1, 2],
      });
      // A state reply nobody asked for is ignored.
      hosts.single.emit(const DesmosStateMessage(req: 999, state: {'x': 0}));
      await settle();
      expect(session.desmosState, {
        'list': [1, 2],
      });
      c.dispose();
    });

    test('desmos.failed → failed (the panel shows the scientific calculator)', () async {
      final c = make();
      await c.ensureOpen(CalculatorTab.graphing);
      await settle();
      hosts.single.emit(const DesmosFailedMessage(reason: 'script'));
      await settle();
      expect((c.status, c.failureReason), (DesmosStatus.failed, 'script'));
      c.dispose();
    });

    test('a page that never says ready fails after the timeout', () async {
      final c = make(scripted: false, timeout: const Duration(milliseconds: 30));
      await c.ensureOpen(CalculatorTab.graphing);
      expect(c.status, DesmosStatus.loading);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect((c.status, c.failureReason), (DesmosStatus.failed, 'timeout'));
      c.dispose();
    });

    test('a crash re-initialises from the last saved state', () async {
      final c = make();
      await c.ensureOpen(CalculatorTab.graphing);
      await settle();
      session.saveDesmosState({'after': true});
      await hosts.single.simulateCrash();
      await settle();
      expect(c.status, DesmosStatus.ready);
      final inits = hosts.single.postedOf<DesmosInitMessage>();
      expect(inits, hasLength(2));
      expect(inits.last.state, {'after': true});
      c.dispose();
    });

    test('dispose closes the island', () async {
      final c = make();
      await c.ensureOpen(CalculatorTab.graphing);
      await settle();
      c.dispose();
      await settle();
      expect(hosts.single.state, IslandHostState.disposed);
    });
  });

  group('DesmosPanel (DesmosCalculator.tsx)', () {
    testWidgets('a veil while loading; the island once ready', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      final session = FakeExamSession.math(initialPhase: ExamPhase.running, tick: false);
      final hosts = <FakeIslandHost>[];
      final c = DesmosController(
        session: session,
        factory: (k) {
          final h = FakeIslandHost(k, scripted: false);
          hosts.add(h);
          return h;
        },
      );
      final tools = RunnerTools()..toggleCalculator();
      await tester.pumpWidget(host(DesmosPanel(controller: c, tools: tools, scientificOnly: false, animate: false)));
      await tester.pump();
      expect(find.byKey(const ValueKey('calc.loading')), findsOneWidget);
      hosts.single.emit(const DesmosReadyMessage(apiVersion: 'v1.11'));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('calc.loading')), findsNothing);
      expect(find.byKey(const ValueKey('calc.island')), findsOneWidget);
      expect(tester.getRect(find.byKey(const ValueKey('panel.calculator'))), BluebookTokens.calculatorRect);
      // The island is told where its body is (windowed mode needs it).
      expect(hosts.single.bounds, isNotNull);
      await tester.pumpWidget(const SizedBox.shrink());
      c.dispose();
      tools.dispose();
      session.dispose();
    });
  });

  group('ScientificCalculator (ScientificCalculator.tsx)', () {
    Future<ScientificCalculatorState> pumpCalc(WidgetTester tester) async {
      setWindowSize(tester, const Size(500, 600));
      await tester.pumpWidget(runnerApp(const SizedBox(width: 460, height: 520, child: ScientificCalculator())));
      return tester.state<ScientificCalculatorState>(find.byType(ScientificCalculator));
    }

    String result(WidgetTester tester) => tester.widget<Text>(find.byKey(const ValueKey('sci.result'))).data!;

    Future<void> keys(WidgetTester tester, List<String> labels) async {
      for (final l in labels) {
        await tester.tap(find.byKey(ValueKey('sci.key.$l')));
        await tester.pump();
      }
    }

    testWidgets('live preview, =, ⌫, C', (tester) async {
      final s = await pumpCalc(tester);
      await keys(tester, ['1', '2', '÷', '4']);
      expect(s.expression, '12/4');
      expect(result(tester), '3');
      await keys(tester, ['⌫']);
      expect(s.expression, '12/');
      expect(result(tester), 'Error');
      await keys(tester, ['8']);
      await tester.tap(find.byKey(const ValueKey('sci.equals')));
      await tester.pump();
      expect(s.expression, '1.5');
      await keys(tester, ['C']);
      expect(s.expression, '');
    });

    testWidgets('degrees by default; RAD changes sin', (tester) async {
      final s = await pumpCalc(tester);
      expect(s.degrees, isTrue);
      await keys(tester, ['sin', '3', '0', ')']);
      expect(result(tester), '0.5');
      await tester.tap(find.byKey(const ValueKey('sci.degrees')));
      await tester.pump();
      expect(find.text('RAD'), findsOneWidget);
      expect(result(tester), isNot('0.5'));
    });

    testWidgets('a broken expression leaves the input on =', (tester) async {
      final s = await pumpCalc(tester);
      await keys(tester, ['(', '2', '+']);
      await tester.tap(find.byKey(const ValueKey('sci.equals')));
      await tester.pump();
      expect(s.expression, '(2+');
    });
  });

  group('DirectionsOverlay and the shortcuts help', () {
    testWidgets('Directions: under the anchor, passage width + 44, 150 px above the bottom', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      var closed = 0;
      await tester.pumpWidget(
        host(
          DirectionsOverlay(
            anchorBottom: 80,
            widthFraction: 0.6,
            isMath: false,
            calculatorAllowed: false,
            onClose: () => closed++,
          ),
        ),
      );
      final r = tester.getRect(find.byKey(const ValueKey('directions.card')));
      expect(r, Rect.fromLTRB(0, 86, 1366 * 0.6 + 44, 768 - 150));
      expect(find.text(directionsRwP2), findsOneWidget);
      // R&W says nothing about calculators, whatever the rule.
      expect(find.textContaining('calculator'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('directions.close')));
      expect(closed, 1);
    });

    // DirectionsOverlay.tsx:40-45 (2026-10-11): the calculator sentence follows the paper's rule.
    for (final allowed in [true, false]) {
      testWidgets('Math directions with the calculator ${allowed ? 'allowed' : 'not available'}', (tester) async {
        setWindowSize(tester, const Size(1366, 768));
        await tester.pumpWidget(
          host(
            DirectionsOverlay(
              anchorBottom: 80,
              widthFraction: 0.5,
              isMath: true,
              calculatorAllowed: allowed,
              onClose: () {},
            ),
          ),
        );
        final expected = allowed
            ? 'The questions in this section address a number of important math skills. '
                  'Use of a calculator is permitted for all questions.'
            : 'The questions in this section address a number of important math skills. '
                  'A calculator is not available on this paper — work these questions by hand.';
        expect(find.text(expected), findsOneWidget);
        expect(find.textContaining(allowed ? 'not available' : 'is permitted'), findsNothing);
      });
    }

    testWidgets('help lists the shortcut table', (tester) async {
      setWindowSize(tester, const Size(1366, 768));
      await tester.pumpWidget(host(Positioned.fill(child: KeyboardShortcutsHelp(onClose: () {}))));
      for (final r in shortcutHelpRows) {
        expect(find.text(r.keys), findsOneWidget);
        expect(find.text(r.action), findsOneWidget);
      }
      // Clicks inside the card do not close it.
      await tester.tap(find.text('Keyboard shortcuts'));
    });
  });
}

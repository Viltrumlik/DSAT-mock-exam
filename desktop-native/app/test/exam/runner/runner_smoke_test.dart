import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/runner_harness.dart';

void main() {
  setUpAll(loadRunnerFonts);

  testWidgets('R&W runner renders the frame', (tester) async {
    final h = await RunnerHarness.pump(tester);
    expect(find.text('Section 1, Module 1: Reading and Writing'), findsOneWidget);
    expect(find.text('Directions'), findsOneWidget);
    expect(find.text('Question 1 of 6'), findsOneWidget);
    expect(find.text('Aziza Karimova'), findsOneWidget);
    expect(h.session.phase, ExamPhase.running);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Math welcome renders', (tester) async {
    final h = await RunnerHarness.pump(tester, session: FakeExamSession.math(tick: false));
    expect(find.text('Start'), findsOneWidget);
    await h.tap(find.text('Start'));
    expect(h.session.phase, ExamPhase.running);
    expect(find.text('Calculator'), findsOneWidget);
    expect(find.text('Reference'), findsOneWidget);
  });
}

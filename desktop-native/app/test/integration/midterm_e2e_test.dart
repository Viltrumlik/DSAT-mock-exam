// A midterm end to end through the WHOLE app: Home → Start → rules → code → pre-check → lock →
// the runner on the content island → module 1 ends at the server's deadline → module 2 →
// handed in → "You're all finished!" → the result screen. The machine is released on every
// way out (handed in, Back from the pre-check, the island unavailable, leaving the done page).
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/exam/launch/island_guard.dart';
import 'package:mastersat_app/exam/launch/midterm_sitting.dart';
import 'package:mastersat_app/exam/runner/runner.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/results/midterm_result_screen.dart';
import 'package:mastersat_app/island/protocol.dart';

import '../exam/runner/support/runner_harness.dart' show loadRunnerFonts;
import 'support/app_rig.dart';

MidtermEngine engineOf(WidgetTester tester) =>
    tester.widget<MidtermSittingScreen>(find.byType(MidtermSittingScreen)).engine;

Future<void> startMidterm(AppRig rig) async {
  await rig.tester.tap(find.widgetWithText(Semantics, 'Start').first);
  await rig.settle();
  expect(find.byType(MidtermSittingScreen), findsOneWidget);
}

Future<void> throughRulesAndCode(AppRig rig) async {
  expect(find.text("I'm ready — continue"), findsOneWidget, reason: 'the rules screen');
  await rig.tapText("I'm ready — continue");
  expect(find.text('Enter your access code'), findsOneWidget);
  await rig.tester.enterText(find.byType(EditableText), fixtureMidtermCode);
  await rig.settle();
  await rig.tapText('Verify & begin');
  expect(find.text('Get this computer ready'), findsOneWidget, reason: 'the pre-check');
}

/// To just past the server deadline of the module on screen (0:00 locks; the hand-in goes at
/// deadline + 750 ms).
Future<void> runOutTheClock(AppRig rig, MidtermEngine e) async {
  await rig.tester.pump(e.moduleClock!.remainingAt(e.mono) + const Duration(milliseconds: 50));
  await rig.settle(const Duration(milliseconds: 200), 10);
}

void main() {
  setUpAll(loadRunnerFonts);

  testWidgets('Start → rules → code → pre-check → lock → runner → hand in → done → result, released', (tester) async {
    final rig = await AppRig.start(tester);
    await rig.pump();
    expect(find.byType(HomeScreen), findsOneWidget);
    await startMidterm(rig);
    final e = engineOf(tester);
    await throughRulesAndCode(rig);
    expect(rig.native.locked, isFalse, reason: 'nothing locks before the student says so');
    expect(rig.hosts, isEmpty, reason: 'no WebView2 on the rules / code / pre-check screens');

    await rig.tapText('Lock and start');
    await rig.settle(const Duration(milliseconds: 200));
    expect(rig.native.locked, isTrue);
    expect(find.byType(ExamRunnerScreen), findsOneWidget);
    final runner = tester.widget<ExamRunnerScreen>(find.byType(ExamRunnerScreen));
    expect(runner.nativeScientificOnly, isFalse, reason: 'junior papers get Desmos Scientific, as on the website');
    expect(runner.battery, same(e.battery), reason: 'one battery reading, drawn by the runner');
    expect(runner.window, isNull, reason: 'the lockdown window is already full screen');
    expect(find.text('87%'), findsOneWidget, reason: 'the battery reading in the header, once');

    final island = rig.content;
    expect(island.postedOf<ModuleLoadMessage>().last.moduleId, e.moduleId);
    final firstModule = e.moduleId;
    final q = e.questions.first;
    island.emit(AnswerChooseMessage(qid: q.id, key: q.choiceKeys.first));
    await rig.settle();
    expect(e.answerFor(q.id), q.choiceKeys.first);

    await runOutTheClock(rig, e);
    expect(e.moduleId, isNot(firstModule), reason: 'module 2 arrived with the hand-in');
    expect(find.byType(ExamRunnerScreen), findsOneWidget);
    expect(rig.content, same(island), reason: 'one content island for the whole sitting');
    expect(rig.native.locked, isTrue);

    await runOutTheClock(rig, e);
    await rig.settle(const Duration(seconds: 1), 6);
    expect(find.text("You're all finished!"), findsOneWidget);
    expect(rig.native.locked, isFalse, reason: 'released the moment it was handed in');
    expect(rig.api.stateOf(e.attemptId), isNot(AttemptState.module2Active));
    await rig.settle(const Duration(seconds: 2), 4);
    expect(find.text('Open the full report'), findsOneWidget);

    await rig.tapText('Open the full report');
    await rig.settle(const Duration(milliseconds: 200), 6);
    expect(find.byType(MidtermSittingScreen), findsNothing);
    expect(find.byType(MidtermResultScreen), findsOneWidget, reason: 'openExam opened the result');
    expect(rig.native.locked, isFalse);
    expect(rig.services.exams!.liveEngines, isEmpty);
    await rig.dispose();
  });

  testWidgets('Back from the pre-check releases the machine; leaving goes Home', (tester) async {
    final rig = await AppRig.start(tester);
    await rig.pump();
    await startMidterm(rig);
    await throughRulesAndCode(rig);
    // The pre-check locks only on "Lock and start"; Back releases whatever was taken.
    await rig.tapText('Back');
    expect(rig.native.locked, isFalse);
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await rig.dispose();
  });

  testWidgets('the question viewer cannot start: the student is told, and leaving releases the machine',
      (tester) async {
    final rig = await AppRig.start(tester, islandOpenFails: true);
    await rig.pump();
    await startMidterm(rig);
    await throughRulesAndCode(rig);
    await rig.tapText('Lock and start');
    await rig.settle(const Duration(milliseconds: 200));
    expect(rig.native.locked, isTrue);
    // WebView2 could not start: the student is told plainly instead of seeing an empty card.
    expect(find.text(IslandUnavailableCopy.title), findsOneWidget);
    expect(find.text(IslandUnavailableCopy.body), findsOneWidget);
    await rig.tapText('Back to Home');
    await rig.settle(const Duration(milliseconds: 200), 6);
    expect(rig.native.locked, isFalse);
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(rig.services.islandDiagnostics!.unavailableCount, 1);
    await rig.dispose();
  });

  testWidgets('a midterm asks for a session that outlasts the sitting before it starts', (tester) async {
    final rig = await AppRig.start(tester, accessLeft: const Duration(hours: 1));
    await rig.pump();
    final refreshesBefore = rig.api.calls.where((c) => c.method == 'authRefresh').length;
    await startMidterm(rig);
    await rig.settle(const Duration(milliseconds: 200));
    expect(rig.api.calls.where((c) => c.method == 'authRefresh').length, refreshesBefore + 1,
        reason: 'ensureFreshFor(2 h 30 min) refreshed the 1-hour token');
    expect(find.text("I'm ready — continue"), findsOneWidget);
    await tester.pump(const Duration(seconds: 16)); // ensureFreshFor's 15 s cap timer
    await rig.dispose();
  });
}

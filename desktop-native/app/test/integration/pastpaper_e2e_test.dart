// A past paper end to end through the WHOLE app: signed-in Home → Start → Welcome → the runner
// on the content island → answers (from the island and the keyboard) → Check Your Work →
// module 2 → Submit → the result screen; Save & Exit then Resume (the same sitting, answers
// kept); "Review questions" in the island's review mode; sign-out blocked while an answer is
// unsent. Since 0.2.4 a past paper is locked down like a midterm from Start until Save & Exit or
// the hand-in (pastpaper_lockdown_test.dart covers the lock in depth; here it rides along).
// Real services, real engine, real file database; fake server, bridge and WebView2.
import 'package:flutter/services.dart' hide KeyMessage;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/auth/auth_controller.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/pastpaper_engine.dart';
import 'package:mastersat_app/exam/launch/pastpaper_sitting.dart';
import 'package:mastersat_app/exam/launch/review_screen.dart';
import 'package:mastersat_app/exam/runner/runner.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/features/home/home_screen.dart';
import 'package:mastersat_app/features/library/booklet_card.dart';
import 'package:mastersat_app/features/results/pastpaper_result_screen.dart';
import 'package:mastersat_app/island/protocol.dart';

import '../exam/runner/support/runner_harness.dart' show loadRunnerFonts;
import 'support/app_rig.dart';

Future<void> pressCard(AppRig rig, int paperId, String label) async {
  final card = find.byWidgetPredicate((w) => w is BookletCard && w.item.paper.id == paperId);
  final button = find.descendant(of: card, matching: find.text(label));
  await rig.tester.ensureVisible(button);
  await rig.tester.pump();
  await rig.tester.tap(button);
  await rig.settle();
}

PastpaperEngine engineOf(WidgetTester tester) =>
    tester.widget<PastpaperSittingScreen>(find.byType(PastpaperSittingScreen)).engine;

/// Next until the last question (the 500 ms Back/Next freeze is waited out).
Future<void> toLastQuestion(AppRig rig, PastpaperEngine e) async {
  while (e.currentIndex < e.questions.length - 1) {
    await rig.tapKey('footer.next');
    await rig.tester.pump(const Duration(milliseconds: 600));
  }
}

void main() {
  setUpAll(loadRunnerFonts);

  testWidgets('Home → Start → answer → module 1 → module 2 → Submit → the result opens', (tester) async {
    final rig = await AppRig.start(tester);
    await rig.pump();
    expect(find.byType(HomeScreen), findsOneWidget);

    await pressCard(rig, 52, 'Start');
    expect(find.byType(ExamRunnerScreen), findsOneWidget, reason: 'the real runner, not a placeholder');
    expect(find.byKey(const ValueKey('welcome.start')), findsOneWidget, reason: 'the Welcome screen starts the clock');
    final e = engineOf(tester);
    expect(e.phase, ExamPhase.welcome);
    expect(rig.native.keepAwakeCalls, [true], reason: 'the display stays awake while a test is open');
    expect(rig.native.batteryReads, greaterThan(0), reason: 'the header shows the battery, as the website does in the app');

    expect(rig.native.locked, isFalse, reason: 'Welcome: nothing locked yet');
    await rig.tapKey('welcome.start');
    expect(e.phase, ExamPhase.running);
    expect(rig.native.locked, isTrue, reason: 'Start locks the machine, as a midterm does');
    final island = rig.content;
    expect(island.postedOf<InitMessage>().single.mode, 'exam');
    expect(island.postedOf<ModuleLoadMessage>().last.moduleId, 301);
    expect(island.postedOf<QuestionShowMessage>().last.qid, 1001);

    // An answer from the island (the student clicked choice B in the card)…
    island.emit(const AnswerChooseMessage(qid: 1001, key: 'B'));
    await rig.settle();
    expect(e.answerFor(1001), 'B');
    expect(island.postedOf<StatePatchMessage>().last.answer, 'B', reason: 'the authoritative echo');

    // …and one from the keyboard (C on question 3; question 2 is a grid-in).
    for (var i = 0; i < 2; i++) {
      await rig.tapKey('footer.next');
      await tester.pump(const Duration(milliseconds: 600));
    }
    expect(island.postedOf<QuestionShowMessage>().last.qid, 1003);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await rig.settle();
    expect(e.answerFor(1003), 'C');

    await toLastQuestion(rig, e);
    await rig.tapKey('footer.submit');
    expect(find.text('Check Your Work'), findsOneWidget);
    await rig.tapKey('review.submit'); // "Next" — module 1 is not the last
    await rig.settle(const Duration(milliseconds: 100), 10);
    expect(e.moduleId, 302, reason: 'module 2 from the bundle, at once');
    expect(e.phase, ExamPhase.running);
    expect(rig.native.locked, isTrue, reason: 'still locked through the module change');
    expect(island.postedOf<ModuleLoadMessage>().last.moduleId, 302);
    expect(rig.api.stateOf(e.attemptId), AttemptState.module2Active);
    expect(rig.api.serverAnswers(e.attemptId, 301), containsPair(1001, 'B'));

    // Module 2: a grid-in typed in the island.
    island.emit(const AnswerInputMessage(qid: 1011, value: '7/2'));
    await rig.settle();
    expect(e.answerFor(1011), '7/2');

    await toLastQuestion(rig, e);
    await rig.tapKey('footer.submit');
    await rig.tapKey('review.submit'); // "Submit"
    await rig.settle(const Duration(milliseconds: 200), 10);

    // Handed in: the runner left, openExam opened the result (scoring → completed).
    await rig.settle(const Duration(seconds: 1), 6);
    expect(find.byType(PastpaperSittingScreen), findsNothing);
    expect(find.byType(PastpaperResultScreen), findsOneWidget);
    expect(rig.api.stateOf(e.attemptId), AttemptState.completed);
    expect(rig.native.locked, isFalse, reason: 'released once the paper was in');
    expect(find.text('Review questions'), findsOneWidget);
    expect(rig.native.keepAwakeCalls.last, isFalse, reason: 'the display may sleep again');

    // Review: the content island in review mode with the marking.
    await rig.tapText('Review questions');
    expect(find.byType(PastpaperReviewScreen), findsOneWidget);
    final review = rig.content;
    expect(review, isNot(same(island)));
    expect(review.postedOf<InitMessage>().single.mode, 'review');
    final shown = review.postedOf<QuestionShowMessage>().last;
    expect(shown.qid, 1001);
    expect(shown.review?.studentAnswer, 'B');
    expect(shown.review?.isCorrect, isTrue);
    expect(find.textContaining('Question 1 of 10', findRichText: true), findsOneWidget);
    await rig.tapText('Next', last: true);
    expect(review.postedOf<QuestionShowMessage>().last.qid, isNot(1001));
    await rig.tapText('Back to results');
    expect(find.byType(PastpaperResultScreen), findsOneWidget);
    await rig.dispose();
  });

  testWidgets('Save & Exit pauses on the server and goes Home; Resume continues the same sitting', (tester) async {
    final rig = await AppRig.start(tester);
    await rig.pump();
    await pressCard(rig, 52, 'Start');
    await rig.tapKey('welcome.start');
    final e = engineOf(tester);
    final attempt = e.attemptId;
    expect(rig.native.locked, isTrue);
    rig.content.emit(const AnswerChooseMessage(qid: 1001, key: 'D'));
    await rig.settle();

    await rig.tapKey('header.more');
    await rig.tapKey('more.saveExit');
    await rig.settle(const Duration(milliseconds: 100), 10);
    expect(find.byType(PastpaperSittingScreen), findsNothing);
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(rig.native.keepAwakeCalls, [true, false]);
    expect(rig.native.locked, isFalse, reason: 'Save & Exit releases the machine');
    // The answer reached the server with the pause (the website's Save & Exit flushes first).
    expect(rig.api.serverAnswers(attempt, 301), containsPair(1001, 'D'));
    expect(rig.api.calls.any((c) => c.method == 'pastpaperPause'), isTrue);

    await rig.settle(const Duration(milliseconds: 200), 5);
    await pressCard(rig, 52, 'Resume');
    await rig.settle(const Duration(milliseconds: 100), 6);
    final again = engineOf(tester);
    expect(again, isNot(same(e)));
    expect(again.attemptId, attempt, reason: 'Resume continues the open sitting, never a new one');
    expect(again.answerFor(1001), 'D');
    expect(again.paused, isTrue, reason: 'the website reopens a paused sitting paused');
    expect(rig.native.locked, isTrue, reason: 'the reopened running sitting locks at once');
    await rig.tapText('Resume');
    await rig.settle();
    expect(again.paused, isFalse);
    await rig.dispose();
  });

  testWidgets('sign-out is blocked while an answer is unsent; it goes once the server has it', (tester) async {
    final rig = await AppRig.start(tester);
    await rig.pump();
    await pressCard(rig, 52, 'Start');
    await rig.tapKey('welcome.start');
    final e = engineOf(tester);

    rig.api.offline = true;
    rig.content.emit(const AnswerChooseMessage(qid: 1001, key: 'A'));
    await rig.settle();
    // Past the quiet-sync delay: the answer is in the outbox, the server is unreachable.
    await tester.pump(const Duration(seconds: 11));
    await rig.settle();
    expect(await tester.runAsync(() => rig.services.exams!.runtime!.unsentCount()), greaterThan(0));

    final blocked = await rig.services.auth.signOut();
    expect(blocked, isA<SignOutBlocked>());
    expect((blocked as SignOutBlocked).unsent.bySource.keys, contains('exam outbox'));
    expect(rig.services.auth.isSignedIn, isTrue);

    rig.api.offline = false;
    e.connectivityHint();
    await rig.settle(const Duration(milliseconds: 200), 10);
    expect(await tester.runAsync(() => rig.services.exams!.runtime!.unsentCount()), 0);
    expect(rig.api.serverAnswers(e.attemptId, 301), containsPair(1001, 'A'));

    // Leave the sitting, then sign out: allowed now, and the runtime closes behind it.
    await rig.tapKey('header.more');
    await rig.tapKey('more.saveExit');
    await rig.settle(const Duration(milliseconds: 100), 10);
    expect(rig.native.locked, isFalse);
    final out = await rig.services.auth.signOut();
    expect(out, isA<SignedOut>());
    await rig.settle(const Duration(milliseconds: 100), 6);
    expect(rig.services.exams!.runtime, isNull);
    await rig.dispose();
  });
}

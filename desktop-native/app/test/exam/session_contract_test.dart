// FakeExamSession honours the ExamSession contract the runner is built against.
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/fake_exam_session.dart';
import 'package:mastersat_app/exam/session_contract.dart';

void main() {
  test('header titles follow the website moduleLabel rule', () {
    expect(
      examModuleTitle(
        kind: ExamKind.pastpaper,
        subject: 'READING_WRITING',
        testTitle: '',
        moduleOrder: 1,
        moduleCount: 2,
      ),
      'Section 1, Module 1: Reading and Writing',
    );
    expect(
      examModuleTitle(kind: ExamKind.pastpaper, subject: 'MATH', testTitle: 'x', moduleOrder: 2, moduleCount: 2),
      'Section 2, Module 2: Math',
    );
    expect(
      examModuleTitle(
        kind: ExamKind.midterm,
        subject: 'MATH',
        testTitle: 'October Midterm · Math',
        moduleOrder: 2,
        moduleCount: 2,
      ),
      'October Midterm · Math — Module 2',
    );
    expect(
      examModuleTitle(kind: ExamKind.midterm, subject: 'MATH', testTitle: ' ', moduleOrder: 1, moduleCount: 1),
      'Math Midterm',
    );
  });

  test('grid-in input rule matches SprInput.tsx', () {
    for (final ok in ['', '7/2', '-3', '3.5', '12345', '.5']) {
      expect(isValidSprInput(ok), isTrue, reason: ok);
    }
    for (final bad in ['123456', '1e3', 'abc', '3,5', ' 1']) {
      expect(isValidSprInput(bad), isFalse, reason: bad);
    }
  });

  test('R&W resume: saved state, answering, flags, eliminations, navigation', () {
    final s = FakeExamSession.readingWriting(tick: false);
    expect(s.kind, ExamKind.pastpaper);
    expect(s.title, 'Section 1, Module 1: Reading and Writing');
    expect(s.questions, hasLength(6));
    expect(s.answerFor(2001), 'B');
    expect(s.isFlagged(2003), isTrue);
    expect(s.annotationsFor(2001)[AnnotationContainer.passage], hasLength(2));
    expect(s.calculatorAllowed, isFalse);
    expect(s.referenceSheetAvailable, isFalse);
    expect(s.canSubmitEarly, isTrue);

    var notified = 0;
    s.addListener(() => notified++);
    s.select(2005, 'A');
    expect(s.answerFor(2005), 'A');
    s.select(2005, 'Z'); // not a choice: ignored
    expect(s.answerFor(2005), 'A');
    s.toggleEliminate(2005, 'A'); // striking the chosen answer clears it
    expect(s.eliminatedFor(2005), {'A'});
    expect(s.answerFor(2005), isNull);
    s.toggleFlag(2005);
    expect(s.isFlagged(2005), isTrue);
    expect(notified, greaterThan(0));

    s.goTo(5);
    s.next(); // last question → Check Your Work
    expect(s.phase, ExamPhase.review);
    expect(s.inputLocked, isTrue);
    s.select(2006, 'A'); // locked on Check Your Work
    expect(s.answerFor(2006), isNull);
    s.goTo(2);
    expect(s.phase, ExamPhase.running);
    expect(s.currentIndex, 2);
    s.dispose();
  });

  test('past paper: welcome starts the clock; submit moves to module 2 then done', () {
    fakeAsync((async) {
      final s = FakeExamSession.math();
      expect(s.phase, ExamPhase.welcome);
      expect(s.calculatorAllowed, isTrue);
      expect(s.referenceSheetAvailable, isTrue);
      final start = s.remaining.value;
      async.elapse(const Duration(seconds: 5));
      expect(s.remaining.value, start, reason: 'the clock waits for Start');
      s.start();
      async.elapse(const Duration(seconds: 5));
      expect(s.remaining.value, start - const Duration(seconds: 5));

      s.select(1002, '7/2');
      expect(s.answerFor(1002), '7/2');
      s.select(1002, '123456'); // too long: ignored
      expect(s.answerFor(1002), '7/2');

      s.openReview();
      s.submitModule();
      expect(s.phase, ExamPhase.transition);
      expect(s.transition, const ModuleTransition(fromOrder: 1, toOrder: 2, waitingForServer: false));
      async.elapse(const Duration(seconds: 1));
      expect(s.phase, ExamPhase.running);
      expect(s.moduleOrder, 2);
      expect(s.questions.first.id, 1011);
      expect(s.remaining.value, const Duration(minutes: 35));

      s.openReview();
      s.submitModule();
      expect(s.phase, ExamPhase.submitting);
      async.elapse(const Duration(seconds: 1));
      expect(s.phase, ExamPhase.done);
      expect(s.doneReason, ExamDoneReason.submitted);
      s.dispose();
    });
  });

  test('pause freezes the countdown; offline pause is refused with a notice', () {
    fakeAsync((async) {
      final s = FakeExamSession.readingWriting();
      final notices = <ExamNotice>[];
      s.notices.listen(notices.add);
      s.pause();
      async.flushMicrotasks();
      final frozen = s.remaining.value;
      async.elapse(const Duration(seconds: 10));
      expect(s.remaining.value, frozen);
      s.resume();
      async.elapse(const Duration(seconds: 2));
      expect(s.remaining.value, frozen - const Duration(seconds: 2));

      s.online = false;
      expect(s.syncStatus, SyncStatus.offline);
      expect(s.canPause, isFalse);
      s.pause();
      async.flushMicrotasks();
      expect(notices.map((n) => n.kind), contains(ExamNoticeKind.pauseNeedsConnection));
      s.dispose();
    });
  });

  test('midterm: no early submit; 0:00 locks input and waits for module 2', () {
    fakeAsync((async) {
      final s = FakeExamSession.midterm();
      expect(s.kind, ExamKind.midterm);
      expect(s.title, 'October Midterm · Math — Module 1');
      expect(s.canSubmitEarly, isFalse);
      expect(s.canSaveAndExit, isFalse);
      expect(s.canPause, isFalse);
      expect(s.referenceSheetAvailable, isFalse);

      s.openReview();
      s.submitModule();
      async.flushMicrotasks();
      expect(s.phase, ExamPhase.review, reason: 'a midterm has no hand-in before 0:00');

      s.setRemaining(const Duration(seconds: 2));
      async.elapse(const Duration(seconds: 2));
      expect(s.phase, ExamPhase.transition);
      expect(s.transition!.waitingForServer, isTrue);
      expect(s.inputLocked, isTrue);
      async.elapse(const Duration(seconds: 1));
      expect(s.moduleOrder, 2);
      expect(s.questions.map((q) => q.id), [3011, 3012, 3013]);
      expect(s.phase, ExamPhase.running);
      s.dispose();
    });
  });

  test('midterm off-screen: countdown locks input; the third strike terminates', () {
    final s = FakeExamSession.midterm(tick: false);
    s.simulateOffscreen();
    expect(s.offscreen.value!.countingDown, isTrue);
    expect(s.inputLocked, isTrue);
    s.simulateReturn();
    expect(s.inputLocked, isFalse);
    s.simulateOffscreen(violations: 3);
    expect(s.phase, ExamPhase.done);
    expect(s.doneReason, ExamDoneReason.terminated);
    s.dispose();
  });

  test('view and tool state: zoom range, highlighter, notes, annotations, media', () async {
    final s = FakeExamSession.math(initialPhase: ExamPhase.running, tick: false);
    s.setZoom(2.0);
    expect(s.zoom, examMaxZoom);
    s.setZoom(0.5);
    expect(s.zoom, examMinZoom);
    s.toggleHighlighter();
    expect(s.highlighterOn, isTrue);
    s.setNotes('check Q4');
    expect(s.notes, 'check Q4');
    s.recordAnnotations(1001, AnnotationContainer.question, const [
      Annotation(start: 0, end: 4, kind: AnnotationKind.highlight, color: HighlightColor.blue),
    ]);
    expect(s.annotationsFor(1001)[AnnotationContainer.question]!.single.color, HighlightColor.blue);
    final keys = s.moduleMediaKeys.toList();
    expect(keys, contains('question_images/math/2025-10-us-a/m1-q4-graph.png'));
    final blob = await s.media(keys.first);
    expect(blob!.bytes.sublist(1, 4), 'PNG'.codeUnits);
    expect(
      await s.reportProblem(questionId: 1001, category: ReportCategory.typoUnclear, message: 'x'),
      ReportOutcome.sent,
    );
    expect(s.log, containsAll(['toggleHighlighter', 'setNotes', 'reportProblem 1001 typo_unclear']));
    s.dispose();
  });
}

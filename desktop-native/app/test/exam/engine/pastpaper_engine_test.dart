import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/exam_engine.dart';
import 'package:mastersat_app/exam/engine/exam_store.dart';
import 'package:mastersat_app/exam/engine/media_cache.dart';
import 'package:mastersat_app/exam/engine/pastpaper_engine.dart';
import 'package:mastersat_app/exam/engine/power_events.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/engine_harness.dart';

PastpaperEngine openFresh(EngineHarness h, {int paper = 52}) {
  final e = h.pastpaper(paper: paper);
  h.run(e.open);
  return e;
}

PastpaperEngine started(EngineHarness h) {
  final e = openFresh(h);
  expect(e.phase, ExamPhase.welcome);
  h.run(e.start);
  h.flush();
  return e;
}

void main() {
  group('open and Welcome', () {
    test('first open downloads the whole test, seals the images, and waits on Welcome', () {
      withHarness((h) {
        final e = h.pastpaper();
        expect(e.phase, ExamPhase.loading);
        h.run(e.open);
        expect(e.phase, ExamPhase.welcome);
        expect(e.attemptId, P52.attempt);
        expect(e.moduleCount, 2);
        expect(e.questions.map((q) => q.id), P52.m1Questions);
        expect(e.title, 'Section 2, Module 1: Math');
        expect(e.referenceSheetAvailable, isTrue);
        expect(e.calculatorAllowed, isTrue);
        // The open asked not to start (a Welcome screen will).
        expect(h.api.calls.first.args['start'], isFalse);
        expect(h.api.stateOf(P52.attempt), AttemptState.notStarted);
        h.elapse(const Duration(seconds: 1));
        // Every image, once, cached by storage key as sealed files.
        expect(h.fetched, hasLength(5));
        final blob = h.run(() => e.media('question_images/math/2025-10-us-a/m1-q4-graph.png'));
        expect(blob, isNotNull);
        expect(blob!.mime, 'image/png');
        expect(Directory('${h.dir.path}/media').listSync().whereType<File>().where((f) => !f.path.endsWith('.part')),
            hasLength(5));
        // Content (both modules) is cached for an offline reopen.
        final rec = h.run(() => h.store.loadAttempt(P52.attempt));
        expect(rec!.contentHashes.keys, containsAll([P52.m1, P52.m2]));
        expect(rec.moduleMeta.map((m) => m.timeLimitMinutes), [35, 35]);
        e.dispose();
      });
    });

    test('Start runs the clock locally at once; the start request goes in the background', () {
      withHarness((h) {
        final e = openFresh(h);
        h.api.latency = const Duration(seconds: 2);
        h.run(e.start);
        expect(e.phase, ExamPhase.running);
        expect(e.remaining.value, const Duration(minutes: 35));
        h.elapse(const Duration(seconds: 1));
        expect(e.remaining.value, const Duration(minutes: 34, seconds: 59));
        h.elapse(const Duration(seconds: 3));
        expect(h.keysOf('pastpaperStart'), ['start.${P52.attempt}']);
        expect(h.api.stateOf(P52.attempt), AttemptState.module1Active);
        // The server started 2 s later than the click: its larger remaining is NOT adopted.
        expect(e.remaining.value, const Duration(minutes: 34, seconds: 56));
        e.dispose();
      });
    });

    test('offline first open says so (with retry) — nothing to show without a cached copy', () {
      withHarness((h) {
        h.api.offline = true;
        final e = openFresh(h);
        expect(e.problem.value?.kind, EngineProblemKind.loadFailed);
        expect(e.problem.value?.canRetry, isTrue);
        expect(e.online, isFalse);
        h.api.offline = false;
        h.run(e.retryOpen);
        expect(e.problem.value, isNull);
        expect(e.phase, ExamPhase.welcome);
        e.dispose();
      });
    });

    test('a paper no longer visible is a clear problem, not a crash', () {
      withHarness((h) {
        final e = openFresh(h, paper: 999);
        expect(e.problem.value?.kind, EngineProblemKind.notAvailable);
        e.dispose();
      });
    });

    test('a resumed active attempt skips Welcome and adopts the server clock and saved work', () {
      withHarness((h) {
        final e = openFresh(h, paper: 51);
        expect(e.phase, ExamPhase.running);
        expect(e.attemptId, 9124);
        expect(e.remaining.value, const Duration(minutes: 22));
        // The fixture's saved answers/flags/highlights come back.
        expect(e.answeredCount, greaterThan(0));
        expect(e.annotationsFor(2001), isNotEmpty);
        e.dispose();
      });
    });
  });

  group('answers and the background safety copy', () {
    test('every click is journaled + answer_state in one transaction, before any network', () {
      withHarness((h) {
        final e = started(h);
        h.api.offline = true;
        e.select(1001, 'B');
        e.toggleFlag(1003);
        e.select(1002, '3/4');
        h.flush();
        final journal = h.run(() => h.store.journal(P52.attempt));
        expect(journal.map((j) => '${j.op.name}:${j.qid}:${j.value ?? ''}'),
            ['answer:1001:B', 'flag:1003:', 'answer:1002:3/4']);
        final state = h.run(() => h.store.answerState(P52.attempt, P52.m1));
        expect(state[1001]!.value, 'B');
        expect(state[1003]!.flagged, isTrue);
        expect(e.answerFor(1002), '3/4');
        e.dispose();
      });
    });

    test('invalid input is ignored: bad grid-in, unknown letters, a struck-out choice', () {
      withHarness((h) {
        final e = started(h);
        e.select(1002, '123456'); // more than 5 characters
        e.select(1002, '1a');
        e.select(1001, 'E');
        e.toggleEliminate(1001, 'C');
        e.select(1001, 'C');
        expect(e.answerFor(1002), isNull);
        expect(e.answerFor(1001), isNull);
        expect(e.eliminatedFor(1001), {'C'});
        // Eliminating the chosen option deselects it (website useAnswers).
        e.select(1001, 'A');
        e.toggleEliminate(1001, 'A');
        expect(e.answerFor(1001), isNull);
        e.dispose();
      });
    });

    test('sync 10 s after the last change, carrying the FULL module map', () {
      withHarness((h) {
        final e = started(h);
        e.select(1001, 'B');
        h.elapse(const Duration(seconds: 9));
        expect(h.keysOf('pastpaperSync'), isEmpty);
        expect(e.syncStatus, SyncStatus.savedLocally);
        h.elapse(const Duration(seconds: 2));
        expect(h.keysOf('pastpaperSync'), ['sync.${P52.attempt}.${P52.m1}.1']);
        final body = h.api.calls.lastWhere((c) => c.method == 'pastpaperSync').args;
        expect((body['answers']! as Map).length, P52.m1Questions.length);
        expect((body['answers']! as Map)['1002'], '');
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'B'});
        expect(e.syncStatus, SyncStatus.synced);
        e.dispose();
      });
    });

    test('a steady stream of changes still syncs within 60 s of the first unsent one', () {
      withHarness((h) {
        final e = started(h);
        for (var i = 0; i < 14; i++) {
          e.select(1001, i.isEven ? 'A' : 'B');
          h.elapse(const Duration(seconds: 5));
        }
        expect(h.keysOf('pastpaperSync'), isNotEmpty);
        final first = h.api.calls.indexWhere((c) => c.method == 'pastpaperSync');
        expect(first, greaterThan(0));
        e.dispose();
      });
    });

    test('Check Your Work syncs at once', () {
      withHarness((h) {
        final e = started(h);
        e.select(1001, 'C');
        e.openReview();
        h.flush();
        expect(e.phase, ExamPhase.review);
        expect(e.inputLocked, isTrue);
        expect(h.keysOf('pastpaperSync'), hasLength(1));
        e.goTo(2);
        expect(e.phase, ExamPhase.running);
        expect(e.currentIndex, 2);
        e.dispose();
      });
    });

    test('navigation: next to the last question opens Check Your Work; back stops at 0', () {
      withHarness((h) {
        final e = started(h);
        e.back();
        expect(e.currentIndex, 0);
        for (var i = 0; i < P52.m1Questions.length - 1; i++) {
          e.next();
        }
        expect(e.currentIndex, P52.m1Questions.length - 1);
        e.next();
        expect(e.phase, ExamPhase.review);
        e.dispose();
      });
    });
  });

  group('module end', () {
    test('Submit hands module 1 in and module 2 starts from the cache at once', () {
      withHarness((h) {
        final e = started(h);
        e.select(1001, 'B');
        e.select(1003, 'D');
        h.api.latency = const Duration(seconds: 3); // a slow network changes nothing on screen
        e.openReview();
        h.run(e.submitModule);
        expect(e.phase, ExamPhase.running);
        expect(e.moduleId, P52.m2);
        expect(e.moduleOrder, 2);
        expect(e.questions.map((q) => q.id), P52.m2Questions);
        expect(e.remaining.value, const Duration(minutes: 35));
        expect(e.eliminatorOn, isFalse);
        expect(e.answerFor(1001), isNull, reason: 'module 2 has its own answers');
        h.elapse(const Duration(seconds: 10));
        expect(h.keysOf('pastpaperSubmit'), ['submit.${P52.attempt}.${P52.m1}']);
        expect(h.api.stateOf(P52.attempt), AttemptState.module2Active);
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'B', 1003: 'D'});
        // The journal row and the outbox item were one transaction.
        final journal = h.run(() => h.store.journal(P52.attempt));
        expect(journal.where((j) => j.op == JournalOp.submit).single.moduleId, P52.m1);
        e.dispose();
      });
    });

    test('the final module goes to submitting, then done after SCORING, then polls the score', () {
      withHarness((h) {
        h.api.scoringPolls = 2;
        final e = started(h);
        e.select(1001, 'B');
        h.run(e.submitModule);
        e.select(1011, '12');
        h.api.latency = const Duration(milliseconds: 500);
        h.run(e.submitModule);
        expect(e.phase, ExamPhase.submitting);
        h.elapse(const Duration(seconds: 1));
        expect(e.phase, ExamPhase.done);
        expect(e.doneReason, ExamDoneReason.submitted);
        expect(e.result.value, isNull);
        h.elapse(const Duration(seconds: 10));
        expect(e.result.value, isNotNull);
        expect(e.result.value!.state, AttemptState.completed);
        final polls = h.callNames().where((n) => n == 'pastpaperResult').length;
        expect(polls, 3); // 2 × SCORING (poll_after_ms 2000) then COMPLETED
        h.elapse(const Duration(minutes: 1));
        expect(h.callNames().where((n) => n == 'pastpaperResult').length, polls, reason: 'polling stops when done');
        // The journal is purged once the server confirmed and nothing is left to send.
        expect(h.run(() => h.store.journal(P52.attempt)), isEmpty);
        expect(h.run(() => h.store.hasReceipt(P52.attempt)), isTrue);
        e.dispose();
      });
    });
  });

  group('pause', () {
    test('pause freezes at once, the server pauses; resume runs again from the server word', () {
      withHarness((h) {
        final e = started(h);
        h.elapse(const Duration(seconds: 30));
        expect(e.canPause, isTrue);
        final ok = h.run(e.pause);
        expect(ok, isTrue);
        expect(e.paused, isTrue);
        final frozen = e.remaining.value;
        h.elapse(const Duration(minutes: 5));
        expect(e.remaining.value, frozen);
        expect(h.api.calls.where((c) => c.method == 'pastpaperPause'), hasLength(1));
        h.run(e.resume);
        expect(e.paused, isFalse);
        h.elapse(const Duration(seconds: 10));
        expect(e.remaining.value, frozen - const Duration(seconds: 10));
        e.dispose();
      });
    });

    test('offline: Pause is refused with the website wording, the clock keeps running', () {
      withHarness((h) {
        final e = started(h);
        final notices = <ExamNotice>[];
        e.notices.listen(notices.add);
        h.api.offline = true;
        final ok = h.run(e.pause);
        expect(ok, isFalse);
        expect(e.paused, isFalse);
        expect(notices, contains(ExamNotice.pauseNeedsConnection));
        expect(e.canPause, isFalse);
        e.dispose();
      });
    });
  });

  group('Save & Exit', () {
    test('online: pauses within 1.5 s and leaves; offline: says the timer keeps running', () {
      withHarness((h) {
        final e = started(h);
        e.select(1001, 'A');
        final r = h.run(e.saveAndExit);
        expect(r.pausedOnServer, isTrue);
        expect(e.phase, ExamPhase.done);
        expect(e.doneReason, ExamDoneReason.savedAndExited);
        h.elapse(const Duration(seconds: 1));
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'A'});
        e.dispose();
      });
      withHarness((h) {
        final e = started(h);
        h.api.offline = true;
        final r = h.run(e.saveAndExit);
        expect(r.pausedOnServer, isFalse);
        e.dispose();
      });
    });

    test('a slow pause is capped at 1.5 s', () {
      withHarness((h) {
        final e = started(h);
        h.api.latency = const Duration(seconds: 4);
        final before = h.async.elapsed;
        final r = h.run(e.saveAndExit);
        expect(h.async.elapsed - before, lessThanOrEqualTo(const Duration(milliseconds: 1600)));
        expect(r.pausedOnServer, isFalse);
        h.elapse(const Duration(seconds: 10));
        e.dispose();
      });
    });
  });

  group('offline sitting', () {
    test('sits module 1 offline, hands in, continues module 2; on reconnect the outbox drains in order '
        'and the server\'s remaining time is accepted', () {
      withHarness((h) {
        final e = openFresh(h);
        h.api.offline = true;
        h.run(e.start);
        e.select(1001, 'B');
        h.elapse(const Duration(seconds: 20));
        expect(e.online, isFalse);
        expect(e.syncStatus, SyncStatus.offline);
        h.elapse(const Duration(minutes: 5));
        h.run(e.submitModule);
        expect(e.moduleId, P52.m2, reason: 'module 2 needs no network');
        e.select(1011, '7');
        h.elapse(const Duration(minutes: 2));
        expect(e.remaining.value, const Duration(minutes: 33));
        h.api.offline = false;
        h.elapse(const Duration(seconds: 40)); // backoff ≤ 30 s
        final sent = h.callNames().where((n) => n.startsWith('pastpaper') && n != 'pastpaperOpen').toList();
        expect(sent.first, 'pastpaperStart', reason: 'start goes first');
        expect(sent.indexOf('pastpaperSubmit'), greaterThan(0));
        expect(h.api.stateOf(P52.attempt), AttemptState.module2Active);
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'B'});
        // The server started module 2 only when the submit arrived: its (larger) remaining
        // is accepted after the time away.
        expect(e.remaining.value, greaterThan(const Duration(minutes: 34)));
        expect(e.online, isTrue);
        h.elapse(const Duration(seconds: 15));
        expect(h.serverAnswers(P52.attempt, P52.m2), {1011: '7'});
        e.dispose();
      });
    });

    test('the final hand-in offline says it will be sent, then completes on reconnect', () {
      withHarness((h) {
        final e = started(h);
        final notices = <ExamNotice>[];
        e.notices.listen(notices.add);
        h.run(e.submitModule);
        h.api.offline = true;
        h.elapse(const Duration(seconds: 1));
        h.run(e.submitModule);
        expect(e.phase, ExamPhase.submitting);
        h.elapse(const Duration(seconds: 5));
        expect(notices, contains(ExamNotice.savedOffline));
        h.api.offline = false;
        h.elapse(const Duration(seconds: 40));
        expect(e.phase, ExamPhase.done);
        e.dispose();
      });
    });
  });

  group('crash recovery', () {
    // Eliminations are memory-only, as on the website (draftStore / useAnswers: never sent,
    // never saved). What IS saved is their one side effect: striking out the chosen option
    // deselects it, and that cleared answer is journaled, kept and sent like any other.
    test('an elimination that clears the chosen answer saves the clear; the strike-out itself is never kept', () {
      withHarness((h) {
        var e = started(h);
        e.select(1001, 'A');
        h.elapse(const Duration(seconds: 11));
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'A'});

        e.toggleEliminate(1001, 'A');
        expect(e.answerFor(1001), isNull);
        expect(e.eliminatedFor(1001), {'A'});
        e.toggleEliminate(1001, 'C'); // not chosen: nothing to save
        h.flush();
        final journal = h.run(() => h.store.journal(P52.attempt));
        expect(journal.map((j) => '${j.op.name}:${j.qid}:${j.value ?? ''}'), ['answer:1001:A', 'clear:1001:'],
            reason: 'the clear is journaled; no elimination ever is');
        final state = h.run(() => h.store.answerState(P52.attempt, P52.m1));
        expect(state[1001]?.value ?? '', '', reason: 'answer_state holds the cleared answer');

        h.elapse(const Duration(seconds: 11));
        expect(h.serverAnswers(P52.attempt, P52.m1), isEmpty, reason: 'the clear reached the server');
        final body = h.api.calls.lastWhere((c) => c.method == 'pastpaperSync').args;
        expect((body['answers']! as Map)['1001'], '');

        // A restart: the cleared answer stays cleared; the strike-outs are gone (memory only).
        h.kill(e);
        e = h.pastpaper();
        h.run(e.open);
        expect(e.phase, ExamPhase.running);
        expect(e.answerFor(1001), isNull);
        expect(e.eliminatedFor(1001), isEmpty);
        e.dispose();
      }, fileDb: true);
    });

    test('a kill mid-module loses nothing: the reopen renders the cached copy and reconciles', () {
      withHarness((h) {
        var e = started(h);
        e.select(1001, 'B');
        h.elapse(const Duration(seconds: 11)); // synced
        e.select(1003, 'C'); // NOT synced yet
        e.toggleFlag(1004);
        h.flush();
        h.kill(e);
        h.elapse(const Duration(seconds: 30)); // time with the app closed counts
        h.api.offline = true; // reopen with no network: from the cache alone
        e = h.pastpaper();
        h.run(e.open);
        expect(e.phase, ExamPhase.running);
        expect(e.answerFor(1001), 'B');
        expect(e.answerFor(1003), 'C');
        expect(e.isFlagged(1004), isTrue);
        expect(e.remaining.value.inSeconds, lessThanOrEqualTo(35 * 60 - 41));
        h.api.offline = false;
        e.dispose();
        h.kill(e);
        e = h.pastpaper();
        h.run(e.open);
        h.elapse(const Duration(seconds: 2));
        // The reconcile found the server behind and synced at once.
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'B', 1003: 'C'});
        expect(h.api.serverFlags(P52.attempt, P52.m1), {1004});
        e.dispose();
      }, fileDb: true);
    });

    test('a module-1 hand-in still in the outbox: the reopen continues module 2 and flushes it', () {
      withHarness((h) {
        var e = started(h);
        e.select(1001, 'A');
        h.api.offline = true;
        h.run(e.submitModule);
        e.select(1012, 'C');
        h.flush();
        h.kill(e);
        h.api.offline = false;
        e = h.pastpaper();
        h.run(e.open);
        expect(e.moduleId, P52.m2);
        expect(e.answerFor(1012), 'C');
        h.elapse(const Duration(seconds: 2));
        expect(h.api.stateOf(P52.attempt), AttemptState.module2Active);
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'A'});
        e.dispose();
      }, fileDb: true);
    });

    test('finished on another device: the local copy is closed and the result shown', () {
      withHarness((h) {
        var e = started(h);
        e.select(1001, 'A');
        h.flush();
        h.kill(e);
        // Elsewhere: the website submits both modules.
        final body = SyncRequest(moduleId: P52.m1, seq: 99, answers: const {1001: 'D'}, flagged: const []);
        h.run(() => h.api.pastpaperSubmit(P52.attempt, body, idempotencyKey: 'web.1'));
        h.run(() => h.api.pastpaperSubmit(P52.attempt,
            SyncRequest(moduleId: P52.m2, seq: 100, answers: const {}, flagged: const []),
            idempotencyKey: 'web.2'));
        e = h.pastpaper();
        h.run(e.open);
        h.elapse(const Duration(seconds: 5));
        // The server made a NEW attempt for this paper (the old one is done): the old local
        // sitting was closed, and the new one waits on Welcome.
        expect(e.attemptId, isNot(P52.attempt));
        expect(e.phase, ExamPhase.welcome);
        final old = h.run(() => h.store.loadAttempt(P52.attempt));
        expect(old!.finished, isTrue);
        e.dispose();
      }, fileDb: true);
    });
  });

  group('sleep and clock changes', () {
    test('sleep while offline: the countdown loses the slept time', () {
      withHarness((h) {
        final e = started(h);
        h.api.offline = true;
        h.elapse(const Duration(seconds: 1));
        final before = e.remaining.value;
        h.clock.slept += const Duration(minutes: 5); // the monotonic clock did not count it
        h.power.debugEmit(PowerEvent.resumed);
        h.elapse(const Duration(seconds: 1));
        expect(e.remaining.value, lessThanOrEqualTo(before - const Duration(minutes: 5)));
        e.dispose();
      });
    });

    test('a wall-clock change (WM_TIMECHANGE) does not end a module early', () {
      withHarness((h) {
        final e = started(h);
        h.elapse(const Duration(seconds: 1));
        h.clock.wallSkew += const Duration(hours: 2);
        h.power.debugEmit(PowerEvent.timeChanged);
        h.elapse(const Duration(seconds: 2));
        expect(e.remaining.value, greaterThan(const Duration(minutes: 34)));
        e.dispose();
      });
    });
  });

  group('low lane', () {
    test('report a problem: sent, then deduped; offline it is queued and sent later', () {
      withHarness((h) {
        final e = started(h);
        final first = h.run(() => e.reportProblem(questionId: 1001, category: ReportCategory.typoUnclear, message: 'x'));
        expect(first, ReportOutcome.sent);
        final again = h.run(() => e.reportProblem(questionId: 1001, category: ReportCategory.typoUnclear, message: 'y'));
        expect(again, ReportOutcome.deduped);
        h.api.offline = true;
        h.elapse(const Duration(seconds: 11)); // let a failure mark us offline
        e.select(1003, 'A');
        h.elapse(const Duration(seconds: 11));
        final queued = h.run(() => e.reportProblem(questionId: 1002, category: ReportCategory.other, message: 'z'));
        expect(queued, ReportOutcome.queued);
        h.api.offline = false;
        h.elapse(const Duration(seconds: 40));
        expect(h.api.calls.where((c) => c.method == 'questionReport'), hasLength(greaterThanOrEqualTo(3)));
        e.dispose();
      });
    });

    test('annotations: stored locally at once, written to the server debounced 2 s', () {
      withHarness((h) {
        final e = started(h);
        const a = Annotation(start: 0, end: 4, kind: AnnotationKind.highlight, color: HighlightColor.yellow);
        e.recordAnnotations(1001, AnnotationContainer.question, const [a]);
        h.elapse(const Duration(seconds: 1));
        expect(h.api.writtenAnnotations, isEmpty);
        h.elapse(const Duration(seconds: 2));
        expect(h.api.writtenAnnotations.keys, ['${P52.attempt}/1001/question']);
        expect(e.annotationsFor(1001)[AnnotationContainer.question], [a]);
        e.dispose();
      });
    });

    test('view, notes and Desmos state survive a reopen', () {
      withHarness((h) {
        var e = started(h);
        e.setZoom(1.3);
        e.setSplit(0.6);
        e.toggleHighlighter();
        e.setNotes('remember q4');
        e.saveDesmosState({'expressions': 1});
        h.flush();
        h.kill(e);
        e = h.pastpaper();
        h.run(e.open);
        expect(e.zoom, 1.3);
        expect(e.split, 0.6);
        expect(e.highlighterOn, isTrue);
        expect(e.notes, 'remember q4');
        expect(e.desmosState, {'expressions': 1});
        e.dispose();
      }, fileDb: true);
    });
  });

  group('media', () {
    test('a failed image is re-signed once and fetched again', () {
      withHarness((h) {
        h.failKeys.add('question_images/math/2025-10-us-a/m1-q6-a.png');
        final e = openFresh(h);
        expect(e.phase, ExamPhase.welcome, reason: 'Start is not blocked forever by one image');
        expect(h.callNames(), contains('media'));
        e.dispose();
      });
    });

    test('mimeForKey', () {
      expect(mimeForKey('a/b.JPG'), 'image/jpeg');
      expect(mimeForKey('a/b.svg'), 'image/svg+xml');
      expect(mimeForKey('a/b'), 'image/png');
    });
  });

  group('errors', () {
    test('a 426 on a send asks for an update and holds the queue (nothing lost)', () {
      withHarness((h) {
        final e = started(h);
        e.select(1001, 'B');
        h.api.failNext(const UpdateRequired(updateUrl: 'https://mastersat.uz/downloads/desktop/'));
        h.elapse(const Duration(seconds: 11));
        expect(e.problem.value?.kind, EngineProblemKind.updateRequired);
        expect(h.run(() => h.store.unsentCount(P52.attempt)), greaterThan(0));
        e.dispose();
      });
    });
  });
}

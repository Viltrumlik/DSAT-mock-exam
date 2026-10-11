import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/exam_store.dart';
import 'package:mastersat_app/exam/engine/lockdown_controller.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import 'support/engine_harness.dart';

/// prepare → code → lock + bind → open.
MidtermEngine sitting(EngineHarness h) {
  final e = h.midterm();
  h.run(() => e.prepare());
  h.run(() => e.prepare(code: fixtureMidtermCode));
  h.run(e.lockAndBind);
  h.run(e.openPaper);
  return e;
}

int syncCount(EngineHarness h) => h.callNames().where((n) => n == 'midtermSync').length;

void main() {
  group('setup', () {
    test('prepare tells the rules and whether a code is needed; a wrong code is refused', () {
      withHarness((h) {
        final e = h.midterm();
        final p = h.run(() => e.prepare());
        expect(p.requiresCode, isTrue);
        expect(p.codeVerified, isFalse);
        expect(p.rules.durationsMin, [35, 35]);
        expect(e.attemptId, M14.attempt);
        expect(e.phase, ExamPhase.loading);
        expect(
          () => h.run(() => e.prepare(code: '000000')),
          throwsA(isA<ApiError>().having((x) => x.code, 'code', 'code_incorrect')),
        );
        final ok = h.run(() => e.prepare(code: fixtureMidtermCode));
        expect(ok.codeVerified, isTrue);
        expect(ok.mayProceed, isTrue);
        e.dispose();
      });
    });

    test('Lock refuses a machine that fails the pre-check, and locks once it is fixed', () {
      withHarness((h) {
        h.native.apps = [const BlockedApp(exe: 'Telegram.exe', name: 'Telegram', closable: true)];
        final e = h.midterm();
        h.run(() => e.prepare(code: fixtureMidtermCode));
        expect(() => h.run(e.lockAndBind), throwsA(isA<PrecheckFailed>()));
        expect(h.native.locked, isFalse);
        h.native.closeApp('Telegram.exe');
        h.run(e.lockAndBind);
        expect(h.native.locked, isTrue);
        expect(e.bound, isTrue);
        // The proof signed the precheck captured at lock time, for this attempt.
        expect(h.native.calls, contains('prove ${M14.attempt}'));
        e.dispose();
        expect(h.native.locked, isFalse, reason: 'a lockdown never outlives the exam');
      });
    });

    test('a required bind that fails releases the machine (never locked behind an error)', () {
      withHarness((h) {
        final e = h.midterm();
        h.run(() => e.prepare(code: fixtureMidtermCode));
        h.api.failNext(const ApiError(
          status: 403,
          body: ApiErrorBody(reason: 'desktop_proof_invalid', desktopRequired: true, detail: 'bad proof'),
        ));
        expect(() => h.run(e.lockAndBind),
            throwsA(isA<MidtermBlocked>().having((b) => b.reason, 'reason', MidtermBlockReason.proofInvalid)));
        expect(h.native.locked, isFalse);
        e.dispose();
      });
    });

    test('a transient bind failure retries the whole chain with a fresh nonce', () {
      withHarness((h) {
        final e = h.midterm();
        h.run(() => e.prepare(code: fixtureMidtermCode));
        h.api.failNext(const NetworkError('reset'));
        h.run(e.lockAndBind);
        expect(e.bound, isTrue);
        expect(h.callNames().where((n) => n == 'midtermChallenge'), hasLength(2));
        e.dispose();
      });
    });

    test('open: the live module in memory only, the server clock, the runner starts', () {
      withHarness((h) {
        final e = sitting(h);
        expect(e.phase, ExamPhase.running);
        expect(e.questions.map((q) => q.id), M14.m1Questions);
        expect(e.title, 'October Midterm · Math — Module 1');
        expect(e.remaining.value, const Duration(minutes: 35));
        expect(e.canPause, isFalse);
        expect(e.canSaveAndExit, isFalse);
        expect(e.canSubmitEarly, isFalse);
        expect(e.referenceSheetAvailable, isFalse);
        // Nothing about the paper is on disk.
        final hash = e.questions.isEmpty ? '' : contentHashOf(e.questions);
        expect(h.run(() => h.store.getContent(hash)), isNull);
        final rec = h.run(() => h.store.loadAttempt(M14.attempt));
        expect(rec!.test, isNull);
        expect(h.run(() => e.media('question_images/midterm/2026-10/m1-q3-circle.png')), isNotNull);
        e.dispose();
      });
    });

    test('open without a verified code goes back to the code screen', () {
      withHarness((h) {
        final e = h.midterm();
        h.run(() => e.prepare());
        h.run(e.lockAndBind);
        expect(() => h.run(e.openPaper), throwsA(isA<MidtermCodeRequired>()));
        e.dispose();
      });
    });
  });

  group('the scoring copy', () {
    test('a heartbeat sync every 15 s even with no change', () {
      withHarness((h) {
        final e = sitting(h);
        final before = syncCount(h);
        h.elapse(const Duration(seconds: 46));
        expect(syncCount(h) - before, 3);
        expect(h.keysOf('midtermSync').first, startsWith('sync.${M14.attempt}.${M14.m1}.'));
        e.dispose();
      });
    });

    test('a sync 3 s after the last change', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(seconds: 1));
        e.select(3001, 'C');
        h.elapse(const Duration(seconds: 2));
        e.select(3002, '6');
        final before = syncCount(h);
        h.elapse(const Duration(milliseconds: 2900));
        expect(syncCount(h), before);
        h.elapse(const Duration(milliseconds: 200));
        expect(syncCount(h), before + 1);
        expect(h.serverAnswers(M14.attempt, M14.m1), {3001: 'C', 3002: '6'});
        e.dispose();
      });
    });

    test('forced syncs at T−60 s and T−10 s', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(minutes: 33, seconds: 59, milliseconds: 500)); // T−60.5 s
        final before = syncCount(h);
        h.elapse(const Duration(seconds: 1));
        expect(syncCount(h), before + 1, reason: 'T−60 s');
        h.elapse(const Duration(seconds: 45)); // includes heartbeats
        final b2 = syncCount(h);
        h.elapse(const Duration(seconds: 5)); // passes T−10 s
        expect(syncCount(h), greaterThan(b2));
        e.dispose();
      });
    });
  });

  group('module end at the server deadline', () {
    test('0:00 locks input, writes journal(deadline), submits at deadline + 750 ms, module 2 from the reply', () {
      withHarness((h) {
        final e = sitting(h);
        e.select(3001, 'C');
        h.elapse(const Duration(minutes: 35) - const Duration(milliseconds: 100));
        expect(e.inputLocked, isFalse);
        h.elapse(const Duration(milliseconds: 150));
        expect(e.remaining.value, Duration.zero);
        expect(e.inputLocked, isTrue);
        expect(e.phase, ExamPhase.transition);
        expect(e.transition, const ModuleTransition(fromOrder: 1, toOrder: 2, waitingForServer: true));
        e.select(3002, '9'); // ignored
        expect(e.answerFor(3002), isNull);
        expect(h.keysOf('midtermSubmit'), isEmpty, reason: 'never before the server deadline');
        final journal = h.run(() => h.store.journal(M14.attempt));
        expect(journal.any((j) => j.op == JournalOp.deadline && j.moduleId == M14.m1), isTrue);
        h.elapse(const Duration(milliseconds: 800));
        expect(h.keysOf('midtermSubmit'), ['submit.${M14.attempt}.${M14.m1}']);
        expect(e.phase, ExamPhase.running);
        expect(e.moduleId, M14.m2);
        expect(e.questions.map((q) => q.id), M14.m2Questions);
        expect(e.remaining.value, greaterThan(const Duration(minutes: 34, seconds: 58)));
        expect(e.inputLocked, isFalse);
        expect(h.serverAnswers(M14.attempt, M14.m1), {3001: 'C'});
        e.dispose();
      });
    });

    test('409 module_not_expired is retried after retry_after_ms, uncapped', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(minutes: 35));
        for (var i = 0; i < 25; i++) {
          h.api.failNext(ApiError(
            status: 409,
            body: ApiErrorBody.fromJson(JsonReader.of(FixtureV1Api.fixture('midterm_submit.response.not_expired.json'))),
          ));
        }
        h.elapse(const Duration(seconds: 30)); // 25 × (500 + 250) ms
        expect(h.keysOf('midtermSubmit').length, 26);
        expect(h.keysOf('midtermSubmit').toSet(), {'submit.${M14.attempt}.${M14.m1}'}, reason: 'one key, forever');
        expect(e.moduleId, M14.m2);
        e.dispose();
      });
    });

    test('a 5xx storm never parks a midterm submit (there is no other way to hand in)', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(minutes: 35));
        for (var i = 0; i < 12; i++) {
          h.api.failNext(const ApiError(status: 503, body: ApiErrorBody(code: 'desktop_v1_disabled')));
        }
        h.elapse(const Duration(minutes: 6));
        expect(e.moduleId, M14.m2);
        expect(e.problem.value, isNull);
        e.dispose();
      });
    });

    test('offline at the boundary: waits, then module 2 on reconnect', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(minutes: 34, seconds: 50));
        h.api.offline = true;
        h.elapse(const Duration(seconds: 20));
        expect(e.phase, ExamPhase.offlineWaiting);
        h.api.offline = false;
        h.elapse(const Duration(seconds: 40));
        expect(e.phase, ExamPhase.running);
        expect(e.moduleId, M14.m2);
        e.dispose();
      });
    });

    test('the final module: submitting, then done, the machine released, the result polled', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(minutes: 35, seconds: 2));
        expect(e.moduleId, M14.m2);
        e.select(3011, 'B');
        h.elapse(const Duration(minutes: 35));
        expect(e.phase, anyOf(ExamPhase.submitting, ExamPhase.done));
        h.elapse(const Duration(seconds: 2));
        expect(e.phase, ExamPhase.done);
        expect(e.doneReason, ExamDoneReason.submitted);
        expect(h.native.locked, isFalse);
        h.elapse(const Duration(seconds: 10));
        expect(e.result.value?.state, AttemptState.completed);
        expect(h.serverAnswers(M14.attempt, M14.m2), {3011: 'B'});
        e.dispose();
      });
    });
  });

  group('off-screen guard', () {
    test('a flicker shorter than the confirm window is not an event', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(seconds: 2)); // armed
        h.native.away = true;
        h.elapse(const Duration(milliseconds: 200));
        h.native.away = false;
        h.elapse(const Duration(seconds: 2));
        expect(h.callNames(), isNot(contains('midtermOffscreen')));
        expect(e.offscreen.value, isNull);
        e.dispose();
      });
    });

    test('one absence = one event with a persisted UUID key; the 3 s grace is shown; a return explains the cost', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(seconds: 2));
        h.native.away = true;
        h.elapse(const Duration(milliseconds: 600));
        expect(e.offscreen.value?.countingDown, isTrue);
        expect(e.offscreen.value?.graceRemaining!.inSeconds, inInclusiveRange(2, 3));
        expect(e.inputLocked, isTrue);
        expect(h.keysOf('midtermOffscreen'), hasLength(1));
        expect(h.keysOf('midtermOffscreen').single, startsWith('off.${M14.attempt}.uuid-'));
        h.elapse(const Duration(seconds: 1));
        h.native.away = false;
        h.elapse(const Duration(milliseconds: 500));
        expect(e.offscreen.value?.countingDown ?? false, isFalse);
        expect(e.offscreen.value?.violations, 1);
        expect(e.offscreenNotice.value, 'You left the exam window. That counted as a warning — 2 chances left.');
        expect(h.keysOf('midtermOffscreen'), hasLength(1));
        e.dispose();
      });
    });

    test('staying away past the grace is the next event; the third ends the sitting (server-side)', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(seconds: 2));
        h.native.away = true;
        h.elapse(const Duration(seconds: 8));
        expect(h.keysOf('midtermOffscreen').toSet(), hasLength(3), reason: 'three distinct UUID keys');
        expect(e.phase, ExamPhase.done);
        expect(e.doneReason, ExamDoneReason.terminated);
        expect(e.offscreen.value?.terminated, isTrue);
        expect(h.native.locked, isFalse);
        expect(h.api.stateOf(M14.attempt), AttemptState.scoring);
        e.dispose();
      });
    });

    test('offline events are queued (never merged) and the local tally shows terminated at the limit', () {
      withHarness((h) {
        final e = sitting(h);
        h.elapse(const Duration(seconds: 2));
        h.api.offline = true;
        for (var i = 0; i < 3; i++) {
          h.native.away = true;
          h.elapse(const Duration(seconds: 1));
          h.native.away = false;
          h.elapse(const Duration(seconds: 1));
        }
        expect(e.doneReason, ExamDoneReason.terminated);
        final queued = h.run(() => h.store.unsentOffscreenEvents(M14.attempt));
        expect(queued, hasLength(3));
        h.api.offline = false;
        h.elapse(const Duration(seconds: 40));
        // The server counted the queued strikes and ended the sitting (the engine then polls the
        // result, which may already have moved SCORING on to COMPLETED).
        expect(h.api.stateOf(M14.attempt), isIn([AttemptState.scoring, AttemptState.completed]));
        expect(h.run(() => h.store.unsentOffscreenEvents(M14.attempt)), isEmpty);
        expect(h.keysOf('midtermOffscreen').toSet(), hasLength(3), reason: 'three events, three keys, never merged');
        e.dispose();
      });
    });

    test('the guard does not watch during the first 800 ms or during the module transition', () {
      withHarness((h) {
        final e = sitting(h);
        h.native.away = true;
        h.elapse(const Duration(milliseconds: 700));
        expect(h.callNames(), isNot(contains('midtermOffscreen')));
        h.native.away = false;
        h.elapse(const Duration(minutes: 35));
        expect(e.phase, ExamPhase.transition);
        h.native.away = true;
        h.elapse(const Duration(milliseconds: 600));
        expect(h.callNames(), isNot(contains('midtermOffscreen')));
        h.native.away = false;
        h.elapse(const Duration(seconds: 3));
        expect(e.moduleId, M14.m2);
        e.dispose();
      });
    });
  });

  group('lockdown liveness and refusals', () {
    test('a watchdog release is re-locked silently on the next heartbeat', () {
      withHarness((h) {
        final e = sitting(h);
        h.native.watchdogReleased = true;
        h.elapse(const Duration(milliseconds: 3100));
        expect(h.native.locked, isTrue);
        expect(e.lockdown.relocks, 1);
        expect(e.blocked.value, isNull);
        e.dispose();
      });
    });

    test('a failed re-lock covers the paper; "Lock and resume" restores it', () {
      withHarness((h) {
        final e = sitting(h);
        h.native.watchdogReleased = true;
        h.native.failLockEnter = true;
        h.elapse(const Duration(milliseconds: 3100));
        expect(e.blocked.value, MidtermBlockReason.lockLost);
        expect(e.lockdown.lost, isTrue);
        h.native.failLockEnter = false;
        h.run(e.relock);
        expect(e.blocked.value, isNull);
        expect(h.native.locked, isTrue);
        e.dispose();
      });
    });

    test('another window took the sitting: blocked, machine released, answers kept', () {
      withHarness((h) {
        final e = sitting(h);
        e.select(3001, 'A');
        // Another window binds (the server swaps the token).
        final ch = h.run(() => h.api.midtermChallenge(M14.attempt));
        h.run(() => h.api.midtermSession(
            M14.attempt,
            LockdownSessionRequest(nonce: ch.nonce, keyId: 'k', mac: 'm', appVersion: '0.2.0', precheck: '{}')));
        h.elapse(const Duration(seconds: 4));
        expect(e.blocked.value, MidtermBlockReason.sessionReplaced);
        expect(h.native.locked, isFalse);
        expect(h.run(() => h.store.unsentCount(M14.attempt)), greaterThan(0), reason: 'held, not lost');
        e.dispose();
      });
    });

    test('a missing token mid-paper is fetched again silently while locked', () {
      withHarness((h) {
        final e = sitting(h);
        h.api.failNext(const ApiError(
          status: 403,
          body: ApiErrorBody(reason: 'desktop_required', desktopRequired: true),
        ));
        e.select(3001, 'B');
        h.elapse(const Duration(seconds: 6));
        expect(e.blocked.value, isNull);
        expect(h.serverAnswers(M14.attempt, M14.m1), {3001: 'B'});
        e.dispose();
      });
    });
  });

  group('recovery and battery', () {
    test('a kill mid-midterm: re-bind, reopen, the journal fills what the server never saw', () {
      withHarness((h) {
        var e = sitting(h);
        e.select(3001, 'C');
        h.elapse(const Duration(seconds: 4)); // synced
        h.api.offline = true;
        e.select(3002, '6'); // never synced
        h.flush();
        h.kill(e);
        h.api.offline = false;
        h.native.lockExit();
        e = h.midterm();
        final p = h.run(() => e.prepare());
        expect(p.attempt.state, AttemptState.module1Active);
        h.run(e.lockAndBind);
        h.run(e.openPaper);
        expect(e.answerFor(3001), 'C');
        expect(e.answerFor(3002), '6');
        h.elapse(const Duration(seconds: 1));
        expect(h.serverAnswers(M14.attempt, M14.m1), {3001: 'C', 3002: '6'});
        e.dispose();
      }, fileDb: true);
    });

    test('a forfeit tallied offline survives a kill: the reopen never shows the paper again', () {
      withHarness((h) {
        var e = sitting(h);
        h.elapse(const Duration(seconds: 2));
        h.api.offline = true;
        for (var i = 0; i < 3; i++) {
          h.native.away = true;
          h.elapse(const Duration(seconds: 1));
          h.native.away = false;
          h.elapse(const Duration(seconds: 1));
        }
        expect(e.doneReason, ExamDoneReason.terminated);
        expect(h.api.stateOf(M14.attempt), AttemptState.module1Active, reason: 'the server has not heard yet');
        h.flush();
        h.kill(e);
        h.native.lockExit();
        h.api.offline = false;
        e = h.midterm();
        final p = h.run(() => e.prepare());
        expect(p.attempt.state, AttemptState.module1Active);
        h.run(e.lockAndBind);
        h.run(e.openPaper);
        expect(e.phase, ExamPhase.done, reason: 'the strikes on this computer still count');
        expect(e.doneReason, ExamDoneReason.terminated);
        expect(h.native.locked, isFalse);
        h.elapse(const Duration(seconds: 10));
        expect(h.api.stateOf(M14.attempt), isIn([AttemptState.scoring, AttemptState.completed]));
        expect(h.keysOf('midtermOffscreen').toSet(), hasLength(3));
        expect(e.result.value?.state, AttemptState.completed);
        e.dispose();
      }, fileDb: true);
    });

    test('low battery is unplugged BELOW 25 % (the website and 0.1.0: percent < 25)', () {
      expect(isLowBattery(const BatteryStatus(percent: 24, charging: false, hasBattery: true)), isTrue);
      expect(isLowBattery(const BatteryStatus(percent: 25, charging: false, hasBattery: true)), isFalse);
      expect(isLowBattery(const BatteryStatus(percent: 26, charging: false, hasBattery: true)), isFalse);
      expect(isLowBattery(const BatteryStatus(percent: 0, charging: false, hasBattery: true)), isTrue);
      expect(isLowBattery(const BatteryStatus(charging: false, hasBattery: true)), isFalse);
      expect(isLowBattery(const BatteryStatus(percent: 10, charging: true, hasBattery: true)), isFalse);
      expect(isLowBattery(const BatteryStatus(percent: 10, charging: false, hasBattery: false)), isFalse);
      expect(isLowBattery(null), isFalse);
      withHarness((h) {
        final e = sitting(h);
        expect(e.battery.value?.percent, 87);
        h.native.batteryStatus = const BatteryStatus(percent: 20, charging: false, hasBattery: true);
        h.elapse(const Duration(seconds: 31));
        expect(isLowBattery(e.battery.value), isTrue);
        e.dispose();
      });
    });

    test('a sitting already finished goes straight to done and polls the result', () {
      withHarness((h) {
        final e = sitting(h);
        h.native.away = true;
        h.elapse(const Duration(seconds: 12));
        e.dispose();
        final again = h.midterm();
        h.run(() => again.prepare());
        expect(again.phase, ExamPhase.done);
        expect(again.doneReason, ExamDoneReason.terminated);
        h.elapse(const Duration(seconds: 6));
        expect(again.result.value?.state, AttemptState.completed);
        again.dispose();
      });
    });
  });
}

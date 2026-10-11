// The 0.1.0 app's three review rounds, carried over as fake_async tests (desktop/app/src/exam:
// useExamState.ts, useExamAttempt.ts, lockdown/useOffscreenGuard.ts). Each group is a bug the
// Tauri app once shipped or nearly shipped; the native engine must never have it.
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/api/v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/exam_engine.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/exam/engine/offscreen_guard.dart';
import 'package:mastersat_app/exam/engine/pastpaper_engine.dart';
import 'package:mastersat_app/exam/session_contract.dart';

import 'support/engine_harness.dart';

PastpaperEngine startedPaper(EngineHarness h) {
  final e = h.pastpaper();
  h.run(e.open);
  h.run(e.start);
  h.flush();
  return e;
}

MidtermEngine sittingMidterm(EngineHarness h) {
  final e = h.midterm();
  h.run(() => e.prepare(code: fixtureMidtermCode));
  h.run(e.lockAndBind);
  h.run(e.openPaper);
  return e;
}

/// Every (module, remaining) pair the runner could ever have rendered: sampled on each
/// countdown change AND on each engine notification (a module change notifies).
class ClockTrace {
  ClockTrace(this.e) {
    e.remaining.addListener(_sample);
    e.addListener(_sample);
    _sample();
  }

  final ExamEngine e;
  final List<(int, Duration)> samples = [];

  void _sample() => samples.add((e.moduleId, e.remaining.value));

  /// Within one module the countdown only ever goes down.
  List<String> upwardJumps() {
    final out = <String>[];
    for (var i = 1; i < samples.length; i++) {
      final (m0, r0) = samples[i - 1];
      final (m1, r1) = samples[i];
      if (m0 == m1 && r1 > r0) out.add('module $m1: $r0 → $r1');
    }
    return out;
  }

  void dispose() {
    e.remaining.removeListener(_sample);
    e.removeListener(_sample);
  }
}

ApiError notExpired() => ApiError(
      status: 409,
      body: ApiErrorBody.fromJson(JsonReader.of(FixtureV1Api.fixture('midterm_submit.response.not_expired.json'))),
    );

void main() {
  // ---------------------------------------------------------------------------------------
  // Round 1 (useExamState.ts): an effect-based clock reset left one render carrying module 1's
  // 0:00 into module 2, and the auto-submit fired again — on module 2, with module 1's answers.
  // ---------------------------------------------------------------------------------------
  group('round 1: the 0:00 hand-in belongs to ITS module', () {
    test('past paper: module 2 never renders 0:00 and is never handed in by module 1\'s timer', () {
      withHarness((h) {
        final e = startedPaper(h);
        final trace = ClockTrace(e);
        e.select(1001, 'B');
        e.select(1003, 'C');
        h.api.latency = const Duration(seconds: 2); // the hand-in reply lands well after module 2 shows
        h.elapse(const Duration(minutes: P52.minutes) + const Duration(milliseconds: 300));
        expect(e.moduleId, P52.m2);
        expect(e.phase, ExamPhase.running);
        expect(e.inputLocked, isFalse);
        expect(trace.samples.where((s) => s.$1 == P52.m2 && s.$2 == Duration.zero), isEmpty,
            reason: 'module 2 never shows module 1\'s 0:00');
        h.elapse(const Duration(seconds: 30));
        expect(h.keysOf('pastpaperSubmit'), ['submit.${P52.attempt}.${P52.m1}']);
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'B', 1003: 'C'});
        expect(h.serverAnswers(P52.attempt, P52.m2), isEmpty, reason: 'module 1\'s answers never land on module 2');
        expect(e.answerFor(1001), isNull);
        expect(e.remaining.value, greaterThan(const Duration(minutes: P52.minutes - 1)));
        expect(trace.upwardJumps(), isEmpty);
        trace.dispose();
        e.dispose();
      });
    });

    test('past paper: Submit and 0:00 in the same instant hand module 1 in exactly once', () {
      withHarness((h) {
        final e = startedPaper(h);
        e.select(1004, 'A');
        h.elapse(const Duration(minutes: P52.minutes) - const Duration(milliseconds: 1));
        e.openReview();
        h.run(e.submitModule); // the student's click races the timer
        h.elapse(const Duration(seconds: 5));
        expect(h.keysOf('pastpaperSubmit'), ['submit.${P52.attempt}.${P52.m1}']);
        expect(e.moduleId, P52.m2);
        expect(e.phase, ExamPhase.running);
        e.dispose();
      });
    });

    test('midterm: module 1\'s deadline timer never hands in module 2', () {
      withHarness((h) {
        final e = sittingMidterm(h);
        final trace = ClockTrace(e);
        e.select(3001, 'C');
        h.elapse(const Duration(minutes: 35) + const Duration(seconds: 1));
        expect(e.moduleId, M14.m2);
        expect(e.phase, ExamPhase.running);
        e.select(3011, 'B');
        // Whatever is still armed for module 1 (forced syncs, the submit, 409 retries) fires now.
        h.elapse(const Duration(minutes: 2));
        expect(h.keysOf('midtermSubmit'), ['submit.${M14.attempt}.${M14.m1}']);
        expect(h.serverAnswers(M14.attempt, M14.m1), {3001: 'C'});
        expect(h.serverAnswers(M14.attempt, M14.m2), {3011: 'B'});
        expect(trace.samples.where((s) => s.$1 == M14.m2 && s.$2 == Duration.zero), isEmpty);
        expect(trace.upwardJumps(), isEmpty);
        trace.dispose();
        e.dispose();
      });
    });

    test('midterm: a 409 for module 1 that lands after module 2 began changes nothing', () {
      withHarness((h) {
        final e = sittingMidterm(h);
        h.api.latency = const Duration(milliseconds: 300);
        h.elapse(const Duration(minutes: 35));
        h.api.failNext(notExpired());
        h.elapse(const Duration(seconds: 5));
        expect(e.moduleId, M14.m2);
        final keys = h.keysOf('midtermSubmit').toSet();
        expect(keys, {'submit.${M14.attempt}.${M14.m1}'});
        h.elapse(const Duration(minutes: 5));
        expect(h.keysOf('midtermSubmit').toSet(), keys, reason: 'no module-2 hand-in before its own deadline');
        e.dispose();
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  // Round 2 (useOffscreenGuard.ts): a watcher up to a second behind, a latched absence across a
  // disarm, and a late reply restarting a finished countdown — each could forfeit a student who
  // was sitting right there.
  // ---------------------------------------------------------------------------------------
  group('round 2: a stale "away" never forfeits a present student', () {
    OffscreenGuard guardFor(FakeAsync async, bool Function() awayNow, List<OffscreenEvent> events) => OffscreenGuard(
          awayNow: awayNow,
          now: () => async.elapsed,
          wallNow: () => DateTime.utc(2026, 10, 11, 9).add(async.elapsed),
          newId: () => 'e${events.length + 1}',
          onEvent: events.add,
        );

    test('the grace-expiry read is re-checked live before a second strike', () {
      fakeAsync((async) {
        final events = <OffscreenEvent>[];
        var away = false;
        final reads = <Duration>[];
        // The guard's watcher is stale exactly once, at the grace-expiry tick: it still says
        // "away" while the student has clicked back. The live re-read says "back".
        var staleAt = const Duration(days: 1);
        bool read() {
          reads.add(async.elapsed);
          if (async.elapsed == staleAt) {
            staleAt = const Duration(days: 1);
            return true;
          }
          return away;
        }

        final g = guardFor(async, read, events);
        g.enabled = true;
        async.elapse(const Duration(milliseconds: 800)); // armed, first tick at 800 ms
        away = true;
        async.elapse(const Duration(milliseconds: 500)); // ticks 1050 (pending), 1300 (confirmed)
        expect(events, hasLength(1));
        expect(g.status.value?.countingDown, isTrue);
        // The countdown started at the 1300 ms tick, so it runs out at the 4300 ms tick.
        staleAt = const Duration(milliseconds: 4300);
        async.elapse(const Duration(milliseconds: 2900)); // up to 4200 ms: still away, counting down
        expect(events, hasLength(1));
        away = false; // back — but the 4300 ms tick's first read is stale
        async.elapse(const Duration(milliseconds: 150));
        expect(reads.where((t) => t == const Duration(milliseconds: 4300)), hasLength(2),
            reason: 'the stale read was followed by a live one');
        expect(events, hasLength(1), reason: 'no second strike for a student who is back');
        expect(g.status.value?.countingDown ?? false, isFalse);
        expect(g.violations, 1);
        expect(g.notice.value, 'You left the exam window. That counted as a warning — 2 chances left.');
        async.elapse(const Duration(seconds: 30));
        expect(events, hasLength(1));
        g.dispose();
      });
    });

    test('an absence latched while disarmed is closed on re-arm when the student is back', () {
      fakeAsync((async) {
        final events = <OffscreenEvent>[];
        var away = false;
        final g = guardFor(async, () => away, events);
        g.enabled = true;
        async.elapse(const Duration(milliseconds: 800));
        away = true;
        async.elapse(const Duration(milliseconds: 600));
        expect(events, hasLength(1));
        g.enabled = false; // the module transition covers the paper
        expect(g.status.value?.countingDown ?? false, isFalse, reason: 'no countdown over a covered paper');
        away = false; // back during the transition
        async.elapse(const Duration(seconds: 10));
        g.enabled = true;
        async.elapse(const Duration(seconds: 10));
        expect(events, hasLength(1));
        expect(g.status.value?.countingDown ?? false, isFalse);
        // ... and a NEW leave is still reported (the latch did not swallow it).
        away = true;
        async.elapse(const Duration(milliseconds: 600));
        expect(events, hasLength(2));
        g.dispose();
      });
    });

    test('a continuing absence across a disarm escalates after re-arm (its grace restarts)', () {
      fakeAsync((async) {
        final events = <OffscreenEvent>[];
        var away = false;
        final g = guardFor(async, () => away, events);
        g.enabled = true;
        async.elapse(const Duration(milliseconds: 800));
        away = true;
        async.elapse(const Duration(milliseconds: 600));
        g.enabled = false;
        async.elapse(const Duration(seconds: 5));
        g.enabled = true;
        async.elapse(const Duration(milliseconds: 900));
        expect(g.status.value?.countingDown, isTrue, reason: 'still away: warned again');
        expect(events, hasLength(1), reason: 'the disarmed time is not a strike');
        async.elapse(const Duration(seconds: 3));
        expect(events, hasLength(2));
        g.dispose();
      });
    });

    test('a late server reply never restarts a countdown the student already ended', () {
      fakeAsync((async) {
        final events = <OffscreenEvent>[];
        var away = false;
        final g = guardFor(async, () => away, events);
        g.enabled = true;
        async.elapse(const Duration(milliseconds: 800));
        away = true;
        async.elapse(const Duration(milliseconds: 600));
        away = false;
        async.elapse(const Duration(milliseconds: 300));
        expect(g.status.value?.countingDown ?? false, isFalse);
        g.acknowledge(events.single.id, violations: 1, limit: 3, graceSeconds: 3, terminated: false);
        expect(g.status.value?.countingDown ?? false, isFalse);
        expect(g.status.value?.violations, 1);
        async.elapse(const Duration(seconds: 10));
        expect(events, hasLength(1));
        g.dispose();
      });
    });

    test('engine: a student who is back is never terminated by queued replies', () {
      withHarness((h) {
        final e = sittingMidterm(h);
        h.elapse(const Duration(seconds: 2));
        h.api.latency = const Duration(seconds: 4); // replies land long after the return
        h.native.away = true;
        h.elapse(const Duration(milliseconds: 600));
        h.native.away = false;
        h.elapse(const Duration(seconds: 10));
        expect(e.phase, ExamPhase.running);
        expect(e.offscreen.value?.violations, 1);
        expect(e.offscreen.value?.terminated, isFalse);
        expect(e.inputLocked, isFalse);
        expect(h.keysOf('midtermOffscreen'), hasLength(1));
        e.dispose();
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  // Round 3 (useExamAttempt.ts): a capped auto-submit gave up during a 5xx window and left a
  // midterm student locked on 0:00; and the opposite on past papers — a deterministic server
  // failure looped forever with nothing on screen.
  // ---------------------------------------------------------------------------------------
  group('round 3: midterm submits retry uncapped', () {
    test('a long outage of mixed failures (network, 503, 409) still hands the module in', () {
      withHarness((h) {
        final e = sittingMidterm(h);
        e.select(3002, '4');
        h.elapse(const Duration(minutes: 35));
        for (var i = 0; i < 60; i++) {
          h.api.failNext(switch (i % 3) {
            0 => const NetworkError('reset'),
            1 => const ApiError(status: 503, body: ApiErrorBody(code: 'maintenance')),
            _ => notExpired(),
          });
        }
        h.elapse(const Duration(minutes: 25));
        expect(e.moduleId, M14.m2, reason: 'never given up');
        expect(e.problem.value, isNull, reason: 'blips are never an error screen');
        expect(h.keysOf('midtermSubmit').toSet(), {'submit.${M14.attempt}.${M14.m1}'});
        expect(h.serverAnswers(M14.attempt, M14.m1), {3002: '4'});
        e.dispose();
      });
    });
  });

  group('round 3: a deterministic past-paper failure surfaces instead of looping', () {
    test('six 500s in a row park the hand-in, say so, and stop calling; "Try again" sends it', () {
      withHarness((h) {
        final e = startedPaper(h);
        e.select(1001, 'D');
        for (var i = 0; i < 6; i++) {
          h.api.failNext(const ApiError(status: 500, body: ApiErrorBody(detail: 'Internal Server Error')));
        }
        h.run(e.submitModule);
        expect(e.moduleId, P52.m2, reason: 'the student keeps working from the cache');
        h.elapse(const Duration(minutes: 2));
        expect(e.problem.value?.kind, EngineProblemKind.sendStuck);
        expect(e.problem.value?.canRetry, isTrue);
        final calls = h.keysOf('pastpaperSubmit').length;
        expect(calls, 6);
        h.elapse(const Duration(minutes: 10));
        expect(h.keysOf('pastpaperSubmit').length, calls, reason: 'parked: no silent loop');
        expect(h.run(() => h.store.unsentCount(P52.attempt)), greaterThan(0), reason: 'held, not dropped');
        h.run(e.retrySend);
        h.elapse(const Duration(seconds: 2));
        expect(e.problem.value, isNull);
        expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'D'});
        expect(h.api.stateOf(P52.attempt), AttemptState.module2Active);
        e.dispose();
      });
    });

    test('a final 4xx is shown at once and never retried', () {
      withHarness((h) {
        final e = startedPaper(h);
        e.select(1001, 'A');
        h.api.failNext(const ApiError(status: 400, body: ApiErrorBody(code: 'invalid', detail: 'bad payload')));
        h.elapse(const Duration(seconds: 11));
        expect(e.problem.value?.kind, EngineProblemKind.sendRefused);
        final n = h.keysOf('pastpaperSync').length;
        h.elapse(const Duration(minutes: 5));
        // Later changes are new items with new keys; the refused one is never sent again.
        expect(h.keysOf('pastpaperSync').take(n).toSet().length, n);
        e.dispose();
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  // The countdown never jumps up (useExamState.ts rule 3): a replayed or delayed reply can carry
  // an old, larger remaining value.
  // ---------------------------------------------------------------------------------------
  group('the countdown never jumps up', () {
    test('past paper: a server clock running behind never adds time mid-module', () {
      withHarness((h) {
        final e = startedPaper(h);
        final trace = ClockTrace(e);
        h.elapse(const Duration(seconds: 5));
        h.clock.slept = const Duration(seconds: -20); // the server now says 20 s MORE are left
        for (var i = 0; i < 8; i++) {
          e.select(P52.m1Questions[i % P52.m1Questions.length], 'ABCD'[i % 4]);
          h.elapse(const Duration(seconds: 15));
        }
        expect(h.keysOf('pastpaperSync'), isNotEmpty);
        expect(trace.upwardJumps(), isEmpty);
        trace.dispose();
        e.dispose();
      });
    });

    test('past paper: a server clock running ahead is adopted (less time, beyond 5 s)', () {
      withHarness((h) {
        final e = startedPaper(h);
        h.elapse(const Duration(seconds: 5));
        final before = e.remaining.value;
        h.clock.slept = const Duration(seconds: 30);
        e.select(1001, 'A');
        h.elapse(const Duration(seconds: 11));
        expect(e.remaining.value, lessThan(before - const Duration(seconds: 35)));
        e.dispose();
      });
    });

    test('midterm: heartbeat replies from a server clock behind never add time', () {
      withHarness((h) {
        final e = sittingMidterm(h);
        final trace = ClockTrace(e);
        h.clock.slept = const Duration(seconds: -8);
        h.elapse(const Duration(minutes: 3));
        expect(trace.upwardJumps(), isEmpty);
        trace.dispose();
        e.dispose();
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  // Pause adoption (useExamAttempt.ts "pause"): only the LATEST pause/resume reply is adopted.
  // ---------------------------------------------------------------------------------------
  group('pause adoption only of the latest reply', () {
    test('Pause then Resume before the pause reply: the late pause reply does not freeze the clock', () {
      withHarness((h) {
        final e = startedPaper(h);
        h.elapse(const Duration(seconds: 20));
        h.api.latency = const Duration(seconds: 2);
        final pausing = e.pause();
        h.elapse(const Duration(milliseconds: 500));
        expect(e.paused, isTrue);
        final resuming = e.resume(); // the student changes their mind; the pause reply is still out
        expect(e.paused, isFalse);
        h.elapse(const Duration(seconds: 5)); // both replies land, the stale pause first
        var pauseResult = true;
        pausing.then((v) => pauseResult = v);
        h.flush();
        expect(pauseResult, isFalse, reason: 'the caller is not told the clock froze');
        h.run(() => resuming);
        expect(e.paused, isFalse);
        final r0 = e.remaining.value;
        h.elapse(const Duration(seconds: 10));
        expect(e.remaining.value, lessThan(r0), reason: 'the countdown runs');
        expect(h.api.stateOf(P52.attempt), AttemptState.module1Active);
        e.dispose();
      });
    });

    test('a pause reply that lands after the module changed never freezes module 2', () {
      withHarness((h) {
        final e = startedPaper(h);
        h.elapse(const Duration(seconds: 20));
        h.api.latency = const Duration(seconds: 2);
        final pausing = e.pause();
        h.elapse(const Duration(milliseconds: 200));
        e.openReview();
        h.run(e.submitModule); // module 2 starts from the cache before the pause reply
        expect(e.moduleId, P52.m2);
        h.elapse(const Duration(seconds: 6));
        var pauseResult = true;
        pausing.then((v) => pauseResult = v);
        h.flush();
        expect(pauseResult, isFalse);
        expect(e.paused, isFalse);
        final r0 = e.remaining.value;
        h.elapse(const Duration(seconds: 10));
        expect(e.remaining.value, lessThan(r0), reason: 'module 2 counts down');
        e.dispose();
      });
    });

    test('rapid Pause / Resume / Pause: the final state is the last click\'s', () {
      withHarness((h) {
        final e = startedPaper(h);
        h.elapse(const Duration(seconds: 20));
        h.api.latency = const Duration(milliseconds: 700);
        final p1 = e.pause();
        h.elapse(const Duration(milliseconds: 100));
        final r1 = e.resume();
        h.elapse(const Duration(milliseconds: 100));
        final p2 = e.pause();
        h.elapse(const Duration(seconds: 3));
        h.run(() => Future.wait([p1, r1.then((_) => true), p2]));
        expect(e.paused, isTrue);
        final frozen = e.remaining.value;
        h.elapse(const Duration(minutes: 1));
        expect(e.remaining.value, frozen);
        e.dispose();
      });
    });
  });
}

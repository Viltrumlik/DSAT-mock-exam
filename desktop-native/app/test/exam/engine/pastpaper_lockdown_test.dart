// A past paper's machine lockdown at the engine (0.2.4): the midterm's LockdownController,
// taken only when the screen asks ([PastpaperEngine.lock]) and released by the engine itself
// the moment the sitting no longer needs it — Save & Exit, the hand-in of the last module, an
// update the app must install, waiting offline for module 2, the window closing, dispose.
// Local only: no proof, no server session, no off-screen guard.
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/engine/exam_engine.dart';
import 'package:mastersat_app/exam/engine/lockdown_controller.dart';
import 'package:mastersat_app/exam/engine/pastpaper_engine.dart';
import 'package:mastersat_app/exam/session_contract.dart';
import 'package:mastersat_app/native/native_bridge.dart';

import 'deferred_module_test.dart' show adaptive;
import 'support/engine_harness.dart';

PastpaperEngine opened(EngineHarness h) {
  final e = h.pastpaper();
  h.run(e.open);
  expect(e.phase, ExamPhase.welcome);
  return e;
}

/// Start as the screen does: lock, then the clock.
PastpaperEngine lockedAndStarted(EngineHarness h) {
  final e = opened(h);
  e.lock();
  h.run(e.start);
  h.flush();
  return e;
}

int count(EngineHarness h, String call) => h.native.calls.where((c) => c == call).length;

void main() {
  test('nothing locks by itself: not on open, not on Welcome, not on Start alone', () {
    withHarness((h) {
      final e = opened(h);
      expect(e.lockdownWanted, isFalse, reason: 'Welcome: the clock has not started');
      expect(h.native.locked, isFalse);
      h.run(e.start);
      expect(e.lockdownWanted, isTrue, reason: 'a module is running');
      expect(count(h, 'lockEnter'), 0, reason: 'only the screen takes the lock (it shows a refusal)');
      e.dispose();
    });
  });

  test('lock: ms_lock_enter, a heartbeat every 3 s, a silent re-lock after the watchdog let go', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      expect(h.native.locked, isTrue);
      expect(e.lockdown.locked, isTrue);
      expect(count(h, 'lockEnter'), 1);
      e.lock(); // a no-op while locked
      expect(count(h, 'lockEnter'), 1);
      final beats = h.native.heartbeats;
      h.elapse(const Duration(seconds: 9));
      expect(h.native.heartbeats - beats, 3);

      h.native.watchdogReleased = true; // the UI stalled > 10 s
      h.elapse(const Duration(seconds: 3));
      expect(e.lockdown.relocks, 1, reason: 'locked again at once, silently');
      expect(e.lockdown.locked, isTrue);
      expect(e.lockdown.lost, isFalse);
      expect(count(h, 'prove ${P52.attempt}'), 0, reason: 'local only: no proof, no server session');
      expect(h.callNames().where((n) => n.contains('desktop') || n.contains('Session')), isEmpty);
      e.dispose();
    });
  });

  test('a re-lock that fails is LOST (the screen covers the paper); lock() takes it again', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      h.native
        ..failLockEnter = true
        ..watchdogReleased = true;
      h.elapse(const Duration(seconds: 3));
      expect(e.lockdown.lost, isTrue);
      expect(e.lockdownWanted, isTrue, reason: 'the paper still runs');
      expect(e.phase, ExamPhase.running);
      h.native.failLockEnter = false;
      e.lock();
      expect(e.lockdown.locked, isTrue);
      expect(e.lockdown.lost, isFalse);
      e.dispose();
    });
  });

  test('a machine that fails the pre-check is refused with its report; nothing is locked', () {
    withHarness((h) {
      final e = opened(h);
      h.native.apps = [const BlockedApp(exe: 'Telegram.exe', name: 'Telegram', closable: true)];
      expect(e.lock, throwsA(isA<PrecheckFailed>().having((p) => p.report.apps.single.name, 'app', 'Telegram')));
      expect(h.native.locked, isFalse);
      expect(e.lockdown.locked, isFalse);
      e.dispose();
    });
  });

  test('module 1 → module 2 keeps the lock (the transition included)', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      e.openReview();
      expect(e.lockdownWanted, isTrue, reason: 'Check Your Work is part of the sitting');
      expect(h.native.locked, isTrue);
      h.run(e.submitModule);
      expect(e.moduleOrder, 2);
      expect(h.native.locked, isTrue);
      expect(count(h, 'lockExit'), 0);
      e.dispose();
    });
  });

  test('the hand-in of the last module releases it before the result (submitting)', () {
    withHarness((h) {
      h.api.scoringPolls = 1;
      final e = lockedAndStarted(h);
      h.run(e.submitModule);
      h.api.latency = const Duration(milliseconds: 500);
      h.run(e.submitModule);
      expect(e.phase, ExamPhase.submitting);
      expect(h.native.locked, isFalse);
      expect(count(h, 'lockExit'), 1);
      expect(e.lockdown.locked, isFalse);
      h.elapse(const Duration(seconds: 1));
      expect(e.phase, ExamPhase.done);
      expect(count(h, 'lockExit'), 1, reason: 'released once');
      e.dispose();
    });
  });

  test('Save & Exit releases it', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      e.select(1001, 'A');
      final r = h.run(e.saveAndExit);
      expect(r.pausedOnServer, isTrue);
      expect(h.native.locked, isFalse);
      expect(e.lockdown.locked, isFalse);
      final beats = h.native.heartbeats;
      h.elapse(const Duration(seconds: 10));
      expect(h.native.heartbeats, beats, reason: 'the heartbeat stopped');
      e.dispose();
    });
  });

  test('a required update releases it (the update card covers everything)', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      e.setProblem(const EngineProblem(EngineProblemKind.updateRequired, 'Update the MasterSAT app to keep going.'));
      expect(e.lockdownWanted, isFalse);
      expect(h.native.locked, isFalse);
      e.dispose();
    });
  });

  test('waiting OFFLINE for module 2 lets go (no way out there); it is wanted again with the module', () {
    withHarness((h) {
      final e = h.pastpaper();
      h.run(e.open);
      e.lock();
      h.run(e.start);
      h.api.offline = true;
      e.openReview();
      h.run(e.submitModule);
      h.elapse(const Duration(seconds: 2));
      expect(e.phase, ExamPhase.offlineWaiting);
      expect(e.lockdownWanted, isFalse);
      expect(h.native.locked, isFalse);
      h.api.offline = false;
      h.elapse(const Duration(seconds: 35));
      expect(e.phase, ExamPhase.running);
      expect(e.lockdownWanted, isTrue, reason: 'the screen locks again before module 2 is shown');
      e.dispose();
    }, apiFactory: adaptive);
  });

  test('the window closing releases it after the last sync, and it is no longer wanted', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      e.select(1001, 'C');
      h.run(e.closeGracefully);
      expect(h.native.locked, isFalse);
      expect(e.lockdown.locked, isFalse);
      expect(e.lockdownWanted, isFalse);
      expect(h.serverAnswers(P52.attempt, P52.m1), {1001: 'C'}, reason: 'the last sync went out');
      e.dispose();
    });
  });

  test('dispose releases it (every other way out)', () {
    withHarness((h) {
      final e = lockedAndStarted(h);
      expect(h.native.locked, isTrue);
      e.dispose();
      expect(h.native.locked, isFalse);
      final beats = h.native.heartbeats;
      h.elapse(const Duration(seconds: 10));
      expect(h.native.heartbeats, beats);
    });
  });

  test('a lock given by the caller is released but not disposed with the engine', () {
    withHarness((h) {
      final lock = LockdownController(native: h.native);
      final e = PastpaperEngine(h.deps(), practiceTestId: 52, studentName: 'Aziza Karimova', lockdown: lock);
      h.run(e.open);
      e.lock();
      h.run(e.start);
      e.dispose();
      expect(lock.locked, isFalse);
      lock.enter(); // still usable
      expect(lock.locked, isTrue);
      lock.dispose();
    });
  });
}

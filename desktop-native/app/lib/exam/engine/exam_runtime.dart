// One signed-in student's exam machinery, for app-core to hold while they are signed in:
// their own database (`exam-<userId>.db`: WAL, synchronous=FULL, sealed values), ONE outbox
// hub for the whole process (so the engine and the start-up drainer never send the same
// attempt twice), and the engines it opens.
//
//   final rt = ExamRuntime.open(dataDir: dir, userId: me.id, api: api, native: native,
//       fetchMedia: http.getBytes, power: PowerEvents());
//   await rt.resumePendingSends();          // app start: past-paper sends left behind
//   final e = rt.pastpaper(52, studentName: me.name)..open();
//   ...
//   await rt.close();                        // sign-out (check rt.unsentCount() first)
import 'dart:io';
import 'dart:math';

import '../../core/api/v1_api.dart';
import '../../native/native_bridge.dart';
import 'engine_clock.dart';
import 'engine_deps.dart';
import 'exam_engine.dart';
import 'exam_store.dart';
import 'media_cache.dart';
import 'midterm_engine.dart';
import 'outbox.dart';
import 'pastpaper_engine.dart';
import 'power_events.dart';

class ExamRuntime {
  ExamRuntime._({
    required this.userId,
    required this.store,
    required this.hub,
    required this.api,
    required this.native,
    required this.clock,
    required this.fetchMedia,
    required this.timings,
    this.power,
  });

  /// Opens (creating if needed) the student's database under [dataDir] (the app's local data
  /// folder) and the process-wide outbox hub. [background] runs SQLite on drift's own isolate
  /// (production); tests pass false.
  factory ExamRuntime.open({
    required Directory dataDir,
    required int userId,
    required V1Api api,
    required NativeBridge native,
    required MediaFetcher fetchMedia,
    EngineClock? clock,
    PowerEvents? power,
    EngineTimings timings = const EngineTimings(),
    bool background = true,
    Random? random,
  }) {
    final c = clock ?? SystemEngineClock();
    final store = ExamStore.open(dataDir: dataDir, userId: userId, native: native, background: background);
    return ExamRuntime._(
      userId: userId,
      store: store,
      hub: OutboxHub(store: store, api: api, clock: c, random: random),
      api: api,
      native: native,
      clock: c,
      fetchMedia: fetchMedia,
      timings: timings,
      power: power,
    );
  }

  final int userId;
  final ExamStore store;
  final OutboxHub hub;
  final V1Api api;
  final NativeBridge native;
  final EngineClock clock;
  final MediaFetcher fetchMedia;
  final EngineTimings timings;
  final PowerEvents? power;
  bool _closed = false;

  /// Engines opened through this runtime; [close] lets their queued writes commit first.
  final List<ExamEngine> _engines = [];

  T _track<T extends ExamEngine>(T e) {
    _engines.removeWhere((x) => x.disposed && !x.hasPendingWrites);
    _engines.add(e);
    return e;
  }

  bool get closed => _closed;

  EngineDeps _deps() {
    if (_closed) throw StateError('ExamRuntime for user $userId is closed');
    return EngineDeps(
      api: api,
      store: store,
      native: native,
      clock: clock,
      hub: hub,
      fetchMedia: fetchMedia,
      timings: timings,
      power: power,
    );
  }

  /// App start (design §1.10 step 2): send what past-paper attempts left in the outbox.
  /// Midterm items wait for their sitting to be re-bound (the lockdown token is memory-only).
  Future<int> resumePendingSends() => hub.drainUnfinished();

  /// A past paper's engine; call `open()` on it (then the runner renders it).
  PastpaperEngine pastpaper(int practiceTestId, {required String studentName}) =>
      _track(PastpaperEngine(_deps(), practiceTestId: practiceTestId, studentName: studentName));

  /// A midterm's engine; hand it to `MidtermFlowController` (features/midterm).
  MidtermEngine midterm(int midtermId, {required String studentName}) =>
      _track(MidtermEngine(_deps(), midtermId: midtermId, studentName: studentName));

  /// Exam items not yet acknowledged by the server (sign-out and "Delete data" are blocked
  /// while this is above zero).
  Future<int> unsentCount() => store.unsentTotal();

  /// Sign-out / quit: stop sending and close the database. Engines must be disposed first.
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    // Every click already queued commits (capped: a wedged disk must not hang sign-out).
    for (final e in _engines) {
      try {
        await e.flushWrites().timeout(timings.closeFlushCap);
      } on Object {
        // whatever did not commit is lost only if the disk refused it
      }
    }
    _engines.clear();
    await hub.quiesce();
    await store.close();
  }
}

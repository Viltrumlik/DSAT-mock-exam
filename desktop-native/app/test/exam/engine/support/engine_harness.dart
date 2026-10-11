// Shared rig for the engine tests: a fake clock driven by fake_async, the fixture server
// running on the same clock, the fake native bridge, a real drift store (in memory, or a file
// for kill/reopen tests) and an image fetcher that serves the contract's fixture PNGs.
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:fake_async/fake_async.dart';
import 'package:mastersat_app/core/api/fixture_v1_api.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/engine_clock.dart';
import 'package:mastersat_app/exam/engine/engine_deps.dart';
import 'package:mastersat_app/exam/engine/exam_engine.dart';
import 'package:mastersat_app/exam/engine/exam_store.dart';
import 'package:mastersat_app/exam/engine/midterm_engine.dart';
import 'package:mastersat_app/exam/engine/outbox.dart';
import 'package:mastersat_app/exam/engine/pastpaper_engine.dart';
import 'package:mastersat_app/exam/engine/power_events.dart';
import 'package:mastersat_app/native/fake_native_bridge.dart';
import 'package:mastersat_app/native/native_bridge.dart';

/// The fake bridge, plus a script for `ms_away_now` (each call pops the next reading) and a
/// count of how often it was read.
class ScriptedNativeBridge extends FakeNativeBridge {
  final List<bool> awayScript = [];
  int awayReads = 0;

  /// When set, `ms_lock_enter` fails (the re-lock after a watchdog release cannot happen).
  bool failLockEnter = false;

  @override
  bool awayNow() {
    awayReads++;
    if (awayScript.isNotEmpty) return awayScript.removeAt(0);
    return away;
  }

  @override
  PrecheckReport lockEnter() {
    if (failLockEnter) {
      calls.add('lockEnter');
      throw const NativeBridgeException(NativeStatus.errOs, 'ms_lock_enter', 'failed');
    }
    return super.lockEnter();
  }
}

/// Monotonic = fake_async elapsed. The server's clock also counts [slept] (time the machine
/// was asleep, which the monotonic clock may not see); the local wall clock adds [wallSkew]
/// (the user or Windows moved it).
class TestClock implements EngineClock {
  TestClock(this.async, {DateTime? base}) : base = base ?? DateTime.utc(2026, 10, 11, 9);

  final FakeAsync async;
  final DateTime base;
  Duration slept = Duration.zero;
  Duration wallSkew = Duration.zero;

  @override
  Duration get monotonic => async.elapsed;

  DateTime get serverNow => base.add(async.elapsed + slept);

  @override
  DateTime get wallNow => serverNow.add(wallSkew);
}

class EngineHarness {
  EngineHarness(this.async, {this.fileDb = false, int seed = 1}) : random = Random(seed) {
    // Each test (and each simulated relaunch) opens its own store on purpose.
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    clock = TestClock(async);
    api = FixtureV1Api(now: () => clock.serverNow);
    native = ScriptedNativeBridge();
    dir = Directory.systemTemp.createTempSync('exam-engine-test');
    power = PowerEvents.detached();
    _openStore();
  }

  final FakeAsync async;
  final bool fileDb;
  final Random random;
  late final TestClock clock;
  late final FixtureV1Api api;
  late final ScriptedNativeBridge native;
  late final Directory dir;
  late final PowerEvents power;
  late ExamStore store;
  late OutboxHub hub;
  EngineTimings timings = const EngineTimings();

  /// Image URLs fetched, in order.
  final List<String> fetched = [];

  /// Keys whose download fails.
  final Set<String> failKeys = {};

  int _ids = 0;

  void _openStore() {
    store = fileDb
        ? ExamStore.open(dataDir: dir, userId: 77, native: native, background: false)
        : ExamStore.withExecutor(NativeDatabase.memory(), native: native, mediaDir: Directory('${dir.path}/media'));
    hub = OutboxHub(store: store, api: api, clock: clock, random: Random(random.nextInt(1 << 30)));
  }

  Future<Uint8List> fetch(Uri url) async {
    fetched.add(url.toString());
    final key = Uri.decodeComponent(url.path.replaceFirst('/mastersat-media/', ''));
    if (failKeys.contains(key)) throw StateError('download failed: $key');
    final bytes = FixtureV1Api.fixtureMedia(key);
    if (bytes == null) throw StateError('no fixture image $key');
    return bytes;
  }

  EngineDeps deps() => EngineDeps(
        api: api,
        store: store,
        native: native,
        clock: clock,
        hub: hub,
        fetchMedia: fetch,
        timings: timings,
        newId: () => 'uuid-${++_ids}',
        power: power,
      );

  PastpaperEngine pastpaper({int paper = 52}) =>
      PastpaperEngine(deps(), practiceTestId: paper, studentName: 'Aziza Karimova');

  MidtermEngine midterm({int midtermId = 14}) =>
      MidtermEngine(deps(), midtermId: midtermId, studentName: 'Aziza Karimova');

  /// Let every microtask (store writes, fixture replies) run.
  void flush() => async.flushMicrotasks();

  /// Advance the clocks.
  void elapse(Duration d) {
    async.elapse(d);
    async.flushMicrotasks();
  }

  /// Runs [f] to completion (by flushing microtasks and, if needed, advancing time).
  T run<T>(Future<T> Function() f, {Duration step = const Duration(milliseconds: 10), int maxSteps = 2000}) {
    T? out;
    Object? error;
    var done = false;
    f().then((v) {
      out = v;
      done = true;
    }, onError: (Object e) {
      error = e;
      done = true;
    });
    flush();
    var steps = 0;
    while (!done && steps++ < maxSteps) {
      elapse(step);
    }
    if (error != null) throw error!;
    if (!done) throw StateError('future did not complete');
    return out as T;
  }

  /// A process kill: the engine and its senders stop without a graceful close, the database
  /// connection is dropped (file DB) and a new hub is made — as a fresh launch would.
  void kill(ExamEngine engine) {
    engine.dispose();
    hub.stopAll();
    flush();
    if (fileDb) {
      run(() => store.close());
    }
    _openStore();
    flush();
  }

  /// Server-side answers + flags for a module.
  Map<int, String> serverAnswers(int attemptId, int moduleId) => api.serverAnswers(attemptId, moduleId);

  List<String> callNames() => [for (final c in api.calls) c.method];

  List<String> keysOf(String method) => [
        for (final c in api.calls)
          if (c.method == method) c.args['key']! as String,
      ];

  void dispose() {
    try {
      dir.deleteSync(recursive: true);
    } on FileSystemException {
      // best effort
    }
  }
}

/// Convenience: wrap a test body in fakeAsync with a harness.
void withHarness(void Function(EngineHarness h) body, {bool fileDb = false, int seed = 1}) {
  fakeAsync((async) {
    final h = EngineHarness(async, fileDb: fileDb, seed: seed);
    try {
      body(h);
    } finally {
      h.dispose();
    }
  });
}

/// The fixture paper 52's ids.
abstract final class P52 {
  static const attempt = 9123;
  static const m1 = 301;
  static const m2 = 302;
  static const m1Questions = [1001, 1002, 1003, 1004, 1005, 1006];
  static const m2Questions = [1011, 1012, 1013, 1014];
  static const minutes = 35;
}

/// The fixture midterm 14's ids.
abstract final class M14 {
  static const midterm = 14;
  static const attempt = 5521;
  static const m1 = 401;
  static const m2 = 402;
  static const m1Questions = [3001, 3002, 3003, 3004];
  static const m2Questions = [3011, 3012, 3013];
}

/// Silences "unused" for helpers some test files do not use.
AttemptKind get unusedKind => AttemptKind.pastpaper;

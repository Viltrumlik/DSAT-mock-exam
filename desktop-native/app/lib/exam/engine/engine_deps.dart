// Everything an engine needs, injected (so every rule is testable with fake_async, the
// fixture API and the fake native bridge).
import 'package:uuid/uuid.dart';

import '../../core/api/v1_api.dart';
import '../../native/native_bridge.dart';
import 'engine_clock.dart';
import 'exam_store.dart';
import 'media_cache.dart';
import 'outbox.dart';
import 'power_events.dart';

/// Every timing rule in one place (design_data_server.md §1.6–§1.9, architecture §5).
class EngineTimings {
  const EngineTimings({
    this.pastpaperQuietSync = const Duration(seconds: 10),
    this.pastpaperMaxUnsent = const Duration(seconds: 60),
    this.offlineProbe = const Duration(seconds: 15),
    this.midtermHeartbeat = const Duration(seconds: 15),
    this.midtermChangeSync = const Duration(seconds: 3),
    this.midtermForcedSyncs = const [Duration(seconds: 60), Duration(seconds: 10)],
    this.midtermSubmitMargin = const Duration(milliseconds: 750),
    this.awayPoll = const Duration(milliseconds: 250),
    this.awayConfirm = const Duration(milliseconds: 250),
    this.guardArm = const Duration(milliseconds: 800),
    this.lockHeartbeat = const Duration(seconds: 3),
    this.batteryPoll = const Duration(seconds: 30),
    this.tick = const Duration(milliseconds: 250),
    this.tickPersist = const Duration(seconds: 5),
    this.sleepGap = const Duration(seconds: 2),
    this.saveAndExitWait = const Duration(milliseconds: 1500),
    this.pauseWait = const Duration(seconds: 5),
    this.reportWait = const Duration(seconds: 3),
    this.annotationDebounce = const Duration(seconds: 2),
    this.resultFastPoll = const Duration(seconds: 2),
    this.resultFastWindow = const Duration(seconds: 60),
    this.resultSlowPoll = const Duration(seconds: 10),
    this.closeFlushCap = const Duration(seconds: 2),
  });

  /// Past papers: sync after this long with no further change…
  final Duration pastpaperQuietSync;

  /// …or this long after the first unsent change, whichever comes first.
  final Duration pastpaperMaxUnsent;

  /// While offline with nothing queued, probe this often (a replayed sync is a cheap status read).
  final Duration offlineProbe;

  /// Midterms: heartbeat sync, even with no change.
  final Duration midtermHeartbeat;

  /// Midterms: sync this long after the last change.
  final Duration midtermChangeSync;

  /// Midterms: forced syncs this long before the deadline.
  final List<Duration> midtermForcedSyncs;

  /// Midterms: hand in at the server deadline + this.
  final Duration midtermSubmitMargin;

  /// Off-screen guard: poll `ms_away_now` this often (4×/s)…
  final Duration awayPoll;

  /// …and count an absence only once it has lasted this long.
  final Duration awayConfirm;

  /// The guard watches only once it has been enabled this long (module-change churn).
  final Duration guardArm;

  /// `ms_heartbeat` period while locked (the DLL releases after 10 s of silence).
  final Duration lockHeartbeat;
  final Duration batteryPoll;

  /// Countdown refresh (the ValueListenable only notifies when the whole second changes).
  final Duration tick;

  /// Persist `remaining_ms_at_tick` this often (offline restart rule).
  final Duration tickPersist;

  /// Wall vs monotonic disagreement that means the machine slept.
  final Duration sleepGap;
  final Duration saveAndExitWait;
  final Duration pauseWait;
  final Duration reportWait;
  final Duration annotationDebounce;
  final Duration resultFastPoll;
  final Duration resultFastWindow;
  final Duration resultSlowPoll;
  final Duration closeFlushCap;
}

/// The collaborators of an engine.
class EngineDeps {
  EngineDeps({
    required this.api,
    required this.store,
    required this.native,
    required this.clock,
    required this.hub,
    required this.fetchMedia,
    this.timings = const EngineTimings(),
    String Function()? newId,
    this.power,
  }) : newId = newId ?? (() => const Uuid().v4());

  final V1Api api;
  final ExamStore store;
  final NativeBridge native;
  final EngineClock clock;
  final OutboxHub hub;
  final MediaFetcher fetchMedia;
  final EngineTimings timings;

  /// UUIDs for off-screen events and question reports.
  final String Function() newId;

  /// WM_POWERBROADCAST / WM_TIMECHANGE from the Windows runner (null in tests that don't care).
  final PowerEvents? power;

  int get wallMs => clock.wallNow.millisecondsSinceEpoch;
}

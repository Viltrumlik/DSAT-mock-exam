// MidtermEngine — one midterm sitting (design_data_server.md §1.6–§1.7, §1.10–§1.11, §2.d;
// architecture §5). Every rule the server enforces is kept, and the client never pretends
// otherwise:
//
//  * prepare (code) → lock (`ms_lock_enter`) → challenge → prove (`ms_prove`) → session →
//    open. The `X-Lockdown-Session` token lives in memory only. Midterm content and images
//    never touch disk; the answer journal does (it is the student's work).
//  * The server copy is the scoring copy: a heartbeat sync every 15 s (also the status poll:
//    state, strikes, termination), a sync 3 s after a change, forced syncs at T−60 s and
//    T−10 s. Answers the server has never seen are accepted until deadline + 300 s.
//  * No early hand-in and no pause. At 0:00 the input locks and `journal(deadline)` is
//    written; the submit goes at the latest response's `t_recv + remaining + 750 ms`, and a
//    `409 module_not_expired` is retried after `retry_after_ms + 250`, uncapped. Module 2
//    arrives with the submit response and its clock is re-anchored synchronously.
//  * The off-screen guard polls `ms_away_now` 4×/s; each event goes through the urgent
//    outbox lane with a persisted UUID key; the server counts the strikes.
//  * `ms_heartbeat` every 3 s; a released lock is re-taken silently.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../../native/native_bridge.dart';
import '../session_contract.dart';
import 'engine_clock.dart';
import 'engine_deps.dart';
import 'exam_engine.dart';
import 'exam_store.dart';
import 'lockdown_controller.dart';
import 'media_cache.dart';
import 'offscreen_guard.dart';
import 'outbox.dart';

/// Why the server turned the sitting away (or the machine let go).
enum MidtermBlockReason {
  /// The server wants a lockdown token this window does not hold.
  desktopRequired,

  /// The newest app session took the sitting over (another window/computer).
  sessionReplaced,

  /// This build is below the server's minimum.
  updateRequired,

  /// The sitting is no longer running (it ended or was submitted).
  notLive,

  /// The challenge expired before the proof arrived.
  challengeInvalid,

  /// The server rejected the app's proof.
  proofInvalid,

  /// The watchdog released the machine and locking again failed.
  lockLost,
}

/// A lockdown refusal (or a lost lock), raised by the setup steps.
class MidtermBlocked implements Exception {
  const MidtermBlocked(this.reason, [this.detail]);
  final MidtermBlockReason reason;
  final String? detail;

  @override
  String toString() => 'MidtermBlocked(${reason.name}${detail == null ? '' : ': $detail'})';
}

/// `open` answered 403 `code_required`: the teacher's code must be entered first.
class MidtermCodeRequired implements Exception {
  const MidtermCodeRequired();
}

/// The app-binding reason inside a server refusal, or null for any other failure.
MidtermBlockReason? midtermBlockReasonOf(Object e) {
  if (e is UpdateRequired) return MidtermBlockReason.updateRequired;
  if (e is MidtermBlocked) return e.reason;
  if (e is! ApiError) return null;
  if (e.body.desktopRequired != true) return null;
  return switch (e.body.reason) {
    'desktop_required' => MidtermBlockReason.desktopRequired,
    'desktop_session_replaced' => MidtermBlockReason.sessionReplaced,
    'desktop_update_required' => MidtermBlockReason.updateRequired,
    'desktop_not_live' => MidtermBlockReason.notLive,
    'desktop_challenge_invalid' => MidtermBlockReason.challengeInvalid,
    'desktop_proof_invalid' => MidtermBlockReason.proofInvalid,
    _ => null,
  };
}

/// The low-battery warning threshold (unplugged, BELOW this percent).
const int lowBatteryPercent = 25;

/// Whether to warn: a laptop, on battery, under [lowBatteryPercent] — exactly the website's
/// and 0.1.0's `isLowBattery` (`percent < LOW_BATTERY_PERCENT`, useBattery.ts) and the
/// runner's (exam_header.dart). 25 % itself does not warn.
bool isLowBattery(BatteryStatus? b) =>
    b != null && b.hasBattery && !b.charging && b.percent != null && b.percent! < lowBatteryPercent;

class MidtermEngine extends ExamEngine {
  MidtermEngine(
    EngineDeps deps, {
    required this.midtermId,
    required super.studentName,
    LockdownController? lockdown,
  })  : lockdown = lockdown ??
            LockdownController(native: deps.native, heartbeatPeriod: deps.timings.lockHeartbeat, strict: true),
        _ownsLockdown = lockdown == null,
        super(deps, kind: ExamKind.midterm) {
    guard = OffscreenGuard(
      awayNow: deps.native.awayNow,
      now: () => deps.clock.monotonic,
      wallNow: () => deps.clock.wallNow,
      newId: deps.newId,
      onEvent: _onOffscreenEvent,
      poll: deps.timings.awayPoll,
      confirm: deps.timings.awayConfirm,
      arm: deps.timings.guardArm,
    );
    guard.status.addListener(_mirrorGuard);
    this.lockdown.addListener(_onLockChanged);
  }

  final int midtermId;
  final LockdownController lockdown;
  final bool _ownsLockdown;
  late final OffscreenGuard guard;
  final MemoryMediaStore _media = MemoryMediaStore();

  @override
  MediaStore get mediaStore => _media;

  MidtermPrepareResponse? _prepared;
  String? _token;
  bool _tokenRequired = true;
  bool _bindUnconfirmed = false;
  bool _rebinding = false;
  bool _refetching = false;
  final Set<int> _handedIn = {};
  int? _submitPendingModule;
  Timer? _heartbeat;
  Timer? _changeTimer;
  Timer? _submitTimer;
  Timer? _batteryTimer;
  Timer? _resultTimer;
  Duration? _resultPollStarted;
  final Map<Duration, Timer> _forcedTimers = {};
  final Set<String> _forcedFired = {};

  final ValueNotifier<MidtermBlockReason?> _blocked = ValueNotifier(null);
  final ValueNotifier<BatteryStatus?> _battery = ValueNotifier(null);
  final ValueNotifier<MidtermResult?> _result = ValueNotifier(null);

  /// The prepare response (rules, whether a code is needed); null before [prepare].
  MidtermPrepareResponse? get prepared => _prepared;

  /// The server turned the sitting away (or the lock was lost); null while all is well.
  ValueListenable<MidtermBlockReason?> get blocked => _blocked;

  /// The latest battery reading (null on a desktop PC or when unknown).
  ValueListenable<BatteryStatus?> get battery => _battery;

  /// The result once COMPLETED (released or awaiting release).
  ValueListenable<MidtermResult?> get result => _result;

  /// The after-return note ("You left the exam window. That counted as a warning — …").
  ValueListenable<String?> get offscreenNotice => guard.notice;

  /// Holds the in-memory lockdown token (tests, diagnostics).
  bool get bound => _token != null;

  bool get lockdownRequired => lastAttempt?.midterm?.desktopRequired ?? true;

  /// Modules this computer has handed in.
  Set<int> get handedIn => Set.unmodifiable(_handedIn);

  @override
  bool get canPause => false;

  int _orderOf(int? moduleId) {
    if (moduleId == null) return 0;
    final m = content[moduleId];
    if (m != null) return m.order;
    final i = moduleIds.indexOf(moduleId);
    return i < 0 ? 0 : i + 1;
  }

  bool get _sitting =>
      !disposed && (phaseValue == ExamPhase.running || phaseValue == ExamPhase.review) && liveModuleId != null;

  bool get _canSync {
    final live = liveModuleId;
    return !disposed &&
        live != null &&
        attemptIdValue != 0 &&
        !_handedIn.contains(live) &&
        (phaseValue == ExamPhase.running ||
            phaseValue == ExamPhase.review ||
            phaseValue == ExamPhase.transition ||
            phaseValue == ExamPhase.offlineWaiting ||
            phaseValue == ExamPhase.submitting) &&
        !(lastAttempt?.state.isFinished ?? false);
  }

  // ---------------------------------------------------------------------------------------
  // Setup: prepare → lock + bind → open
  // ---------------------------------------------------------------------------------------

  /// `POST midterms/{id}/prepare` (optionally with the teacher's code). A wrong code throws
  /// [ApiError] 403 `code_incorrect`. Network and version errors propagate.
  Future<MidtermPrepareResponse> prepare({String? code}) async {
    final r = await deps.api.midtermPrepare(midtermId, MidtermPrepareRequest(code: code));
    if (disposed) return r;
    setOnline(true);
    _prepared = r;
    final a = r.attempt;
    attemptIdValue = a.id;
    lastAttempt = a;
    moduleIds = a.moduleIds;
    testInfo ??= TestInfo(
      id: midtermId,
      subject: r.rules.subject,
      title: r.rules.title,
      tools: TestTools(calculator: r.rules.calculator, referenceSheet: false),
    );
    final record = AttemptRecord(
      id: a.id,
      kind: AttemptKind.midterm,
      refId: midtermId,
      serverState: a.state,
      serverVersion: a.version,
      moduleIds: a.moduleIds,
      activeModuleId: a.module?.id,
      localPhase: 'prepare',
      updatedWallMs: deps.wallMs,
    );
    write(() => store.upsertAttempt(record));
    _snapshotGuard(a);
    if (a.state.isFinished) _finishedOnServer(a);
    changed();
    return r;
  }

  /// Lock the machine, then bind the sitting to this window (challenge → prove → session).
  /// Throws [PrecheckFailed] (nothing locked), [ProofRefused], [MidtermBlocked] or an
  /// [ApiException]; when the server requires the app, a failed bind releases the machine.
  Future<void> lockAndBind() async {
    if (attemptIdValue == 0) throw StateError('prepare() first');
    if (!lockdown.locked) lockdown.enter();
    if (_token != null) return; // re-locking after the watchdog let go: the token is still good
    try {
      await _bind();
    } on Object catch (e) {
      final reason = midtermBlockReasonOf(e);
      if (lockdownRequired || reason == MidtermBlockReason.updateRequired) {
        lockdown.exit();
        rethrow;
      }
      // The server does not police this sitting: the lock, the heartbeat and the off-screen
      // rule still apply locally, unbound.
      _tokenRequired = false;
      outbox?.lockdownOptional = true;
    }
  }

  Future<void> _bind() async {
    Object? last;
    for (var i = 0; i < 3; i++) {
      try {
        final ch = await deps.api.midtermChallenge(attemptIdValue);
        final proof = lockdown.prove(attemptId: attemptIdValue, nonce: ch.nonce);
        _bindUnconfirmed = true;
        final s = await deps.api.midtermSession(attemptIdValue, proof.toSessionRequest(ch.nonce));
        _bindUnconfirmed = false;
        _token = s.lockdownSession;
        _tokenRequired = s.required;
        outbox?.lockdownOptional = !s.required;
        setOnline(true);
        return;
      } on ApiException catch (e) {
        last = e;
        final reason = midtermBlockReasonOf(e);
        if (reason != null) {
          throw MidtermBlocked(reason, e is ApiError ? e.body.detail : null);
        }
        if (!e.isTransient) rethrow;
        if (e is NetworkError) setOnline(false);
        await Future<void>.delayed(Duration(milliseconds: 600 * (i + 1)));
      }
    }
    throw last!;
  }

  /// `POST midterms/attempts/{id}/open`: the live module (memory only), saved answers merged
  /// with this computer's journal, then the runner starts. Throws [MidtermCodeRequired],
  /// [MidtermBlocked] or an [ApiException] after retries.
  Future<void> openPaper() async {
    for (var i = 0; i < 4; i++) {
      final sent = mono;
      try {
        final b = await deps.api.midtermOpen(attemptIdValue, const MidtermOpenRequest(), lockdownSession: _token ?? '');
        if (disposed) return;
        setOnline(true);
        await _applyBundle(b, sent, mono);
        return;
      } on ApiError catch (e) {
        if (e.code == 'code_required') throw const MidtermCodeRequired();
        final reason = midtermBlockReasonOf(e);
        if (reason != null) throw MidtermBlocked(reason, e.body.detail);
        final a = e.body.attempt;
        if (a != null && a.state.isFinished) {
          lastAttempt = a;
          _finishedOnServer(a);
          return;
        }
        if (!e.isTransient || i == 3) rethrow;
      } on NetworkError {
        setOnline(false);
        if (i == 3) rethrow;
      } on UpdateRequired {
        throw const MidtermBlocked(MidtermBlockReason.updateRequired);
      }
      await Future<void>.delayed(Duration(milliseconds: 800 * (i + 1)));
    }
  }

  Future<void> _applyBundle(ExamBundle b, Duration sent, Duration received) async {
    final a = b.attempt;
    lastAttempt = a;
    attemptIdValue = a.id;
    testInfo = b.test;
    moduleIds = a.moduleIds;
    for (final m in b.modules) {
      if (m.questions != null) content[m.id] = m; // memory only, never the store
    }
    await flushWrites();
    seq = await store.maxSeq(a.id);
    final rec = await store.loadAttempt(a.id);
    acked
      ..clear()
      ..addAll(rec?.ackedSeq ?? const {});
    _handedIn.addAll(await store.handedInModules(a.id));
    await loadLocalExtras();
    attachOutbox();
    guard.restorePending(await store.unsentOffscreenEvents(a.id));
    _snapshotGuard(a);
    if (disposed) return;
    if (a.midterm?.terminated ?? false) {
      _terminate(serverConfirmed: true);
      return;
    }
    if (a.state.isFinished) {
      _finishedOnServer(a);
      return;
    }
    if (guard.terminated) {
      // Strikes this computer tallied (offline, then the app died) still count: they are in
      // the outbox, now sending with the fresh token. The paper never comes back.
      if (phaseValue != ExamPhase.done) _terminate(serverConfirmed: false);
      return;
    }
    final live = a.module?.id;
    if (live == null || content[live]?.questions == null) {
      throw const ApiError(status: 502, body: ApiErrorBody(code: 'no_content', detail: 'The live module was missing.'));
    }
    final behind = await reconcileWithServer(live, b.answers[live] ?? const {}, b.flagged[live] ?? const []);
    mergeServerAnnotations(b.annotations);

    // Images in memory; wait briefly so the first question shows whole, then carry on.
    final keys = {...?content[live]?.questions?.expand((q) => q.imageKeys)};
    final download = _downloader().ensure(b.media, first: keys);
    unawaited(download.then((_) => changed()));
    await _atMost(download, const Duration(seconds: 3));
    if (disposed) return;

    _enter(a, live, sent, mono);
    if (behind) enqueueSync();
  }

  /// Wait for [f], but no longer than [cap] — with a cancelled timer, not a stray
  /// `Future.delayed` that outlives the wait.
  static Future<void> _atMost(Future<void> f, Duration cap) {
    final done = Completer<void>();
    final timer = Timer(cap, () {
      if (!done.isCompleted) done.complete();
    });
    f.then<void>((_) {}, onError: (Object _) {}).whenComplete(() {
      timer.cancel();
      if (!done.isCompleted) done.complete();
    });
    return done.future;
  }

  MediaDownloader _downloader() => MediaDownloader(
        target: _media,
        fetch: deps.fetchMedia,
        resign: () async =>
            (await deps.api.media(AttemptKind.midterm, attemptIdValue, lockdownSession: _token)).media,
      );

  /// Make [module] live from server timing [a] — synchronously re-anchoring its clock.
  void _enter(AttemptLite a, int module, Duration sent, Duration received) {
    // A sitting that ended here (a local forfeit) is never reopened by a late reply.
    if (disposed || phaseValue == ExamPhase.done || guard.terminated) return;
    _submitTimer?.cancel();
    _submitTimer = null;
    _submitPendingModule = null;
    final ms = a.timing.remainingMs ?? a.module?.durationMs ?? 0;
    enterModule(module, remaining: Duration(milliseconds: ms));
    moduleClock!.anchor(
      timing: a.timing,
      sent: sent,
      received: received,
      rule: AnchorRule.force,
      midterm: true,
      submitMargin: timings.midtermSubmitMargin,
      forceUpTolerance: forceUpTolerance,
    );
    phaseValue = ExamPhase.running;
    transitionValue = null;
    final id = attemptIdValue;
    write(() => store.setPhase(id, 'running', activeModuleId: module));
    startClockLoop();
    _startHeartbeat();
    _startBattery();
    _updateGuard();
    changed();
  }

  @override
  void configureOutbox(OutboxSender o) {
    o.lockdownToken = () => _token;
    o.lockdownOptional = !_tokenRequired;
  }

  // ---------------------------------------------------------------------------------------
  // Syncs
  // ---------------------------------------------------------------------------------------

  void _startHeartbeat() {
    _heartbeat ??= Timer.periodic(timings.midtermHeartbeat, (_) {
      if (_canSync && _blocked.value == null) enqueueSync();
    });
  }

  @override
  void onAnswerChanged() {
    _changeTimer?.cancel();
    _changeTimer = Timer(timings.midtermChangeSync, () {
      _changeTimer = null;
      if (_canSync && hasUnqueuedChanges) enqueueSync();
    });
  }

  @override
  void requestStatus() {
    if (_canSync) enqueueSync();
  }

  @override
  void onClockAnchored(ModuleClock c) {
    if (c.frozen) return;
    for (final off in timings.midtermForcedSyncs) {
      final key = '${c.moduleId}/${off.inMilliseconds}';
      _forcedTimers.remove(off)?.cancel();
      if (_forcedFired.contains(key)) continue;
      final at = c.deadline - off - mono;
      if (at <= Duration.zero) continue;
      _forcedTimers[off] = Timer(at, () {
        _forcedTimers.remove(off);
        _forcedFired.add(key);
        if (_canSync && liveModuleId == c.moduleId) enqueueSync();
      });
    }
    if (_submitPendingModule == c.moduleId && _submitTimer != null) _armSubmit(c.moduleId);
  }

  // ---------------------------------------------------------------------------------------
  // Module end: at the server deadline, never before
  // ---------------------------------------------------------------------------------------

  @override
  void onTimeUp(int moduleId) {
    record(JournalOp.deadline, moduleId: moduleId);
    _changeTimer?.cancel();
    _changeTimer = null;
    _submitPendingModule = moduleId;
    _armSubmit(moduleId);
    final last = moduleIds.isEmpty || moduleId == moduleIds.last;
    if (last) {
      transitionValue = null;
      phaseValue = ExamPhase.submitting;
    } else {
      final from = _orderOf(moduleId);
      transitionValue = ModuleTransition(fromOrder: from, toOrder: from + 1, waitingForServer: true);
      phaseValue = online ? ExamPhase.transition : ExamPhase.offlineWaiting;
    }
    _updateGuard();
    changed();
  }

  void _armSubmit(int moduleId) {
    _submitTimer?.cancel();
    _submitTimer = null;
    final c = moduleClock;
    if (c == null || c.moduleId != moduleId || _handedIn.contains(moduleId)) return;
    // The latest response's t_recv + remaining + 750 ms — no round-trip subtraction: the
    // server refuses a hand-in before its own deadline (design §1.7).
    final at = c.submitAt ?? (c.deadline + timings.midtermSubmitMargin);
    final delay = at - mono;
    _submitTimer = Timer(delay.isNegative ? Duration.zero : delay, () => _enqueueSubmit(moduleId));
  }

  void _enqueueSubmit(int moduleId) {
    _submitTimer = null;
    // A stale timer (module 2 already live) must never hand in module 2 with module 1's work.
    if (disposed || moduleId != liveModuleId || _handedIn.contains(moduleId)) return;
    _handedIn.add(moduleId);
    _submitPendingModule = null;
    final id = attemptIdValue;
    final item = submitItem(moduleId);
    recordWith(JournalOp.submit, () async {
      await store.enqueue(item);
      await store.setPhase(id, 'transition', activeModuleId: moduleId);
    }, moduleId: moduleId);
    write(() async {
      outbox?.kick();
      await refreshUnsent();
    });
  }

  @override
  Future<void> submitModule() async {
    // No hand-in before 0:00 on a midterm (canSubmitEarly is false); the engine submits itself.
  }

  // ---------------------------------------------------------------------------------------
  // Server replies
  // ---------------------------------------------------------------------------------------

  @override
  void onDelivered(OutboxItem item, Object response, Duration sent, Duration received) {
    switch (response) {
      case final WriteOutcome w:
        _adoptServer(w.attempt, sent, received);
      case final SubmitOutcome s:
        final next = s.nextModule;
        if (next != null && next.questions != null) {
          content[next.id] = next;
          unawaited(_downloader().ensure(s.media, first: {...next.questions!.expand((q) => q.imageKeys)}).then((_) {
            if (!disposed) changed();
          }));
        }
        _adoptServer(s.attempt, sent, received);
      case final OffscreenOutcome o:
        final eventId = (item.payload['event_id'] as String?) ?? item.idemKey;
        guard.acknowledge(eventId,
            violations: o.violations, limit: o.limit, graceSeconds: o.graceSeconds, terminated: o.terminated);
        if (o.terminated) {
          lastAttempt = o.attempt;
          _terminate(serverConfirmed: true);
          return;
        }
        _adoptServer(o.attempt, sent, received);
      default:
        break;
    }
  }

  void _snapshotGuard(AttemptLite a) {
    final m = a.midterm;
    if (m == null) return;
    guard.serverSnapshot(
      violations: m.offscreenViolations,
      limit: m.offscreenLimit,
      graceSeconds: m.offscreenGraceSeconds,
      terminated: m.terminated,
    );
  }

  void _adoptServer(AttemptLite a, Duration sent, Duration received) {
    if (disposed || a.id != attemptIdValue) return;
    _snapshotGuard(a);
    if (a.midterm?.terminated ?? false) {
      lastAttempt = a;
      _terminate(serverConfirmed: true);
      return;
    }
    if (a.state.isFinished) {
      lastAttempt = a;
      _finishedOnServer(a);
      return;
    }
    // Ended here already (a forfeit the server has not confirmed yet): nothing to follow.
    if (phaseValue == ExamPhase.done) return;
    final serverModule = a.module?.id;
    final live = liveModuleId;
    if (serverModule != null && serverModule != live && _orderOf(serverModule) > _orderOf(live)) {
      final prev = lastAttempt;
      if (prev != null && a.version < prev.version) return;
      if (live != null) _handedIn.add(live);
      if (content[serverModule]?.questions != null) {
        lastAttempt = a;
        _enter(a, serverModule, sent, received);
      } else {
        // A replayed submit carries the outcome but not the module (v1 stores outcomes only):
        // fetch the live module again.
        lastAttempt = a;
        unawaited(_refetchLiveModule());
      }
      return;
    }
    adoptLite(a, sent, received, AnchorRule.midterm);
  }

  Future<void> _refetchLiveModule() async {
    if (_refetching || disposed) return;
    _refetching = true;
    try {
      final sent = mono;
      final b = await deps.api.midtermOpen(attemptIdValue, const MidtermOpenRequest(), lockdownSession: _token ?? '');
      if (disposed) return;
      for (final m in b.modules) {
        if (m.questions != null) content[m.id] = m;
      }
      final live = b.attempt.module?.id;
      if (b.attempt.state.isFinished) {
        _finishedOnServer(b.attempt);
      } else if (live != null && content[live]?.questions != null) {
        await reconcileWithServer(live, b.answers[live] ?? const {}, b.flagged[live] ?? const []);
        unawaited(_downloader().ensure(b.media).then((_) {
          if (!disposed) changed();
        }));
        lastAttempt = b.attempt;
        _enter(b.attempt, live, sent, mono);
      }
    } on ApiException catch (e) {
      if (e is NetworkError) setOnline(false);
      // The next heartbeat/submit reply tries again.
    } finally {
      _refetching = false;
    }
  }

  void _finishedOnServer(AttemptLite a) {
    final terminated = a.midterm?.terminated ?? false;
    _finish(terminated ? ExamDoneReason.terminated : ExamDoneReason.submitted, serverConfirmed: true);
  }

  void _terminate({required bool serverConfirmed}) {
    if (serverConfirmed) guard.serverTerminated();
    offscreenStatus.value = OffscreenStatus(violations: guard.violations, limit: guard.limit, terminated: true);
    _finish(ExamDoneReason.terminated, serverConfirmed: serverConfirmed);
  }

  void _finish(ExamDoneReason reason, {required bool serverConfirmed}) {
    final alreadyDone = phaseValue == ExamPhase.done;
    stopClockLoop();
    _stopTimers();
    guard.enabled = false;
    lockdown.exit(); // the paper is in: release the machine
    final id = attemptIdValue;
    if (serverConfirmed && id != 0) {
      write(() async {
        // Nothing still queued can change a sitting the server has closed.
        await store.discardOutbox(id);
        final unsent =
            await store.unsentCount(id, lane: OutboxLane.exam) + await store.unsentCount(id, lane: OutboxLane.urgent);
        if (unsent == 0) await store.purgeJournal(id, kind: AttemptKind.midterm, wallMs: deps.wallMs);
        await store.setTerminal(id, deps.wallMs);
        await refreshUnsent();
      });
    }
    if (!alreadyDone || (reason == ExamDoneReason.terminated && doneReasonValue != reason)) {
      phaseValue = ExamPhase.done;
      doneReasonValue = reason;
      transitionValue = null;
      changed();
    }
    if (serverConfirmed) _startResultPolling();
  }

  @override
  void onFailed(OutboxItem item, ApiException error, OutboxFailure failure, Duration sent, Duration received) {
    switch (failure) {
      case OutboxFailure.held:
        final reason = midtermBlockReasonOf(error);
        if (reason != null) unawaited(_onRefused(reason));
      case OutboxFailure.network:
        if (phaseValue == ExamPhase.transition) {
          phaseValue = ExamPhase.offlineWaiting;
          changed();
        }
      case OutboxFailure.notExpired:
        final a = error is ApiError ? error.body.attempt : null;
        if (a != null) adoptLite(a, sent, received, AnchorRule.midterm);
      case OutboxFailure.dead:
        final a = error is ApiError ? error.body.attempt : null;
        if (a != null) {
          _adoptServer(a, sent, received);
        } else {
          setProblem(EngineProblem(EngineProblemKind.sendRefused,
              "The server couldn't accept part of your work. Ask your teacher — it's saved on this computer.",
              detail: '$error'));
        }
      case OutboxFailure.retrying:
      case OutboxFailure.parked:
        break;
    }
  }

  @override
  void setOnline(bool value) {
    super.setOnline(value);
    if (value && phaseValue == ExamPhase.offlineWaiting && transitionValue != null) {
      phaseValue = ExamPhase.transition;
      changed();
    }
  }

  /// A refusal mid-paper: fix what can be fixed silently (a fresh token while still locked);
  /// release the machine for the rest.
  Future<void> _onRefused(MidtermBlockReason reason) async {
    if (disposed) return;
    switch (reason) {
      case MidtermBlockReason.desktopRequired:
      case MidtermBlockReason.challengeInvalid:
      case MidtermBlockReason.proofInvalid:
        if (lockdown.locked && !_rebinding) {
          await _silentRebind();
        } else {
          _setBlocked(MidtermBlockReason.desktopRequired);
        }
      case MidtermBlockReason.sessionReplaced:
        // Our OWN last bind may have landed unseen (its reply was lost): re-bind once rather
        // than tell the student the paper moved. Otherwise the newest session wins.
        if (_bindUnconfirmed && lockdown.locked && !_rebinding) {
          _bindUnconfirmed = false;
          await _silentRebind();
        } else {
          _token = null;
          _setBlocked(MidtermBlockReason.sessionReplaced);
          release();
        }
      case MidtermBlockReason.updateRequired:
        _setBlocked(MidtermBlockReason.updateRequired);
        setProblem(const EngineProblem(EngineProblemKind.updateRequired,
            'Update the MasterSAT app to keep going — your answers are saved on this computer.'));
        release();
      case MidtermBlockReason.notLive:
        // The sitting ended on the server: whatever we hold is moot; show the result.
        _finish(ExamDoneReason.submitted, serverConfirmed: true);
      case MidtermBlockReason.lockLost:
        _setBlocked(MidtermBlockReason.lockLost);
    }
  }

  Future<void> _silentRebind() async {
    _rebinding = true;
    _token = null;
    try {
      await _bind();
      _setBlocked(null);
      outbox?.release();
    } on Object {
      _setBlocked(MidtermBlockReason.desktopRequired);
    } finally {
      _rebinding = false;
    }
  }

  void _setBlocked(MidtermBlockReason? r) {
    if (disposed) return;
    _blocked.value = r;
    _updateGuard();
    changed();
  }

  /// "Lock and resume" after a lost lock or a refusal: lock again, re-bind if needed, send
  /// what waited. Throws like [lockAndBind].
  Future<void> relock() async {
    if (!lockdown.locked) lockdown.enter();
    if (_token == null && lockdownRequired) {
      try {
        await _bind();
      } on Object {
        lockdown.exit();
        rethrow;
      }
    }
    _setBlocked(null);
    outbox?.release();
    _updateGuard();
  }

  // ---------------------------------------------------------------------------------------
  // Lockdown, guard, battery
  // ---------------------------------------------------------------------------------------

  void _onLockChanged() {
    if (disposed) return;
    if (lockdown.lost && _blocked.value == null && phaseValue != ExamPhase.done) {
      _setBlocked(MidtermBlockReason.lockLost);
    }
    _updateGuard();
  }

  void _updateGuard() {
    if (disposed) return;
    guard.enabled = _sitting &&
        lockdown.locked &&
        !lockdown.lost &&
        _blocked.value == null &&
        transitionValue == null &&
        timeUpModule != liveModuleId &&
        !guard.terminated;
  }

  void _mirrorGuard() {
    if (disposed) return;
    offscreenStatus.value = guard.status.value;
    if (guard.terminated && phaseValue != ExamPhase.done) {
      // The local tally reached the limit: show it as the server will (it is told by the
      // queued events, which keep sending).
      _terminate(serverConfirmed: false);
      return;
    }
    changed();
  }

  void _onOffscreenEvent(OffscreenEvent e) {
    final id = attemptIdValue;
    final item = OutboxItem(
      attemptId: id,
      attemptKind: AttemptKind.midterm,
      lane: OutboxLane.urgent,
      kind: OutboxKind.offscreen,
      idemKey: IdempotencyKeys.offscreen(id, e.id),
      payload: OffscreenRequest(eventId: e.id, occurredAt: e.occurredAt, awayMs: e.awayMs).toJson(),
      createdWallMs: deps.wallMs,
    );
    recordWith(JournalOp.offscreen, () => store.enqueue(item).then((_) {}), value: e.id);
    write(() async {
      outbox?.kick();
      await refreshUnsent();
    });
  }

  void _startBattery() {
    if (_batteryTimer != null) return;
    _readBattery();
    _batteryTimer = Timer.periodic(timings.batteryPoll, (_) => _readBattery());
  }

  void _readBattery() {
    if (disposed) return;
    try {
      final b = deps.native.battery();
      _battery.value = (b != null && b.hasBattery) ? b : null;
    } on Object {
      // keep the last reading
    }
  }

  /// Read the battery now (the pre-check screen shows it before the sitting starts).
  BatteryStatus? readBatteryNow() {
    _readBattery();
    return _battery.value;
  }

  // ---------------------------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------------------------

  void _startResultPolling() {
    if (_resultTimer != null || _result.value != null || disposed || attemptIdValue == 0) return;
    _resultPollStarted = mono;
    _resultTimer = Timer(Duration.zero, _pollResult);
  }

  Future<void> _pollResult() async {
    _resultTimer = null;
    if (disposed) return;
    Duration? pollAfter;
    try {
      final r = await deps.api.midtermResult(attemptIdValue);
      if (disposed) return;
      setOnline(true);
      if (r.state == AttemptState.completed) {
        _result.value = r;
        changed();
        return;
      }
      pollAfter = r.pollAfterMs == null ? null : Duration(milliseconds: r.pollAfterMs!);
    } on NetworkError {
      if (disposed) return;
      setOnline(false);
    } on Object {
      if (disposed) return;
    }
    final fast = mono - (_resultPollStarted ?? mono) < timings.resultFastWindow;
    final next = fast ? (pollAfter ?? timings.resultFastPoll) : timings.resultSlowPoll;
    _resultTimer = Timer(next, _pollResult);
  }

  // ---------------------------------------------------------------------------------------
  // Not on midterms
  // ---------------------------------------------------------------------------------------

  @override
  Future<void> start() async {}

  @override
  Future<bool> pause() async => false;

  @override
  Future<void> resume() async {}

  @override
  Future<SaveAndExitResult> saveAndExit() async => const SaveAndExitResult(pausedOnServer: false);

  // ---------------------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------------------

  void _stopTimers() {
    _heartbeat?.cancel();
    _heartbeat = null;
    _changeTimer?.cancel();
    _changeTimer = null;
    _submitTimer?.cancel();
    _submitTimer = null;
    _batteryTimer?.cancel();
    _batteryTimer = null;
    for (final t in _forcedTimers.values) {
      t.cancel();
    }
    _forcedTimers.clear();
  }

  /// Release the machine and stop watching (every exit path). Safe to call twice.
  void release() {
    guard.enabled = false;
    lockdown.exit();
    _batteryTimer?.cancel();
    _batteryTimer = null;
  }

  @override
  void dispose() {
    if (disposed) return;
    _stopTimers();
    _resultTimer?.cancel();
    guard.status.removeListener(_mirrorGuard);
    lockdown.removeListener(_onLockChanged);
    release();
    super.dispose();
    guard.dispose();
    if (_ownsLockdown) lockdown.dispose();
    _blocked.dispose();
    _battery.dispose();
    _result.dispose();
    _media.clear();
  }
}

// PastpaperEngine — one past-paper sitting (design_data_server.md §1.3–§1.11, §2.b–§2.c).
//
//  * open: render the cached copy at once when this computer has one, then `open` with the
//    `have` hashes and reconcile (server ⊕ newer local journal). A first open downloads the
//    whole test — both modules and every image (sealed files) — and the Welcome screen waits
//    only for module 1's images.
//  * Welcome → start: the local clock starts on the click; `start` goes in the background.
//  * Answers are local first. The background safety copy is a full-module `sync` 10 s after
//    the last change or 60 s after the first unsent one, and at once on Check Your Work,
//    Pause, Save & Exit and close.
//  * Module end (Submit or 0:00): the journal row + the frozen `submit` are ONE transaction,
//    and module 2 starts from the cache at once. The final module goes to `submitting` until
//    the server confirms SCORING, then `done` and result polling (`poll_after_ms`).
//  * Pause/resume need the network (optimistic freeze; only the latest reply is adopted).
//  * Offline: everything but pause works; the server's timing is accepted on reconnect.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../session_contract.dart';
import 'engine_clock.dart';
import 'exam_engine.dart';
import 'exam_store.dart';
import 'media_cache.dart';
import 'outbox.dart';

class PastpaperEngine extends ExamEngine {
  PastpaperEngine(
    super.deps, {
    required this.practiceTestId,
    required super.studentName,
  }) : super(kind: ExamKind.pastpaper) {
    _media = SealedFileMediaStore(store: deps.store, native: deps.native, wallMs: () => deps.wallMs);
  }

  final int practiceTestId;

  late final SealedFileMediaStore _media;

  @override
  MediaStore get mediaStore => _media;

  /// Modules this computer has handed in.
  final Set<int> _handedIn = {};

  Timer? _quietTimer;
  Timer? _maxTimer;
  Timer? _periodic;
  Timer? _resultTimer;
  Duration? _resultPollStarted;
  int _pauseSerial = 0;
  bool _resumeOwed = false;
  bool _opened = false;

  final ValueNotifier<PastpaperResult?> _result = ValueNotifier(null);
  final ValueNotifier<MediaProgress?> _mediaProgress = ValueNotifier(null);

  /// The score once the server has it (COMPLETED); null while scoring or before.
  ValueListenable<PastpaperResult?> get result => _result;

  /// Image download progress while the first open is still loading.
  ValueListenable<MediaProgress?> get mediaProgress => _mediaProgress;

  /// Modules handed in on this computer (tests, diagnostics).
  Set<int> get handedIn => Set.unmodifiable(_handedIn);

  @override
  bool get canPause =>
      online &&
      !paused &&
      moduleClock != null &&
      (phase == ExamPhase.running || phase == ExamPhase.review) &&
      timeUpModule != liveModuleId;

  ModuleContent? _module(int id) => content[id];

  Duration _durationOf(int moduleId) {
    final m = _module(moduleId);
    if (m != null) return Duration(minutes: m.timeLimitMinutes);
    final a = lastAttempt;
    if (a?.module?.id == moduleId) return Duration(milliseconds: a!.module!.durationMs);
    return Duration.zero;
  }

  int _orderOf(int moduleId) {
    final m = _module(moduleId);
    if (m != null) return m.order;
    final i = moduleIds.indexOf(moduleId);
    return i < 0 ? 0 : i + 1;
  }

  int? _nextModuleAfter(int moduleId) {
    final i = moduleIds.indexOf(moduleId);
    return i >= 0 && i + 1 < moduleIds.length ? moduleIds[i + 1] : null;
  }

  Map<int, String> get _haveHashes => {
        for (final m in content.values)
          if (m.questions != null) m.id: m.contentHash,
      };

  // ---------------------------------------------------------------------------------------
  // Open
  // ---------------------------------------------------------------------------------------

  /// Opens the paper: the cached copy first (if any), then the server's bundle. Never throws;
  /// failures land in [problem] (the screen shows them with a way back).
  Future<void> open() async {
    if (_opened) return;
    _opened = true;
    phaseValue = ExamPhase.loading;
    changed();
    var fromCache = false;
    try {
      final local = await store.findUnfinished(AttemptKind.pastpaper, practiceTestId);
      if (local != null) fromCache = await _restoreLocal(local);
    } catch (e) {
      setProblem(EngineProblem(EngineProblemKind.storageFailed,
          "Your saved work on this computer couldn't be read. Try opening the paper again.",
          detail: '$e'));
    }
    if (disposed) return;

    ExamBundle bundle;
    final sent = mono;
    try {
      bundle = await deps.api.pastpaperOpen(practiceTestId, PastpaperOpenRequest(start: false, have: _haveHashes));
    } on NetworkError catch (e) {
      setOnline(false);
      if (!fromCache) {
        setProblem(EngineProblem(EngineProblemKind.loadFailed,
            'This paper needs an internet connection the first time it opens. Connect, then try again.',
            canRetry: true, detail: '$e'));
      }
      return;
    } on UpdateRequired catch (e) {
      setProblem(EngineProblem(EngineProblemKind.updateRequired,
          'Update the MasterSAT app to keep going — your answers are saved on this computer.',
          detail: '$e'));
      return;
    } on ApiError catch (e) {
      setOnline(true);
      if (e.status == 404) {
        setProblem(EngineProblem(EngineProblemKind.notAvailable,
            "This paper isn't available to you any more. Anything you answered is saved on this computer.",
            detail: '$e'));
      } else if (!fromCache) {
        setProblem(EngineProblem(EngineProblemKind.loadFailed,
            "This paper couldn't be opened just now. Try again in a moment.",
            canRetry: true, detail: '$e'));
      }
      return;
    } on FormatException catch (e) {
      if (!fromCache) {
        setProblem(EngineProblem(EngineProblemKind.loadFailed,
            "This paper couldn't be opened just now. Try again in a moment.",
            canRetry: true, detail: '$e'));
      }
      return;
    }
    if (disposed) return;
    setOnline(true);
    await _applyBundle(bundle, fromCache: fromCache, sent: sent, received: mono);
  }

  /// "Try again" after a load failure.
  Future<void> retryOpen() async {
    setProblem(null);
    _opened = false;
    await open();
  }

  /// Rebuild the sitting from this computer alone (no network). Returns whether the live
  /// module's content is here, i.e. whether the student can keep going offline.
  Future<bool> _restoreLocal(AttemptRecord local) async {
    attemptIdValue = local.id;
    testInfo = local.test;
    moduleIds = local.moduleIds;
    for (final meta in local.moduleMeta) {
      final hash = local.contentHashes[meta.id];
      final qs = hash == null ? null : await store.getContent(hash);
      content[meta.id] = qs == null ? meta : meta.withQuestions(qs);
    }
    acked
      ..clear()
      ..addAll(local.ackedSeq);
    seq = await store.maxSeq(local.id);
    _handedIn
      ..clear()
      ..addAll(await store.handedInModules(local.id));
    for (final m in moduleIds) {
      await loadModuleState(m);
    }
    await loadLocalExtras();

    var live = local.activeModuleId ?? (moduleIds.isEmpty ? null : moduleIds.first);
    // A hand-in committed but the phase write lost: the journal is the truth.
    while (live != null && _handedIn.contains(live)) {
      live = _nextModuleAfter(live);
    }
    final allIn = moduleIds.isNotEmpty && moduleIds.every(_handedIn.contains);
    if (allIn) {
      liveModuleId = moduleIds.last;
      phaseValue = ExamPhase.submitting;
      attachOutbox();
      changed();
      return true;
    }
    if (live == null) return false;
    liveModuleId = live;
    final hasContent = content[live]?.questions != null;
    if (!hasContent) return false;

    final started = local.localPhase != 'welcome' && local.remainingMsAtTick != null;
    if (!started) {
      phaseValue = ExamPhase.welcome;
    } else {
      var remaining = Duration(milliseconds: local.remainingMsAtTick!);
      if (!local.paused && local.tickWallMs != null) {
        // Time with the app closed counts, as it does on the server (design §1.8).
        final away = deps.wallMs - local.tickWallMs!;
        if (away > 0) remaining -= Duration(milliseconds: away);
      }
      enterModule(live, remaining: remaining, frozen: local.paused);
      pausedFlag = local.paused;
      phaseValue = local.localPhase == 'review' ? ExamPhase.review : ExamPhase.running;
      startClockLoop();
      _startPeriodic();
    }
    attachOutbox();
    changed();
    return true;
  }

  Future<void> _applyBundle(ExamBundle b, {required bool fromCache, required Duration sent, required Duration received}) async {
    final a = b.attempt;
    if (fromCache && a.id != attemptIdValue) {
      // The server has no open sitting for the attempt this computer held (it was finished
      // elsewhere): close it locally — its outbox still drains — and take the server's.
      final old = attemptIdValue;
      write(() => store.setTerminal(old, deps.wallMs));
      _resetForNewAttempt();
      fromCache = false;
    }
    attemptIdValue = a.id;
    lastAttempt = a;
    testInfo = b.test;
    moduleIds = a.moduleIds;

    for (final m in b.modules) {
      if (m.questions != null) {
        content[m.id] = m;
        final qs = m.questions!;
        write(() => store.putContent(m.contentHash, m.id, qs, deps.wallMs));
      } else if (m.unchanged) {
        final cached = content[m.id]?.questions ?? await store.getContent(m.contentHash);
        content[m.id] = cached == null ? m : m.withQuestions(cached);
      } else {
        content[m.id] = m; // deferred: arrives as submit.next_module
      }
    }
    final meta = [for (final id in moduleIds) if (content[id] != null) content[id]!];
    final hashes = {for (final m in meta) if (m.questions != null) m.id: m.contentHash};
    final record = AttemptRecord(
      id: a.id,
      kind: AttemptKind.pastpaper,
      refId: practiceTestId,
      serverState: a.state,
      serverVersion: a.version,
      moduleIds: moduleIds,
      activeModuleId: a.module?.id,
      localPhase: 'welcome',
      contentHashes: hashes,
      test: b.test,
      moduleMeta: meta,
      updatedWallMs: deps.wallMs,
    );
    write(() async {
      await store.upsertAttempt(record);
      await store.setContentHashes(a.id, hashes);
      await store.setServerState(a.id, a.state, a.version);
    });
    if (!fromCache) {
      seq = await store.maxSeq(a.id);
      _handedIn.addAll(await store.handedInModules(a.id));
      await loadLocalExtras();
    }

    if (a.state.isFinished) {
      attachOutbox();
      _finishedOnServer(a);
      return;
    }

    // Which module is live: the one further along — the server's, or this computer's when a
    // hand-in is still in the outbox (design §1.10: flush it, then continue module 2).
    final serverModule = a.module?.id ?? (moduleIds.isEmpty ? null : moduleIds.first);
    var live = serverModule;
    final local = liveModuleId;
    if (local != null && serverModule != null && _orderOf(local) > _orderOf(serverModule)) live = local;
    while (live != null && _handedIn.contains(live)) {
      live = _nextModuleAfter(live);
    }

    // Reconcile every module the server sent answers for (server ⊕ unacknowledged journal).
    var behind = false;
    for (final m in moduleIds) {
      final serverAnswers = b.answers[m] ?? const <int, String>{};
      final serverFlags = b.flagged[m] ?? const <int>[];
      final differs = await reconcileWithServer(m, serverAnswers, serverFlags);
      if (differs && m == serverModule && a.state.isActive && !_handedIn.contains(m)) behind = true;
    }
    mergeServerAnnotations(b.annotations);
    attachOutbox();

    if (live == null) {
      // Every module handed in locally; the outbox is delivering the last one.
      phaseValue = ExamPhase.submitting;
      changed();
      return;
    }

    // Images: the live module's first (Start waits for them), the rest in the background.
    final liveKeys = {...?content[live]?.questions?.expand((q) => q.imageKeys)};
    final downloader = MediaDownloader(
      target: _media,
      fetch: deps.fetchMedia,
      resign: () async => (await deps.api.media(AttemptKind.pastpaper, a.id)).media,
    );
    final firstRefs = [for (final r in b.media) if (liveKeys.contains(r.key)) r];
    if (!fromCache && firstRefs.isNotEmpty) {
      await downloader.ensure(firstRefs, onProgress: (p) {
        if (!disposed) _mediaProgress.value = p;
      });
      if (disposed) return;
    }
    unawaited(downloader.ensure(b.media, first: liveKeys));

    if (content[live]?.questions == null) {
      // Deferred module 2 with module 1 already handed in: wait for the submit response.
      liveModuleId = live;
      _waitForServerModule(fromOrder: _orderOf(live) - 1, toOrder: _orderOf(live));
      return;
    }

    final serverIsLive = a.state.isActive && serverModule == live;
    if (a.state == AttemptState.notStarted && moduleClock == null) {
      liveModuleId = live;
      phaseValue = ExamPhase.welcome;
      write(() => store.setPhase(a.id, 'welcome', activeModuleId: live));
      changed();
      return;
    }
    if (moduleClock == null || moduleClock!.moduleId != live) {
      final ms = serverIsLive ? a.timing.remainingMs : null;
      final remaining = ms != null ? Duration(milliseconds: ms) : _durationOf(live);
      liveModuleId = live;
      enterModule(live, remaining: remaining, frozen: serverIsLive && a.timing.paused);
      pausedFlag = serverIsLive && a.timing.paused;
      if (!serverIsLive) forceAnchorModule = live;
    } else if (serverIsLive) {
      // The cached sitting is on screen: the server's clock wins in both directions (reopen).
      adoptOpenTiming(a, sent, received);
    } else {
      forceAnchorModule = live;
    }
    if (phaseValue != ExamPhase.review) phaseValue = ExamPhase.running;
    write(() => store.setPhase(a.id, phaseValue == ExamPhase.review ? 'review' : 'running', activeModuleId: live));
    startClockLoop();
    _startPeriodic();
    if (behind) enqueueSync();
    changed();
  }

  /// Open/reopen: the server's timing replaces the local countdown in both directions.
  void adoptOpenTiming(AttemptLite a, Duration sent, Duration received) {
    final c = moduleClock;
    if (c == null || a.module?.id != c.moduleId) return;
    final ms = a.timing.remainingMs;
    if (ms == null) return;
    if (a.timing.paused) {
      c.setFrozen(Duration(milliseconds: ms));
      pausedFlag = true;
    } else {
      if (c.frozen) c.unfreeze(mono, remaining: Duration(milliseconds: ms));
      c.anchor(timing: a.timing, sent: sent, received: received, rule: AnchorRule.force);
      pausedFlag = false;
    }
    armDeadline();
    onTick();
  }

  void _resetForNewAttempt() {
    content.clear();
    answers.clear();
    flags.clear();
    acked.clear();
    queuedSeq.clear();
    _handedIn.clear();
    annotationMap.clear();
    moduleClock = null;
    liveModuleId = null;
    seq = 0;
    stopClockLoop();
    outbox = null;
  }

  // ---------------------------------------------------------------------------------------
  // Start, answers, background sync
  // ---------------------------------------------------------------------------------------

  @override
  Future<void> start() async {
    if (phaseValue != ExamPhase.welcome || liveModuleId == null) return;
    final m = liveModuleId!;
    final a = lastAttempt;
    final remaining = a != null && a.module?.id == m && a.timing.remainingMs != null && !a.state.isActive
        ? Duration(milliseconds: a.timing.remainingMs!)
        : _durationOf(m);
    enterModule(m, remaining: remaining);
    phaseValue = ExamPhase.running;
    final id = attemptIdValue;
    final item = OutboxItem(
      attemptId: id,
      attemptKind: AttemptKind.pastpaper,
      lane: OutboxLane.exam,
      kind: OutboxKind.start,
      idemKey: IdempotencyKeys.start(id),
      payload: const {},
      createdWallMs: deps.wallMs,
    );
    write(() async {
      await store.transaction(() async {
        await store.setPhase(id, 'running', activeModuleId: m);
        await store.enqueue(item);
      });
      outbox?.kick();
      await refreshUnsent();
    });
    startClockLoop();
    _startPeriodic();
    changed();
  }

  @override
  void onAnswerChanged() {
    _quietTimer?.cancel();
    _quietTimer = Timer(timings.pastpaperQuietSync, _syncNow);
    _maxTimer ??= Timer(timings.pastpaperMaxUnsent, _syncNow);
  }

  void _cancelSyncTimers() {
    _quietTimer?.cancel();
    _quietTimer = null;
    _maxTimer?.cancel();
    _maxTimer = null;
  }

  void _syncNow() {
    _cancelSyncTimers();
    if (disposed || !clockRunsInPhase) return;
    final live = liveModuleId;
    if (live == null || _handedIn.contains(live)) return;
    if (hasUnqueuedChanges) enqueueSync();
  }

  void _startPeriodic() {
    _periodic ??= Timer.periodic(timings.offlineProbe, (_) => _periodicCheck());
  }

  int _probeTicks = 0;

  void _periodicCheck() {
    if (disposed || !clockRunsInPhase) return;
    final live = liveModuleId;
    if (live == null || _handedIn.contains(live)) return;
    _probeTicks++;
    if (!online && unsentItems == 0 && !(outbox?.isBusy(OutboxLane.exam) ?? false)) {
      // Offline: a cheap status read finds the connection again (a replayed sync).
      enqueueSync();
      return;
    }
    // Online: a safety copy at least every 60 s while something is unacknowledged.
    final every = (timings.pastpaperMaxUnsent.inMilliseconds / timings.offlineProbe.inMilliseconds).ceil();
    if (_probeTicks % (every < 1 ? 1 : every) == 0 && seq > (acked[live] ?? 0) && hasUnqueuedChanges) {
      enqueueSync();
    }
  }

  @override
  void onReviewOpened() => _syncNow();

  @override
  void requestStatus() {
    final live = liveModuleId;
    if (live == null || _handedIn.contains(live) || !clockRunsInPhase) return;
    enqueueSync();
  }

  @override
  void onConnectivity(bool online) {
    if (!online) return;
    // The server's clock is the truth after time away from it (design §1.8): the next reply
    // about the live module re-anchors in both directions.
    forceNextAnchor = true;
    if (_resumeOwed) unawaited(_sendResume());
  }

  // ---------------------------------------------------------------------------------------
  // Module end
  // ---------------------------------------------------------------------------------------

  @override
  void onTimeUp(int moduleId) => _handIn(moduleId);

  @override
  Future<void> submitModule() async {
    if (phaseValue != ExamPhase.review && phaseValue != ExamPhase.running) return;
    final live = liveModuleId;
    if (live == null) return;
    _handIn(live);
  }

  void _handIn(int moduleId) {
    if (moduleId != liveModuleId || _handedIn.contains(moduleId)) return;
    _handedIn.add(moduleId);
    _cancelSyncTimers();
    final id = attemptIdValue;
    final item = submitItem(moduleId);
    final next = _nextModuleAfter(moduleId);
    final nextReady = next != null && content[next]?.questions != null;
    final phaseAfter = next == null ? 'submitting' : (nextReady ? 'running' : 'transition');
    recordWith(JournalOp.submit, () async {
      await store.enqueue(item);
      await store.setPhase(id, phaseAfter, activeModuleId: next ?? moduleId);
    }, moduleId: moduleId);
    write(() async {
      outbox?.kick();
      await refreshUnsent();
    });
    if (next == null) {
      stopClockLoop();
      phaseValue = ExamPhase.submitting;
      if (!online) emit(ExamNotice.savedOffline);
    } else if (nextReady) {
      // Module 2 from the cache, now. Its clock is local until the server's reply about it
      // arrives, which then re-anchors it in both directions.
      enterModule(next, remaining: _durationOf(next));
      forceAnchorModule = next;
      phaseValue = ExamPhase.running;
      transitionValue = null;
      startClockLoop();
    } else {
      liveModuleId = next;
      _waitForServerModule(fromOrder: _orderOf(moduleId), toOrder: _orderOf(next));
    }
    changed();
  }

  void _waitForServerModule({required int fromOrder, required int toOrder}) {
    stopClockLoop();
    moduleClock = null;
    transitionValue = ModuleTransition(fromOrder: fromOrder, toOrder: toOrder, waitingForServer: true);
    phaseValue = online ? ExamPhase.transition : ExamPhase.offlineWaiting;
    changed();
  }

  void _receiveModule(ModuleContent next, List<MediaRef> media) {
    if (next.questions == null) return;
    content[next.id] = next;
    final qs = next.questions!;
    final meta = [for (final id in moduleIds) if (content[id] != null) content[id]!];
    final hashes = {for (final m in meta) if (m.questions != null) m.id: m.contentHash};
    final id = attemptIdValue;
    write(() async {
      await store.putContent(next.contentHash, next.id, qs, deps.wallMs);
      await store.setModuleMeta(id, meta);
      await store.setContentHashes(id, hashes);
    });
    final downloader = MediaDownloader(
      target: _media,
      fetch: deps.fetchMedia,
      resign: () async => (await deps.api.media(AttemptKind.pastpaper, id)).media,
    );
    unawaited(downloader.ensure(media));
  }

  // ---------------------------------------------------------------------------------------
  // Server replies
  // ---------------------------------------------------------------------------------------

  @override
  void onDelivered(OutboxItem item, Object response, Duration sent, Duration received) {
    switch (response) {
      case final AttemptEnvelope e:
        _adoptServer(e.attempt, sent, received);
      case final WriteOutcome w:
        _adoptServer(w.attempt, sent, received);
      case final SubmitOutcome s:
        final next = s.nextModule;
        if (next != null) _receiveModule(next, s.media);
        _adoptServer(s.attempt, sent, received);
      default:
        break;
    }
  }

  void _adoptServer(AttemptLite a, Duration sent, Duration received) {
    if (disposed || a.id != attemptIdValue) return;
    if (a.state.isFinished) {
      lastAttempt = a;
      _finishedOnServer(a);
      return;
    }
    final serverModule = a.module?.id;
    final live = liveModuleId;
    final clockModule = moduleClock?.moduleId;
    final follow = a.state.isActive &&
        serverModule != null &&
        content[serverModule]?.questions != null &&
        clockModule != serverModule &&
        (live == null || _orderOf(serverModule) >= _orderOf(live));
    if (follow) {
      // The server is on a module this screen is not counting: module 2 arrived for a
      // deferred paper, or the sitting moved on from another device. Follow it.
      lastAttempt = a;
      if (live != null && live != serverModule) _handedIn.add(live);
      final ms = a.timing.remainingMs;
      enterModule(serverModule,
          remaining: ms == null ? _durationOf(serverModule) : Duration(milliseconds: ms), frozen: a.timing.paused);
      pausedFlag = a.timing.paused;
      phaseValue = ExamPhase.running;
      transitionValue = null;
      final id = attemptIdValue;
      write(() => store.setPhase(id, 'running', activeModuleId: serverModule));
      startClockLoop();
      _startPeriodic();
      changed();
      return;
    }
    adoptLite(a, sent, received, AnchorRule.pastpaper);
  }

  void _finishedOnServer(AttemptLite a) {
    final id = attemptIdValue;
    final wasRunning = phaseValue != ExamPhase.submitting && phaseValue != ExamPhase.done;
    stopClockLoop();
    _cancelSyncTimers();
    _periodic?.cancel();
    _periodic = null;
    moduleClock?.freeze(mono);
    write(() async {
      if (wasRunning) {
        // Finished elsewhere: nothing this computer still holds can be used.
        await store.discardOutbox(id);
      }
      final unsent = await store.unsentCount(id, lane: OutboxLane.exam) + await store.unsentCount(id, lane: OutboxLane.urgent);
      if (unsent == 0) await store.purgeJournal(id, kind: AttemptKind.pastpaper, wallMs: deps.wallMs);
      await store.setTerminal(id, deps.wallMs);
      await refreshUnsent();
    });
    if (phaseValue != ExamPhase.done || doneReasonValue != ExamDoneReason.submitted) {
      phaseValue = ExamPhase.done;
      doneReasonValue = ExamDoneReason.submitted;
      transitionValue = null;
      changed();
    }
    if (a.state == AttemptState.completed || a.state == AttemptState.scoring) _startResultPolling();
  }

  @override
  void onFailed(OutboxItem item, ApiException error, OutboxFailure failure, Duration sent, Duration received) {
    switch (failure) {
      case OutboxFailure.parked:
        setProblem(EngineProblem(EngineProblemKind.sendStuck,
            "MasterSAT couldn't save your answers on the server just now. They're safe on this computer — try again.",
            canRetry: true, detail: '$error'));
      case OutboxFailure.dead:
        if (error is ApiError) {
          final attempt = error.body.attempt;
          if (attempt != null) _adoptServer(attempt, sent, received);
          if (error.status == 404) {
            setProblem(EngineProblem(EngineProblemKind.notAvailable,
                "This paper isn't available to you any more. Anything you answered is saved on this computer.",
                detail: '$error'));
          } else if (attempt == null) {
            setProblem(EngineProblem(EngineProblemKind.sendRefused,
                "The server couldn't accept part of your work. It's saved on this computer.",
                detail: '$error'));
          }
        }
      case OutboxFailure.network:
        if (phaseValue == ExamPhase.transition) {
          phaseValue = ExamPhase.offlineWaiting;
          changed();
        }
      case OutboxFailure.retrying:
      case OutboxFailure.notExpired:
      case OutboxFailure.held:
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

  /// "Try again" on a stuck send.
  Future<void> retrySend() async {
    setProblem(null);
    await outbox?.retryParked();
  }

  // ---------------------------------------------------------------------------------------
  // Pause / resume / Save & Exit
  // ---------------------------------------------------------------------------------------

  @override
  Future<bool> pause() async {
    if (!canPause) {
      if (!online && kind == ExamKind.pastpaper) emit(ExamNotice.pauseNeedsConnection);
      return false;
    }
    final c = moduleClock!;
    final module = liveModuleId;
    if (hasUnqueuedChanges) _syncNow();
    c.freeze(mono);
    pausedFlag = true;
    armDeadline();
    persistTick(force: true);
    changed();
    final serial = ++_pauseSerial;
    final sent = mono;
    try {
      final env = await deps.api.pastpaperPause(attemptIdValue).timeout(timings.pauseWait);
      if (disposed) return true;
      setOnline(true);
      // Only the LATEST pause/resume reply is adopted, and only about the live module: an
      // older reply (a module change overtook it) must not freeze module 2's countdown while
      // the server's module-2 clock runs on (0.1.0 review).
      if (serial != _pauseSerial) return pausedFlag;
      if (env.attempt.module?.id != module || module != liveModuleId) {
        _adoptServer(env.attempt, sent, mono);
        return false;
      }
      adoptPauseReply(env.attempt, sent, mono);
      persistTick(force: true);
      return env.attempt.timing.paused;
    } on Object catch (e) {
      if (disposed) return false;
      if (serial == _pauseSerial && moduleClock == c) {
        c.unfreeze(mono);
        pausedFlag = false;
        armDeadline();
        persistTick(force: true);
      }
      if (e is NetworkError || e is TimeoutException) {
        setOnline(false);
        emit(ExamNotice.pauseNeedsConnection);
      } else if (e is ApiError && e.body.attempt != null) {
        _adoptServer(e.body.attempt!, sent, mono);
      }
      changed();
      return false;
    }
  }

  @override
  Future<void> resume() async {
    if (!pausedFlag) return;
    final c = moduleClock;
    if (c == null) return;
    // Optimistic: the clock runs again now; the server's reply then re-anchors it.
    c.unfreeze(mono);
    pausedFlag = false;
    armDeadline();
    persistTick(force: true);
    changed();
    await _sendResume();
  }

  Future<void> _sendResume() async {
    final serial = ++_pauseSerial;
    final module = liveModuleId;
    final sent = mono;
    try {
      final env = await deps.api.pastpaperResume(attemptIdValue).timeout(timings.pauseWait);
      if (disposed) return;
      _resumeOwed = false;
      setOnline(true);
      if (serial != _pauseSerial) return;
      if (env.attempt.module?.id != module || module != liveModuleId) {
        _adoptServer(env.attempt, sent, mono);
        return;
      }
      if (env.attempt.timing.paused) return; // not ours to re-freeze; the next reply decides
      adoptPauseReply(env.attempt, sent, mono);
      persistTick(force: true);
    } on Object catch (e) {
      if (disposed) return;
      if (e is NetworkError || e is TimeoutException) {
        // The clock keeps running here (stricter than the server); resume again on reconnect.
        _resumeOwed = true;
        setOnline(false);
      } else if (e is ApiError && e.body.attempt != null) {
        _adoptServer(e.body.attempt!, sent, mono);
      }
    }
  }

  @override
  Future<SaveAndExitResult> saveAndExit() async {
    if (phaseValue == ExamPhase.done) return SaveAndExitResult(pausedOnServer: pausedFlag);
    if (hasUnqueuedChanges && clockRunsInPhase) _syncNow();
    var pausedOnServer = pausedFlag && online;
    if (!pausedFlag && canPause) {
      pausedOnServer = await pause().timeout(timings.saveAndExitWait, onTimeout: () => false);
    }
    persistTick(force: true);
    try {
      await flushWrites().timeout(timings.closeFlushCap);
    } on TimeoutException {
      // Whatever is still queued commits on its own; the journal already has every answer.
    }
    stopClockLoop();
    _cancelSyncTimers();
    _periodic?.cancel();
    _periodic = null;
    phaseValue = ExamPhase.done;
    doneReasonValue = ExamDoneReason.savedAndExited;
    changed();
    return SaveAndExitResult(pausedOnServer: pausedOnServer);
  }

  // ---------------------------------------------------------------------------------------
  // Result polling
  // ---------------------------------------------------------------------------------------

  void _startResultPolling() {
    if (_resultTimer != null || _result.value != null || disposed) return;
    _resultPollStarted = mono;
    _resultTimer = Timer(Duration.zero, _pollResult);
  }

  Duration _cadence(int? pollAfterMs) {
    final started = _resultPollStarted ?? mono;
    final fast = mono - started < timings.resultFastWindow;
    if (!fast) return timings.resultSlowPoll;
    return pollAfterMs != null && pollAfterMs > 0 ? Duration(milliseconds: pollAfterMs) : timings.resultFastPoll;
  }

  Future<void> _pollResult() async {
    _resultTimer = null;
    if (disposed) return;
    Duration next;
    try {
      final r = await deps.api.pastpaperResult(attemptIdValue, have: _haveHashes);
      if (disposed) return;
      setOnline(true);
      if (r.state == AttemptState.completed) {
        _result.value = r;
        changed();
        return;
      }
      next = _cadence(r.pollAfterMs);
    } on NetworkError {
      if (disposed) return;
      setOnline(false);
      next = _cadence(null);
    } on ApiException {
      if (disposed) return;
      next = _cadence(null);
    } on FormatException {
      if (disposed) return;
      next = _cadence(null);
    }
    _resultTimer = Timer(next, _pollResult);
  }

  /// Stop polling (the result screen closed).
  void stopResultPolling() {
    _resultTimer?.cancel();
    _resultTimer = null;
  }

  @override
  Future<void> closeGracefully() async {
    if (hasUnqueuedChanges && clockRunsInPhase) _syncNow();
    await super.closeGracefully();
  }

  @override
  void dispose() {
    if (disposed) return;
    _cancelSyncTimers();
    _periodic?.cancel();
    _resultTimer?.cancel();
    super.dispose();
    _result.dispose();
    _mediaProgress.dispose();
  }
}

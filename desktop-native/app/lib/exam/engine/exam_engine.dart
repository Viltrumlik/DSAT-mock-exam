// ExamEngine — the shared half of the past-paper and midterm engines. It implements the
// foundation's ExamSession contract: the runner renders it; nothing here draws a pixel.
//
// The rules it keeps (design_data_server.md §1.3–§1.12, architecture §4.1):
//  * every select/clear/flag goes to the journal + answer_state in ONE transaction, queued the
//    moment it happens (chained, so writes commit in click order; ≤ 30 ms on an SSD);
//  * the screen never waits on the network: answers are local first, the outbox sends later;
//  * the countdown is a [ModuleClock] on the monotonic clock, owned by ONE module id and
//    re-anchored synchronously on module change; time-up is handled once per module;
//  * eliminations are memory-only and reset per module (website draftStore/useAnswers);
//  * online/offline is learned from request outcomes (no OS connectivity guesswork).
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import '../session_contract.dart';
import 'engine_clock.dart';
import 'engine_deps.dart';
import 'exam_store.dart';
import 'media_cache.dart';
import 'outbox.dart';
import 'power_events.dart';
import 'reconcile.dart';

/// Something the student must see (and maybe act on) — not a toast.
enum EngineProblemKind {
  /// The paper could not be opened (offline with no cached copy, server error).
  loadFailed,

  /// 404: the paper is no longer available to this student. Local answers are kept.
  notAvailable,

  /// Past papers: the server kept failing a hand-in/sync; "Try again" re-queues it.
  sendStuck,

  /// The server refused an item for good (final 4xx). Local data is kept.
  sendRefused,

  /// This build is below the minimum version (HTTP 426).
  updateRequired,

  /// The local database refused a write (disk full, permissions).
  storageFailed,
}

@immutable
class EngineProblem {
  const EngineProblem(this.kind, this.message, {this.canRetry = false, this.detail});

  final EngineProblemKind kind;

  /// Student-facing English copy.
  final String message;
  final bool canRetry;

  /// Diagnostics (never shown as the main message).
  final String? detail;

  @override
  String toString() => 'EngineProblem(${kind.name}: $message${detail == null ? '' : ' — $detail'})';
}

/// Shown while the bundle is still loading (no test info yet).
const TestInfo _placeholderTest = TestInfo(
  id: 0,
  subject: 'READING_WRITING',
  title: '',
  tools: TestTools(referenceSheet: false),
);

abstract class ExamEngine extends ExamSession implements OutboxListener {
  ExamEngine(this.deps, {required this.kind, required this.studentName}) {
    _powerSub = deps.power?.events.listen(_onPower);
  }

  final EngineDeps deps;

  @override
  final ExamKind kind;

  @override
  final String studentName;

  AttemptKind get attemptKind => kind == ExamKind.midterm ? AttemptKind.midterm : AttemptKind.pastpaper;

  ExamStore get store => deps.store;
  EngineClock get clock => deps.clock;
  EngineTimings get timings => deps.timings;
  Duration get mono => deps.clock.monotonic;

  // ---- identity / content ---------------------------------------------------------------

  int attemptIdValue = 0;
  TestInfo? testInfo;
  AttemptLite? lastAttempt;
  List<int> moduleIds = const [];
  final Map<int, ModuleContent> content = {};
  int? liveModuleId;

  @override
  int get attemptId => attemptIdValue;

  @override
  TestInfo get test => testInfo ?? _placeholderTest;

  /// `scope=exam` annotation ref: `"<id>"` for past papers, `"mt-<id>"` for midterms.
  String get annotationRef => AnnotationWriteRequest.refFor(attemptKind, attemptIdValue);

  @override
  int get moduleOrder {
    final live = liveModuleId;
    if (live == null) return 1;
    final c = content[live];
    if (c != null) return c.order;
    final i = moduleIds.indexOf(live);
    return i < 0 ? 1 : i + 1;
  }

  @override
  int get moduleCount => moduleIds.isEmpty ? 1 : moduleIds.length;

  @override
  int get moduleId => liveModuleId ?? 0;

  @override
  List<Question> get questions => content[liveModuleId]?.questions ?? const [];

  Question? questionById(int qid) {
    for (final q in questions) {
      if (q.id == qid) return q;
    }
    return null;
  }

  // ---- answers ----------------------------------------------------------------------------

  final Map<int, Map<int, String>> answers = {};
  final Map<int, Set<int>> flags = {};
  final Map<int, Set<String>> _eliminated = {};

  /// Per module: the journal seq the server is known to hold.
  final Map<int, int> acked = {};

  /// The last journal seq written (the next row gets seq + 1).
  int seq = 0;

  /// Per module: the seq of the last sync/submit payload queued.
  final Map<int, int> queuedSeq = {};

  Future<void> _writes = Future<void>.value();
  int _pendingWrites = 0;

  /// Store writes queued and not yet committed.
  bool get hasPendingWrites => _pendingWrites > 0;

  /// The answers of [moduleId] (tests, diagnostics).
  Map<int, String> answersOf(int moduleId) => Map.unmodifiable(answers[moduleId] ?? const <int, String>{});

  @override
  String? answerFor(int questionId) {
    final v = answers[liveModuleId]?[questionId];
    return (v == null || v.isEmpty) ? null : v;
  }

  @override
  bool isFlagged(int questionId) => flags[liveModuleId]?.contains(questionId) ?? false;

  @override
  Set<String> eliminatedFor(int questionId) => Set.unmodifiable(_eliminated[questionId] ?? const <String>{});

  bool _eliminatorOn = false;
  @override
  bool get eliminatorOn => _eliminatorOn;

  final Map<int, Map<AnnotationContainer, List<Annotation>>> annotationMap = {};

  @override
  Map<AnnotationContainer, List<Annotation>> annotationsFor(int questionId) =>
      Map.unmodifiable(annotationMap[questionId] ?? const <AnnotationContainer, List<Annotation>>{});

  // ---- view -------------------------------------------------------------------------------

  int index = 0;
  bool _highlighterOn = false;
  double _zoom = 1.0;
  double _split = 0.5;
  String _notes = '';
  Object? _desmos;

  @override
  int get currentIndex => questions.isEmpty ? 0 : index.clamp(0, questions.length - 1);

  @override
  bool get highlighterOn => _highlighterOn;

  @override
  double get zoom => _zoom;

  @override
  double get split => _split;

  @override
  String get notes => _notes;

  @override
  Object? get desmosState => _desmos;

  // ---- time -------------------------------------------------------------------------------

  ModuleClock? moduleClock;
  final ValueNotifier<Duration> _remaining = ValueNotifier(Duration.zero);
  Timer? _ticker;
  Timer? _deadlineTimer;
  int? timeUpModule;
  Duration? _lastMono;
  DateTime? _lastWall;
  Duration? _lastPersist;

  /// The next response for the live module may move the countdown either way (after sleep).
  bool forceNextAnchor = false;

  @override
  ValueListenable<Duration> get remaining => _remaining;

  bool pausedFlag = false;

  @override
  bool get paused => pausedFlag;

  // ---- status -----------------------------------------------------------------------------

  ExamPhase phaseValue = ExamPhase.loading;
  ExamDoneReason? doneReasonValue;
  ModuleTransition? transitionValue;
  bool _online = true;
  int _sending = 0;
  int _unsent = 0;
  final StreamController<ExamNotice> _notices = StreamController.broadcast();
  final ValueNotifier<OffscreenStatus?> offscreenStatus = ValueNotifier(null);
  final ValueNotifier<EngineProblem?> _problem = ValueNotifier(null);
  OutboxSender? outbox;
  StreamSubscription<PowerEvent>? _powerSub;
  bool disposed = false;

  @override
  ExamPhase get phase => phaseValue;

  @override
  ExamDoneReason? get doneReason => doneReasonValue;

  @override
  ModuleTransition? get transition => transitionValue;

  @override
  bool get online => _online;

  @override
  ValueListenable<OffscreenStatus?> get offscreen => offscreenStatus;

  @override
  Stream<ExamNotice> get notices => _notices.stream;

  /// Exam/urgent outbox items not yet acknowledged by the server.
  int get unsentItems => _unsent;

  /// Problems the runner (or the screen around it) must show; null when all is well.
  ValueListenable<EngineProblem?> get problem => _problem;

  @override
  SyncStatus get syncStatus {
    if (!_online) return SyncStatus.offline;
    if (_sending > 0) return SyncStatus.syncing;
    if (_unsent > 0 || hasUnqueuedChanges) return SyncStatus.savedLocally;
    return SyncStatus.synced;
  }

  /// Journal rows newer than the last queued payload for the live module.
  bool get hasUnqueuedChanges {
    final live = liveModuleId;
    if (live == null) return false;
    return seq > (queuedSeq[live] ?? 0) && seq > (acked[live] ?? 0);
  }

  bool get locallyLocked => false;

  @override
  bool get inputLocked =>
      timeUpModule != null && timeUpModule == liveModuleId ||
      phaseValue != ExamPhase.running ||
      (offscreenStatus.value?.countingDown ?? false) ||
      (offscreenStatus.value?.terminated ?? false) ||
      locallyLocked;

  bool get _canEdit => !inputLocked && phaseValue == ExamPhase.running && liveModuleId != null;

  // ---- media ------------------------------------------------------------------------------

  MediaStore get mediaStore;

  @override
  Future<MediaBlob?> media(String key) => mediaStore.read(key);

  // ---- plumbing for subclasses ------------------------------------------------------------

  void emit(ExamNotice n) {
    if (!_notices.isClosed) _notices.add(n);
  }

  void changed() {
    if (!disposed) notifyListeners();
  }

  void setProblem(EngineProblem? p) {
    if (!disposed) _problem.value = p;
  }

  /// Queue a store operation after every earlier one (click order is commit order).
  void write(Future<void> Function() op) {
    _pendingWrites++;
    _writes = _writes.then((_) => op()).whenComplete(() => _pendingWrites--).then<void>((_) {},
        onError: (Object e, StackTrace st) {
      if (e is StateError && disposed) return; // the database closed under a late write
      setProblem(EngineProblem(EngineProblemKind.storageFailed,
          "Your answers couldn't be saved on this computer. Free some disk space, then keep going.",
          detail: '$e'));
    });
  }

  /// Completes when every queued store write has committed.
  Future<void> flushWrites() => _writes;

  JournalEntry _entry(JournalOp op, {int? qid, String? value, int? moduleId}) => JournalEntry(
        attemptId: attemptIdValue,
        seq: ++seq,
        moduleId: moduleId ?? liveModuleId ?? 0,
        qid: qid,
        op: op,
        value: value,
        monoMs: mono.inMilliseconds,
        wallMs: deps.wallMs,
      );

  /// Append one journal row (and its answer_state change) in its own transaction.
  JournalEntry record(JournalOp op, {int? qid, String? value, int? moduleId}) {
    final e = _entry(op, qid: qid, value: value, moduleId: moduleId);
    write(() => store.record(e));
    return e;
  }

  /// Journal row + extra store work in ONE transaction (module hand-in, off-screen event).
  JournalEntry recordWith(JournalOp op, Future<void> Function() also, {int? moduleId, String? value}) {
    final e = _entry(op, moduleId: moduleId, value: value);
    write(() => store.transaction(() async {
          await store.record(e);
          await also();
        }));
    return e;
  }

  /// The full answer map of [moduleId] (every question, "" when unanswered), frozen now.
  SyncRequest payloadFor(int moduleId) {
    final qs = content[moduleId]?.questions ?? const <Question>[];
    final mine = answers[moduleId] ?? const <int, String>{};
    final out = <int, String>{for (final q in qs) q.id: mine[q.id] ?? ''};
    for (final e in mine.entries) {
      out.putIfAbsent(e.key, () => e.value);
    }
    final flagged = (flags[moduleId] ?? const <int>{}).toList()..sort();
    return SyncRequest(moduleId: moduleId, seq: seq, answers: out, flagged: flagged);
  }

  /// Queue a background sync of [moduleId] (default: the live module).
  void enqueueSync({int? moduleId, int nextAtMs = 0}) {
    final m = moduleId ?? liveModuleId;
    if (m == null || attemptIdValue == 0) return;
    final body = payloadFor(m);
    queuedSeq[m] = body.seq;
    final item = OutboxItem(
      attemptId: attemptIdValue,
      attemptKind: attemptKind,
      lane: OutboxLane.exam,
      kind: OutboxKind.sync,
      idemKey: IdempotencyKeys.sync(attemptIdValue, m, body.seq),
      payload: body.toJson(),
      coversModule: m,
      coversSeq: body.seq,
      nextAtMs: nextAtMs,
      createdWallMs: deps.wallMs,
    );
    write(() async {
      await store.enqueue(item);
      outbox?.kick();
      await refreshUnsent();
    });
  }

  /// The hand-in item for [moduleId] (its payload is the full map, frozen now).
  OutboxItem submitItem(int moduleId, {int nextAtMs = 0}) {
    final body = payloadFor(moduleId);
    queuedSeq[moduleId] = body.seq;
    return OutboxItem(
      attemptId: attemptIdValue,
      attemptKind: attemptKind,
      lane: OutboxLane.exam,
      kind: OutboxKind.submit,
      idemKey: IdempotencyKeys.submit(attemptIdValue, moduleId),
      payload: body.toJson(),
      coversModule: moduleId,
      coversSeq: body.seq,
      nextAtMs: nextAtMs,
      createdWallMs: deps.wallMs,
    );
  }

  Future<void> refreshUnsent() async {
    if (disposed || attemptIdValue == 0) return;
    int n;
    try {
      n = await store.unsentCount(attemptIdValue, lane: OutboxLane.exam) +
          await store.unsentCount(attemptIdValue, lane: OutboxLane.urgent);
    } on Object {
      return; // only a count for the status line; the store is closing or busy
    }
    if (disposed) return;
    if (n != _unsent) {
      _unsent = n;
      changed();
    }
  }

  void attachOutbox() {
    final o = deps.hub.senderFor(attemptIdValue, attemptKind);
    o.listener = this;
    outbox = o;
    configureOutbox(o);
    o.kick();
  }

  /// Subclass hook (midterms give it the lockdown token).
  void configureOutbox(OutboxSender o) {}

  // ---- module + clock ---------------------------------------------------------------------

  /// Make [moduleId] the live module NOW: index 0, eliminations cleared, a new countdown —
  /// all synchronously, before anyone can see the new module with the old module's clock.
  void enterModule(int moduleId, {required Duration remaining, bool frozen = false}) {
    liveModuleId = moduleId;
    index = 0;
    _eliminated.clear();
    _eliminatorOn = false;
    timeUpModule = null;
    transitionValue = null;
    moduleClock = ModuleClock(moduleId: moduleId, now: mono, remaining: remaining, frozen: frozen);
    _remaining.value = displaySeconds(moduleClock!.remainingAt(mono));
    armDeadline();
    persistTick(force: true);
  }

  /// (Re)arm the precise time-up timer and the subclass's deadline-relative timers.
  void armDeadline() {
    _deadlineTimer?.cancel();
    _deadlineTimer = null;
    final c = moduleClock;
    if (c == null || disposed) return;
    if (!c.frozen) {
      _deadlineTimer = Timer(c.remainingAt(mono), onTick);
    }
    onClockAnchored(c);
  }

  /// Subclass hook: the deadline moved (midterms re-arm the T−60 / T−10 syncs).
  void onClockAnchored(ModuleClock c) {}

  void startClockLoop() {
    _ticker ??= Timer.periodic(timings.tick, (_) => onTick());
    _lastMono = mono;
    _lastWall = clock.wallNow;
    armDeadline();
    onTick();
  }

  void stopClockLoop() {
    _ticker?.cancel();
    _ticker = null;
    _deadlineTimer?.cancel();
    _deadlineTimer = null;
  }

  /// Phases in which the countdown can reach 0:00 and hand the module in.
  bool get clockRunsInPhase => phaseValue == ExamPhase.running || phaseValue == ExamPhase.review;

  void onTick() {
    if (disposed) return;
    final c = moduleClock;
    if (c == null) return;
    _checkSleep();
    final now = mono;
    final left = c.remainingAt(now);
    _remaining.value = displaySeconds(left);
    persistTick();
    if (!c.frozen &&
        left == Duration.zero &&
        c.moduleId == liveModuleId &&
        timeUpModule != c.moduleId &&
        clockRunsInPhase) {
      timeUpModule = c.moduleId;
      emit(ExamNotice.timeUp);
      onTimeUp(c.moduleId);
      changed();
    }
  }

  /// 0:00 on the live module, exactly once per module id.
  void onTimeUp(int moduleId);

  void persistTick({bool force = false}) {
    final c = moduleClock;
    if (c == null || attemptIdValue == 0) return;
    final now = mono;
    if (!force && _lastPersist != null && now - _lastPersist! < timings.tickPersist) return;
    _lastPersist = now;
    final remainingMs = c.remainingAt(now).inMilliseconds;
    final wall = deps.wallMs;
    final frozen = c.frozen;
    write(() => store.setTick(attemptIdValue, remainingMs: remainingMs, wallMs: wall, paused: frozen));
  }

  void _checkSleep() {
    final m = mono;
    final w = clock.wallNow;
    final lm = _lastMono;
    final lw = _lastWall;
    _lastMono = m;
    _lastWall = w;
    if (lm == null || lw == null) return;
    final gap = w.difference(lw) - (m - lm);
    if (gap > timings.sleepGap) onClockGap(gap);
  }

  /// The wall clock moved more than the monotonic one: the machine slept and the monotonic
  /// clock did not count it. Subtract the gap now (right when offline) and ask the server,
  /// whose answer may move the countdown either way (design §1.8).
  void onClockGap(Duration gap) {
    moduleClock?.subtract(gap);
    forceNextAnchor = true;
    armDeadline();
    requestStatus();
  }

  /// Ask the server for a fresh timing block (a sync; a replay is a cheap status read).
  void requestStatus() => enqueueSync();

  void _onPower(PowerEvent e) {
    switch (e) {
      case PowerEvent.resumed:
        onTick(); // runs the sleep check against the last tick
        forceNextAnchor = true;
        requestStatus();
      case PowerEvent.timeChanged:
        // Re-baseline: a time change is not sleep.
        _lastWall = clock.wallNow;
        _lastMono = mono;
      case PowerEvent.suspending:
        persistTick(force: true);
    }
  }

  /// A forced anchor ignores an upward move this small (round-trip noise, never shown as a tick
  /// up). Midterms keep it to 1 s: their display decides when input locks.
  Duration get forceUpTolerance =>
      kind == ExamKind.midterm ? const Duration(seconds: 1) : const Duration(seconds: 5);

  /// The next response about this module re-anchors its countdown in BOTH directions (set on
  /// a module change, so the server's word on the new module's clock is taken — design §1.8).
  int? forceAnchorModule;

  /// Adopt a server snapshot: forward-only by version; re-anchors the live module's countdown.
  ///
  /// The clock is touched only when the snapshot is about the live module, and only when the
  /// server's paused flag matches the local one — pausing and resuming are decided by the
  /// pause/resume replies alone ([adoptPauseReply]), never by a sync that crossed them.
  /// Returns false when the snapshot was older than the one already held.
  bool adoptLite(AttemptLite a, Duration sent, Duration received, AnchorRule rule) {
    final prev = lastAttempt;
    if (prev != null && a.id == prev.id && a.version < prev.version && !a.state.isFinished) return false;
    lastAttempt = a;
    final c = moduleClock;
    if (c == null || a.module?.id != c.moduleId || c.moduleId != liveModuleId) return true;
    if (a.timing.paused != c.frozen) return true;
    final forced = forceNextAnchor || forceAnchorModule == c.moduleId;
    final r = forced ? AnchorRule.force : rule;
    final moved = c.anchor(
      timing: a.timing,
      sent: sent,
      received: received,
      rule: r,
      midterm: kind == ExamKind.midterm,
      submitMargin: timings.midtermSubmitMargin,
      forceUpTolerance: forceUpTolerance,
    );
    if (forced && a.timing.remainingMs != null) {
      forceNextAnchor = false;
      if (forceAnchorModule == c.moduleId) forceAnchorModule = null;
    }
    if (moved) {
      armDeadline();
      onTick();
    } else if (kind == ExamKind.midterm) {
      onClockAnchored(c);
    }
    return true;
  }

  /// A pause/resume reply: adopt its paused state and time left — but only for the live module.
  void adoptPauseReply(AttemptLite a, Duration sent, Duration received) {
    final prev = lastAttempt;
    if (prev != null && a.id == prev.id && a.version < prev.version && !a.state.isFinished) return;
    lastAttempt = a;
    final c = moduleClock;
    if (c == null || a.module?.id != c.moduleId || c.moduleId != liveModuleId) return;
    final ms = a.timing.remainingMs;
    if (a.timing.paused) {
      if (ms != null) {
        c.setFrozen(Duration(milliseconds: ms));
      } else {
        c.freeze(mono);
      }
      pausedFlag = true;
    } else {
      if (c.frozen) c.unfreeze(mono, remaining: ms == null ? null : Duration(milliseconds: ms));
      c.anchor(timing: a.timing, sent: sent, received: received, rule: AnchorRule.force);
      pausedFlag = false;
    }
    armDeadline();
    onTick();
    changed();
  }

  // ---- connectivity -----------------------------------------------------------------------

  void setOnline(bool value) {
    if (_online == value) return;
    _online = value;
    emit(value ? ExamNotice.reconnected : ExamNotice.reconnecting);
    if (value) unawaited(outbox?.connectivityRestored());
    onConnectivity(value);
    changed();
  }

  /// Subclass hook.
  void onConnectivity(bool online) {}

  /// app-core: the OS says the network is back — retry at once.
  void connectivityHint() => unawaited(outbox?.connectivityRestored());

  // ---- OutboxListener ---------------------------------------------------------------------

  final Map<String, Completer<QuestionReportResponse?>> _reportWaiters = {};

  @override
  void onOutboxSending(OutboxItem item) {
    if (item.lane == OutboxLane.low) return;
    _sending++;
    changed();
  }

  @override
  void onOutboxDelivered(OutboxItem item, Object response, Duration sent, Duration received) {
    if (item.lane != OutboxLane.low) _sending = (_sending - 1).clamp(0, 1 << 30);
    setOnline(true);
    if (item.coversModule != null && item.coversSeq != null) {
      final applied = switch (response) {
        final WriteOutcome w => w.applied,
        final SubmitOutcome s => s.applied,
        _ => false,
      };
      if (applied && (acked[item.coversModule!] ?? -1) < item.coversSeq!) acked[item.coversModule!] = item.coversSeq!;
    }
    switch (item.kind) {
      case OutboxKind.report:
        _reportWaiters.remove(item.idemKey)?.complete(response is QuestionReportResponse ? response : null);
      case OutboxKind.annotation:
        final req = AnnotationWriteRequest.fromJson(JsonReader.of(item.payload));
        write(() => store.putAnnotation(req.ref, req.targetId, req.container, req.data, dirty: false));
      case OutboxKind.start:
      case OutboxKind.sync:
      case OutboxKind.submit:
      case OutboxKind.offscreen:
        onDelivered(item, response, sent, received);
    }
    unawaited(refreshUnsent());
    changed();
  }

  @override
  void onOutboxFailed(OutboxItem item, ApiException error, OutboxFailure failure, Duration sent, Duration received) {
    if (item.lane != OutboxLane.low) _sending = (_sending - 1).clamp(0, 1 << 30);
    setOnline(failure != OutboxFailure.network);
    if (item.kind == OutboxKind.report && failure != OutboxFailure.network && failure != OutboxFailure.retrying) {
      _reportWaiters.remove(item.idemKey)?.complete(null);
    }
    if (failure == OutboxFailure.held && error is UpdateRequired) {
      setProblem(const EngineProblem(EngineProblemKind.updateRequired,
          'Update the MasterSAT app to keep going — your answers are saved on this computer.'));
    }
    onFailed(item, error, failure, sent, received);
    unawaited(refreshUnsent());
    changed();
  }

  @override
  void onOutboxIdle(OutboxLane lane) => unawaited(refreshUnsent());

  /// Kind-specific handling of a delivered start/sync/submit/offscreen.
  void onDelivered(OutboxItem item, Object response, Duration sent, Duration received);

  /// Kind-specific handling of a failure.
  void onFailed(OutboxItem item, ApiException error, OutboxFailure failure, Duration sent, Duration received);

  // ---- reconcile --------------------------------------------------------------------------

  /// Rebuild [moduleId]'s work from the server's saved map plus every local journal row the
  /// server has not acknowledged; persist it; return whether the server is behind.
  Future<bool> reconcileWithServer(int moduleId, Map<int, String> serverAnswers, List<int> serverFlags) async {
    await flushWrites();
    final newer = await store.journalAfter(attemptIdValue, moduleId, acked[moduleId] ?? 0);
    final merged = reconcileModule(serverAnswers: serverAnswers, serverFlags: serverFlags, newer: newer);
    final server = reconcileModule(serverAnswers: serverAnswers, serverFlags: serverFlags, newer: const []);
    answers[moduleId] = merged.answers;
    flags[moduleId] = merged.flagged;
    final s = seq;
    write(() => store.replaceModuleState(attemptIdValue, moduleId, merged.answers, merged.flagged, seq: s));
    return !merged.sameAs(server);
  }

  /// Load a module's work from answer_state.
  Future<void> loadModuleState(int moduleId) async {
    final cells = await store.answerState(attemptIdValue, moduleId);
    answers[moduleId] = {
      for (final e in cells.entries)
        if ((e.value.value ?? '').isNotEmpty) e.key: e.value.value!,
    };
    flags[moduleId] = {
      for (final e in cells.entries)
        if (e.value.flagged) e.key,
    };
  }

  Future<void> loadLocalExtras() async {
    final ref = annotationRef;
    for (final row in await store.annotations(ref)) {
      annotationMap.putIfAbsent(row.targetId, () => {})[row.container] = row.data;
    }
    _notes = await store.notes(ref);
    _desmos = await store.desmosState(ref);
    final view = await store.viewState(ref);
    if (view != null) {
      _zoom = view.zoom;
      _split = view.split;
      _highlighterOn = view.highlighter;
    }
  }

  /// Server annotation rows (website highlights) fill in what this computer has no row for.
  void mergeServerAnnotations(List<AnnotationRow> rows) {
    for (final row in rows) {
      final byContainer = annotationMap.putIfAbsent(row.targetId, () => {});
      if (byContainer.containsKey(row.container)) continue;
      byContainer[row.container] = row.data;
      final ref = annotationRef;
      write(() => store.putAnnotation(ref, row.targetId, row.container, row.data, dirty: false));
    }
  }

  // ---- answering actions ------------------------------------------------------------------

  /// Subclass hook: a change was journaled (schedule the background sync).
  void onAnswerChanged();

  @override
  void select(int questionId, String value) {
    if (!_canEdit) return;
    final q = questionById(questionId);
    if (q == null) return;
    if (q.isMathInput) {
      if (!isValidSprInput(value)) return;
      if (value.isEmpty) {
        clearAnswer(questionId);
        return;
      }
    } else {
      if (!q.choiceKeys.contains(value)) return;
      // A struck-out choice cannot be chosen (website ChoiceList).
      if (_eliminated[questionId]?.contains(value) ?? false) return;
    }
    final m = answers.putIfAbsent(liveModuleId!, () => {});
    if (m[questionId] == value) return;
    m[questionId] = value;
    record(JournalOp.answer, qid: questionId, value: value);
    onAnswerChanged();
    changed();
  }

  @override
  void clearAnswer(int questionId) {
    if (!_canEdit) return;
    if (questionById(questionId) == null) return;
    final m = answers[liveModuleId!];
    if (m == null || !m.containsKey(questionId)) return;
    m.remove(questionId);
    record(JournalOp.clear, qid: questionId);
    onAnswerChanged();
    changed();
  }

  @override
  void toggleFlag(int questionId) {
    if (!_canEdit) return;
    if (questionById(questionId) == null) return;
    final set = flags.putIfAbsent(liveModuleId!, () => {});
    final on = !set.contains(questionId);
    if (on) {
      set.add(questionId);
    } else {
      set.remove(questionId);
    }
    record(on ? JournalOp.flag : JournalOp.unflag, qid: questionId);
    onAnswerChanged();
    changed();
  }

  @override
  void toggleEliminator() {
    if (!_canEdit) return;
    _eliminatorOn = !_eliminatorOn;
    changed();
  }

  @override
  void toggleEliminate(int questionId, String choiceKey) {
    if (!_canEdit) return;
    final q = questionById(questionId);
    if (q == null || !q.choiceKeys.contains(choiceKey)) return;
    final set = _eliminated.putIfAbsent(questionId, () => {});
    if (!set.remove(choiceKey)) set.add(choiceKey);
    // Eliminating the chosen option also deselects it (website useAnswers.toggleEliminate).
    if (set.contains(choiceKey) && answers[liveModuleId!]?[questionId] == choiceKey) {
      answers[liveModuleId!]!.remove(questionId);
      record(JournalOp.clear, qid: questionId);
      onAnswerChanged();
    }
    changed();
  }

  // ---- navigation -------------------------------------------------------------------------

  @override
  void goTo(int i) {
    if (i < 0 || i >= questions.length) return;
    if (phaseValue != ExamPhase.running && phaseValue != ExamPhase.review) return;
    index = i;
    if (phaseValue == ExamPhase.review && !(timeUpModule == liveModuleId)) phaseValue = ExamPhase.running;
    changed();
  }

  @override
  void next() {
    if (phaseValue != ExamPhase.running) return;
    if (index >= questions.length - 1) {
      openReview();
      return;
    }
    index++;
    changed();
  }

  @override
  void back() {
    if (phaseValue != ExamPhase.running || index == 0) return;
    index--;
    changed();
  }

  @override
  void openReview() {
    if (phaseValue != ExamPhase.running) return;
    phaseValue = ExamPhase.review;
    onReviewOpened();
    changed();
  }

  /// Subclass hook (past papers sync immediately on Check Your Work).
  void onReviewOpened() {}

  // ---- tools ------------------------------------------------------------------------------

  void _saveView() {
    final ref = annotationRef;
    final z = _zoom, s = _split, h = _highlighterOn;
    if (attemptIdValue == 0) return;
    write(() => store.setViewState(ref, zoom: z, split: s, highlighter: h));
  }

  @override
  void setZoom(double zoom) {
    final z = (zoom.clamp(examMinZoom, examMaxZoom) * 10).roundToDouble() / 10;
    if (z == _zoom) return;
    _zoom = z;
    _saveView();
    changed();
  }

  @override
  void setSplit(double split) {
    final s = split.clamp(0.25, 0.75).toDouble();
    if (s == _split) return;
    _split = s;
    _saveView();
    changed();
  }

  @override
  void toggleHighlighter() {
    _highlighterOn = !_highlighterOn;
    _saveView();
    changed();
  }

  final Map<String, Timer> _annotationTimers = {};

  @override
  void recordAnnotations(int questionId, AnnotationContainer container, List<Annotation> annotations) {
    final list = List<Annotation>.unmodifiable(annotations);
    annotationMap.putIfAbsent(questionId, () => {})[container] = list;
    final ref = annotationRef;
    write(() => store.putAnnotation(ref, questionId, container, list, dirty: true));
    final key = 'annot.$ref.$questionId.${container.wire}';
    _annotationTimers[key]?.cancel();
    _annotationTimers[key] = Timer(timings.annotationDebounce, () {
      _annotationTimers.remove(key);
      final item = OutboxItem(
        attemptId: attemptIdValue,
        attemptKind: attemptKind,
        lane: OutboxLane.low,
        kind: OutboxKind.annotation,
        idemKey: key,
        payload: AnnotationWriteRequest(ref: ref, targetId: questionId, container: container, data: list).toJson(),
        createdWallMs: deps.wallMs,
      );
      write(() async {
        await store.enqueue(item);
        outbox?.kick();
      });
    });
    changed();
  }

  @override
  void setNotes(String text) {
    _notes = text;
    final ref = annotationRef;
    write(() => store.setNotes(ref, text));
    changed();
  }

  @override
  void saveDesmosState(Object? state) {
    _desmos = state;
    final ref = annotationRef;
    write(() => store.setDesmosState(ref, state));
  }

  @override
  Future<ReportOutcome> reportProblem({
    required int questionId,
    required ReportCategory category,
    required String message,
  }) async {
    final key = IdempotencyKeys.report(deps.newId());
    final item = OutboxItem(
      attemptId: attemptIdValue,
      attemptKind: attemptKind,
      lane: OutboxLane.low,
      kind: OutboxKind.report,
      idemKey: key,
      payload: QuestionReportRequest(
        system: 'exam',
        questionId: questionId,
        category: category,
        message: message,
        attemptId: attemptIdValue == 0 ? null : attemptIdValue,
      ).toJson(),
      createdWallMs: deps.wallMs,
    );
    final waiter = Completer<QuestionReportResponse?>();
    if (_online) _reportWaiters[key] = waiter;
    write(() async {
      await store.enqueue(item);
      outbox?.kick();
    });
    if (!_online) {
      emit(ExamNotice.reportQueued);
      return ReportOutcome.queued;
    }
    final res = await waiter.future.timeout(timings.reportWait, onTimeout: () => null);
    _reportWaiters.remove(key);
    final outcome = res == null
        ? ReportOutcome.queued
        : res.deduped
            ? ReportOutcome.deduped
            : ReportOutcome.sent;
    emit(switch (outcome) {
      ReportOutcome.sent => ExamNotice.reportSent,
      ReportOutcome.deduped => ExamNotice.reportDeduped,
      ReportOutcome.queued => ExamNotice.reportQueued,
    });
    return outcome;
  }

  // ---- finishing --------------------------------------------------------------------------

  /// Window close / Windows shutdown: the journal is already on disk; try one last sync
  /// (capped at 2 s, architecture §4.1 "Closing during a test").
  Future<void> closeGracefully() async {
    if (hasUnqueuedChanges && clockRunsInPhase) enqueueSync();
    persistTick(force: true);
    try {
      await flushWrites().timeout(timings.closeFlushCap);
      await (outbox?.whenQuiet() ?? Future<void>.value()).timeout(timings.closeFlushCap);
    } on TimeoutException {
      // Whatever did not make it is in the outbox; the next launch sends it.
    }
  }

  @override
  void dispose() {
    if (disposed) return;
    disposed = true;
    stopClockLoop();
    for (final t in _annotationTimers.values) {
      t.cancel();
    }
    _annotationTimers.clear();
    if (outbox?.listener == this) outbox?.listener = null;
    unawaited(_powerSub?.cancel());
    for (final w in _reportWaiters.values) {
      if (!w.isCompleted) w.complete(null);
    }
    _reportWaiters.clear();
    unawaited(_notices.close());
    _remaining.dispose();
    offscreenStatus.dispose();
    _problem.dispose();
    super.dispose();
  }
}

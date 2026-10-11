// The persistent outbox sender (design_data_server.md §1.5).
//
//  * One [OutboxSender] per attempt, shared through [OutboxHub] so the engine and the
//    background drainer never send the same attempt twice.
//  * Lanes: `exam` (start/sync/submit, one in flight), `urgent` (off-screen events — never
//    stuck behind a sync hanging on a slow network), `low` (annotations, reports).
//  * Payloads were frozen when queued; the sender never rebuilds a body.
//  * Retry policy: network errors, 408, 429 (Retry-After) and 5xx back off 1, 2, 4, 8, 16, then
//    30 s with ±20 % jitter, and retry at once when connectivity returns. A final 4xx marks the
//    item dead and surfaces it. Midterm `409 module_not_expired` waits `retry_after_ms + 250`
//    and retries, uncapped. Lockdown refusals and 426 HOLD the exam lanes (nothing is lost) until
//    the midterm flow re-binds / the app updates.
//  * Past papers only: after [OutboxSender.serverFailureCap] server-answered 5xx in a row the
//    item is PARKED and surfaced (a deterministic server failure must not loop forever unseen —
//    0.1.0 review round 3). Midterms retry uncapped: there is no other way to hand in.
import 'dart:async';
import 'dart:math';

import '../../core/api/v1_api.dart';
import '../../core/models/models.dart';
import 'engine_clock.dart';
import 'exam_store.dart';

/// Why a send did not complete.
enum OutboxFailure {
  /// No answer at all (offline, DNS, timeout); retried with backoff.
  network,

  /// The server answered 408/429/5xx (or 401 while app-core refreshes); retried with backoff.
  retrying,

  /// Midterm submit before the server deadline; retried after `retry_after_ms + 250`.
  notExpired,

  /// Past papers: too many server failures in a row; waits for [OutboxSender.retryParked].
  parked,

  /// A final 4xx: the item will never be sent.
  dead,

  /// Lockdown refusal or 426: the exam lanes wait for [OutboxSender.release].
  held,
}

/// The engine (or nobody, for the background drainer) hears about every outcome.
abstract class OutboxListener {
  void onOutboxSending(OutboxItem item);

  /// [response] is the parsed model (AttemptEnvelope, WriteOutcome, SubmitOutcome,
  /// OffscreenOutcome, QuestionReportResponse) or `true` for 204 annotation writes.
  void onOutboxDelivered(OutboxItem item, Object response, Duration sent, Duration received);

  void onOutboxFailed(OutboxItem item, ApiException error, OutboxFailure failure, Duration sent, Duration received);

  /// Nothing due on [lane] right now.
  void onOutboxIdle(OutboxLane lane);
}

const List<Duration> defaultOutboxBackoff = [
  Duration(seconds: 1),
  Duration(seconds: 2),
  Duration(seconds: 4),
  Duration(seconds: 8),
  Duration(seconds: 16),
  Duration(seconds: 30),
];

class OutboxSender {
  OutboxSender({
    required this.store,
    required this.api,
    required this.clock,
    required this.attemptId,
    required this.attemptKind,
    Random? random,
    this.serverFailureCap,
    this.backoff = defaultOutboxBackoff,
    this.notExpiredMargin = const Duration(milliseconds: 250),
  }) : _random = random ?? Random();

  final ExamStore store;
  final V1Api api;
  final EngineClock clock;
  final int attemptId;
  final AttemptKind attemptKind;
  final Random _random;

  /// Null = uncapped (midterms).
  final int? serverFailureCap;
  final List<Duration> backoff;
  final Duration notExpiredMargin;

  /// Midterms: the in-memory `X-Lockdown-Session` token (null → the request is held).
  String? Function()? lockdownToken;

  /// Midterms whose server does not require the app: an empty token is sent as none.
  bool lockdownOptional = false;

  OutboxListener? listener;

  bool _stopped = false;
  bool _held = false;
  final Map<OutboxLane, bool> _running = {};
  final Map<OutboxLane, bool> _again = {};
  final Map<OutboxLane, Timer?> _timers = {};
  final Map<OutboxLane, Completer<void>?> _idle = {};

  /// Store failures seen while sending (diagnostics).
  final List<Object> storeErrors = [];

  bool get held => _held;
  bool get stopped => _stopped;

  /// A request is on the wire for [lane].
  bool isBusy(OutboxLane lane) => _running[lane] ?? false;

  /// Try every lane now.
  void kick() {
    for (final lane in OutboxLane.values) {
      unawaited(_pump(lane));
    }
  }

  /// Connectivity is back: anything in backoff is due at once.
  Future<void> connectivityRestored() async {
    if (_stopped) return;
    await store.makeDueNow(attemptId);
    kick();
  }

  /// Stop sending on the exam lanes (lockdown refusal being resolved, update required).
  void hold() => _held = true;

  /// Resume after [hold].
  void release() {
    _held = false;
    kick();
  }

  /// "Try again" after a parked failure.
  Future<void> retryParked() async {
    await store.unpark(attemptId);
    kick();
  }

  /// Stop scheduling new sends. A request already on the wire still completes and is
  /// recorded (an acknowledged item must leave the outbox).
  void stop() {
    _stopped = true;
    for (final t in _timers.values) {
      t?.cancel();
    }
    _timers.clear();
  }

  /// Completes once no lane has a request on the wire.
  Future<void> whenQuiet() async {
    for (final lane in OutboxLane.values) {
      if (_running[lane] ?? false) {
        await (_idle[lane] ??= Completer<void>()).future;
      }
    }
  }

  Duration _backoffFor(int tries) {
    final base = backoff[min(max(tries - 1, 0), backoff.length - 1)];
    final factor = 0.8 + 0.4 * _random.nextDouble();
    return Duration(milliseconds: (base.inMilliseconds * factor).round());
  }

  int get _nowMs => clock.wallNow.millisecondsSinceEpoch;

  Future<void> _pump(OutboxLane lane) async {
    if (_stopped) return;
    if (_running[lane] ?? false) {
      _again[lane] = true;
      return;
    }
    _running[lane] = true;
    _timers[lane]?.cancel();
    _timers[lane] = null;
    try {
      while (!_stopped) {
        _again[lane] = false;
        if (_held && lane != OutboxLane.low) break;
        final item = await store.nextPending(attemptId, lane);
        if (_stopped) break;
        if (item == null) {
          if (_again[lane] ?? false) continue;
          listener?.onOutboxIdle(lane);
          break;
        }
        final wait = item.nextAtMs - _nowMs;
        if (wait > 0) {
          _timers[lane] = Timer(Duration(milliseconds: wait), () => unawaited(_pump(lane)));
          break;
        }
        await _sendOne(item);
      }
    } on Object catch (e) {
      // The store refused (closed during shutdown, disk full). A stopped sender belongs to a
      // closing process; otherwise try again later — nothing is lost, the item is still queued.
      if (!_stopped) {
        _timers[lane]?.cancel();
        _timers[lane] = Timer(backoff.last, () => unawaited(_pump(lane)));
        storeErrors.add(e);
      }
    } finally {
      _running[lane] = false;
      final c = _idle.remove(lane);
      if (c != null && !c.isCompleted) c.complete();
    }
  }

  Future<void> _sendOne(OutboxItem item) async {
    await store.markInflight(item.id);
    if (!_stopped) listener?.onOutboxSending(item);
    final sent = clock.monotonic;
    try {
      final response = await _dispatch(item);
      final received = clock.monotonic;
      final (attempt, applied) = _summary(response);
      await store.completeOutbox(item, attempt: attempt, applied: applied);
      if (!_stopped) listener?.onOutboxDelivered(item, response, sent, received);
    } on ApiException catch (e) {
      await _failed(item, e, sent, clock.monotonic);
    } on FormatException catch (e) {
      // A body we cannot parse is the server's fault, deterministic or not: count it like a 5xx.
      await _failed(item, ApiError(status: 502, body: ApiErrorBody(detail: e.message)), sent, clock.monotonic);
    }
  }

  static ApiError _noToken() => const ApiError(
        status: 403,
        body: ApiErrorBody(
          reason: 'desktop_required',
          desktopRequired: true,
          detail: 'This midterm can only be taken in the MasterSAT app for Windows.',
        ),
      );

  String _token() {
    final t = lockdownToken?.call();
    if (t == null || t.isEmpty) {
      // A sitting the server does not police (MIDTERM_DESKTOP_REQUIRED off): send no token.
      if (lockdownOptional) return '';
      throw _noToken();
    }
    return t;
  }

  Future<Object> _dispatch(OutboxItem item) async {
    final midterm = attemptKind == AttemptKind.midterm;
    final p = JsonReader.of(item.payload);
    switch (item.kind) {
      case OutboxKind.start:
        return api.pastpaperStart(attemptId, idempotencyKey: item.idemKey);
      case OutboxKind.sync:
        final body = SyncRequest.fromJson(p);
        return midterm
            ? api.midtermSync(attemptId, body, lockdownSession: _token(), idempotencyKey: item.idemKey)
            : api.pastpaperSync(attemptId, body, idempotencyKey: item.idemKey);
      case OutboxKind.submit:
        final body = SyncRequest.fromJson(p);
        return midterm
            ? api.midtermSubmit(attemptId, body, lockdownSession: _token(), idempotencyKey: item.idemKey)
            : api.pastpaperSubmit(attemptId, body, idempotencyKey: item.idemKey);
      case OutboxKind.offscreen:
        return api.midtermOffscreen(attemptId, OffscreenRequest.fromJson(p),
            lockdownSession: _token(), idempotencyKey: item.idemKey);
      case OutboxKind.annotation:
        await api.annotationWrite(AnnotationWriteRequest.fromJson(p));
        return true;
      case OutboxKind.report:
        return api.questionReport(QuestionReportRequest.fromJson(p), idempotencyKey: item.idemKey);
    }
  }

  static (AttemptLite?, bool) _summary(Object response) => switch (response) {
        final AttemptEnvelope e => (e.attempt, false),
        final WriteOutcome w => (w.attempt, w.applied),
        final SubmitOutcome s => (s.attempt, s.applied),
        final OffscreenOutcome o => (o.attempt, false),
        _ => (null, false),
      };

  Future<void> _failed(OutboxItem item, ApiException e, Duration sent, Duration received) async {
    void tell(OutboxFailure f) {
      if (!_stopped) listener?.onOutboxFailed(item, e, f, sent, received);
    }

    switch (e) {
      case UpdateRequired():
        await store.reschedule(item.id,
            nextAtMs: 0, tries: item.tries, serverFailures: item.serverFailures, error: 'update_required');
        _held = true;
        tell(OutboxFailure.held);
      case ApiError() when attemptKind == AttemptKind.midterm && e.isLockdownRefusal:
        await store.reschedule(item.id,
            nextAtMs: 0, tries: item.tries, serverFailures: item.serverFailures, error: e.code);
        _held = true;
        tell(OutboxFailure.held);
      case ApiError() when e.status == 409 && e.code == ExamStore.notExpiredMarker:
        final wait = Duration(milliseconds: e.retryAfterMs ?? 1000) + notExpiredMargin;
        await store.reschedule(item.id,
            nextAtMs: _nowMs + wait.inMilliseconds,
            tries: item.tries,
            serverFailures: item.serverFailures,
            error: ExamStore.notExpiredMarker);
        tell(OutboxFailure.notExpired);
      case ApiError() when e.isTransient || e.isUnauthorized:
        final tries = item.tries + 1;
        final failures = item.serverFailures + (e.status >= 500 ? 1 : 0);
        final cap = serverFailureCap;
        if (cap != null && e.status >= 500 && failures >= cap) {
          await store.markParked(item.id, e.toString(), tries: tries, serverFailures: failures);
          tell(OutboxFailure.parked);
          return;
        }
        final wait = e.retryAfter ?? _backoffFor(tries);
        await store.reschedule(item.id,
            nextAtMs: _nowMs + wait.inMilliseconds, tries: tries, serverFailures: failures, error: e.toString());
        tell(OutboxFailure.retrying);
      case ApiError():
        await store.markDead(item.id, e.toString());
        tell(OutboxFailure.dead);
      case NetworkError():
        final tries = item.tries + 1;
        await store.reschedule(item.id,
            nextAtMs: _nowMs + _backoffFor(tries).inMilliseconds,
            tries: tries,
            serverFailures: item.serverFailures,
            error: e.toString());
        tell(OutboxFailure.network);
    }
  }
}

/// One sender per attempt for the whole process.
class OutboxHub {
  OutboxHub({
    required this.store,
    required this.api,
    required this.clock,
    Random? random,
    this.pastpaperServerFailureCap = 6,
    this.backoff = defaultOutboxBackoff,
  }) : random = random ?? Random();

  final ExamStore store;
  final V1Api api;
  final EngineClock clock;
  final Random random;
  final int pastpaperServerFailureCap;
  final List<Duration> backoff;
  final Map<int, OutboxSender> _senders = {};

  OutboxSender senderFor(int attemptId, AttemptKind kind) => _senders.putIfAbsent(
        attemptId,
        () => OutboxSender(
          store: store,
          api: api,
          clock: clock,
          attemptId: attemptId,
          attemptKind: kind,
          random: random,
          serverFailureCap: kind == AttemptKind.pastpaper ? pastpaperServerFailureCap : null,
          backoff: backoff,
        ),
      );

  /// App start (design §1.10 step 2): send what past-paper attempts left behind. Midterm items
  /// wait for their sitting to be re-bound (the lockdown token is memory-only).
  Future<int> drainUnfinished() async {
    var started = 0;
    for (final (id, kind) in await store.attemptsWithUnsent()) {
      if (kind != AttemptKind.pastpaper) continue;
      senderFor(id, kind).kick();
      started++;
    }
    return started;
  }

  void stopAll() {
    for (final s in _senders.values) {
      s.stop();
    }
    _senders.clear();
  }

  /// Forget a finished attempt's sender.
  void remove(int attemptId) => _senders.remove(attemptId)?.stop();
}

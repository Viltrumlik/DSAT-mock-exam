// The client half of the midterm off-screen rule (server half: midterms/views.offscreen),
// ported from desktop/app/src/exam/lockdown/useOffscreenGuard.ts to a polled native reading
// (architecture §5: `ms_away_now` four times a second).
//
// The guard only notices and reports; the SERVER owns the count, the grace and the forfeit:
//  * one absence = ONE event, however long it lasts — unless the grace runs out while the
//    student is still away, which is the next event (with its own UUID);
//  * every event is persisted with a UUID key the moment it happens (the engine writes it to
//    the journal + outbox) and is never merged;
//  * an apparent leave must still read "away" [confirm] later to count (focus churn);
//  * the guard watches only once it has been enabled for [arm] (module-change churn);
//  * before charging a second event at the end of the grace, the LIVE state is read again:
//    a stale "away" never forfeits a student who is back;
//  * a warning never outlives its absence: the countdown is local and stops when they return,
//    and a late server reply never restarts it;
//  * the shown tally = max(server count, server count at the last off-screen reply + events
//    not yet acknowledged); at the limit the client shows "terminated" as the server will.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../session_contract.dart';

/// One off-screen event to persist and send.
@immutable
class OffscreenEvent {
  const OffscreenEvent({required this.id, required this.occurredAt, required this.awayMs});

  /// UUID (also in the idempotency key `off.{attempt}.{uuid}`).
  final String id;
  final DateTime occurredAt;
  final int awayMs;
}

class OffscreenGuard {
  OffscreenGuard({
    required this.awayNow,
    required this.now,
    required this.wallNow,
    required this.newId,
    required this.onEvent,
    this.poll = const Duration(milliseconds: 250),
    this.confirm = const Duration(milliseconds: 250),
    this.arm = const Duration(milliseconds: 800),
    int limit = 3,
    int graceSeconds = 3,
  })  : _limit = limit, // ignore: prefer_initializing_formals

        _grace = Duration(seconds: graceSeconds < 1 ? 1 : graceSeconds);

  /// `ms_away_now` (foreground not ours, or more than one monitor).
  final bool Function() awayNow;

  /// Monotonic now.
  final Duration Function() now;
  final DateTime Function() wallNow;
  final String Function() newId;

  /// The engine persists + queues the event (journal + outbox, one transaction).
  final void Function(OffscreenEvent event) onEvent;
  final Duration poll;
  final Duration confirm;
  final Duration arm;

  int _limit;
  Duration _grace;
  int _serverCount = 0;
  int _ackedCount = 0;
  final Set<String> _pending = {};
  bool _serverTerminated = false;

  bool _enabled = false;
  bool _armed = false;
  Timer? _armTimer;
  Timer? _poller;

  Duration? _pendingSince;
  bool _away = false;
  Duration? _absenceStart;
  Duration? _countdownStart;
  bool _disposed = false;

  final ValueNotifier<OffscreenStatus?> status = ValueNotifier(null);

  /// "You left the exam window. That counted as a warning — 2 chances left." (after a return).
  final ValueNotifier<String?> notice = ValueNotifier(null);

  int get limit => _limit;
  int get violations {
    final local = _ackedCount + _pending.length;
    return local > _serverCount ? local : _serverCount;
  }

  int get chancesLeft => (_limit - violations).clamp(0, _limit);
  bool get terminated => _serverTerminated || violations >= _limit;
  bool get armed => _armed;
  bool get away => _away;
  Set<String> get pendingEvents => Set.unmodifiable(_pending);

  // ---- inputs --------------------------------------------------------------------------

  /// Watch only while the student is genuinely sitting an active, locked paper.
  set enabled(bool value) {
    if (_disposed || value == _enabled) return;
    _enabled = value;
    if (!value) {
      _armTimer?.cancel();
      _armTimer = null;
      _armed = false;
      _poller?.cancel();
      _poller = null;
      _pendingSince = null;
      // The countdown stops showing; the absence stays latched and is settled on re-arm.
      _countdownStart = null;
      _publish();
      return;
    }
    _armTimer = Timer(arm, _onArmed);
  }

  bool get enabled => _enabled;

  /// The server's word from any snapshot (`attempt.midterm`): forward-only.
  void serverSnapshot({required int violations, required int limit, required int graceSeconds, required bool terminated}) {
    if (limit > 0) _limit = limit;
    if (graceSeconds > 0) _grace = Duration(seconds: graceSeconds);
    if (violations > _serverCount) _serverCount = violations;
    if (terminated) _terminate();
    _publish();
  }

  /// The reply to one off-screen event.
  void acknowledge(String eventId, {required int violations, required int limit, required int graceSeconds, required bool terminated}) {
    _pending.remove(eventId);
    if (violations > _ackedCount) _ackedCount = violations;
    serverSnapshot(violations: violations, limit: limit, graceSeconds: graceSeconds, terminated: terminated);
  }

  /// Restore after a reopen: events queued before the restart, still unacknowledged.
  void restorePending(Iterable<String> ids) {
    _pending.addAll(ids);
    _publish();
  }

  /// Dismiss the after-return note.
  void dismissNotice() => notice.value = null;

  // ---- the loop ------------------------------------------------------------------------

  void _onArmed() {
    _armTimer = null;
    if (!_enabled || _disposed || terminated) return;
    _armed = true;
    // Settle the bookkeeping to reality: an absence latched while disarmed is closed if the
    // student is back, or its grace restarts if not (else it would never escalate).
    if (_away) {
      if (!awayNow()) {
        _closeAbsence(withNotice: false);
      } else {
        _countdownStart = now();
      }
    }
    _poller = Timer.periodic(poll, (_) => _tick());
    _tick();
  }

  void _tick() {
    if (!_armed || _disposed) return;
    if (terminated) {
      _stopLoop();
      _publish();
      return;
    }
    final t = now();
    final isAway = awayNow();
    if (!_away) {
      if (!isAway) {
        _pendingSince = null;
        return;
      }
      final since = _pendingSince;
      if (since == null) {
        _pendingSince = t;
        return;
      }
      if (t - since < confirm) return;
      // Confirmed: a new absence, one event.
      _pendingSince = null;
      _away = true;
      _absenceStart = since;
      _countdownStart = t;
      _report(t - since);
      _publish();
      return;
    }
    // In an absence.
    if (!isAway) {
      _closeAbsence(withNotice: true);
      return;
    }
    final started = _countdownStart ??= t;
    if (t - started >= _grace) {
      // The grace ran out. Read the LIVE state once more before charging again.
      if (!awayNow()) {
        _closeAbsence(withNotice: true);
        return;
      }
      _report(t - (_absenceStart ?? started));
      _countdownStart = t;
    }
    _publish();
  }

  void _report(Duration awayFor) {
    final e = OffscreenEvent(id: newId(), occurredAt: wallNow(), awayMs: awayFor.inMilliseconds);
    _pending.add(e.id);
    onEvent(e);
    if (terminated) _terminate();
  }

  void _closeAbsence({required bool withNotice}) {
    _away = false;
    _absenceStart = null;
    _countdownStart = null;
    _pendingSince = null;
    if (withNotice && !terminated) {
      final left = chancesLeft;
      final label = left == 0 ? 'no chances left' : '$left ${left == 1 ? 'chance' : 'chances'} left';
      notice.value = 'You left the exam window. That counted as a warning — $label.';
    }
    _publish();
  }

  void _terminate() {
    _stopLoop();
    _away = false;
    _countdownStart = null;
  }

  void _stopLoop() {
    _poller?.cancel();
    _poller = null;
    _armTimer?.cancel();
    _armTimer = null;
    _armed = false;
  }

  /// Marks the sitting terminated by the server (any reply).
  void serverTerminated() {
    _serverTerminated = true;
    _terminate();
    _publish();
  }

  void _publish() {
    if (_disposed) return;
    final t = now();
    Duration? grace;
    final started = _countdownStart;
    if (_armed && _away && started != null && !terminated) {
      final left = _grace - (t - started);
      final ms = left.inMilliseconds;
      grace = Duration(seconds: ms <= 0 ? 0 : (ms + 999) ~/ 1000);
    }
    final next = (violations == 0 && grace == null && !terminated)
        ? null
        : OffscreenStatus(violations: violations, limit: _limit, graceRemaining: grace, terminated: terminated);
    if (status.value != next) status.value = next;
  }

  void dispose() {
    if (_disposed) return;
    _stopLoop();
    _disposed = true;
    status.dispose();
    notice.dispose();
  }
}

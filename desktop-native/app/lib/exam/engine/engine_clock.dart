// The engine's two clocks, injected so every timing rule can be proven with fake_async:
//  * [EngineClock.monotonic] drives every countdown (design §1.8: the OS wall clock is never
//    used for the countdown);
//  * [EngineClock.wallNow] is only for persisted timestamps, journal rows and the
//    "time with the app closed counts" restart rule.
//
// [ModuleClock] is one module's countdown, anchored to the server's `timing` block.
import '../../core/models/models.dart';

/// Monotonic + wall time.
abstract class EngineClock {
  /// Time since an arbitrary origin; never jumps when Windows syncs its clock.
  Duration get monotonic;

  /// UTC wall time (persisted timestamps only).
  DateTime get wallNow;
}

/// The real clock: a process-wide [Stopwatch] for monotonic time.
class SystemEngineClock implements EngineClock {
  SystemEngineClock() : _watch = Stopwatch()..start();

  final Stopwatch _watch;

  @override
  Duration get monotonic => _watch.elapsed;

  @override
  DateTime get wallNow => DateTime.now().toUtc();
}

/// How a response's timing may move a running countdown.
enum AnchorRule {
  /// Adopt in both directions: open, app reopen, resume from pause, module change.
  force,

  /// Midterm in-module responses: adopt only when the server says LESS time is left by > 1 s.
  midterm,

  /// Past-paper sync/start/submit responses: adopt only when LESS time is left by > 5 s.
  pastpaper,
}

/// One module's countdown on the monotonic clock.
///
/// Three rules, each a bug 0.1.0 once had (desktop/app/src/exam/useExamState.ts):
///  * it belongs to ITS module ([moduleId]); a response about another module never moves it;
///  * it runs on the monotonic clock, so a wall-clock step cannot end a module early;
///  * an in-module response re-anchors it only DOWNWARD — a delayed or replayed reply can
///    carry a larger remaining value, and the countdown never jumps up. Only [AnchorRule.force]
///    (open, reopen, resume, module change) may move it up.
class ModuleClock {
  ModuleClock({required this.moduleId, required Duration now, required Duration remaining, bool frozen = false})
      : _deadline = now + _nonNegative(remaining),
        _frozen = frozen ? _nonNegative(remaining) : null;

  final int moduleId;
  Duration _deadline;
  Duration? _frozen;

  /// Midterms: when to hand the module in — the latest response's receive time + its
  /// `remaining_ms` + 750 ms, with NO round-trip subtraction (design §1.7). The server refuses
  /// an early hand-in, so the client must never be early.
  Duration? submitAt;

  static Duration _nonNegative(Duration d) => d.isNegative ? Duration.zero : d;

  bool get frozen => _frozen != null;

  /// The monotonic instant the module ends (meaningless while [frozen]).
  Duration get deadline => _deadline;

  /// Time left at monotonic [now] (never negative).
  Duration remainingAt(Duration now) => _nonNegative(_frozen ?? (_deadline - now));

  /// Pause: stop where it is.
  void freeze(Duration now) => _frozen ??= remainingAt(now);

  /// Resume: run again from [remaining] (the server's word) or from where it stopped.
  void unfreeze(Duration now, {Duration? remaining}) {
    final r = _nonNegative(remaining ?? _frozen ?? remainingAt(now));
    _frozen = null;
    _deadline = now + r;
  }

  /// Set the frozen value (a paused server reply).
  void setFrozen(Duration remaining) => _frozen = _nonNegative(remaining);

  /// Move the deadline earlier by [gap] (offline sleep compensation, design §1.8).
  void subtract(Duration gap) {
    if (gap <= Duration.zero) return;
    if (_frozen != null) return; // a paused module does not lose time
    _deadline -= gap;
  }

  /// Re-anchor from a response's [timing] measured between [sent] and [received]
  /// (monotonic). Returns true when the displayed deadline moved.
  ///
  /// `deadline_mono = t_recv − rtt/2 + remaining_ms` (design §1.8). Midterms also refresh
  /// [submitAt] from every response, whatever [rule] decides about the display.
  bool anchor({
    required Timing timing,
    required Duration sent,
    required Duration received,
    required AnchorRule rule,
    bool midterm = false,
    Duration submitMargin = const Duration(milliseconds: 750),
  }) {
    final ms = timing.remainingMs;
    if (ms == null) return false;
    final remaining = Duration(milliseconds: ms);
    if (midterm) submitAt = received + remaining + submitMargin;
    if (timing.paused) {
      if (rule == AnchorRule.force || _frozen != null) {
        _frozen = _nonNegative(remaining);
        return true;
      }
      return false;
    }
    if (_frozen != null) {
      if (rule != AnchorRule.force) return false;
      _frozen = null;
    }
    final rtt = received - sent;
    final candidate = received - Duration(microseconds: rtt.inMicroseconds ~/ 2) + remaining;
    switch (rule) {
      case AnchorRule.force:
        final moved = candidate != _deadline;
        _deadline = candidate;
        return moved;
      case AnchorRule.midterm:
      case AnchorRule.pastpaper:
        final threshold = rule == AnchorRule.midterm ? const Duration(seconds: 1) : const Duration(seconds: 5);
        if (_deadline - candidate > threshold) {
          _deadline = candidate;
          return true;
        }
        return false;
    }
  }
}

/// The countdown as the runner shows it: whole seconds, rounded UP, so 0:00 appears only when
/// the module is really over.
Duration displaySeconds(Duration remaining) {
  if (remaining <= Duration.zero) return Duration.zero;
  final ms = remaining.inMilliseconds;
  return Duration(seconds: (ms + 999) ~/ 1000);
}

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/models/models.dart';
import 'package:mastersat_app/exam/engine/engine_clock.dart';

Timing _t(int remainingMs, {bool paused = false}) =>
    Timing(serverNow: DateTime.utc(2026, 10, 11, 9), remainingMs: remainingMs, paused: paused);

const _s = Duration(seconds: 1);

void main() {
  group('ModuleClock', () {
    test('counts down on the monotonic clock and never goes negative', () {
      final c = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 1));
      expect(c.remainingAt(const Duration(seconds: 20)), const Duration(seconds: 40));
      expect(c.remainingAt(const Duration(minutes: 5)), Duration.zero);
    });

    test('an in-module past-paper reply never moves the countdown UP', () {
      final c = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      // The server says 30 s MORE is left (a delayed start, a replayed reply): ignored.
      final moved = c.anchor(timing: _t(630000), sent: Duration.zero, received: Duration.zero, rule: AnchorRule.pastpaper);
      expect(moved, isFalse);
      expect(c.remainingAt(Duration.zero), const Duration(minutes: 10));
    });

    test('past-paper replies adopt LESS time only beyond 5 s; midterm beyond 1 s', () {
      final p = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      expect(p.anchor(timing: _t(600000 - 4000), sent: Duration.zero, received: Duration.zero, rule: AnchorRule.pastpaper),
          isFalse);
      expect(p.anchor(timing: _t(600000 - 6000), sent: Duration.zero, received: Duration.zero, rule: AnchorRule.pastpaper),
          isTrue);
      expect(p.remainingAt(Duration.zero), const Duration(seconds: 594));

      final m = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      expect(m.anchor(timing: _t(600000 - 900), sent: Duration.zero, received: Duration.zero, rule: AnchorRule.midterm),
          isFalse);
      expect(m.anchor(timing: _t(600000 - 1500), sent: Duration.zero, received: Duration.zero, rule: AnchorRule.midterm),
          isTrue);
      // …and never up.
      expect(m.anchor(timing: _t(700000), sent: Duration.zero, received: Duration.zero, rule: AnchorRule.midterm), isFalse);
    });

    test('a forced anchor moves both ways, compensating half the round trip', () {
      final c = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      c.anchor(
        timing: _t(900000),
        sent: const Duration(seconds: 10),
        received: const Duration(seconds: 12),
        rule: AnchorRule.force,
      );
      // deadline = t_recv − rtt/2 + remaining = 12 − 1 + 900 s
      expect(c.deadline, const Duration(seconds: 911));
    });

    test('midterm submitAt = t_recv + remaining + 750 ms, with no round-trip subtraction', () {
      final c = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      c.anchor(
        timing: _t(60000),
        sent: const Duration(seconds: 10),
        received: const Duration(seconds: 14),
        rule: AnchorRule.midterm,
        midterm: true,
      );
      expect(c.submitAt, const Duration(seconds: 74, milliseconds: 750));
      // The display moved down (60 s < 10 min) by t_recv − rtt/2.
      expect(c.deadline, const Duration(seconds: 72));
    });

    test('freeze/unfreeze and subtract (sleep compensation)', () {
      final c = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      c.freeze(const Duration(minutes: 1));
      expect(c.remainingAt(const Duration(minutes: 30)), const Duration(minutes: 9));
      c.subtract(const Duration(minutes: 5)); // a paused module loses nothing
      c.unfreeze(const Duration(minutes: 30));
      expect(c.remainingAt(const Duration(minutes: 31)), const Duration(minutes: 8));
      c.subtract(const Duration(minutes: 2));
      expect(c.remainingAt(const Duration(minutes: 31)), const Duration(minutes: 6));
    });

    test('a paused reply only moves a frozen clock (or a forced anchor)', () {
      final c = ModuleClock(moduleId: 1, now: Duration.zero, remaining: const Duration(minutes: 10));
      expect(c.anchor(timing: _t(1000, paused: true), sent: _s, received: _s, rule: AnchorRule.pastpaper), isFalse);
      expect(c.frozen, isFalse);
    });
  });

  group('displaySeconds', () {
    test('rounds up so 0:00 shows only when the module is over', () {
      expect(displaySeconds(const Duration(milliseconds: 1)), const Duration(seconds: 1));
      expect(displaySeconds(const Duration(milliseconds: 1000)), const Duration(seconds: 1));
      expect(displaySeconds(const Duration(milliseconds: 1001)), const Duration(seconds: 2));
      expect(displaySeconds(Duration.zero), Duration.zero);
      expect(displaySeconds(const Duration(milliseconds: -5)), Duration.zero);
    });
  });
}

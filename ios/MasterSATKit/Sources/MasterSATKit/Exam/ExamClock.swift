import Foundation

/// The countdown shown to the student, anchored to the server.
///
/// The device clock is never the source of truth: it can be wrong, it can be *set* wrong on
/// purpose, and it jumps when the network syncs it. So the clock stores the server's
/// `remaining_seconds` together with a reading of a monotonic timer taken the instant the
/// snapshot arrived, and simply counts down from there. Every new snapshot re-anchors it,
/// which means local drift can never accumulate beyond one poll interval.
///
/// The monotonic source is *continuous* — it keeps advancing while the device is asleep or
/// the app is suspended. That is deliberate and matches the server: a full mock's clock
/// cannot be stopped by backgrounding the app, and a student who locks their phone for two
/// minutes must come back to two fewer minutes.
public struct ExamClock: Sendable, Equatable {
    /// Monotonic reading (in seconds) when the anchoring snapshot arrived.
    public let anchoredAt: TimeInterval
    /// What the server said was left at that moment.
    public let remainingAtAnchor: TimeInterval

    public init(anchoredAt: TimeInterval, remainingAtAnchor: TimeInterval) {
        self.anchoredAt = anchoredAt
        self.remainingAtAnchor = max(0, remainingAtAnchor)
    }

    /// Anchor to a snapshot. Nil when the attempt has no running clock (not started,
    /// scoring, completed) — the caller shows no timer at all rather than a stale one.
    public init?(attempt: Attempt, monotonicNow: TimeInterval = ExamClock.monotonicNow()) {
        guard let remaining = attempt.remainingSeconds else { return nil }
        self.init(anchoredAt: monotonicNow, remainingAtAnchor: TimeInterval(remaining))
    }

    /// Anchor to the mock's break countdown instead of the module clock.
    public static func forBreak(attempt: Attempt, monotonicNow: TimeInterval = ExamClock.monotonicNow()) -> ExamClock? {
        guard attempt.onBreak, let remaining = attempt.breakRemainingSeconds else { return nil }
        return ExamClock(anchoredAt: monotonicNow, remainingAtAnchor: TimeInterval(remaining))
    }

    public func remaining(at monotonicNow: TimeInterval = ExamClock.monotonicNow()) -> TimeInterval {
        max(0, remainingAtAnchor - (monotonicNow - anchoredAt))
    }

    /// Locally believed to have run out. The *server* still decides what that means: it
    /// closes the module on the next write, and a client that submits early would only be
    /// throwing away time the student is entitled to.
    public func hasElapsed(at monotonicNow: TimeInterval = ExamClock.monotonicNow()) -> Bool {
        remaining(at: monotonicNow) <= 0
    }

    /// Continuous monotonic seconds. Unaffected by wall-clock changes, and — unlike
    /// `mach_absolute_time` / `ProcessInfo.systemUptime` — it keeps advancing while the
    /// device is asleep. That difference is the whole point: a locked phone must not
    /// freeze an exam clock the server is still running down.
    public static func monotonicNow() -> TimeInterval {
        var timebase = mach_timebase_info_data_t()
        mach_timebase_info(&timebase)
        let nanos = Double(mach_continuous_time()) * Double(timebase.numer) / Double(timebase.denom)
        return nanos / 1_000_000_000
    }

    /// `mm:ss`, the format the Bluebook-style header uses.
    public static func format(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

import Foundation

/// The XP a finished task earned, as the server confirms it: the header's total after a
/// refresh, minus the total it showed before. Never negative, and nothing when either is unknown
/// — "+N XP" is only ever shown for a gain the server stands behind.
public enum XPDelta {
    public static func gain(before: Int?, after: Int?) -> Int {
        guard let before, let after, after > before else { return 0 }
        return after - before
    }

    /// What a finished task's gain is measured from: the header's total when the work started,
    /// raised to the total it holds when the work is handed in.
    ///
    /// The server pays a task's XP when it is handed in, so a rise the header took in between —
    /// a return to the app, a reconnect — came from somewhere else. Measured from the start, that
    /// rise would be claimed as this task's gain, and the header would hold it back the moment
    /// the task was recorded: the pill would drop to the old total at hand-in. A stale read never
    /// lowers the baseline, and unknown at the start stays unknown — nothing is measured.
    public static func baseline(atStart: Int?, atHandIn: Int?) -> Int? {
        guard let atStart else { return nil }
        return max(atStart, atHandIn ?? atStart)
    }
}

/// Hands out tickets in request order and accepts an answer only if no later request's answer
/// is already in — two reads of `/rewards/me/` can come back the wrong way round.
public struct LatestOnly: Sendable, Equatable {
    public private(set) var issued: UInt64 = 0
    public private(set) var accepted: UInt64 = 0

    public init() {}

    public mutating func issue() -> UInt64 {
        issued += 1
        return issued
    }

    public mutating func accept(_ ticket: UInt64) -> Bool {
        guard ticket > accepted else { return false }
        accepted = ticket
        return true
    }
}

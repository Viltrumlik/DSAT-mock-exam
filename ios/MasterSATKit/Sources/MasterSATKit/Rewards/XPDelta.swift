import Foundation

/// The XP a finished task earned, as the server confirms it: the header's total after a
/// refresh, minus the total it showed before. Never negative, and nothing when either is unknown
/// — "+N XP" is only ever shown for a gain the server stands behind.
public enum XPDelta {
    public static func gain(before: Int?, after: Int?) -> Int {
        guard let before, let after, after > before else { return 0 }
        return after - before
    }

    /// What a finished task's gain is measured from: the total the header holds when the work is
    /// handed in, higher or lower than when it started (the start's total only when the header
    /// has no total at hand-in).
    ///
    /// The server pays a task's XP when it is handed in, so a rise the header took in between —
    /// a return to the app, a reconnect — came from somewhere else. Measured from the start, that
    /// rise would be claimed as this task's gain, and the header would hold it back the moment
    /// the task was recorded: the pill would drop to the old total at hand-in.
    ///
    /// A fall in between is taken too. The header's store takes `/rewards/me/` answers in request
    /// order (`LatestOnly`), so a lower total at hand-in is a take-back, not a stale read; measured
    /// from the higher start, a +15 after a −10 would read as +5, and the pill would roll up to
    /// the old total with no flight before the +5 flew. The trade-off is the one the celebration
    /// queue already makes for away gains: a rise the header has not read yet when the work is
    /// handed in rides in this task's flight, counted once.
    ///
    /// Unknown at the start stays unknown — nothing is measured.
    public static func baseline(atStart: Int?, atHandIn: Int?) -> Int? {
        guard let atStart else { return nil }
        return atHandIn ?? atStart
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

    /// The stricter question, for an answer that is not shown the moment it lands (it may wait
    /// for the celebrations to finish): only the newest request asked may be shown at all. An
    /// older answer waiting in its place could otherwise be shown after the newer one.
    public func isNewestAsked(_ ticket: UInt64) -> Bool { ticket == issued }
}

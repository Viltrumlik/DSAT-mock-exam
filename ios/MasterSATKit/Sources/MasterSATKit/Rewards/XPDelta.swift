import Foundation

/// The XP a finished task earned, as the server confirms it: the header's total after a
/// refresh, minus the total it showed before. Never negative, and nothing when either is unknown
/// — "+N XP" is only ever shown for a gain the server stands behind.
public enum XPDelta {
    public static func gain(before: Int?, after: Int?) -> Int {
        guard let before, let after, after > before else { return 0 }
        return after - before
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

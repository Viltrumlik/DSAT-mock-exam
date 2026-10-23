import Foundation

/// What "while you were away" writes as the new baseline — the decision table, apart from the
/// screens that feed it.
///
/// The baseline is what the header SHOWS, not what the server says: XP still held for a flight
/// is not seen yet, a streak waiting to roll is not on the flame yet, and a place whose card has
/// not been shown is not seen yet. Writing the server's numbers instead would make a kill in the
/// middle of a celebration lose it for good — the next launch would find nothing left to celebrate.
public enum LastSeenRule {
    /// What the header holds right now: the numbers the stores last took.
    public struct Shown: Sendable, Equatable {
        /// Nil until `/rewards/me/` has answered once. Held XP is NOT taken off it (`InFlight`).
        public var xp: Int?
        /// The run as the flame shows it — a longer one still waiting to roll is not on it yet.
        public var streak: Int?
        /// The place last noted from the default board, by the hub or the welcome-back check.
        public var rank: Int?
        /// The newest history row last applied.
        public var newestAwardID: Int?

        public init(xp: Int?, streak: Int? = nil, rank: Int? = nil, newestAwardID: Int? = nil) {
            self.xp = xp
            self.streak = streak
            self.rank = rank
            self.newestAwardID = newestAwardID
        }
    }

    /// What the student has not been shown yet.
    public struct InFlight: Sendable, Equatable {
        /// XP confirmed and not landed on the pill, or a rise a refresh brought ahead of its
        /// flight (`CelebrationQueue.held(xpNow:)`).
        public var heldXP: Int
        /// A rank-up whose card has not been shown yet.
        public var rankNotShown: Rise?
        /// Whether the board read this launch failed. True while it is still out too: a kill in
        /// between must find the place unread. Nil until this launch has made one (or decided it
        /// need not), and the stored `rankUnread` stands.
        public var rankReadFailed: Bool?

        public init(heldXP: Int = 0, rankNotShown: Rise? = nil, rankReadFailed: Bool? = nil) {
            self.heldXP = heldXP
            self.rankNotShown = rankNotShown
            self.rankReadFailed = rankReadFailed
        }
    }

    /// The baseline to write, or nil to leave the old one alone — before anything has loaded
    /// there is nothing to say. A number not known this time keeps its old value.
    public static func baseline(old: LastSeen?, shown: Shown, inFlight: InFlight) -> LastSeen? {
        guard let xp = shown.xp else { return nil }
        let held = inFlight.heldXP
        // A place that may be news and has not been shown (a read that failed, or a card still
        // waiting for the stage) keeps the baseline at the place the student last saw, so the
        // next read measures from it — however the hub has noted the new one meanwhile.
        let readFailed = inFlight.rankReadFailed ?? old?.rankUnread ?? false
        let waiting = inFlight.rankNotShown
        return LastSeen(
            xp: max(0, xp - held),
            // Every change, drops included: a run that restarted and grows again is new growth
            // from the restart, never from the old best.
            streak: shown.streak ?? old?.streak ?? 0,
            rank: waiting?.from ?? (readFailed ? old?.rank : (shown.rank ?? old?.rank)),
            // XP in the air keeps its caption's starting point too: a kill before it lands flies
            // both again, once.
            newestAwardID: held > 0 ? old?.newestAwardID : (shown.newestAwardID ?? old?.newestAwardID),
            rankUnread: waiting != nil || readFailed
        )
    }
}

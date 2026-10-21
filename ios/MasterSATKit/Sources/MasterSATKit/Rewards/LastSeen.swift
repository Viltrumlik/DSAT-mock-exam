import Foundation

/// What the header last showed this student — the baseline "while you were away" measures from.
///
/// "Seen" means shown: XP still held for a flight that has not landed is not seen yet, so the
/// app writes the number on the pill, not the server's.
public struct LastSeen: Codable, Sendable, Equatable {
    public var xp: Int
    /// The run of lessons attended, as the flame showed it.
    public var streak: Int
    /// The place on the default board (global, all time, XP). Nil until a board has been read.
    public var rank: Int?
    /// The newest `/rewards/me/` history row when this was written — what the flight's label
    /// counts new earnings from.
    public var newestAwardID: Int?
    /// A better place may be waiting: the board read that should have found it failed, or the
    /// trophy card for it has not been shown yet. While set, `rank` is held at the place the
    /// student last saw, and the next check reads the board whatever the XP did
    /// (`WelcomeBack.readsRank`). A baseline stored before this field existed reads as false.
    public var rankUnread: Bool

    public init(xp: Int, streak: Int, rank: Int?, newestAwardID: Int?, rankUnread: Bool = false) {
        self.xp = xp
        self.streak = streak
        self.rank = rank
        self.newestAwardID = newestAwardID
        self.rankUnread = rankUnread
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        xp = try c.decode(Int.self, forKey: .xp)
        streak = try c.decode(Int.self, forKey: .streak)
        rank = try c.decodeIfPresent(Int.self, forKey: .rank)
        newestAwardID = try c.decodeIfPresent(Int.self, forKey: .newestAwardID)
        rankUnread = try c.decodeIfPresent(Bool.self, forKey: .rankUnread) ?? false
    }
}

/// The baseline on the phone, one small JSON value per student in `UserDefaults`.
///
/// Five small fields (XP, streak, place, newest award, and whether a place is still unread): a
/// file would add a directory, atomic writes and a migration story for nothing, and
/// `UserDefaults` already survives relaunches and updates. Keyed by user id, so a second
/// account on the same phone starts with no baseline and celebrates nothing on its first launch.
/// A value that will not decode reads as no baseline — never a crash, never a celebration.
// @unchecked: the SDK does not mark UserDefaults Sendable, but Apple documents it as thread-safe.
public struct LastSeenBook: @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public static func key(userID: Int) -> String { "rewards.lastSeen.v1.\(userID)" }

    public func read(userID: Int) -> LastSeen? {
        guard let data = defaults.data(forKey: Self.key(userID: userID)) else { return nil }
        return try? JSONDecoder().decode(LastSeen.self, from: data)
    }

    public func write(_ seen: LastSeen, userID: Int) {
        guard let data = try? JSONEncoder().encode(seen) else { return }
        defaults.set(data, forKey: Self.key(userID: userID))
    }
}

/// A number that went the right way: a longer streak, or a better place (a smaller rank).
public struct Rise: Sendable, Equatable {
    public let from: Int
    public let to: Int

    public init(from: Int, to: Int) {
        self.from = from
        self.to = to
    }
}

/// "While you were away" — what improved since the student last saw it. The XP part is not here:
/// it is measured by `CelebrationQueue` like every other confirmed gain (`recordAway`).
///
/// Nothing is ever celebrated without a baseline (the first launch on this phone), and nothing
/// that went down is ever named: a restarted run or a lower place is simply the new baseline.
public enum WelcomeBack {
    public static func streak(seen: LastSeen?, now: Int) -> Rise? {
        guard let seen, now > seen.streak else { return nil }
        return Rise(from: seen.streak, to: now)
    }

    public static func rank(seen: Int?, now: Int?) -> Rise? {
        guard let seen, let now, now < seen else { return nil }
        return Rise(from: seen, to: now)
    }

    /// Whether the welcome-back check reads the board: a place can only improve through the
    /// student's own XP, so only when XP rose — or to take a first baseline, or because an
    /// earlier read failed or its card was never shown (`rankUnread`), whatever the XP did since.
    /// A student with no XP has no place on the board (`rank_of` is null), so there is nothing to
    /// read.
    public static func readsRank(seen: LastSeen?, xpNow: Int) -> Bool {
        guard let seen else { return true }
        return seen.rankUnread || xpNow > seen.xp || (seen.rank == nil && xpNow > 0)
    }

    /// The flight's caption: the newest XP earning since the baseline ("Attendance"), and how
    /// many more came with it. Only rows that carry XP are named — the history is the points
    /// ledger, and a survey pays points but no XP, so a caption naming one would explain an XP
    /// rise it did not cause. The decision is `XPLedger`'s, per event: a rule in `rules` follows
    /// its `grantsXP` flag, and an event without a rule (or `rules == nil`) carries XP except
    /// where the server's fallback says otherwise.
    ///
    /// The newest row is the highest id, whatever order `history` arrives in. Nil when no new XP
    /// row explains the rise — a homework re-graded upward changes its own row rather than adding
    /// one — and the flight then flies without a caption, rather than with a wrong one.
    ///
    /// The history is a capped window (`historyWindow`), newest first. When it is full and has not
    /// reached back to the baseline row, the rows in it are only the newest of what came in, so a
    /// count would be a guess: the newest is named and the rest left unsaid.
    public static func label(history: [PointAward], since: Int?, rules: [RewardRule]? = nil) -> String? {
        let fresh = XPLedger.rows(history, rules: rules, limit: .max).filter { $0.id > (since ?? Int.min) }
        guard let newest = fresh.max(by: { $0.id < $1.id }) else { return nil }
        let name = newest.label.isEmpty ? "Earned while you were away" : newest.label
        guard fresh.count > 1, windowReaches(history, since: since) else { return name }
        return "\(name) + \(fresh.count - 1) more"
    }

    /// The most rows `/rewards/me/` sends in its history: `HISTORY_LIMIT` in
    /// `backend/rewards/views.py` — change them together.
    public static let historyWindow = 50

    /// Whether the history window goes back at least to the baseline row. A window that is not
    /// full is the whole season's ledger, so it does; a full one does only if it still holds a
    /// row at or before the baseline.
    static func windowReaches(_ history: [PointAward], since: Int?) -> Bool {
        guard history.count >= historyWindow else { return true }
        guard let since else { return false }
        return history.contains { $0.id <= since }
    }
}

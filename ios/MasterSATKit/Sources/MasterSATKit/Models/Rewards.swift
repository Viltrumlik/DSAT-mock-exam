import Foundation

/// One earning: a lesson attended, a homework finished, a support session held.
public struct PointAward: Decodable, Identifiable, Sendable {
    public let id: Int
    public let event: String
    /// Server-rendered wording. The app does not map events to text of its own — a new
    /// earning type must not need an app release to be readable.
    public let label: String
    public let points: Int
    public let classroomName: String?
    /// Kept as the raw string, like every other server timestamp in this kit (`dueAt` and
    /// friends). The shared decoder sets no `dateDecodingStrategy`, so a `Date` property
    /// would fail to decode an ISO-8601 payload — at runtime, with nothing to catch it at
    /// build time. `JSONCoding.parseServerDate` handles both the microsecond and plain forms.
    public let awardedAt: String
    public let note: String

    public var awardedDate: Date? { JSONCoding.parseServerDate(awardedAt) }

    enum CodingKeys: String, CodingKey {
        case id, event, label, points, note
        case classroomName = "classroom_name"
        case awardedAt = "awarded_at"
    }
}

/// The student's own balance and recent earnings.
///
/// **`coins` comes from the wallet, never from `points / pointsPerCoin`.** Points are a score
/// and coins are a balance; the moment coins can be spent the two stop agreeing, and a screen
/// that derived them would keep showing a student coins they had already spent. The backend
/// makes the same point in `MyRewardsView`.
///
/// There is no season here, deliberately: the balance is already scoped to the current one,
/// and the product never names it.
public struct MyRewards: Decodable, Sendable {
    public let points: Int
    public let coins: Int
    public let pointsPerCoin: Int
    public let pointsToNextCoin: Int
    public let history: [PointAward]

    enum CodingKeys: String, CodingKey {
        case points, coins, history
        case pointsPerCoin = "points_per_coin"
        case pointsToNextCoin = "points_to_next_coin"
    }
}

/// What earns what — the rules, visible in the product rather than only in a spreadsheet.
public struct RewardRule: Decodable, Identifiable, Sendable {
    public let event: String
    public let label: String
    public let points: Int

    public var id: String { event }
}

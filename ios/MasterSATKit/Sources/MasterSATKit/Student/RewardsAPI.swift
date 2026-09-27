import Foundation

/// The student's own points, coins and the rules that earn them.
///
/// Points are written by hooks on the server — attendance marked, homework settled, a support
/// session held — and never by a client. The one write here is conversion, and it is a write
/// precisely because it is not an earning: turning points into coins is a choice the student
/// makes about something they have already earned.
public struct RewardsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func me() async throws -> MyRewards {
        try await client.send(.get("/rewards/me/"), as: MyRewards.self)
    }

    /// What earns what. Served from the learning center's live rules, so a retune shows up
    /// here without an app release. Includes the retired homework bands — filter them with
    /// `RewardRule.earnable`.
    public func rules() async throws -> [RewardRule] {
        try await client.send(.get("/rewards/rules/"), as: RulesEnvelope.self).rules
    }

    /// The balances and the last 50 coin movements.
    public func wallet() async throws -> RewardsWallet {
        try await client.send(.get("/rewards/wallet/"), as: RewardsWallet.self)
    }

    /// Spend points on coins. `points: nil` sends `{}`, which the server reads as Max — every
    /// point that buys a whole coin.
    ///
    /// **Not idempotent, and it cannot be.** Converting spends the points, so a second call is
    /// a second purchase rather than a no-op. The server locks the wallet row and re-reads the
    /// balance, so two presses can never spend the same points twice — but the caller must
    /// confirm first, disable the button while this is in flight, and never retry it on its
    /// own. Asking for more points than the balance holds is refused (400) with a sentence.
    public func convert(points: Int?) async throws -> ConversionResult {
        try await client.send(
            try .post("/rewards/wallet/convert/", json: ConvertRequest(points: points)),
            as: ConversionResult.self
        )
    }
}

/// The school-wide XP board. On `/api/rewards/` because it is a projection of the same ledger.
public struct LeaderboardAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Invalid values are not refused by the server — they fall back to its defaults — so a
    /// stale chip costs a student nothing worse than the all-time global board.
    public func board(_ query: LeaderboardQuery = LeaderboardQuery()) async throws -> LeaderboardBoard {
        try await client.send(.get("/rewards/leaderboard/", query: query.queryItems), as: LeaderboardBoard.self)
    }

    public func filters() async throws -> LeaderboardFilters {
        try await client.send(.get("/rewards/leaderboard/filters/"), as: LeaderboardFilters.self)
    }
}

/// `{"points": 30}`, or `{}` for Max — a nil optional is omitted, not sent as null.
private struct ConvertRequest: Encodable, Sendable {
    let points: Int?
}

private struct RulesEnvelope: Decodable, Sendable {
    let rules: [RewardRule]

    enum CodingKeys: String, CodingKey { case rules }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rules = try c.rewardsList(RewardRule.self, .rules)
    }
}

import Foundation

/// The student's own points and coins.
///
/// Read-only by design: points are written by hooks on the server — attendance finalised,
/// homework graded, a support session held — and never by a client. See §0 of
/// docs/rewards/PLAN.md for why they are event-sourced rather than derived.
public struct RewardsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func me() async throws -> MyRewards {
        try await client.send(.get("/rewards/me/"), as: MyRewards.self)
    }

    /// What earns what. Served from the school's live rules, so a retune shows up here
    /// without an app release.
    public func rules() async throws -> [RewardRule] {
        try await client.send(.get("/rewards/rules/"), as: RulesEnvelope.self).rules
    }
}

private struct RulesEnvelope: Decodable, Sendable {
    let rules: [RewardRule]
}

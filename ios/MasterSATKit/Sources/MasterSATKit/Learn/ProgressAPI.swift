import Foundation

/// My Progress: the level ladder, and the student beside their group.
///
/// Two requests on purpose, as on the web: the ladder is cheap and answers on its own, while
/// the comparison reads the whole class's registers and homework. A page that waited for the
/// comparison to show the ladder would be slower for no reason — and a failed comparison must
/// never take the ladder down with it.
public struct ProgressAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// `GET /classes/progress/` — one track per subject, one row per level.
    public func progress() async throws -> MyProgressReport {
        try await client.send(.get("/classes/progress/"), as: MyProgressReport.self)
    }

    /// `GET /classes/progress/peers/` — one comparison per current classroom. Aggregates only.
    public func peers() async throws -> PeerProgress {
        try await client.send(.get("/classes/progress/peers/"), as: PeerProgress.self)
    }
}

import Foundation

/// The roadmap: the per-subject level ladder, and the reading that comes before a lesson's
/// homework.
///
/// All three routes live under `/api/classes/` rather than `/api/journals/`, which is
/// host-guarded to the admin subdomain. They are open to any signed-in student, frozen ones
/// included: the roadmap opens nothing a student may not open, and the homework it links to
/// enforces the freeze itself.
public struct RoadmapAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// `GET /classes/roadmap/`.
    public func roadmap() async throws -> RoadmapResponse {
        try await client.send(.get("/classes/roadmap/"), as: RoadmapResponse.self)
    }

    /// Home's level chips, read off the same payload.
    public func levelChips() async throws -> [RoadmapLevelChip] {
        try await roadmap().levelChips
    }

    /// `GET /classes/roadmap/<delivery_id>/reading/`.
    ///
    /// A lesson that is not the student's — or has not reached their class — answers 404
    /// (`APIError.http(status: 404, …)`), never 403: to a student the two are the same thing.
    public func reading(deliveryId: Int) async throws -> RoadmapReading {
        try await client.send(.get(Self.readingPath(deliveryId)), as: RoadmapReading.self)
    }

    /// "I've finished reading" — `POST` to the same path, no body.
    ///
    /// Safe to repeat (the server keeps one mark per student and delivery), and it answers
    /// with the whole reading again: marking it read is what reveals the homework id, so the
    /// response replaces the page's copy rather than prompting a refetch.
    public func markRead(deliveryId: Int) async throws -> RoadmapReading {
        try await client.send(.post(Self.readingPath(deliveryId)), as: RoadmapReading.self)
    }

    static func readingPath(_ deliveryId: Int) -> String {
        "/classes/roadmap/\(deliveryId)/reading/"
    }
}

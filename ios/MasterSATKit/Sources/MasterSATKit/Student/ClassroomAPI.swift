import Foundation

/// The classroom side of the student app: which classes they are in, who else is there,
/// what has been shared, and where they stand.
public struct ClassroomAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Every classroom the student is a member of.
    public func classrooms() async throws -> [Classroom] {
        try await client.send(.get("/classes/"), as: ListOrResults<Classroom>.self).items
    }

    public func classroom(id: Int) async throws -> Classroom {
        try await client.send(.get("/classes/\(id)/"), as: Classroom.self)
    }

    /// Join with the code the teacher read out.
    ///
    /// The code is the only way back into a class a student was removed from, so a wrong
    /// one has to fail loudly with the server's own wording rather than being swallowed.
    @discardableResult
    public func join(code: String) async throws -> Classroom {
        try await client.send(
            try .post("/classes/join/", json: ["join_code": code.trimmingCharacters(in: .whitespaces)]),
            as: Classroom.self
        )
    }

    public func people(classroomId: Int) async throws -> [ClassroomMember] {
        try await client.send(
            .get("/classes/\(classroomId)/people/"),
            as: ListOrResults<ClassroomMember>.self
        ).items
    }

    public func materials(classroomId: Int) async throws -> [ClassroomMaterial] {
        try await client.send(
            .get("/classes/\(classroomId)/materials/"),
            as: ListOrResults<ClassroomMaterial>.self
        ).items
    }

    /// One leaderboard.
    ///
    /// A class can hide its board entirely, and foundation/junior classes do not rank on
    /// SAT at all — both come back as a successful response describing that, not an error,
    /// so the caller must read `isHidden` / `satAvailable` rather than treating a short
    /// list as "nobody has scored yet".
    public func rankings(classroomId: Int, kind: RankingKind) async throws -> RankingBoard {
        try await client.send(
            .get("/classes/\(classroomId)/rankings/\(kind.path)/"),
            as: RankingBoard.self
        )
    }
}

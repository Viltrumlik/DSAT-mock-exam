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
    ///
    /// The server answers `{"joined": true, "role": …, "classroom": {…}}` — the class is
    /// NESTED. Decoding the body as a `Classroom` failed on every successful join: the student
    /// was in the class on the server and looking at an error on the phone.
    @discardableResult
    public func join(code: String) async throws -> Classroom {
        try await client.send(
            try .post("/classes/join/", json: ["join_code": code.trimmingCharacters(in: .whitespaces)]),
            as: JoinResponse.self
        ).classroom
    }

    /// Classwork for one class — done in the lesson, so it is not in `my-assignments`, which
    /// is homework only.
    ///
    /// The per-class list is the full assignment serializer and never says which class a row
    /// belongs to, so the rows are stamped with it here: the detail screen loads by class.
    public func classwork(classroomId: Int, classroomName: String? = nil) async throws -> [AssignmentListing] {
        try await client.send(
            .get("/classes/\(classroomId)/assignments/", query: [URLQueryItem(name: "category", value: "CLASSWORK")]),
            as: ListOrResults<AssignmentListing>.self
        ).items.map { $0.inClassroom(id: classroomId, name: classroomName) }
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

    /// The class board, ranked on XP.
    ///
    /// A class can hide its board entirely — that comes back as a successful response
    /// describing it (`isHidden`, with only the student's own row), not an error, so the
    /// caller must not read a short list as "nobody has earned anything yet".
    public func rankings(classroomId: Int, kind: RankingKind = .academic) async throws -> RankingBoard {
        try await client.send(
            .get("/classes/\(classroomId)/rankings/\(kind.path)/"),
            as: RankingBoard.self
        )
    }
}

private struct JoinResponse: Decodable, Sendable {
    let classroom: Classroom
}

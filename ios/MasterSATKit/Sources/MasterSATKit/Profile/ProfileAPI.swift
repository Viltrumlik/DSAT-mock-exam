import Foundation

/// What the profile reads that no other screen reads: the student's test sittings, for
/// "Latest results".
///
/// Everything else on the profile comes from surfaces the app already has — `/users/me/`
/// (`AccountAPI`, `StudentAPI`), `/rewards/me/`, `/classes/`, `/classes/my-assignments/`,
/// `/classes/my-schedule/` and `/classes/{id}/people/`.
public struct ProfileAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// `GET /exams/attempts/` — every sitting the student has started, finished or not, the
    /// same list the web's profile reads.
    ///
    /// The server answers with a plain array today (the viewset has no pagination); a
    /// `results` or `items` envelope is read too. A row that cannot be read is skipped rather
    /// than failing the list — one odd sitting must not blank the student's results. A
    /// midterm whose result is not out yet arrives with `score: null` (the server masks it),
    /// which `ProfileResults.recent` leaves out.
    public func attempts() async throws -> [ProfileAttempt] {
        try await client.send(.get("/exams/attempts/"), as: ProfileAttemptList.self).attempts
    }
}

/// One sitting from `GET /exams/attempts/`, only the fields the profile reads.
public struct ProfileAttempt: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let submittedAt: String?
    public let isCompleted: Bool
    /// The sitting's scaled score. Nil until it is scored, and for a midterm whose result the
    /// teacher has not released yet.
    public let score: Int?
    /// `MATH`, `READING_WRITING` (older rows: `ENGLISH`).
    public let subject: String?
    public let title: String?
    public let collectionName: String?
    /// Set when the sitting is a section of a mock (or a midterm).
    public let mockExamId: Int?
    /// `MOCK_SAT` or `MIDTERM` when `mockExamId` is set.
    public let mockKind: String?

    public init(
        id: Int,
        submittedAt: String? = nil,
        isCompleted: Bool = false,
        score: Int? = nil,
        subject: String? = nil,
        title: String? = nil,
        collectionName: String? = nil,
        mockExamId: Int? = nil,
        mockKind: String? = nil
    ) {
        self.id = id
        self.submittedAt = submittedAt
        self.isCompleted = isCompleted
        self.score = score
        self.subject = subject
        self.title = title
        self.collectionName = collectionName
        self.mockExamId = mockExamId
        self.mockKind = mockKind
    }

    private enum CodingKeys: String, CodingKey {
        case id, score
        case submittedAt = "submitted_at"
        case isCompleted = "is_completed"
        case details = "practice_test_details"
    }

    private enum DetailKeys: String, CodingKey {
        case subject, title
        case collectionName = "collection_name"
        case mockExamId = "mock_exam_id"
        case mockKind = "mock_kind"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        submittedAt = (try? c.decodeIfPresent(String.self, forKey: .submittedAt)) ?? nil
        isCompleted = ((try? c.decodeIfPresent(Bool.self, forKey: .isCompleted)) ?? nil) ?? false
        let whole: Int? = try? c.decodeIfPresent(Int.self, forKey: .score)
        let fractional: Double? = try? c.decodeIfPresent(Double.self, forKey: .score)
        let typed: String? = try? c.decodeIfPresent(String.self, forKey: .score)
        score = whole
            ?? fractional.map { Int($0.rounded()) }
            ?? typed.flatMap { Double($0.trimmingCharacters(in: .whitespaces)) }.map { Int($0.rounded()) }

        if let d = try? c.nestedContainer(keyedBy: DetailKeys.self, forKey: .details) {
            subject = (try? d.decodeIfPresent(String.self, forKey: .subject)) ?? nil
            title = (try? d.decodeIfPresent(String.self, forKey: .title)) ?? nil
            collectionName = (try? d.decodeIfPresent(String.self, forKey: .collectionName)) ?? nil
            mockExamId = (try? d.decodeIfPresent(Int.self, forKey: .mockExamId)) ?? nil
            mockKind = (try? d.decodeIfPresent(String.self, forKey: .mockKind)) ?? nil
        } else {
            subject = nil
            title = nil
            collectionName = nil
            mockExamId = nil
            mockKind = nil
        }
    }
}

/// A plain array, or `{results: […]}` / `{items: […]}`, read row by row.
struct ProfileAttemptList: Decodable, Sendable {
    let attempts: [ProfileAttempt]

    init(from decoder: Decoder) throws {
        if let rows = try? decoder.singleValueContainer().decode(CommunityLossyList<ProfileAttempt>.self) {
            attempts = rows.elements
            return
        }
        let c = try decoder.container(keyedBy: Key.self)
        if let rows = try? c.decode(CommunityLossyList<ProfileAttempt>.self, forKey: .results) {
            attempts = rows.elements
        } else {
            attempts = try c.decode(CommunityLossyList<ProfileAttempt>.self, forKey: .items).elements
        }
    }

    private enum Key: String, CodingKey { case results, items }
}

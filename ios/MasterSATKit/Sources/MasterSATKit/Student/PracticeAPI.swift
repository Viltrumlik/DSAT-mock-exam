import Foundation

/// Free-practice surfaces: the question bank, practice-test packs, and the invigilated
/// mock sittings a student joins with a code.
public struct PracticeAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    // MARK: - Practice-test packs

    public func packs() async throws -> [PracticePack] {
        try await client.send(
            .get("/exams/practice-test-packs/"),
            as: ListOrResults<PracticePack>.self
        ).items
    }

    public func pack(id: Int) async throws -> PracticePack {
        try await client.send(.get("/exams/practice-test-packs/\(id)/"), as: PracticePack.self)
    }

    // MARK: - Question bank

    public struct BankFilters: Sendable, Equatable {
        public var subject: String?
        public var domain: Int?
        public var skill: Int?
        public var difficulty: String?
        public var search: String?
        public var limit: Int
        public var offset: Int

        public init(
            subject: String? = nil,
            domain: Int? = nil,
            skill: Int? = nil,
            difficulty: String? = nil,
            search: String? = nil,
            limit: Int = 30,
            offset: Int = 0
        ) {
            self.subject = subject
            self.domain = domain
            self.skill = skill
            self.difficulty = difficulty
            self.search = search
            self.limit = limit
            self.offset = offset
        }

        var query: [URLQueryItem] {
            var items: [URLQueryItem] = []
            if let subject, !subject.isEmpty { items.append(.init(name: "subject", value: subject)) }
            if let domain { items.append(.init(name: "domain", value: String(domain))) }
            if let skill { items.append(.init(name: "skill", value: String(skill))) }
            if let difficulty, !difficulty.isEmpty { items.append(.init(name: "difficulty", value: difficulty)) }
            if let search, !search.isEmpty { items.append(.init(name: "search", value: search)) }
            items.append(.init(name: "limit", value: String(limit)))
            items.append(.init(name: "offset", value: String(offset)))
            return items
        }
    }

    public func bankQuestions(_ filters: BankFilters) async throws -> BankPage {
        try await client.send(.get("/questionbank/practice/", query: filters.query), as: BankPage.self)
    }

    public func bankQuestion(id: Int) async throws -> BankQuestionDetail {
        try await client.send(.get("/questionbank/practice/\(id)/"), as: BankQuestionDetail.self)
    }

    /// Answer one bank question and learn whether it was right.
    ///
    /// The answer key and the explanation only exist in THIS response — the question
    /// payload never carries them — so a student cannot read the answer off the wire
    /// before committing to one.
    public func answerBankQuestion(id: Int, answer: String) async throws -> BankAnswerResult {
        try await client.send(
            try .post("/questionbank/practice/\(id)/answer/", json: ["answer": answer]),
            as: BankAnswerResult.self
        )
    }

    public func bankTaxonomy(subject: String? = nil) async throws -> BankTaxonomy {
        let query = (subject?.isEmpty == false) ? [URLQueryItem(name: "subject", value: subject)] : []
        return try await client.send(.get("/questionbank/practice/taxonomy/", query: query), as: BankTaxonomy.self)
    }

    // MARK: - Invigilated sittings

    /// Join a sitting with the code the teacher read out. Puts the student in the
    /// approval queue; it does not start anything.
    public func joinSitting(code: String) async throws -> MockSessionPlace {
        try await client.send(
            try .post("/mocks/sessions/join/", json: ["code": code.trimmingCharacters(in: .whitespaces)]),
            as: MockSessionPlace.self
        )
    }

    /// Every sitting this student has a place in. The waiting room polls this, because
    /// there is no push transport — see the mock-sittings work for why SSE was ruled out.
    public func mySittings() async throws -> [MockSessionPlace] {
        try await client.send(.get("/mocks/sessions/mine/"), as: ListOrResults<MockSessionPlace>.self).items
    }

    // MARK: - Results

    /// The 1600-scale result for one finished mock. Shares `MockResults` with the exam
    /// engine rather than declaring a second shape for the same payload.
    public func mockResult(attemptId: Int) async throws -> MockResults {
        try await client.send(.get("/mocks/attempts/\(attemptId)/results/"), as: MockResults.self)
    }

    public func midtermResult(attemptId: Int) async throws -> MidtermResult {
        try await client.send(.get("/midterms/attempts/\(attemptId)/review/"), as: MidtermResult.self)
    }

    /// A finished past paper, scored.
    public func pastpaperResult(attemptId: Int) async throws -> Attempt {
        try await client.send(.get("/exams/attempts/\(attemptId)/results/"), as: Attempt.self)
    }

    /// A midterm certificate by its public code.
    public func certificate(code: String) async throws -> CertificateDetail {
        try await client.send(.get("/classes/certificates/midterm/\(code)/"), as: CertificateDetail.self)
    }
}

/// A certificate looked up by code. The download itself is a PDF the app opens in a
/// browser rather than decoding.
public struct CertificateDetail: Decodable, Sendable, Equatable {
    public let code: String
    public let studentName: String?
    public let midtermTitle: String?
    public let score: Double?
    public let scoreCeiling: Double?
    public let rank: Int?
    public let cohortSize: Int?
    public let issuedAt: String?
    public let downloadURL: String?

    private enum CodingKeys: String, CodingKey {
        case code, score, rank
        case studentName = "student_name"
        case midtermTitle = "midterm_title"
        case scoreCeiling = "score_ceiling"
        case cohortSize = "cohort_size"
        case issuedAt = "issued_at"
        case downloadURL = "download_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = (try? c.decodeIfPresent(String.self, forKey: .code)) as? String ?? ""
        studentName = try? c.decodeIfPresent(String.self, forKey: .studentName)
        midtermTitle = try? c.decodeIfPresent(String.self, forKey: .midtermTitle)
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
        scoreCeiling = try? c.decodeIfPresent(Double.self, forKey: .scoreCeiling)
        rank = try? c.decodeIfPresent(Int.self, forKey: .rank)
        cohortSize = try? c.decodeIfPresent(Int.self, forKey: .cohortSize)
        issuedAt = try? c.decodeIfPresent(String.self, forKey: .issuedAt)
        downloadURL = try? c.decodeIfPresent(String.self, forKey: .downloadURL)
    }
}

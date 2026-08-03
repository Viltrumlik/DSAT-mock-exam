import Foundation

/// Everything the student app reads outside an exam.
public struct StudentAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func me() async throws -> CurrentUser {
        try await client.send(.get("/users/me/"), as: CurrentUser.self)
    }

    /// Every assignment across every classroom the student is in — one request, not one
    /// per classroom.
    public func assignments() async throws -> [AssignmentListing] {
        try await client.send(.get("/classes/my-assignments/"), as: ItemsEnvelope<AssignmentListing>.self).items
    }

    /// Calendar events. The server caps the range at 70 days and buckets nothing — the
    /// client groups by `date`.
    public func schedule(from: Date, to: Date) async throws -> [ScheduleEvent] {
        let query = [
            URLQueryItem(name: "from", value: Self.day.string(from: from)),
            URLQueryItem(name: "to", value: Self.day.string(from: to)),
        ]
        return try await client.send(.get("/classes/my-schedule/", query: query), as: EventsEnvelope.self).events
    }

    /// Every midterm the student can see.
    ///
    /// The app does not START midterms — they are sat under supervision on a laptop — but
    /// it reads this to show a student the score once the paper is behind them.
    public func midterms() async throws -> [MidtermListing] {
        try await client.send(.get("/midterms/mine/"), as: ResultsEnvelope<MidtermListing>.self).results
    }

    // MARK: - Vocabulary

    /// Vocabulary sets assigned as homework, grouped by the assignment that carries them.
    public func vocabularyHomework() async throws -> [VocabHomeworkGroup] {
        try await client.send(.get("/vocabulary/homework/"), as: ListOrResults<VocabHomeworkGroup>.self).items
    }

    /// One set with its words in study order, each tagged with the student's progress.
    public func vocabularySet(id: Int) async throws -> VocabSetDetail {
        try await client.send(.get("/vocabulary/sets/\(id)/"), as: VocabSetDetail.self)
    }

    /// The whole published word bank, section by section.
    public func vocabularySections() async throws -> [VocabSection] {
        try await client.send(.get("/vocabulary/sections/"), as: ListOrResults<VocabSection>.self).items
    }

    public func vocabularySection(id: Int) async throws -> VocabSectionDetail {
        try await client.send(.get("/vocabulary/sections/\(id)/"), as: VocabSectionDetail.self)
    }

    /// Sets the student built themselves.
    public func myVocabularySets() async throws -> [VocabMySet] {
        try await client.send(.get("/vocabulary/my-sets/"), as: ListOrResults<VocabMySet>.self).items
    }

    /// Search the bank for words to put in a set.
    public func searchVocabularyWords(_ query: String, sectionId: Int? = nil, limit: Int = 50) async throws -> [VocabWord] {
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if !query.isEmpty { items.append(.init(name: "q", value: query)) }
        if let sectionId { items.append(.init(name: "section", value: String(sectionId))) }
        return try await client.send(.get("/vocabulary/words/", query: items), as: ListOrResults<VocabWord>.self).items
    }

    /// Create one of the student's own sets. `wordIds` is the membership *and* the order.
    @discardableResult
    public func createVocabularySet(title: String, wordIds: [Int]) async throws -> VocabMySet {
        try await client.send(
            try .post("/vocabulary/my-sets/", json: CustomSetRequest(title: title, wordIds: wordIds)),
            as: VocabMySet.self
        )
    }

    /// Rename a set or replace its words. `wordIds` REPLACES membership — sending a
    /// shorter list removes the rest, which is the endpoint's contract, not a bug here.
    @discardableResult
    public func updateVocabularySet(id: Int, title: String, wordIds: [Int]) async throws -> VocabMySet {
        try await client.send(
            try .patch("/vocabulary/my-sets/\(id)/", json: CustomSetRequest(title: title, wordIds: wordIds)),
            as: VocabMySet.self
        )
    }

    public func deleteVocabularySet(id: Int) async throws {
        _ = try await client.send(.delete("/vocabulary/my-sets/\(id)/"))
    }

    public func startVocabularySession(setId: Int, mode: VocabStudyMode) async throws -> VocabSession {
        try await client.send(
            try .post("/vocabulary/sessions/", json: SessionStartRequest(setId: setId, mode: mode.rawValue)),
            as: VocabSession.self
        )
    }

    /// Bank a run's answers.
    ///
    /// `isPartial` records the answers without completing the set — the flush a mode fires
    /// when the student walks away mid-run, so 20 of 25 cards still count for something.
    /// Safe to call twice: a finished session returns its existing summary rather than
    /// applying progress again, which matters because leaving the app is a normal way to
    /// end a run.
    @discardableResult
    public func finishVocabularySession(
        id: Int,
        results: [VocabResult],
        durationMs: Int,
        isPartial: Bool
    ) async throws -> VocabSessionSummary {
        try await client.send(
            try .post(
                "/vocabulary/sessions/\(id)/finish/",
                json: SessionFinishRequest(results: results, durationMs: durationMs, partial: isPartial)
            ),
            as: VocabSessionSummary.self
        )
    }

    // MARK: - Homework submission

    public func mySubmission(classroomId: Int, assignmentId: Int) async throws -> Submission {
        try await client.send(
            .get("/classes/\(classroomId)/assignments/\(assignmentId)/my-submission/"),
            as: Submission.self
        )
    }

    /// Attach files to a submission, and optionally hand it in.
    ///
    /// `expectedRevision` is the revision last read. The server refuses a write built on a
    /// stale one, which is what stops a phone that was offline from overwriting a
    /// teacher's return. Each file carries its own token so a retry after a timeout
    /// re-uploads nothing.
    @discardableResult
    public func submitHomework(
        classroomId: Int,
        assignmentId: Int,
        files: [MultipartForm.File] = [],
        removeFileIds: [Int] = [],
        expectedRevision: Int?,
        markAsSubmitted: Bool = true
    ) async throws -> Submission {
        var form = MultipartForm()
        for file in files { form.add(file: file) }
        if !files.isEmpty {
            let tokens = files.map(\.token)
            let encoded = (try? JSONSerialization.data(withJSONObject: tokens)).flatMap {
                String(data: $0, encoding: .utf8)
            }
            if let encoded { form.add("file_tokens", encoded) }
        }
        if !removeFileIds.isEmpty {
            form.add("remove_file_ids", removeFileIds.map(String.init).joined(separator: ","))
        }
        if let expectedRevision { form.add("expected_revision", expectedRevision) }
        form.add("submit", markAsSubmitted ? "true" : "false")

        return try await client.send(
            .upload("/classes/\(classroomId)/assignments/\(assignmentId)/submit/", form: form),
            as: Submission.self
        )
    }

    nonisolated(unsafe) private static let day: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

private struct CustomSetRequest: Encodable, Sendable {
    let title: String
    let wordIds: [Int]

    private enum CodingKeys: String, CodingKey {
        case title
        case wordIds = "word_ids"
    }
}

private struct SessionStartRequest: Encodable, Sendable {
    let setId: Int
    let mode: String

    private enum CodingKeys: String, CodingKey {
        case mode
        case setId = "set_id"
    }
}

private struct SessionFinishRequest: Encodable, Sendable {
    let results: [VocabResult]
    let durationMs: Int
    let partial: Bool

    private enum CodingKeys: String, CodingKey {
        case results, partial
        case durationMs = "duration_ms"
    }
}

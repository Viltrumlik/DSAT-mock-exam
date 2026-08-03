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

    /// Available mocks with their attempt state.
    public func mocks() async throws -> [MockListing] {
        try await client.send(.get("/mocks/mine/"), as: ResultsEnvelope<MockListing>.self).results
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

    /// Every midterm the student can see, with its window, its attempt and its result.
    public func midterms() async throws -> [MidtermListing] {
        try await client.send(.get("/midterms/mine/"), as: ResultsEnvelope<MidtermListing>.self).results
    }

    /// The past-paper catalogue.
    public func pastpapers() async throws -> [PastpaperListing] {
        try await client.send(.get("/exams/"), as: ListOrResults<PastpaperListing>.self).items
    }

    /// The student's own pastpaper attempts, for labelling the catalogue rows.
    public func pastpaperAttempts() async throws -> [PastpaperAttemptSummary] {
        try await client.send(.get("/exams/attempts/"), as: ListOrResults<PastpaperAttemptSummary>.self).items
    }

    // MARK: - Opening an attempt

    /// Open (or reopen) an attempt for a mock.
    ///
    /// The server returns the existing in-progress attempt rather than creating a second
    /// one, so this is safe to call from a "Start" button that may be tapped twice.
    public func startMockAttempt(mockId: Int) async throws -> Attempt {
        try await client.send(try .post("/mocks/attempts/", json: ["mock": mockId]), as: Attempt.self)
    }

    /// Open (or reopen) a midterm attempt. Refused with the server's own wording when the
    /// window is shut or the student has already sat it.
    public func startMidtermAttempt(midtermId: Int) async throws -> Attempt {
        try await client.send(try .post("/midterms/attempts/", json: ["midterm": midtermId]), as: Attempt.self)
    }

    /// Open (or reopen) a past-paper attempt. A unique constraint keeps a double tap from
    /// creating a second live attempt.
    public func startPastpaperAttempt(practiceTestId: Int) async throws -> Attempt {
        try await client.send(
            try .post("/exams/attempts/", json: ["practice_test": practiceTestId]),
            as: Attempt.self
        )
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

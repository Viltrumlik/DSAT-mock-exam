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

    nonisolated(unsafe) private static let day: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

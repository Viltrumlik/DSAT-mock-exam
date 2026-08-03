import Foundation
import Testing
@testable import MasterSATKit

@Suite struct PracticeAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> PracticeAPI {
        PracticeAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("Bank filters become query items, and blanks are left out")
    func filtersBecomeQuery() async throws {
        server.handler = { _ in .json(["count": 0, "results": []]) }

        _ = try await api().bankQuestions(.init(subject: "MATH", difficulty: "", search: "slope", limit: 10, offset: 20))

        let url = try #require(server.requests.first?.url)
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let byName = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(byName["subject"] == "MATH")
        #expect(byName["search"] == "slope")
        #expect(byName["limit"] == "10")
        #expect(byName["offset"] == "20")
        // An empty difficulty must not become `difficulty=`, which filters everything out.
        #expect(byName["difficulty"] == nil)
    }

    @Test("The answer key arrives only in the answer response")
    func answerCarriesTheKey() async throws {
        server.handler = { request in
            request.httpMethod == "POST"
                ? .json(["is_correct": false, "correct_answer": "C", "explanation": "Because…"])
                : .json(["id": 1, "question_text": "Q", "choices": []])
        }

        let detail = try await api().bankQuestion(id: 1)
        let result = try await api().answerBankQuestion(id: 1, answer: "A")

        // The question payload has no key on it at all — that is the point.
        #expect(detail.choices.isEmpty)
        #expect(result.isCorrect == false)
        #expect(result.correctAnswer == .string("C"))
        #expect(result.explanation == "Because…")
    }

    @Test("A sitting is only startable once the room has started it")
    func sittingStart() async throws {
        server.handler = { _ in
            .json([
                ["session_id": 1, "mock_id": 2, "title": "August mock", "status": "OPEN",
                 "my_status": "PENDING", "attempt_id": nil],
                ["session_id": 2, "mock_id": 3, "title": "July mock", "status": "STARTED",
                 "my_status": "APPROVED", "attempt_id": 88],
            ])
        }

        let places = try await api().mySittings()

        #expect(places[0].isPending)
        // Approved is not the same as started — the attempt id is the only real signal.
        #expect(places[0].hasStarted == false)
        #expect(places[1].isApproved)
        #expect(places[1].hasStarted)
        #expect(places[1].attemptId == 88)
    }

    @Test("A mock result keeps its section scores apart")
    func mockResult() async throws {
        server.handler = { _ in
            .json([
                "title": "Mock 3", "mock_kind": "FULL",
                "english_score": 700, "math_score": 720, "total_score": 1420, "score_ceiling": 1600,
            ])
        }

        let result = try await api().mockResult(attemptId: 12)

        #expect(result.englishScore == 700)
        #expect(result.mathScore == 720)
        #expect(result.totalScore == 1420)
    }

    @Test("An unreleased midterm result reports that, rather than a zero")
    func unreleasedMidterm() async throws {
        // A classroom midterm is scored on submit but stays sealed until the teacher
        // publishes it. Showing 0 would read as a failed paper.
        server.handler = { _ in .json(["score_only": true, "released": false, "subject": "MATH"]) }

        let result = try await api().midtermResult(attemptId: 4)

        #expect(result.released == false)
        #expect(result.totalScore == nil)
    }
}

@Suite struct AnalyticsTests {

    private func attempt(_ id: Int, score: Double?, day: String?, subject: String = "MATH") -> PastpaperAttemptSummary {
        PastpaperAttemptSummary(
            id: id,
            currentState: "COMPLETED",
            isCompleted: true,
            score: score,
            submittedAt: day.map { "\($0)T10:00:00Z" },
            title: "Paper \(id)",
            subject: subject
        )
    }

    @Test("With nothing sat, every figure is absent rather than zero")
    func emptyIsEmpty() {
        let model = Analytics.build(
            pastpaperAttempts: [], mocks: [], midterms: [], assignments: [], user: nil
        )

        #expect(model.current == nil)
        #expect(model.best == nil)
        #expect(model.average == nil)
        #expect(model.hasAnyResult == false)
    }

    @Test("History is chronological and the latest score is current")
    func historyIsChronological() {
        let model = Analytics.build(
            pastpaperAttempts: [
                attempt(3, score: 1300, day: "2026-07-01"),
                attempt(1, score: 1200, day: "2026-06-01"),
                attempt(2, score: 1350, day: "2026-08-01"),
            ],
            mocks: [], midterms: [], assignments: [], user: nil
        )

        #expect(model.history.map(\.score) == [1200, 1300, 1350])
        #expect(model.current == 1350)
        #expect(model.best == 1350)
        #expect(model.trendDelta == 50)
    }

    @Test("An attempt with no date falls back to its id rather than jumping to the front")
    func undatedAttemptsKeepOrder() {
        let model = Analytics.build(
            pastpaperAttempts: [attempt(9, score: 1400, day: nil), attempt(2, score: 1100, day: nil)],
            mocks: [], midterms: [], assignments: [], user: nil
        )

        #expect(model.history.map(\.score) == [1100, 1400])
    }

    @Test("An unscored attempt is left out of the average")
    func unscoredAttemptsExcluded() {
        let model = Analytics.build(
            pastpaperAttempts: [
                attempt(1, score: 1200, day: "2026-06-01"),
                attempt(2, score: nil, day: "2026-07-01"),
            ],
            mocks: [], midterms: [], assignments: [], user: nil
        )

        #expect(model.totalAttempts == 1)
        #expect(model.average == 1200)
    }

    @Test("Subjects are split, and one attempt gives no delta")
    func subjectSplit() {
        let model = Analytics.build(
            pastpaperAttempts: [
                attempt(1, score: 700, day: "2026-06-01", subject: "MATH"),
                attempt(2, score: 740, day: "2026-07-01", subject: "MATH"),
                attempt(3, score: 650, day: "2026-07-02", subject: "READING_WRITING"),
            ],
            mocks: [], midterms: [], assignments: [], user: nil
        )

        let math = try? #require(model.subjects.first { $0.id == "MATH" })
        #expect(math?.attempts == 2)
        #expect(math?.delta == 40)
        let rw = try? #require(model.subjects.first { $0.id == "READING_WRITING" })
        #expect(rw?.delta == nil)
    }

    @Test("The gap to target goes negative once the target is passed")
    func gapGoesNegative() throws {
        let user = try JSONCoding.decoder.decode(
            CurrentUser.self,
            from: Data(#"{"id":1,"email":"s@x.uz","target_score":1400}"#.utf8)
        )

        let model = Analytics.build(
            pastpaperAttempts: [attempt(1, score: 1450, day: "2026-06-01")],
            mocks: [], midterms: [], assignments: [], user: user
        )

        #expect(model.target == 1400)
        #expect(model.gap == -50)
        #expect(model.goalReached)
    }
}

@Suite struct VocabSearchTests {

    @Test("A search result carries the section that tells it apart")
    func searchRowCarriesSection() throws {
        // The bank stores the same word once per section, so three rows come back reading
        // "abate / to become less intense" with nothing to choose between them.
        let data = Data(#"""
        [{"id":1,"word":"abate","definition":"to lessen","section_id":2,"section_title":"650 Hard Words"},
         {"id":9,"word":"abate","definition":"to lessen","section_id":3,"section_title":"College Panda"}]
        """#.utf8)

        let words = try JSONCoding.decoder.decode([VocabWord].self, from: data)

        #expect(words.map(\.sectionTitle) == ["650 Hard Words", "College Panda"])
        #expect(words[0].id != words[1].id)
    }

    @Test("A set's own words have no section, and that is not an error")
    func setWordsHaveNoSection() throws {
        let data = Data(#"{"id":1,"word":"abate","definition":"to lessen","status":"learning"}"#.utf8)
        let word = try JSONCoding.decoder.decode(VocabWord.self, from: data)

        #expect(word.sectionTitle == nil)
        #expect(word.status == .learning)
    }
}

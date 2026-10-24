import Foundation
import Testing
@testable import MasterSATKit

@Suite struct QuestionReportsTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> QuestionReportsAPI {
        QuestionReportsAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    /// The body as the server read it.
    private func sentBody() throws -> [String: Any] {
        let request = try #require(server.requests.first)
        let data = try #require(request.httpBody)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test("The wire names are the website's, and so is the order and the wording")
    func categoriesMatchTheWebsite() {
        #expect(QuestionReportCategory.allCases.map(\.rawValue) == [
            "wrong_answer", "answer_key", "typo_unclear", "image_figure", "other",
        ])
        #expect(QuestionReportCategory.allCases.first == .wrongAnswer)
        #expect(QuestionReportCategory.wrongAnswer.label == "Wrong / no correct answer")
        #expect(QuestionReportCategory.answerKey.label == "Answer key looks wrong")
        #expect(QuestionReportCategory.typoUnclear.label == "Typo / unclear wording")
        #expect(QuestionReportCategory.imageFigure.label == "Image / figure problem")
        #expect(QuestionReportCategory.other.label == "Something else")
        #expect(QuestionReportSystem.allCases.map(\.rawValue) == ["exam", "assessment"])
    }

    @Test("The runner's report carries the attempt id and the details")
    func runnerBodyCarriesEverything() async throws {
        server.handler = { _ in .json(["id": 71, "status": "NEW"], status: 201) }
        let result = try await api().submit(QuestionReport(
            system: .assessment,
            questionId: 412,
            category: .answerKey,
            message: "  The key says C, but B is right. ",
            attemptId: 9001
        ))

        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/question-reports/reports/")
        let body = try sentBody()
        #expect(body["system"] as? String == "assessment")
        #expect(body["question_id"] as? Int == 412)
        #expect(body["category"] as? String == "answer_key")
        #expect(body["attempt_id"] as? Int == 9001)
        // Trimmed, as the website trims it before sending.
        #expect(body["message"] as? String == "The key says C, but B is right.")
        #expect(result == QuestionReportResult(id: 71, status: "NEW", deduped: false))
    }

    @Test("The review's report names no attempt, and an empty message is left out")
    func reviewBodyOmitsAttemptAndMessage() async throws {
        server.handler = { _ in .json(["id": 72, "status": "NEW"], status: 201) }
        _ = try await api().submit(QuestionReport(
            system: .assessment,
            questionId: 412,
            category: .wrongAnswer
        ))

        let body = try sentBody()
        #expect(body["attempt_id"] == nil)
        #expect(body["message"] == nil)
        #expect(body.keys.sorted() == ["category", "question_id", "system"])
    }

    @Test("A message of nothing but spaces is not a detail")
    func whitespaceOnlyMessageIsOmitted() async throws {
        server.handler = { _ in .json(["id": 73], status: 201) }
        _ = try await api().submit(QuestionReport(
            system: .exam,
            questionId: 7,
            category: .typoUnclear,
            message: "   \n\t  "
        ))

        let body = try sentBody()
        #expect(body["message"] == nil)
        #expect(body["system"] as? String == "exam")
    }

    @Test("A repeat inside the window comes back deduped, with no status")
    func dedupedIsReadBack() async throws {
        server.handler = { _ in .json(["id": 71, "deduped": true], status: 200) }
        let result = try await api().submit(QuestionReport(
            system: .assessment, questionId: 412, category: .other
        ))
        #expect(result.deduped)
        #expect(result.id == 71)
        #expect(result.status == nil)
    }

    @Test("A refusal reaches the caller as its own APIError, sentence and all")
    func refusalSurfaces() async throws {
        server.handler = { _ in
            .json(["detail": "Your account is frozen."], status: 403)
        }
        await #expect(throws: APIError.self) {
            _ = try await api().submit(QuestionReport(
                system: .assessment, questionId: 412, category: .wrongAnswer
            ))
        }

        server.handler = { _ in .json(["detail": "Question not found."], status: 404) }
        do {
            _ = try await api().submit(QuestionReport(
                system: .assessment, questionId: 1, category: .wrongAnswer
            ))
            Issue.record("A 404 must not read as a sent report")
        } catch let error as APIError {
            #expect(error.errorDescription == "Question not found.")
        }
    }

    @Test("The cap counts what the server counts, so a long message is cut here and never refused there")
    func messageCapCountsCodePoints() {
        #expect(QuestionReport.messageLimit == 2000)

        let plain = String(repeating: "a", count: 2001)
        #expect(QuestionReport.clampedMessage(plain).unicodeScalars.count == 2000)
        // Exactly at the limit is left alone — the cut is for what is over it.
        let exact = String(repeating: "a", count: 2000)
        #expect(QuestionReport.clampedMessage(exact) == exact)

        // The case Swift's own `count` waves through: a family emoji is ONE character and seven
        // code points, so 500 of them are 500 characters and 3,500 code points — a message the
        // server's max_length=2000 refuses.
        let emoji = String(repeating: "👨‍👩‍👧", count: 500)
        #expect(emoji.count < QuestionReport.messageLimit)
        #expect(emoji.unicodeScalars.count > QuestionReport.messageLimit)
        #expect(QuestionReport.clampedMessage(emoji).unicodeScalars.count == 2000)
    }
}

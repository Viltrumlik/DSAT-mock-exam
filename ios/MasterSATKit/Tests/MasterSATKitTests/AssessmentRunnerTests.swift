import Foundation
import Testing
@testable import MasterSATKit

private func bundleJSON(
    attemptId: Int = 5,
    questionOrder: [Int] = [30, 10, 20],
    answers: [[String: Any]] = [],
    currentIndex: Int = 0
) -> [String: Any] {
    [
        "attempt": [
            "id": attemptId,
            "homework_id": 77,
            "student_id": 1,
            "status": "in_progress",
            "is_paused": false,
            "elapsed_seconds": 42,
            "server_now": "2026-08-03T10:00:00Z",
            "current_question_index": currentIndex,
            "question_order": questionOrder,
            "answers": answers,
        ],
        "set": ["id": 3, "title": "Linear equations", "subject": "math", "category": "Algebra"],
        "questions": [
            ["id": 10, "order": 1, "prompt": "Q one", "question_type": "multiple_choice",
             "choices": [["id": "A", "text": "1"], ["id": "B", "text": "2"]], "points": 1],
            ["id": 20, "order": 2, "prompt": "Q two", "question_type": "numeric", "points": 1],
            ["id": 30, "order": 3, "prompt": "Q three", "question_type": "short_text", "points": 2],
        ],
    ]
}

@Suite struct AssessmentBundleTests {

    private func decode(_ object: [String: Any]) throws -> AssessmentBundle {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONCoding.decoder.decode(AssessmentBundle.self, from: data)
    }

    @Test("Questions follow the attempt's own order, not the set's")
    func attemptOrderWins() throws {
        // question_order is per attempt: two students can be served the same set in
        // different orders, and the answers were recorded against THIS one.
        let bundle = try decode(bundleJSON(questionOrder: [30, 10, 20]))

        #expect(bundle.orderedQuestions.map(\.id) == [30, 10, 20])
    }

    @Test("A question missing from the order is still reachable")
    func missingFromOrderStillAppears() throws {
        // Otherwise the student could never answer it, and could never finish.
        let bundle = try decode(bundleJSON(questionOrder: [30, 10]))

        #expect(bundle.orderedQuestions.map(\.id) == [30, 10, 20])
    }

    @Test("With no order at all, questions fall back to their authored order")
    func noOrderFallsBack() throws {
        let bundle = try decode(bundleJSON(questionOrder: []))

        #expect(bundle.orderedQuestions.map(\.id) == [10, 20, 30])
    }

    @Test("A choice decodes from either `id` or `key`")
    func choiceKeyAlias() throws {
        // The runner payload says `id`; the review payload says `key` for the same thing.
        let data = Data(#"[{"id":"A","text":"one"},{"key":"B","text":"two"}]"#.utf8)
        let choices = try JSONCoding.decoder.decode([AssessmentChoice].self, from: data)

        #expect(choices.map(\.id) == ["A", "B"])
    }

    @Test("A decimal result sent as a string still reads as a number")
    func decimalStringsDecode() throws {
        // DRF serialises DecimalField as a string by default. Defaulting to 0 here would
        // tell a student they scored nothing.
        let data = Data(#"{"attempt_id":1,"id":2,"score_points":"7.50","max_points":"10","percent":"75"}"#.utf8)
        let result = try JSONCoding.decoder.decode(AssessmentResult.self, from: data)

        #expect(result.scorePoints == 7.5)
        #expect(result.maxPoints == 10)
        #expect(result.percent == 75)
    }

    @Test("An unknown question type does not take the attempt down")
    func unknownTypeSurvives() throws {
        let data = Data(#"{"id":1,"prompt":"p","question_type":"essay_v2"}"#.utf8)
        let question = try JSONCoding.decoder.decode(AssessmentQuestion.self, from: data)

        #expect(question.questionType == .unknown)
    }
}

@Suite struct JSONValueTests {

    @Test("A whole number goes back out without a decimal point")
    func wholeNumbersStayWhole() throws {
        // The student's own answer is echoed back in review; "12.0" is not what they typed.
        let encoded = try JSONCoding.encoder.encode(JSONValue.number(12))
        #expect(String(decoding: encoded, as: UTF8.self) == "12")
    }

    @Test("A fraction keeps its decimals")
    func fractionsSurvive() throws {
        let encoded = try JSONCoding.encoder.encode(JSONValue.number(10.25))
        #expect(String(decoding: encoded, as: UTF8.self) == "10.25")
    }

    @Test("Null stays null rather than becoming the text \"null\"")
    func nullStaysNull() throws {
        // A "null" string would read as an answered question.
        let encoded = try JSONCoding.encoder.encode(JSONValue.null)
        #expect(String(decoding: encoded, as: UTF8.self) == "null")
        #expect(JSONValue.null.isEmpty)
    }

    @Test("Whitespace-only text counts as unanswered")
    func blankTextIsEmpty() {
        #expect(JSONValue.string("   ").isEmpty)
        #expect(JSONValue.string("2").isEmpty == false)
    }
}

@MainActor
@Suite struct AssessmentRunnerTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func runner(attemptId: Int = 5) -> AssessmentRunner {
        AssessmentRunner(
            attemptId: attemptId,
            api: AssessmentAPI(client: APIClient(
                config: config,
                storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
                session: server.session()
            ))
        )
    }

    @Test("Loading adopts the answers the server already holds")
    func loadAdoptsServerAnswers() async throws {
        // A student may have answered on the web, or on another device. The server's copy
        // is the record; starting blank would look like their work had been lost.
        server.handler = { _ in
            .json(bundleJSON(answers: [["id": 1, "question_id": 10, "answer": "B", "client_seq": 4]]))
        }
        let runner = runner()

        await runner.load()

        #expect(runner.answers[10] == .string("B"))
        #expect(runner.answeredCount == 1)
        #expect(runner.questions.count == 3)
    }

    @Test("An empty stored answer does not count as answered")
    func emptyStoredAnswerIsNotAnswered() async throws {
        server.handler = { _ in
            .json(bundleJSON(answers: [["id": 1, "question_id": 10, "answer": NSNull(), "client_seq": 2]]))
        }
        let runner = runner()

        await runner.load()

        #expect(runner.answeredCount == 0)
    }

    @Test("Picking a choice sends immediately")
    func choiceSendsAtOnce() async throws {
        server.handler = { _ in .json(bundleJSON()) }
        let runner = runner()
        await runner.load()
        server.handler = { _ in .json(["ok": true]) }

        runner.setAnswer(.string("A"), for: 10)
        try await Task.sleep(for: .milliseconds(120))

        let saves = server.requests.filter { $0.url?.absoluteString.contains("/attempts/answer/") == true }
        #expect(saves.count == 1)
        let body = try #require(saves.first?.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["question_id"] as? Int == 10)
        #expect(json["answer"] as? String == "A")
    }

    @Test("Typing coalesces into one write")
    func typingCoalesces() async throws {
        // One request per keystroke would be a request storm on a grid-in.
        server.handler = { _ in .json(bundleJSON()) }
        let runner = runner()
        await runner.load()
        server.handler = { _ in .json(["ok": true]) }

        runner.setAnswer(.string("1"), for: 20, immediate: false)
        runner.setAnswer(.string("12"), for: 20, immediate: false)
        runner.setAnswer(.string("125"), for: 20, immediate: false)
        try await Task.sleep(for: .milliseconds(600))

        let saves = server.requests.filter { $0.url?.absoluteString.contains("/attempts/answer/") == true }
        #expect(saves.count == 1)
        let body = try #require(saves.first?.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["answer"] as? String == "125")
    }

    @Test("Each write carries a higher client_seq than the last")
    func sequencesIncrease() async throws {
        // The server keeps the highest sequence per question, so an answer that overtakes
        // its own replacement on the wire is dropped rather than winning.
        server.handler = { _ in .json(bundleJSON()) }
        let runner = runner()
        await runner.load()
        server.handler = { _ in .json(["ok": true]) }

        runner.setAnswer(.string("A"), for: 10)
        try await Task.sleep(for: .milliseconds(80))
        runner.setAnswer(.string("B"), for: 10)
        try await Task.sleep(for: .milliseconds(80))

        let saves = server.requests.filter { $0.url?.absoluteString.contains("/attempts/answer/") == true }
        let seqs = saves.compactMap { request -> Int? in
            guard let body = request.httpBody,
                  let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            else { return nil }
            return json["client_seq"] as? Int
        }
        #expect(seqs.count == 2)
        #expect(seqs[1] > seqs[0])
    }

    @Test("Submitting flushes unsent answers first")
    func submitFlushesFirst() async throws {
        // A submit that races an unsent answer grades work the server never saw.
        server.handler = { _ in .json(bundleJSON()) }
        let runner = runner()
        await runner.load()
        server.handler = { _ in .json(["ok": true]) }

        runner.setAnswer(.string("late"), for: 30, immediate: false)
        let ok = await runner.submit()

        #expect(ok)
        let paths = server.requests.compactMap { $0.url?.absoluteString }
        let answerIndex = try #require(paths.firstIndex { $0.contains("/attempts/answer/") })
        let submitIndex = try #require(paths.firstIndex { $0.contains("/attempts/submit/") })
        #expect(answerIndex < submitIndex)
    }

    @Test("A failed write is remembered and retried on flush")
    func failedWriteIsRetried() async throws {
        server.handler = { _ in .json(bundleJSON()) }
        let runner = runner()
        await runner.load()

        server.handler = { request in
            request.url?.absoluteString.contains("/attempts/answer/") == true
                ? .json(["detail": "boom"], status: 500)
                : .json(["ok": true])
        }
        runner.setAnswer(.string("A"), for: 10)
        try await Task.sleep(for: .milliseconds(120))
        #expect(runner.unsaved.contains(10))

        server.handler = { _ in .json(["ok": true]) }
        await runner.flush()

        #expect(runner.unsaved.isEmpty)
    }
}

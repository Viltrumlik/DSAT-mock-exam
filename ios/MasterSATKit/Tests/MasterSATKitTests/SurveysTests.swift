import Foundation
import Testing
@testable import MasterSATKit

@Suite struct SurveysAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> SurveysAPI {
        SurveysAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    private func json(_ request: URLRequest) throws -> [String: Any] {
        let body = try #require(request.httpBody)
        return try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    @Test("The open list decodes, price and all")
    func openList() async throws {
        server.handler = { _ in
            .json(["surveys": [
                [
                    "id": 7, "title": "End of term", "description": "Tell us",
                    "closes_at": "2026-09-30T18:00:00+05:00", "question_count": 12,
                    "allow_anonymous": true, "image_url": NSNull(), "points_award": 40,
                ],
                // A survey worth nothing is legitimate — 0 must survive, not become 40.
                ["id": 8, "title": "Phone check", "description": "", "closes_at": NSNull(),
                 "question_count": 1, "allow_anonymous": false, "image_url": "", "points_award": 0],
                // Missing its id: skipped, not the whole list.
                ["title": "Broken"],
            ]])
        }
        let open = try await api().open()
        #expect(open.map(\.id) == [7, 8])
        #expect(open[0].closesDate != nil)
        #expect(open[0].allowAnonymous)
        #expect(open[0].pointsAward == 40)
        #expect(open[1].pointsAward == 0)
        #expect(open[1].closesAt == nil)
        #expect(open[1].imageURL == nil)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/surveys/open/")
    }

    @Test("The form decodes every question type and every shape of condition_value")
    func formDecodes() async throws {
        server.handler = { _ in
            .json([
                "id": 7, "title": "End of term", "description": "", "status": "PUBLISHED",
                "opens_at": NSNull(), "closes_at": NSNull(), "allow_anonymous": true,
                "image_url": "https://r2.example/survey.png?sig=1", "audience_kind": "ALL",
                "audience_level": "", "audience_classrooms": [], "audience_branch": NSNull(),
                "points_award": 40, "created_at": "2026-09-01T09:00:00+05:00",
                "updated_at": "2026-09-01T09:00:00+05:00", "question_count": 6,
                "response_count": 3, "is_open": true, "already_completed": false,
                "questions": [
                    // Listed out of order on purpose.
                    Self.question(id: 5, order: 4, type: "SHORT_TEXT", condition: 2, rule: "ANY_OF", value: ["Teacher"]),
                    Self.question(id: 1, order: 0, type: "RATING", condition: NSNull(), rule: "", value: NSNull(),
                                  extra: ["scale_min": 0, "scale_max": 10, "follow_up_threshold": 8,
                                          "scale_low_label": "Not at all", "scale_high_label": "Definitely"]),
                    Self.question(id: 2, order: 1, type: "MULTI_CHOICE", condition: 1, rule: "AT_LEAST", value: 8,
                                  extra: ["options": ["Teacher", "Exams"], "max_selections": 1,
                                          "follow_up_options": ["Exams"]]),
                    Self.question(id: 3, order: 2, type: "SCALE", condition: 1, rule: "BELOW", value: "7"),
                    Self.question(id: 4, order: 3, type: "DATE", condition: 1, rule: "ANSWERED", value: NSNull()),
                    Self.question(id: 6, order: 5, type: "HOLOGRAM", condition: 1, rule: "AT_LEAST", value: 7.0,
                                  extra: ["options": [1, 2, 3]]),
                ],
            ])
        }
        let survey = try await api().survey(id: 7)
        #expect(survey.questions.map(\.id) == [1, 2, 3, 4, 5, 6])
        #expect(survey.isOpen && !survey.alreadyCompleted)
        #expect(survey.allowAnonymous)
        #expect(survey.imageURL != nil)

        let q = Dictionary(uniqueKeysWithValues: survey.questions.map { ($0.id, $0) })
        #expect(q[1]?.type == .rating)
        #expect(q[1]?.scaleMin == 0 && q[1]?.scaleMax == 10)
        #expect(q[1]?.followUpThreshold == 8)
        #expect(q[1]?.scaleHighLabel == "Definitely")
        #expect(q[1]?.conditionOperator == nil)
        #expect(q[1]?.conditionValue == nil)

        #expect(q[2]?.conditionValue == .number(8))
        #expect(q[2]?.conditionOperator == .atLeast)
        #expect(q[2]?.maxSelections == 1)
        #expect(q[2]?.followUpOptions == ["Exams"])
        #expect(q[3]?.conditionValue == .text("7"))
        #expect(q[4]?.conditionOperator == .answered)
        #expect(q[5]?.conditionValue == .options(["Teacher"]))
        // An unknown type is kept (and drawn as a text box), a float bar reads as int(), and
        // options stored as numbers still render.
        #expect(q[6]?.type == .other("HOLOGRAM"))
        #expect(q[6]?.conditionValue == .number(7))
        #expect(q[6]?.options == ["1", "2", "3"])
    }

    @Test("A malformed question costs that question, not the form")
    func lossyQuestions() async throws {
        server.handler = { _ in
            .json(["id": 7, "title": "T", "is_open": true, "questions": [
                ["prompt": "no id"],
                Self.question(id: 2, order: 0, type: "LONG_TEXT", condition: NSNull(), rule: "", value: NSNull()),
            ]])
        }
        let survey = try await api().survey(id: 7)
        #expect(survey.questions.map(\.id) == [2])
    }

    @Test("A survey that is closed or not aimed at the student is a 404 with its sentence")
    func notOpenIs404() async throws {
        server.handler = { _ in .json(["detail": "That survey is not open."], status: 404) }
        do {
            _ = try await api().survey(id: 7)
            Issue.record("expected a 404")
        } catch APIError.http(let status, let detail) {
            #expect(status == 404)
            #expect(detail == "That survey is not open.")
        }
    }

    @Test("A draft decodes answers keyed by string ids, skipping what it cannot read")
    func draftDecodes() async throws {
        server.handler = { _ in
            .json([
                "answers": ["1": 7, "2": ["Teacher", "Exams"], "3": "2026-09-25", "4": NSNull(), "x": "junk"],
                "follow_ups": ["1": "Too fast", "2": ""],
                "saved_at": "2026-09-25T10:00:00.123456+05:00",
            ])
        }
        let draft = try await api().draft(surveyId: 7)
        #expect(draft.answers == [1: .number(7), 2: .choices(["Teacher", "Exams"]), 3: .text("2026-09-25")])
        #expect(draft.followUps == [1: "Too fast"])
        #expect(draft.savedAt != nil)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/surveys/7/draft/")
    }

    @Test("No draft yet is two empty maps, not an error")
    func emptyDraft() async throws {
        server.handler = { _ in .json(["answers": [:], "follow_ups": [:], "saved_at": NSNull()]) }
        let draft = try await api().draft(surveyId: 7)
        #expect(draft.answers.isEmpty && draft.followUps.isEmpty && draft.savedAt == nil)
    }

    @Test("The autosave is a PUT of both maps, and a 204 with no body is success")
    func saveDraftSends() async throws {
        server.handler = { _ in StubResponse(status: 204, body: Data()) }
        try await api().saveDraft(
            surveyId: 7,
            SurveyPayload(answers: ["1": .number(0), "2": .choices(["A"]), "3": .text("hi")], followUps: ["1": "why"])
        )
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "PUT")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/surveys/7/draft/")
        let body = try json(request)
        let answers = try #require(body["answers"] as? [String: Any])
        #expect(answers["1"] as? Int == 0)
        #expect(answers["2"] as? [String] == ["A"])
        #expect(answers["3"] as? String == "hi")
        #expect(body["follow_ups"] as? [String: String] == ["1": "why"])
        // A draft never carries the anonymity choice.
        #expect(body["anonymous"] == nil)
    }

    @Test("Submitting posts answers, notes and the anonymity wish, and reads what was recorded")
    func respondSends() async throws {
        server.handler = { _ in
            .json(["detail": "Thanks — your answers are recorded.", "response_id": 55, "is_anonymous": false],
                  status: 201)
        }
        let result = try await api().respond(
            surveyId: 7, SurveyPayload(answers: ["1": .number(9)], followUps: [:]), anonymous: true
        )
        // Asked for anonymity; the survey did not allow it; the server says so.
        #expect(result.isAnonymous == false)
        #expect(result.responseId == 55)

        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/surveys/7/respond/")
        let body = try json(request)
        #expect(body["anonymous"] as? Bool == true)
        #expect((body["answers"] as? [String: Any])?["1"] as? Int == 9)
        #expect(body["follow_ups"] as? [String: String] == [:])
    }

    @Test("A refused submission surfaces every reason in one sentence")
    func respondRefused() async throws {
        let joined = "“Name” is required.; “Would you recommend us?” — please add a short note to go with that answer."
        server.handler = { _ in .json(["detail": joined], status: 400) }
        do {
            _ = try await api().respond(surveyId: 7, SurveyPayload(answers: [:], followUps: [:]), anonymous: false)
            Issue.record("expected a refusal")
        } catch let error as APIError {
            #expect(error.errorDescription == joined)
        }
    }

    @Test("An answer encodes as the bare JSON value the server stores")
    func answerEncoding() throws {
        let data = try JSONCoding.encoder.encode(["a": SurveyAnswer.number(3), "b": .text("x"), "c": .choices(["p", "q"])])
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["a"] as? Int == 3)
        #expect(object["b"] as? String == "x")
        #expect(object["c"] as? [String] == ["p", "q"])
    }

    // MARK: - Fixtures

    static func question(
        id: Int, order: Int, type: String, condition: Any, rule: String, value: Any,
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        var q: [String: Any] = [
            "id": id, "order": order, "prompt": "Q\(id)", "help_text": "", "question_type": type,
            "is_required": false, "options": [], "max_selections": 0, "scale_min": 1, "scale_max": 5,
            "image_url": NSNull(), "scale_low_label": "", "scale_high_label": "",
            "follow_up_threshold": NSNull(), "follow_up_placeholder": "", "follow_up_required": false,
            "follow_up_options": [], "condition_question": condition, "condition_operator": rule,
            "condition_value": value,
        ]
        for (key, value) in extra { q[key] = value }
        return q
    }
}

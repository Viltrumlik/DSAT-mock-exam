import Foundation

/// The student's side of `/api/surveys/`.
///
/// Every call needs a signed-in student. Refusals arrive as `{"detail": "…"}` — a submit
/// joins several with "; " — so `APIError.errorDescription` is already the sentence to show.
public struct SurveysAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Published, in-window surveys with questions, aimed at this student and not yet
    /// answered. Newest first.
    public func open() async throws -> [SurveyBrief] {
        try await client.send(.get("/surveys/open/"), as: OpenEnvelope.self).surveys
    }

    /// How many surveys are waiting — what a badge on Home needs.
    public func openCount() async throws -> Int {
        try await open().count
    }

    /// The form. 404 when it is closed, unpublished or not aimed at this student — the
    /// server does not say which, on purpose.
    public func survey(id: Int) async throws -> Survey {
        try await client.send(.get("/surveys/\(id)/"), as: Survey.self)
    }

    /// The saved-but-unsubmitted answers. Empty maps when there is no draft.
    public func draft(surveyId: Int) async throws -> SurveyDraft {
        try await client.send(.get("/surveys/\(surveyId)/draft/"), as: SurveyDraft.self)
    }

    /// The autosave. 204, no body. Lenient on the server: a half-typed or required-but-empty
    /// answer is simply not stored yet, and a late save can never reopen a submitted reply.
    public func saveDraft(surveyId: Int, _ payload: SurveyPayload) async throws {
        let body = try JSONCoding.encoder.encode(Body(payload: payload, anonymous: nil))
        try await client.send(Endpoint(path: "/surveys/\(surveyId)/draft/", method: .put, body: body))
    }

    /// Hand the answers in. One shot and all-or-nothing: a refusal names every problem in one
    /// `detail`, and a second submit is refused as "already completed".
    ///
    /// `anonymous` is a preference; the server honours it only when the survey allows it, and
    /// the result says what it actually recorded.
    public func respond(surveyId: Int, _ payload: SurveyPayload, anonymous: Bool) async throws -> SurveySubmitResult {
        try await client.send(
            .post("/surveys/\(surveyId)/respond/", json: Body(payload: payload, anonymous: anonymous)),
            as: SurveySubmitResult.self
        )
    }

    private struct Body: Encodable, Sendable {
        let answers: [String: SurveyAnswer]
        let followUps: [String: String]
        let anonymous: Bool?

        init(payload: SurveyPayload, anonymous: Bool?) {
            answers = payload.answers
            followUps = payload.followUps
            self.anonymous = anonymous
        }

        enum CodingKeys: String, CodingKey {
            case answers, anonymous
            case followUps = "follow_ups"
        }
    }

    private struct OpenEnvelope: Decodable, Sendable {
        let surveys: [SurveyBrief]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            surveys = (try? c.decodeIfPresent(CommunityLossyList<SurveyBrief>.self, forKey: .surveys))?
                .elements ?? []
        }

        enum CodingKeys: String, CodingKey { case surveys }
    }
}

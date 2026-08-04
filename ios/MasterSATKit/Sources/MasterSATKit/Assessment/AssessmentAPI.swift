import Foundation

/// The assessments runner's transport.
///
/// This is the platform's *second* exam engine and it is not a variant of the first. A
/// pastpaper/mock/midterm is a timed paper of modules submitted as a block; an assessment
/// is a set of questions saved one answer at a time, with no clock and no modules. Sharing
/// one runner between them would mean every rule in either had to be conditional on which
/// kind it was.
public struct AssessmentAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Open or resume an attempt on one attached assessment.
    ///
    /// `homeworkId` targets a specific assessment inside a bundle. Passing the assignment
    /// instead resolves to its first one, which is wrong the moment a homework carries two.
    public func start(homeworkId: Int) async throws -> AssessmentAttempt {
        try await client.send(
            try .post("/assessments/attempts/start/", json: ["homework_id": homeworkId]),
            as: AssessmentAttempt.self
        )
    }

    public func start(assignmentId: Int) async throws -> AssessmentAttempt {
        try await client.send(
            try .post("/assessments/attempts/start/", json: ["assignment_id": assignmentId]),
            as: AssessmentAttempt.self
        )
    }

    /// The questions plus the attempt, in one request.
    public func bundle(attemptId: Int) async throws -> AssessmentBundle {
        try await client.send(.get("/assessments/attempts/\(attemptId)/bundle/"), as: AssessmentBundle.self)
    }

    /// Record one answer.
    ///
    /// `clientSeq` is what makes late arrivals harmless: the server keeps the highest
    /// sequence it has seen per question, so an answer that overtakes its own replacement
    /// on the wire is dropped rather than winning. Without it, "A then B" delivered out of
    /// order silently records A.
    @discardableResult
    public func answer(
        attemptId: Int,
        questionId: Int,
        answer: JSONValue,
        clientSeq: Int,
        currentIndex: Int?
    ) async throws -> Data {
        try await client.send(
            try .post(
                "/assessments/attempts/answer/",
                json: SaveAnswerRequest(
                    attemptId: attemptId,
                    questionId: questionId,
                    answer: answer,
                    clientSeq: clientSeq,
                    currentIndex: currentIndex
                )
            )
        )
    }

    @discardableResult
    public func submit(attemptId: Int) async throws -> Data {
        try await client.send(try .post("/assessments/attempts/submit/", json: ["attempt_id": attemptId]))
    }

    @discardableResult
    public func pause(attemptId: Int) async throws -> Data {
        try await client.send(try .post("/assessments/attempts/pause/", json: ["attempt_id": attemptId]))
    }

    @discardableResult
    public func resume(attemptId: Int) async throws -> Data {
        try await client.send(try .post("/assessments/attempts/resume/", json: ["attempt_id": attemptId]))
    }

    /// The student's own result for one assessment homework.
    public func myResult(homeworkId: Int) async throws -> AssessmentMyResult {
        try await client.send(
            .get("/assessments/homework/by-homework/\(homeworkId)/my-result/"),
            as: AssessmentMyResult.self
        )
    }

    public func myResult(assignmentId: Int) async throws -> AssessmentMyResult {
        try await client.send(
            .get("/assessments/homework/\(assignmentId)/my-result/"),
            as: AssessmentMyResult.self
        )
    }

    /// Question-by-question review, with the answer key and explanations. Only served
    /// once the attempt is graded — before that the server refuses, which is the whole
    /// point of the split runner/review payloads.
    public func review(attemptId: Int) async throws -> AssessmentReview {
        try await client.send(.get("/assessments/attempts/\(attemptId)/review/"), as: AssessmentReview.self)
    }
}

private struct SaveAnswerRequest: Encodable, Sendable {
    let attemptId: Int
    let questionId: Int
    let answer: JSONValue
    let clientSeq: Int
    let currentIndex: Int?

    private enum CodingKeys: String, CodingKey {
        case answer
        case attemptId = "attempt_id"
        case questionId = "question_id"
        case clientSeq = "client_seq"
        case currentIndex = "current_index"
    }
}

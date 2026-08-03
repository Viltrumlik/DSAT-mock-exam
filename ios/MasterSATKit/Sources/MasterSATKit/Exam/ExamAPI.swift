import Foundation

/// Which attempt backend a runner is driving.
///
/// Three Django apps speak the identical attempt protocol — status / start / save_attempt /
/// submit_module — so one runner drives all three and only the base path changes. Port of
/// `createExamApi(base)`.
public enum ExamBackend: String, Sendable, CaseIterable {
    /// Pastpapers and practice tests. The only one that supports pause.
    case exams
    /// The separated single-subject midterm.
    case midterms
    /// The full 4-module mock, with a server-authoritative break.
    case mocks

    var basePath: String {
        switch self {
        case .exams: return "/exams/attempts"
        case .midterms: return "/midterms/attempts"
        case .mocks: return "/mocks/attempts"
        }
    }

    /// Only pastpapers may stop the clock. A mock never pauses — leaving is policed by the
    /// off-screen rule instead — and a midterm refuses it server-side too.
    public var supportsPause: Bool { self == .exams }

    /// Only the full mock has a break phase between the English and Math sections.
    public var hasBreak: Bool { self == .mocks }

    /// Whether leaving the exam is a reportable event on this backend.
    ///
    /// Pastpapers have no `offscreen` endpoint at all — reporting there is a 404. The other
    /// two do, and the CLIENT does not decide whether it counts: a midterm is policed
    /// unconditionally (it publishes no `proctored` flag, because every midterm is
    /// invigilated), and an unproctored mock answers with a harmless tally that burns
    /// nothing. Gating this on the attempt's `proctored` flag silently disabled the rule
    /// for every midterm, since that flag is a mock-only field.
    public var policesOffscreen: Bool {
        switch self {
        case .exams: return false
        case .midterms, .mocks: return true
        }
    }

    /// Midterms may require a teacher's access code before the clock starts.
    public var mayRequireAccessCode: Bool { self == .midterms }
}

/// Answer to "may this attempt begin?" on a code-gated midterm.
public struct AccessCodeCheck: Decodable, Sendable, Equatable {
    public let ok: Bool
    public let requiresCode: Bool

    private enum CodingKeys: String, CodingKey {
        case ok
        case requiresCode = "requires_code"
    }
}

/// What the server says an off-screen event cost the student.
public struct OffscreenTally: Decodable, Sendable, Equatable {
    public let violations: Int
    public let limit: Int
    public let graceSeconds: Int
    public let terminated: Bool
    public let attempt: Attempt?

    private enum CodingKeys: String, CodingKey {
        case violations, limit, terminated, attempt
        case graceSeconds = "grace_seconds"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        violations = (try? c.decodeIfPresent(Int.self, forKey: .violations)) as? Int ?? 0
        limit = (try? c.decodeIfPresent(Int.self, forKey: .limit)) as? Int ?? 3
        graceSeconds = (try? c.decodeIfPresent(Int.self, forKey: .graceSeconds)) as? Int ?? 0
        terminated = (try? c.decodeIfPresent(Bool.self, forKey: .terminated)) as? Bool ?? false
        attempt = try? c.decodeIfPresent(Attempt.self, forKey: .attempt)
    }
}

public struct MockResults: Decodable, Sendable, Equatable {
    public let mockKind: String?
    public let title: String?
    public let englishScore: Double?
    public let mathScore: Double?
    public let totalScore: Double?
    public let scoreCeiling: Double?

    private enum CodingKeys: String, CodingKey {
        case title
        case mockKind = "mock_kind"
        case englishScore = "english_score"
        case mathScore = "math_score"
        case totalScore = "total_score"
        case scoreCeiling = "score_ceiling"
    }
}

/// Typed client for the SAT exam engine.
public struct ExamAPI: Sendable {
    private let client: APIClient
    private let backend: ExamBackend

    public init(client: APIClient, backend: ExamBackend) {
        self.client = client
        self.backend = backend
    }

    private var base: String { backend.basePath }

    // MARK: - Reading

    /// Canonical poll endpoint, falling back to the plain retrieve route.
    public func status(attemptId: Int) async throws -> Attempt {
        do {
            return try await client.send(.get("\(base)/\(attemptId)/status/"), as: Attempt.self)
        } catch {
            // A 404 on /status/ means an older deployment; anything else is real and the
            // retrieve route will raise it again rather than swallow it.
            return try await client.send(.get("\(base)/\(attemptId)/"), as: Attempt.self)
        }
    }

    // MARK: - Lifecycle

    /// Transition NOT_STARTED → active. Idempotent via a persisted key, so relaunching the
    /// app mid-start cannot burn a second attempt.
    public func start(attemptId: Int, idempotencyKey: String? = nil) async throws -> Attempt {
        let key = idempotencyKey ?? IdempotencyKeys.start(attemptId: attemptId)
        return try await client.send(.post("\(base)/\(attemptId)/start/", idempotencyKey: key), as: Attempt.self)
    }

    /// Persist in-progress answers without advancing state.
    public func saveAttempt(
        attemptId: Int,
        answers: [String: String],
        flagged: [Int],
        expectedVersion: Int? = nil,
        idempotencyKey: String? = nil,
        isBackground: Bool = false
    ) async throws -> Attempt {
        let body = SavePayload(
            answers: answers,
            flagged: flagged,
            expectedVersionNumber: expectedVersion,
            background: isBackground ? true : nil
        )
        return try await client.send(
            try .post("\(base)/\(attemptId)/save_attempt/", json: body, idempotencyKey: idempotencyKey),
            as: Attempt.self
        )
    }

    /// Submit the active module → advances state.
    ///
    /// `moduleId` is not optional in practice: the server no-ops a submit prepared for a
    /// module the attempt has already left, and that is the only thing standing between a
    /// retried request and a skipped section. The full mock has four such boundaries.
    public func submitModule(
        attemptId: Int,
        moduleId: Int,
        answers: [String: String],
        flagged: [Int],
        expectedVersion: Int? = nil,
        idempotencyKey: String? = nil
    ) async throws -> Attempt {
        let body = SubmitPayload(
            answers: answers,
            flagged: flagged,
            moduleId: moduleId,
            expectedVersionNumber: expectedVersion
        )
        return try await client.send(
            try .post("\(base)/\(attemptId)/submit_module/", json: body, idempotencyKey: idempotencyKey),
            as: Attempt.self
        )
    }

    // MARK: - Pastpaper-only

    public func pause(attemptId: Int) async throws -> Attempt {
        guard backend.supportsPause else {
            throw APIError.forbidden(detail: "This exam cannot be paused.", reason: "pause_unsupported")
        }
        return try await client.send(.post("\(base)/\(attemptId)/pause/"), as: Attempt.self)
    }

    public func resumeFromPause(attemptId: Int) async throws -> Attempt {
        guard backend.supportsPause else {
            throw APIError.forbidden(detail: "This exam cannot be paused.", reason: "pause_unsupported")
        }
        return try await client.send(.post("\(base)/\(attemptId)/resume_pause/"), as: Attempt.self)
    }

    // MARK: - Mock-only

    /// Proceed from the break into Math.
    public func endBreak(attemptId: Int, idempotencyKey: String? = nil) async throws -> Attempt {
        try await client.send(
            .post("\(base)/\(attemptId)/end_break/", idempotencyKey: idempotencyKey),
            as: Attempt.self
        )
    }

    public func mockResults(attemptId: Int) async throws -> MockResults {
        try await client.send(.get("\(base)/\(attemptId)/results/"), as: MockResults.self)
    }

    // MARK: - Midterm-only

    /// Check the classroom access code before the clock starts.
    ///
    /// A no-op success when the sitting is not code-gated, so the caller can ask without
    /// first knowing. A wrong code is a 403 with the server's own wording — never guessed
    /// at here, because "wrong code" and "the teacher hasn't started the room yet" are
    /// different problems for the student standing in it.
    public func verifyAccessCode(attemptId: Int, code: String) async throws -> AccessCodeCheck {
        try await client.send(
            try .post("\(base)/\(attemptId)/verify_code/", json: AccessCodeRequest(code: code)),
            as: AccessCodeCheck.self
        )
    }

    // MARK: - Proctoring

    /// Report that the student left the exam. Returns what it cost them.
    ///
    /// The client never decides the consequence — it says "they left" and the server
    /// answers with the tally, the grace and whether the paper has just been taken in. The
    /// count lives on the server precisely because a local tally is cleared by relaunching
    /// the app, which is exactly what a student gaming the rule would do.
    public func reportOffscreen(attemptId: Int, idempotencyKey: String) async throws -> OffscreenTally {
        try await client.send(
            .post("\(base)/\(attemptId)/offscreen/", idempotencyKey: idempotencyKey),
            as: OffscreenTally.self
        )
    }
}

// MARK: - Wire payloads

private struct SavePayload: Encodable, Sendable {
    let answers: [String: String]
    let flagged: [Int]
    let expectedVersionNumber: Int?
    let background: Bool?

    private enum CodingKeys: String, CodingKey {
        case answers, flagged, background
        case expectedVersionNumber = "expected_version_number"
    }
}

private struct AccessCodeRequest: Encodable, Sendable {
    let code: String
}

private struct SubmitPayload: Encodable, Sendable {
    let answers: [String: String]
    let flagged: [Int]
    let moduleId: Int
    let expectedVersionNumber: Int?

    private enum CodingKeys: String, CodingKey {
        case answers, flagged
        case moduleId = "module_id"
        case expectedVersionNumber = "expected_version_number"
    }
}

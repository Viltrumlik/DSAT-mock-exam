import Foundation

// The frames on the live-quiz socket. Server → client is `{"type": …, "data": {…}}`
// (`backend/livequiz/consumers.py` + `events.py`); client → server is `{"type": …, …fields}`.
//
// Decoding never throws and never crashes the game: a frame that is not JSON is dropped, a
// type this build does not know is `.unknown`, and a known type whose body is malformed
// reads as `.unknown` too. The server may grow new frames long before this app is updated.

// MARK: - Server → client

/// The whole room, as the server sends it on every (re)connect — and, as the same shape,
/// inside `game_paused`, `game_resumed`, `session_terminated` and `game_finished`.
public struct LiveQuizSnapshot: Sendable, Equatable {
    public let sessionId: Int?
    public let joinCode: String
    public let status: LiveQuizStatus
    public let currentIndex: Int
    public let questionTotal: Int
    public let startedAt: Date?
    public let finishedAt: Date?
    /// The open question's deadline, by the server's clock. Nil unless a question is open.
    public let endsAt: Date?
    public let config: LiveQuizConfig
    public let participants: [LiveQuizParticipant]
    /// Only while a question is open.
    public let question: LiveQuizQuestion?
    /// The receiving player's own row. Trust it ONLY in `session_state`, which is sent to one
    /// socket: the copies inside broadcast frames carry whichever connection built them.
    public let me: LiveQuizParticipant?

    public init(
        sessionId: Int? = nil, joinCode: String = "", status: LiveQuizStatus, currentIndex: Int = -1,
        questionTotal: Int = 0, startedAt: Date? = nil, finishedAt: Date? = nil, endsAt: Date? = nil,
        config: LiveQuizConfig = .defaults, participants: [LiveQuizParticipant] = [],
        question: LiveQuizQuestion? = nil, me: LiveQuizParticipant? = nil
    ) {
        self.sessionId = sessionId
        self.joinCode = joinCode
        self.status = status
        self.currentIndex = currentIndex
        self.questionTotal = questionTotal
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.endsAt = endsAt
        self.config = config
        self.participants = participants
        self.question = question
        self.me = me
    }
}

extension LiveQuizSnapshot: Decodable {
    private enum CodingKeys: String, CodingKey {
        case status, config, participants, question, me
        case sessionId = "session_id"
        case joinCode = "join_code"
        case currentIndex = "current_index"
        case questionTotal = "question_total"
        case startedAt = "started_at"
        case finishedAt = "finished_at"
        case endsAt = "ends_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let raw = LiveQuizDecode.string(c, .status), !raw.isEmpty else {
            throw DecodingError.keyNotFound(
                CodingKeys.status, .init(codingPath: c.codingPath, debugDescription: "a room needs a status")
            )
        }
        status = LiveQuizStatus(raw: raw)
        sessionId = LiveQuizDecode.int(c, .sessionId)
        joinCode = LiveQuizDecode.string(c, .joinCode) ?? ""
        currentIndex = LiveQuizDecode.int(c, .currentIndex) ?? -1
        questionTotal = LiveQuizDecode.int(c, .questionTotal) ?? 0
        startedAt = LiveQuizDecode.date(c, .startedAt)
        finishedAt = LiveQuizDecode.date(c, .finishedAt)
        endsAt = LiveQuizDecode.date(c, .endsAt)
        config = (try? c.decodeIfPresent(LiveQuizConfig.self, forKey: .config)) ?? .defaults
        participants = (try? c.decodeIfPresent(LiveQuizLossyList<LiveQuizParticipant>.self, forKey: .participants))?
            .elements ?? []
        question = (try? c.decodeIfPresent(LiveQuizQuestion.self, forKey: .question)) ?? nil
        me = (try? c.decodeIfPresent(LiveQuizParticipant.self, forKey: .me)) ?? nil
    }
}

/// How the room answered one question — counts only, never names.
public struct LiveQuizTally: Sendable, Equatable, Decodable {
    public let answered: Int
    public let playing: Int
    public let correct: Int
    public let incorrect: Int
    public let byChoice: [String: Int]

    public init(answered: Int = 0, playing: Int = 0, correct: Int = 0, incorrect: Int = 0, byChoice: [String: Int] = [:]) {
        self.answered = answered
        self.playing = playing
        self.correct = correct
        self.incorrect = incorrect
        self.byChoice = byChoice
    }

    private enum CodingKeys: String, CodingKey {
        case answered, playing, correct, incorrect
        case byChoice = "by_choice"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        answered = LiveQuizDecode.int(c, .answered) ?? 0
        playing = LiveQuizDecode.int(c, .playing) ?? 0
        correct = LiveQuizDecode.int(c, .correct) ?? 0
        incorrect = LiveQuizDecode.int(c, .incorrect) ?? 0
        byChoice = ((try? c.decodeIfPresent([String: LiveQuizLossyInt].self, forKey: .byChoice)) ?? nil)?
            .compactMapValues(\.value) ?? [:]
    }
}

/// `question_ended`: the question closes, and now — only now — the key travels. It goes to
/// everyone, even when the teacher turned `reveal_correctness` off.
public struct LiveQuizReveal: Sendable, Equatable {
    public let question: LiveQuizQuestion
    /// "A"…"D".
    public let correctAnswer: String
    /// The word's example sentence. May be empty.
    public let explanation: String
    public let tally: LiveQuizTally

    public init(question: LiveQuizQuestion, correctAnswer: String, explanation: String = "", tally: LiveQuizTally = LiveQuizTally()) {
        self.question = question
        self.correctAnswer = correctAnswer
        self.explanation = explanation
        self.tally = tally
    }

    /// The text of the right option, where the question still has it.
    public var correctChoiceText: String? {
        question.choices.first { $0.id.caseInsensitiveCompare(correctAnswer) == .orderedSame }?.text
    }
}

/// `answer_result` — sent only to the student who answered. `isCorrect` and `pointsAwarded`
/// are present only when the teacher left `reveal_correctness` on.
public struct LiveQuizAnswerResult: Sendable, Equatable {
    public let questionId: Int
    public let accepted: Bool
    public let responseTimeMs: Int?
    public let isCorrect: Bool?
    public let pointsAwarded: Int?

    public init(questionId: Int, accepted: Bool = true, responseTimeMs: Int? = nil, isCorrect: Bool? = nil, pointsAwarded: Int? = nil) {
        self.questionId = questionId
        self.accepted = accepted
        self.responseTimeMs = responseTimeMs
        self.isCorrect = isCorrect
        self.pointsAwarded = pointsAwarded
    }
}

/// Everything the server can say. Decoded with `LiveQuizServerMessage.decode(_:)`.
public enum LiveQuizServerMessage: Sendable, Equatable {
    /// On every connect: the whole room, from cold.
    case sessionState(LiveQuizSnapshot)
    /// `participant_joined`, `participant_left`, `lobby_updated` — the players in the room.
    case lobby(participants: [LiveQuizParticipant])
    case gameStarted(countdownSeconds: Int)
    case questionStarted(question: LiveQuizQuestion, startedAt: Date?, endsAt: Date?)
    case timeWarning(secondsLeft: Int)
    case answerResult(LiveQuizAnswerResult)
    case questionEnded(LiveQuizReveal)
    /// Ordered by score, highest first, then by who joined first.
    case leaderboard(rows: [LiveQuizParticipant])
    case paused(LiveQuizSnapshot)
    /// Carries the deadline pushed back by the length of the pause.
    case resumed(LiveQuizSnapshot)
    case terminated(LiveQuizSnapshot?)
    /// Final places are in `rows` (with `rank`). `session.me` is NOT this student.
    case finished(rows: [LiveQuizParticipant], session: LiveQuizSnapshot?)
    /// Broadcast to the whole room; it is only about us when the id is ours.
    case removed(participantId: Int)
    case error(code: String, detail: String)
    case pong(serverTime: Date?)
    /// A frame this build does not understand, or one whose body did not make sense.
    case unknown(type: String)

    /// The frame in `text`, or nil when it is not a frame at all (not JSON, no type).
    public static func decode(_ text: String) -> LiveQuizServerMessage? {
        decode(Data(text.utf8))
    }

    public static func decode(_ data: Data) -> LiveQuizServerMessage? {
        guard let envelope = try? JSONCoding.decoder.decode(Envelope.self, from: data) else { return nil }
        return envelope.message
    }

    /// Decodes `type`, then `data` by it. A body that fails to decode becomes `.unknown`.
    private struct Envelope: Decodable {
        let message: LiveQuizServerMessage

        private enum CodingKeys: String, CodingKey { case type, data }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let type = try c.decode(String.self, forKey: .type)
            func body<T: Decodable>(_: T.Type) -> T? { (try? c.decodeIfPresent(T.self, forKey: .data)) ?? nil }

            let decoded: LiveQuizServerMessage?
            switch type {
            case "session_state":
                decoded = body(LiveQuizSnapshot.self).map { .sessionState($0) }
            case "participant_joined", "participant_left", "lobby_updated":
                decoded = body(LobbyBody.self).map { .lobby(participants: $0.participants) }
            case "game_started":
                decoded = .gameStarted(countdownSeconds: body(CountdownBody.self)?.seconds ?? 3)
            case "question_started":
                decoded = body(QuestionStartedBody.self).map {
                    .questionStarted(question: $0.question, startedAt: $0.startedAt, endsAt: $0.endsAt)
                }
            case "question_time_warning":
                decoded = .timeWarning(secondsLeft: body(WarningBody.self)?.secondsLeft ?? 5)
            case "answer_result":
                decoded = body(AnswerResultBody.self).map { .answerResult($0.result) }
            case "question_ended":
                decoded = body(QuestionEndedBody.self).map { .questionEnded($0.reveal) }
            case "leaderboard_updated":
                decoded = body(RowsBody.self).map { .leaderboard(rows: $0.rows) }
            case "game_paused":
                decoded = body(LiveQuizSnapshot.self).map { .paused($0) }
            case "game_resumed":
                decoded = body(LiveQuizSnapshot.self).map { .resumed($0) }
            case "session_terminated":
                decoded = .terminated(body(LiveQuizSnapshot.self))
            case "game_finished":
                let finished = body(FinishedBody.self)
                decoded = .finished(rows: finished?.rows ?? [], session: finished?.session)
            case "removed_from_session":
                decoded = body(RemovedBody.self).map { .removed(participantId: $0.participantId) }
            case "error":
                let error = body(ErrorBody.self)
                decoded = .error(code: error?.code ?? "", detail: error?.detail ?? "")
            case "pong":
                decoded = .pong(serverTime: body(PongBody.self)?.ts)
            default:
                decoded = nil
            }
            message = decoded ?? .unknown(type: type)
        }
    }

    // MARK: Bodies

    private struct LobbyBody: Decodable {
        let participants: [LiveQuizParticipant]
        private enum CodingKeys: String, CodingKey { case participants }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard let list = try c.decodeIfPresent(LiveQuizLossyList<LiveQuizParticipant>.self, forKey: .participants) else {
                throw DecodingError.keyNotFound(CodingKeys.participants, .init(codingPath: c.codingPath, debugDescription: "no list"))
            }
            participants = list.elements
        }
    }

    private struct CountdownBody: Decodable {
        let seconds: Int?
        private enum CodingKeys: String, CodingKey { case seconds = "countdown_seconds" }
        init(from decoder: Decoder) throws {
            seconds = LiveQuizDecode.int(try decoder.container(keyedBy: CodingKeys.self), .seconds)
        }
    }

    private struct QuestionStartedBody: Decodable {
        let question: LiveQuizQuestion
        let startedAt: Date?
        let endsAt: Date?
        private enum CodingKeys: String, CodingKey {
            case question
            case startedAt = "started_at"
            case endsAt = "ends_at"
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            question = try c.decode(LiveQuizQuestion.self, forKey: .question)
            startedAt = LiveQuizDecode.date(c, .startedAt)
            endsAt = LiveQuizDecode.date(c, .endsAt)
        }
    }

    private struct WarningBody: Decodable {
        let secondsLeft: Int?
        private enum CodingKeys: String, CodingKey { case secondsLeft = "seconds_left" }
        init(from decoder: Decoder) throws {
            secondsLeft = LiveQuizDecode.int(try decoder.container(keyedBy: CodingKeys.self), .secondsLeft)
        }
    }

    private struct AnswerResultBody: Decodable {
        let result: LiveQuizAnswerResult
        private enum CodingKeys: String, CodingKey {
            case accepted
            case questionId = "question_id"
            case responseTimeMs = "response_time_ms"
            case isCorrect = "is_correct"
            case pointsAwarded = "points_awarded"
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            result = LiveQuizAnswerResult(
                questionId: try LiveQuizDecode.requiredInt(c, .questionId),
                accepted: LiveQuizDecode.bool(c, .accepted) ?? true,
                responseTimeMs: LiveQuizDecode.int(c, .responseTimeMs),
                isCorrect: LiveQuizDecode.bool(c, .isCorrect),
                pointsAwarded: LiveQuizDecode.int(c, .pointsAwarded)
            )
        }
    }

    private struct QuestionEndedBody: Decodable {
        let reveal: LiveQuizReveal
        private enum CodingKeys: String, CodingKey {
            case question, explanation, tally
            case correctAnswer = "correct_answer"
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            reveal = LiveQuizReveal(
                question: try c.decode(LiveQuizQuestion.self, forKey: .question),
                correctAnswer: LiveQuizDecode.string(c, .correctAnswer) ?? "",
                explanation: LiveQuizDecode.string(c, .explanation) ?? "",
                tally: ((try? c.decodeIfPresent(LiveQuizTally.self, forKey: .tally)) ?? nil) ?? LiveQuizTally()
            )
        }
    }

    private struct RowsBody: Decodable {
        let rows: [LiveQuizParticipant]
        private enum CodingKeys: String, CodingKey { case rows }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            rows = (try? c.decodeIfPresent(LiveQuizLossyList<LiveQuizParticipant>.self, forKey: .rows))?.elements ?? []
        }
    }

    private struct FinishedBody: Decodable {
        let rows: [LiveQuizParticipant]
        let session: LiveQuizSnapshot?
        private enum CodingKeys: String, CodingKey { case leaderboard, session }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            rows = ((try? c.decodeIfPresent(RowsBody.self, forKey: .leaderboard)) ?? nil)?.rows ?? []
            session = (try? c.decodeIfPresent(LiveQuizSnapshot.self, forKey: .session)) ?? nil
        }
    }

    private struct RemovedBody: Decodable {
        let participantId: Int
        private enum CodingKeys: String, CodingKey { case participantId = "participant_id" }
        init(from decoder: Decoder) throws {
            participantId = try LiveQuizDecode.requiredInt(try decoder.container(keyedBy: CodingKeys.self), .participantId)
        }
    }

    private struct ErrorBody: Decodable {
        let code: String?
        let detail: String?
        private enum CodingKeys: String, CodingKey { case code, detail }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = LiveQuizDecode.string(c, .code)
            detail = LiveQuizDecode.string(c, .detail)
        }
    }

    private struct PongBody: Decodable {
        let ts: Date?
        private enum CodingKeys: String, CodingKey { case ts }
        init(from decoder: Decoder) throws {
            ts = LiveQuizDecode.date(try decoder.container(keyedBy: CodingKeys.self), .ts)
        }
    }
}

/// A count that may arrive as a number or a numeric string, or be junk.
struct LiveQuizLossyInt: Decodable, Sendable {
    let value: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) {
            value = i
        } else if let d = try? c.decode(Double.self), d.isFinite {
            value = Int(d.rounded())
        } else if let s = try? c.decode(String.self) {
            value = Int(s)
        } else {
            value = nil
        }
    }
}

// MARK: - Client → server

/// What a student may send. The host's commands are refused server-side (`not_host`), so the
/// app never builds them.
public enum LiveQuizClientMessage: Sendable, Equatable {
    /// Every 25 s; answered with `pong`, which also tells us the server's clock.
    case heartbeat
    case submitAnswer(questionId: Int, answer: String)
    /// The server closes the socket (1000). The place in the room is kept.
    case leaveSession

    /// The frame as text, ready for the socket.
    public var text: String {
        let object: [String: Any]
        switch self {
        case .heartbeat:
            object = ["type": "heartbeat"]
        case .submitAnswer(let questionId, let answer):
            object = ["type": "submit_answer", "question_id": questionId, "answer": answer]
        case .leaveSession:
            object = ["type": "leave_session"]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
}

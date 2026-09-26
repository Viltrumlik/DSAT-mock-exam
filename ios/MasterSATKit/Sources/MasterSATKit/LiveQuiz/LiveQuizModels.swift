import Foundation

// Live quiz — the web's `/live`. A teacher runs a vocabulary quiz room; students join by code
// and play it in real time. REST (`/api/livequiz/…`) finds the room and exchanges the code for
// a session id; everything that happens during the game arrives over the WebSocket
// (`LiveQuizConnection`). Shapes follow `backend/livequiz/{serializers,events}.py`.

// MARK: - Status

/// Where the room is. The server's `LiveQuizSession.status`, always upper-case on the wire
/// but compared case-insensitively here — casing differs between apps on this platform.
public enum LiveQuizStatus: Sendable, Equatable, Hashable {
    case lobby
    /// The three-second countdown before question one.
    case starting
    case questionActive
    case questionResults
    case paused
    case finished
    /// Stopped by the teacher before (or instead of) finishing. Final, and cannot be rejoined.
    case terminated
    case unknown(String)

    public init(raw: String) {
        switch raw.uppercased() {
        case "LOBBY": self = .lobby
        case "STARTING": self = .starting
        case "QUESTION_ACTIVE": self = .questionActive
        case "QUESTION_RESULTS": self = .questionResults
        case "PAUSED": self = .paused
        case "FINISHED": self = .finished
        case "TERMINATED": self = .terminated
        default: self = .unknown(raw)
        }
    }

    /// The room is still running — it can be joined, rejoined and played.
    public var isLive: Bool {
        switch self {
        case .lobby, .starting, .questionActive, .questionResults, .paused: return true
        case .finished, .terminated, .unknown: return false
        }
    }
}

// MARK: - Configuration

/// How the teacher set the room up. Every key falls back to the server's own default
/// (`livequiz.constants.CONFIG_DEFAULTS`), so a room created before a key existed still reads.
public struct LiveQuizConfig: Sendable, Equatable, Hashable, Decodable {
    public var questionSeconds: Int
    public var speedBonusRatio: Double
    /// Off (the default): the first answer is final and a second one is refused.
    public var allowAnswerChange: Bool
    public var showLeaderboardBetween: Bool
    /// Off turns the round silent: the student is told their answer landed, not whether it
    /// was right, until the final board.
    public var revealCorrectness: Bool
    public var shuffleQuestions: Bool
    public var manualAdvance: Bool

    public init(
        questionSeconds: Int = 20, speedBonusRatio: Double = 0.5, allowAnswerChange: Bool = false,
        showLeaderboardBetween: Bool = true, revealCorrectness: Bool = true,
        shuffleQuestions: Bool = false, manualAdvance: Bool = true
    ) {
        self.questionSeconds = questionSeconds
        self.speedBonusRatio = speedBonusRatio
        self.allowAnswerChange = allowAnswerChange
        self.showLeaderboardBetween = showLeaderboardBetween
        self.revealCorrectness = revealCorrectness
        self.shuffleQuestions = shuffleQuestions
        self.manualAdvance = manualAdvance
    }

    public static let defaults = LiveQuizConfig()

    private enum CodingKeys: String, CodingKey {
        case questionSeconds = "question_seconds"
        case speedBonusRatio = "speed_bonus_ratio"
        case allowAnswerChange = "allow_answer_change"
        case showLeaderboardBetween = "show_leaderboard_between"
        case revealCorrectness = "reveal_correctness"
        case shuffleQuestions = "shuffle_questions"
        case manualAdvance = "manual_advance"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = LiveQuizConfig.defaults
        questionSeconds = LiveQuizDecode.int(c, .questionSeconds) ?? d.questionSeconds
        speedBonusRatio = LiveQuizDecode.double(c, .speedBonusRatio) ?? d.speedBonusRatio
        allowAnswerChange = LiveQuizDecode.bool(c, .allowAnswerChange) ?? d.allowAnswerChange
        showLeaderboardBetween = LiveQuizDecode.bool(c, .showLeaderboardBetween) ?? d.showLeaderboardBetween
        revealCorrectness = LiveQuizDecode.bool(c, .revealCorrectness) ?? d.revealCorrectness
        shuffleQuestions = LiveQuizDecode.bool(c, .shuffleQuestions) ?? d.shuffleQuestions
        manualAdvance = LiveQuizDecode.bool(c, .manualAdvance) ?? d.manualAdvance
    }
}

// MARK: - Rooms (REST)

/// One room, as `join/` and `mine/` describe it. No questions and no key.
public struct LiveQuizSummary: Sendable, Equatable, Hashable, Identifiable, Decodable {
    public let id: Int
    /// Absent on the student's `mine/` list — a list of live codes is a leak.
    public let joinCode: String?
    public let status: LiveQuizStatus
    public let classroomId: Int?
    public let classroomName: String
    public let vocabSetId: Int?
    /// The vocabulary set's title — what the web calls the quiz.
    public let title: String
    public let currentIndex: Int
    public let questionTotal: Int?
    public let config: LiveQuizConfig
    public let createdAt: String?
    public let startedAt: String?
    public let finishedAt: String?
    public let participantCount: Int
    public let presentCount: Int

    public init(
        id: Int, joinCode: String? = nil, status: LiveQuizStatus = .lobby, classroomId: Int? = nil,
        classroomName: String = "", vocabSetId: Int? = nil, title: String = "", currentIndex: Int = -1,
        questionTotal: Int? = nil, config: LiveQuizConfig = .defaults, createdAt: String? = nil,
        startedAt: String? = nil, finishedAt: String? = nil, participantCount: Int = 0, presentCount: Int = 0
    ) {
        self.id = id
        self.joinCode = joinCode
        self.status = status
        self.classroomId = classroomId
        self.classroomName = classroomName
        self.vocabSetId = vocabSetId
        self.title = title
        self.currentIndex = currentIndex
        self.questionTotal = questionTotal
        self.config = config
        self.createdAt = createdAt
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.participantCount = participantCount
        self.presentCount = presentCount
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, title, config, counts
        case joinCode = "join_code"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
        case vocabSetId = "vocab_set_id"
        case currentIndex = "current_index"
        case questionTotal = "question_total"
        case createdAt = "created_at"
        case startedAt = "started_at"
        case finishedAt = "finished_at"
    }

    private enum CountKeys: String, CodingKey { case participants, present }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try LiveQuizDecode.requiredInt(c, .id)
        joinCode = LiveQuizDecode.string(c, .joinCode).flatMap { $0.isEmpty ? nil : $0 }
        status = LiveQuizStatus(raw: LiveQuizDecode.string(c, .status) ?? "")
        classroomId = LiveQuizDecode.int(c, .classroomId)
        classroomName = LiveQuizDecode.string(c, .classroomName) ?? ""
        vocabSetId = LiveQuizDecode.int(c, .vocabSetId)
        title = LiveQuizDecode.string(c, .title) ?? ""
        currentIndex = LiveQuizDecode.int(c, .currentIndex) ?? -1
        questionTotal = LiveQuizDecode.int(c, .questionTotal)
        config = (try? c.decodeIfPresent(LiveQuizConfig.self, forKey: .config)) ?? .defaults
        createdAt = LiveQuizDecode.string(c, .createdAt)
        startedAt = LiveQuizDecode.string(c, .startedAt)
        finishedAt = LiveQuizDecode.string(c, .finishedAt)
        let counts = try? c.nestedContainer(keyedBy: CountKeys.self, forKey: .counts)
        participantCount = counts.flatMap { LiveQuizDecode.int($0, .participants) } ?? 0
        presentCount = counts.flatMap { LiveQuizDecode.int($0, .present) } ?? 0
    }
}

/// What `POST /livequiz/join/` hands back: the room, and the student's place in it.
public struct LiveQuizJoin: Sendable, Equatable, Decodable {
    public let session: LiveQuizSummary
    public let participantId: Int?
    public let displayName: String
    public let score: Int

    public init(session: LiveQuizSummary, participantId: Int?, displayName: String = "", score: Int = 0) {
        self.session = session
        self.participantId = participantId
        self.displayName = displayName
        self.score = score
    }

    private enum CodingKeys: String, CodingKey { case session, participant }
    private enum ParticipantKeys: String, CodingKey {
        case id, score
        case displayName = "display_name"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        session = try c.decode(LiveQuizSummary.self, forKey: .session)
        let p = try? c.nestedContainer(keyedBy: ParticipantKeys.self, forKey: .participant)
        participantId = p.flatMap { LiveQuizDecode.int($0, .id) }
        displayName = p.flatMap { LiveQuizDecode.string($0, .displayName) } ?? ""
        score = p.flatMap { LiveQuizDecode.int($0, .score) } ?? 0
    }
}

/// `GET /livequiz/sessions/<id>/results/` — the room, and the student's own row of the
/// report (the server strips everybody else's). Used to learn why a socket was refused.
public struct LiveQuizResults: Sendable, Equatable, Decodable {
    public let session: LiveQuizSummary
    /// The student's own row, when they have a place in the room. Empty for a student who
    /// never joined or was removed — the report leaves out removed players.
    public let myRows: [LiveQuizParticipant]
    public let questionCount: Int

    public init(session: LiveQuizSummary, myRows: [LiveQuizParticipant] = [], questionCount: Int = 0) {
        self.session = session
        self.myRows = myRows
        self.questionCount = questionCount
    }

    private enum CodingKeys: String, CodingKey { case session, report }
    private enum ReportKeys: String, CodingKey { case participants, questions }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        session = try c.decode(LiveQuizSummary.self, forKey: .session)
        let report = try? c.nestedContainer(keyedBy: ReportKeys.self, forKey: .report)
        myRows = (report.flatMap { try? $0.decodeIfPresent(LiveQuizLossyList<LiveQuizParticipant>.self, forKey: .participants) })?
            .elements ?? []
        questionCount = (report.flatMap { try? $0.decodeIfPresent(LiveQuizLossyList<LiveQuizIgnored>.self, forKey: .questions) })?
            .elements.count ?? 0
    }
}

// MARK: - People and questions (socket)

/// One player (`events.participant_row`). The REST report's rows use `participant_id` for
/// the same field, and both are read.
public struct LiveQuizParticipant: Sendable, Equatable, Hashable, Identifiable, Decodable {
    public let id: Int
    public let userId: Int?
    public let displayName: String
    /// "JOINED" | "LEFT" | "KICKED". Removed players are left out of every list.
    public let status: String
    /// Has a socket open right now.
    public let present: Bool
    public let score: Int
    public let correctCount: Int
    public let answeredCount: Int
    /// The final place, shared on a tie (1, 2, 2, 4). Nil until the game finishes.
    public let rank: Int?

    public init(
        id: Int, userId: Int? = nil, displayName: String = "", status: String = "JOINED",
        present: Bool = true, score: Int = 0, correctCount: Int = 0, answeredCount: Int = 0, rank: Int? = nil
    ) {
        self.id = id
        self.userId = userId
        self.displayName = displayName
        self.status = status
        self.present = present
        self.score = score
        self.correctCount = correctCount
        self.answeredCount = answeredCount
        self.rank = rank
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, present, score, rank
        case participantId = "participant_id"
        case userId = "user_id"
        case displayName = "display_name"
        case correctCount = "correct_count"
        case answeredCount = "answered_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = LiveQuizDecode.int(c, .id) ?? LiveQuizDecode.int(c, .participantId) else {
            throw DecodingError.keyNotFound(
                CodingKeys.id, .init(codingPath: c.codingPath, debugDescription: "a participant needs an id")
            )
        }
        self.id = id
        userId = LiveQuizDecode.int(c, .userId)
        displayName = LiveQuizDecode.string(c, .displayName) ?? ""
        status = LiveQuizDecode.string(c, .status) ?? "JOINED"
        present = LiveQuizDecode.bool(c, .present) ?? false
        score = LiveQuizDecode.int(c, .score) ?? 0
        correctCount = LiveQuizDecode.int(c, .correctCount) ?? 0
        answeredCount = LiveQuizDecode.int(c, .answeredCount) ?? 0
        rank = LiveQuizDecode.int(c, .rank)
    }
}

/// One option: `{"id": "A", "text": "abate"}`.
public struct LiveQuizChoice: Sendable, Equatable, Hashable, Identifiable, Decodable {
    public let id: String
    public let text: String

    public init(id: String, text: String) {
        self.id = id
        self.text = text
    }

    private enum CodingKeys: String, CodingKey { case id, text }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = LiveQuizDecode.string(c, .id), !id.isEmpty else {
            throw DecodingError.keyNotFound(
                CodingKeys.id, .init(codingPath: c.codingPath, debugDescription: "a choice needs an id")
            )
        }
        self.id = id
        text = LiveQuizDecode.string(c, .text) ?? ""
    }
}

/// A question as a player may see it (`events.public_question`) — deliberately without the
/// answer key, which only travels in `question_ended`.
public struct LiveQuizQuestion: Sendable, Equatable, Hashable, Identifiable, Decodable {
    public let id: Int
    /// 0-based.
    public let index: Int
    public let total: Int
    /// The definition (asking for the word) or the word (asking for the meaning).
    public let prompt: String
    /// "Which word means this?" / "What does this word mean?"
    public let questionPrompt: String
    public let questionType: String
    public let choices: [LiveQuizChoice]
    public let points: Int
    public let timeLimitSeconds: Int
    /// "definition_to_word" | "word_to_definition".
    public let form: String

    public init(
        id: Int, index: Int = 0, total: Int = 0, prompt: String = "", questionPrompt: String = "",
        questionType: String = "multiple_choice", choices: [LiveQuizChoice] = [], points: Int = 1,
        timeLimitSeconds: Int = 20, form: String = ""
    ) {
        self.id = id
        self.index = index
        self.total = total
        self.prompt = prompt
        self.questionPrompt = questionPrompt
        self.questionType = questionType
        self.choices = choices
        self.points = points
        self.timeLimitSeconds = timeLimitSeconds
        self.form = form
    }

    /// "Question 3 of 10" — 1-based for people.
    public var number: Int { index + 1 }

    private enum CodingKeys: String, CodingKey {
        case id, index, total, prompt, choices, points, form
        case questionPrompt = "question_prompt"
        case questionType = "question_type"
        case timeLimitSeconds = "time_limit_seconds"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try LiveQuizDecode.requiredInt(c, .id)
        index = LiveQuizDecode.int(c, .index) ?? 0
        total = LiveQuizDecode.int(c, .total) ?? 0
        prompt = LiveQuizDecode.string(c, .prompt) ?? ""
        questionPrompt = LiveQuizDecode.string(c, .questionPrompt) ?? ""
        questionType = LiveQuizDecode.string(c, .questionType) ?? "multiple_choice"
        choices = (try? c.decodeIfPresent(LiveQuizLossyList<LiveQuizChoice>.self, forKey: .choices))?.elements ?? []
        points = LiveQuizDecode.int(c, .points) ?? 1
        timeLimitSeconds = LiveQuizDecode.int(c, .timeLimitSeconds) ?? 0
        form = LiveQuizDecode.string(c, .form) ?? ""
    }
}

// MARK: - Decoding helpers

/// Lenient field readers. A value of the wrong type reads as absent rather than failing the
/// whole frame: one odd field must cost that field, not the student's view of the game.
enum LiveQuizDecode {
    static func int<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Int? {
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Double.self, forKey: key), v.isFinite { return Int(v.rounded()) }
        if let v = try? c.decodeIfPresent(String.self, forKey: key) {
            let trimmed = v.trimmingCharacters(in: .whitespaces)
            if let i = Int(trimmed) { return i }
            if let d = Double(trimmed), d.isFinite { return Int(d.rounded()) }
        }
        return nil
    }

    static func requiredInt<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) throws -> Int {
        guard let value = int(c, key) else {
            throw DecodingError.keyNotFound(key, .init(codingPath: c.codingPath, debugDescription: "missing \(key.stringValue)"))
        }
        return value
    }

    static func double<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Double? {
        if let v = try? c.decodeIfPresent(Double.self, forKey: key), v.isFinite { return v }
        if let v = try? c.decodeIfPresent(String.self, forKey: key), let d = Double(v), d.isFinite { return d }
        return nil
    }

    static func bool<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Bool? {
        if let v = try? c.decodeIfPresent(Bool.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return v != 0 }
        if let v = try? c.decodeIfPresent(String.self, forKey: key) {
            switch v.lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }

    static func string<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> String? {
        if let v = try? c.decodeIfPresent(String.self, forKey: key) { return v }
        if let v = try? c.decodeIfPresent(Int.self, forKey: key) { return String(v) }
        return nil
    }

    static func date<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Date? {
        string(c, key).flatMap(JSONCoding.parseServerDate)
    }
}

/// An array that keeps the elements it can read and skips the rest.
struct LiveQuizLossyList<Element: Decodable>: Decodable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        while !c.isAtEnd {
            if let element = try? c.decode(Element.self) {
                out.append(element)
            } else {
                // A failed decode does not advance the container; this always succeeds and does.
                _ = try? c.decode(LiveQuizIgnored.self)
            }
        }
        elements = out
    }
}

/// Accepts any JSON value and keeps nothing.
struct LiveQuizIgnored: Decodable {
    init(from decoder: Decoder) throws {}
}

extension LiveQuizLossyList: Sendable where Element: Sendable {}

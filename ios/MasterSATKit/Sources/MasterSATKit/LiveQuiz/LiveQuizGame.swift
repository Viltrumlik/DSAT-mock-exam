import Foundation

/// What the student's screen shows.
public enum LiveQuizPhase: Sendable, Equatable {
    /// Nothing heard from the room yet — "Joining the quiz…".
    case connecting
    /// "You are in." — waiting for the teacher to start.
    case lobby
    /// The three-second countdown before question one — "Get ready…".
    case starting
    /// A question is open and on screen.
    case question
    /// The question just closed: the student's result, the answer, the standings.
    case results
    /// Between questions without a result to show — reconnected while the results were up.
    case waitingForNext
    case paused
    case finished
    /// The teacher stopped the room.
    case terminated
    /// The teacher took this student out of the room.
    case removed

    /// Nothing more will happen in this room.
    public var isFinal: Bool {
        switch self {
        case .finished, .terminated, .removed: return true
        default: return false
        }
    }
}

/// The student's own answer to one question, as far as this phone knows it.
public struct LiveQuizMyAnswer: Sendable, Equatable {
    public enum State: Sendable, Equatable {
        /// Handed to the socket; the server has not answered yet.
        case sending
        /// The server recorded it.
        case accepted
        /// The server refused it (`too_late`, `bad_state`, `unknown_question`): it did not count.
        case refused(code: String)
    }

    /// "A"…"D". Nil only when the server said "already answered" to an answer this phone
    /// never sent — given on another device.
    public var choice: String?
    public var state: State
    /// Present only when the teacher left `reveal_correctness` on.
    public var isCorrect: Bool?
    public var pointsAwarded: Int?
    public var responseTimeMs: Int?

    public init(choice: String?, state: State, isCorrect: Bool? = nil, pointsAwarded: Int? = nil, responseTimeMs: Int? = nil) {
        self.choice = choice
        self.state = state
        self.isCorrect = isCorrect
        self.pointsAwarded = pointsAwarded
        self.responseTimeMs = responseTimeMs
    }
}

/// The headline of the results card.
public enum LiveQuizOutcome: Sendable, Equatable {
    /// "Correct" and "+N" — `points` is nil when the score for it never reached this phone.
    case correct(points: Int?)
    /// "Not this time — The answer was B".
    case notThisTime(correctAnswer: String)
    /// "Time ran out — The answer was B": no answer counted.
    case timeRanOut(correctAnswer: String)
    /// The answer counted, but the teacher keeps right and wrong for the end
    /// (`reveal_correctness` off) — so the card must not give it away.
    case answerIn
}

/// An `error` frame worth showing under the question — "Time is up for that question."
public struct LiveQuizNotice: Sendable, Equatable {
    public let code: String
    public let detail: String

    public init(code: String, detail: String) {
        self.code = code
        self.detail = detail
    }
}

/// The student's picture of the room, rebuilt from the server's frames and nothing else.
///
/// Pure: no socket, no timers, no clock of its own — every method that needs "now" is handed
/// it, so the whole game is testable frame by frame. Nothing here decides whether an answer
/// was right, whether time is up, or what anybody scored; the server does, and this only
/// remembers what it said. Three things it adds to what the web keeps, all from
/// `part3 … f) Live quiz`'s porting notes:
///
/// - **Which questions this phone answered.** A reconnect mid-question does not say whether
///   the student already answered, so the answer is remembered here, an `already_answered`
///   refusal reads as "locked", and an answer that was in flight when the line dropped is
///   sent again when the room comes back (the server refuses a true duplicate).
/// - **The server's clock.** The countdown is the server's deadline moved onto this phone's
///   clock by the offset a heartbeat's round trip measures — not the device clock read
///   against a server timestamp, which is what the web does and is wrong on a phone whose
///   clock is out.
/// - **Whose row is ours.** `me` is taken only from `session_state`, which is sent to this
///   socket alone. The copies inside broadcast frames belong to whichever connection built
///   them — `game_finished` can carry a classmate's row as `me`.
public struct LiveQuizGame: Sendable, Equatable {
    /// The server still counts an answer this long after the deadline (`LATE_ANSWER_GRACE_MS`).
    public static let lateAnswerGrace: TimeInterval = 0.75
    /// The countdown turns urgent this close to the deadline (`TIME_WARNING_SECONDS`).
    public static let warningSeconds: TimeInterval = 5
    /// A heartbeat's round trip longer than this measures the network, not the clock.
    public static let usableRoundTrip: TimeInterval = 3

    public let sessionId: Int
    /// This student's place in the room: from `join/`, then from `session_state.me`.
    public private(set) var participantId: Int?
    public private(set) var userId: Int?

    /// Nil until the first `session_state`.
    public private(set) var status: LiveQuizStatus?
    public private(set) var joinCode = ""
    public private(set) var config = LiveQuizConfig.defaults
    public private(set) var currentIndex = -1
    public private(set) var questionTotal = 0
    /// The open question. Nil whenever none is open.
    public private(set) var question: LiveQuizQuestion?
    /// Everyone in the room — "N in the room".
    public private(set) var participants: [LiveQuizParticipant] = []
    /// Highest score first. Between questions, and the final board once the game is over.
    public private(set) var standings: [LiveQuizParticipant] = []
    /// The closed question's answer, for the results card.
    public private(set) var reveal: LiveQuizReveal?
    /// This phone's answers, by question id.
    public private(set) var answers: [Int: LiveQuizMyAnswer] = [:]
    /// The server's five-second warning arrived for the open question.
    public private(set) var timeWarning = false
    public private(set) var isRemoved = false
    /// The last refusal worth showing. Cleared by the next question or an accepted answer.
    public private(set) var notice: LiveQuizNotice?
    /// Server clock minus this phone's clock, from the latest usable heartbeat.
    public private(set) var clockOffset: TimeInterval = 0
    public private(set) var hasClockSample = false

    private var serverEndsAt: Date?
    /// The deadline as it was when `question_started` arrived: receipt + the question's
    /// length. Used until the first heartbeat has measured the clock.
    private var receiptDeadline: Date?
    /// An accepted answer being replaced (`allow_answer_change`). If the replacement is
    /// refused, the original still stands on the server — and here.
    private var replaced: [Int: LiveQuizMyAnswer] = [:]
    /// Answers sent a second time after a reconnect. For these, `already_answered` means the
    /// first copy landed — so the server holds this very choice. For an answer sent once, it
    /// means the server holds one given elsewhere, and its choice is unknown here.
    private var resent: Set<Int> = []

    public init(sessionId: Int, participantId: Int? = nil) {
        self.sessionId = sessionId
        self.participantId = participantId
    }

    // MARK: - What to show

    public var phase: LiveQuizPhase {
        if isRemoved { return .removed }
        guard let status else { return .connecting }
        switch status {
        case .lobby: return .lobby
        case .starting: return .starting
        case .questionActive: return question == nil ? .waitingForNext : .question
        case .questionResults: return reveal == nil ? .waitingForNext : .results
        case .paused: return .paused
        case .finished: return .finished
        case .terminated: return .terminated
        case .unknown: return .waitingForNext
        }
    }

    /// When the open question closes, on this phone's clock.
    public var deadline: Date? {
        guard status == .questionActive, question != nil else { return nil }
        if hasClockSample, let serverEndsAt { return serverEndsAt.addingTimeInterval(-clockOffset) }
        return receiptDeadline ?? serverEndsAt
    }

    /// Seconds left on the open question, never below zero. Nil when no question is open.
    public func secondsLeft(at now: Date) -> TimeInterval? {
        deadline.map { max(0, $0.timeIntervalSince(now)) }
    }

    /// The countdown turns red: the server's warning arrived, or the clock says it should have
    /// (a phone that reconnected in the last five seconds never hears the warning).
    public func isWarning(at now: Date) -> Bool {
        guard phase == .question else { return false }
        if timeWarning { return true }
        guard let left = secondsLeft(at: now) else { return false }
        return left <= Self.warningSeconds
    }

    /// The clock has run out but the question has not closed. The timer that closes it lives
    /// in whichever connection opened the question — usually the teacher's — so if that
    /// drops, the question waits for the teacher.
    public func isOutOfTime(at now: Date) -> Bool {
        guard phase == .question, let deadline else { return false }
        return now >= deadline
    }

    /// This phone's answer to the open question.
    public var currentAnswer: LiveQuizMyAnswer? {
        question.flatMap { answers[$0.id] }
    }

    /// The choice cannot be changed: it is on its way, or it counted and the room does not
    /// allow a change.
    public var isLocked: Bool {
        guard let answer = currentAnswer else { return false }
        switch answer.state {
        case .sending: return true
        case .accepted: return !config.allowAnswerChange
        case .refused: return false
        }
    }

    /// Whether sending `choiceId` would say something new. Re-sending the answer that
    /// already counted would only re-time it — the server scores the later time — so it is
    /// not sent.
    public func isChange(_ choiceId: String) -> Bool {
        guard let answer = currentAnswer, answer.state == .accepted, let held = answer.choice else { return true }
        return held != choiceId
    }

    public func canSubmit(at now: Date) -> Bool {
        guard phase == .question, question != nil, !isLocked else { return false }
        if let deadline, now >= deadline.addingTimeInterval(Self.lateAnswerGrace) { return false }
        return true
    }

    /// The headline of the results card, while the results are up.
    public var outcome: LiveQuizOutcome? {
        guard phase == .results, let reveal else { return nil }
        let correct = reveal.correctAnswer
        guard let answer = answers[reveal.question.id], answer.state == .accepted else {
            return .timeRanOut(correctAnswer: correct)
        }
        if let isCorrect = answer.isCorrect {
            return isCorrect ? .correct(points: answer.pointsAwarded) : .notThisTime(correctAnswer: correct)
        }
        // The verdict itself never arrived (the line dropped, or the server only said
        // "already answered"). With correctness on, the answer key and the choice settle it;
        // with it off, the card must not tell what the teacher chose to keep back.
        guard config.revealCorrectness, let choice = answer.choice else { return .answerIn }
        return choice.caseInsensitiveCompare(correct) == .orderedSame
            ? .correct(points: nil)
            : .notThisTime(correctAnswer: correct)
    }

    /// Whether a row is this student.
    public func isMe(_ row: LiveQuizParticipant) -> Bool {
        if let participantId, row.id == participantId { return true }
        if let userId, let rowUser = row.userId, rowUser == userId { return true }
        return false
    }

    /// This student's row — from the final board once there is one.
    public var myStanding: LiveQuizParticipant? {
        standings.first(where: isMe) ?? participants.first(where: isMe)
    }

    /// This student's place on the board.
    public var myPlace: Int? {
        let places = Self.places(for: standings)
        guard let index = standings.firstIndex(where: isMe) else { return nil }
        return places[index]
    }

    /// The place of every row, in order: the server's final `rank` where it has written one,
    /// otherwise worked out the way the server works it out at the end — highest score first,
    /// and a tie shares the place (1, 2, 2, 4). The platform has one ranking rule; standings
    /// between questions must not number two equal scores differently.
    public static func places(for rows: [LiveQuizParticipant]) -> [Int] {
        var out: [Int] = []
        out.reserveCapacity(rows.count)
        var previousScore: Int?
        var previousPlace = 0
        for (position, row) in rows.enumerated() {
            let computed: Int
            if let score = previousScore, score == row.score {
                computed = previousPlace
            } else {
                computed = position + 1
            }
            previousScore = row.score
            previousPlace = computed
            out.append(row.rank ?? computed)
        }
        return out
    }

    // MARK: - Moves

    /// Record the student's choice and return the frame to send, or nil if it cannot be sent
    /// now (no open question, locked, out of time, not one of the options).
    public mutating func submit(_ choiceId: String, at now: Date) -> LiveQuizClientMessage? {
        guard canSubmit(at: now), let question else { return nil }
        guard let choice = question.choices.first(where: { $0.id == choiceId }) else { return nil }
        guard isChange(choice.id) else { return nil }
        if let existing = answers[question.id], existing.state == .accepted {
            replaced[question.id] = existing
        }
        resent.remove(question.id)
        answers[question.id] = LiveQuizMyAnswer(choice: choice.id, state: .sending)
        notice = nil
        return .submitAnswer(questionId: question.id, answer: choice.id)
    }

    /// Take one frame. Returns frames to send back — an answer that was in flight when the
    /// line dropped, sent again once the room says the question is still open.
    @discardableResult
    public mutating func apply(
        _ message: LiveQuizServerMessage,
        receivedAt: Date,
        heartbeatSentAt: Date? = nil
    ) -> [LiveQuizClientMessage] {
        switch message {
        case .sessionState(let snapshot):
            return applySnapshot(snapshot, receivedAt: receivedAt)

        case .lobby(let people):
            participants = people

        case .gameStarted:
            status = .starting
            closeQuestion()
            reveal = nil
            notice = nil

        case .questionStarted(let next, let startedAt, let endsAt):
            open(next)
            serverEndsAt = endsAt
            if let startedAt, let endsAt {
                receiptDeadline = receivedAt.addingTimeInterval(endsAt.timeIntervalSince(startedAt))
            } else if next.timeLimitSeconds > 0 {
                receiptDeadline = receivedAt.addingTimeInterval(TimeInterval(next.timeLimitSeconds))
            }

        case .timeWarning:
            if status == .questionActive { timeWarning = true }

        case .answerResult(let result):
            var answer = answers[result.questionId] ?? LiveQuizMyAnswer(choice: nil, state: .accepted)
            answer.state = .accepted
            answer.isCorrect = result.isCorrect
            answer.pointsAwarded = result.pointsAwarded
            answer.responseTimeMs = result.responseTimeMs
            answers[result.questionId] = answer
            replaced[result.questionId] = nil
            notice = nil

        case .questionEnded(let closed):
            status = .questionResults
            reveal = closed
            currentIndex = closed.question.index
            if closed.question.total > 0 { questionTotal = closed.question.total }
            closeQuestion()

        case .leaderboard(let rows):
            standings = rows

        case .paused(let snapshot):
            status = .paused
            participants = snapshot.participants
            // The clock is stopped; `game_resumed` brings the deadline back, moved on by the
            // length of the pause.
            serverEndsAt = nil
            receiptDeadline = nil

        case .resumed(let snapshot):
            applyBroadcastState(snapshot)

        case .terminated:
            status = .terminated
            closeQuestion()

        case .finished(let rows, let session):
            status = .finished
            if !rows.isEmpty { standings = rows }
            if let total = session?.questionTotal, total > 0 { questionTotal = total }
            closeQuestion()

        case .removed(let removedId):
            if let participantId, removedId == participantId {
                isRemoved = true
                closeQuestion()
            } else {
                participants.removeAll { $0.id == removedId }
                standings.removeAll { $0.id == removedId }
            }

        case .error(let code, let detail):
            applyError(code: code, detail: detail)

        case .pong(let serverTime):
            if let serverTime, let heartbeatSentAt {
                let roundTrip = receivedAt.timeIntervalSince(heartbeatSentAt)
                if roundTrip >= 0, roundTrip <= Self.usableRoundTrip {
                    // The server stamped the pong somewhere inside the round trip; the middle
                    // is the best guess, and wrong by at most half of it.
                    let midpoint = heartbeatSentAt.addingTimeInterval(roundTrip / 2)
                    clockOffset = serverTime.timeIntervalSince(midpoint)
                    hasClockSample = true
                }
            }

        case .unknown:
            break
        }
        return []
    }

    // MARK: - Internals

    private mutating func applySnapshot(_ snapshot: LiveQuizSnapshot, receivedAt: Date) -> [LiveQuizClientMessage] {
        if let me = snapshot.me {
            participantId = me.id
            userId = me.userId ?? userId
        }
        if !snapshot.joinCode.isEmpty { joinCode = snapshot.joinCode }
        config = snapshot.config
        currentIndex = snapshot.currentIndex
        if snapshot.questionTotal > 0 { questionTotal = snapshot.questionTotal }
        participants = snapshot.participants
        // `participants` arrives highest score first — on a finished room, with final ranks.
        standings = snapshot.participants
        applyRoomStatus(snapshot)

        // An answer that left this phone but never came back as `answer_result` may or may
        // not have landed. Send it again while the question is still open: a duplicate is
        // refused as `already_answered`, which reads as locked.
        guard snapshot.status == .questionActive, let open = question,
              let pending = answers[open.id], pending.state == .sending, let choice = pending.choice
        else { return [] }
        if let deadline, receivedAt >= deadline.addingTimeInterval(Self.lateAnswerGrace) { return [] }
        resent.insert(open.id)
        return [.submitAnswer(questionId: open.id, answer: choice)]
    }

    /// The room-state part shared by `session_state` and `game_resumed`. `me` is never read
    /// here: a broadcast copy of it is whoever built the frame.
    private mutating func applyBroadcastState(_ snapshot: LiveQuizSnapshot) {
        if !snapshot.participants.isEmpty { participants = snapshot.participants }
        currentIndex = snapshot.currentIndex
        if snapshot.questionTotal > 0 { questionTotal = snapshot.questionTotal }
        applyRoomStatus(snapshot)
    }

    private mutating func applyRoomStatus(_ snapshot: LiveQuizSnapshot) {
        status = snapshot.status
        switch snapshot.status {
        case .questionActive:
            if let open = snapshot.question {
                if open.id != question?.id {
                    // A question this phone never saw start: a fresh card.
                    timeWarning = false
                    notice = nil
                    receiptDeadline = nil
                }
                question = open
            } else if let held = question, held.index != snapshot.currentIndex {
                // The room is on a question this phone does not have; never show the old one
                // under the new one's clock.
                question = nil
            }
            // The snapshot's deadline is the authority — a pause may have moved it.
            serverEndsAt = snapshot.endsAt
            receiptDeadline = nil
            reveal = nil
        case .questionResults:
            closeQuestion()
            // A reconnect during the results brings no reveal; keep ours only if it is for
            // the question the room is on.
            if let kept = reveal, kept.question.index != snapshot.currentIndex { reveal = nil }
        case .lobby, .starting:
            closeQuestion()
            reveal = nil
        case .paused, .finished, .terminated, .unknown:
            closeQuestion()
        }
    }

    private mutating func open(_ next: LiveQuizQuestion) {
        status = .questionActive
        question = next
        currentIndex = next.index
        if next.total > 0 { questionTotal = next.total }
        reveal = nil
        timeWarning = false
        notice = nil
        serverEndsAt = nil
        receiptDeadline = nil
    }

    private mutating func closeQuestion() {
        question = nil
        serverEndsAt = nil
        receiptDeadline = nil
        timeWarning = false
    }

    private mutating func applyError(code: String, detail: String) {
        // Error frames do not say which command they answer. The only command a student
        // sends that can be refused is an answer, and one is in flight at a time.
        let inFlight = answers.first { $0.value.state == .sending }?.key

        switch code {
        case "already_answered":
            // A duplicate: the server holds an answer for this question already.
            let questionId = inFlight ?? question?.id
            if let questionId {
                var answer = answers[questionId] ?? LiveQuizMyAnswer(choice: nil, state: .accepted)
                if answer.state == .sending, !resent.contains(questionId) {
                    // Sent once and already there: somebody answered from another device.
                    answer.choice = nil
                }
                answer.state = .accepted
                answers[questionId] = answer
                replaced[questionId] = nil
                resent.remove(questionId)
            }
            notice = nil
            return

        case "too_late", "bad_state", "unknown_question":
            if let questionId = inFlight {
                if let original = replaced.removeValue(forKey: questionId) {
                    answers[questionId] = original
                } else {
                    answers[questionId]?.state = .refused(code: code)
                }
            }

        default:
            // Not a verdict on the answer (`server_error`, `not_participant`, …): it did not
            // count, and the student may try again.
            if let questionId = inFlight {
                if let original = replaced.removeValue(forKey: questionId) {
                    answers[questionId] = original
                } else {
                    answers[questionId] = nil
                }
            }
        }
        notice = LiveQuizNotice(code: code, detail: detail.isEmpty ? Self.fallbackDetail(for: code) : detail)
    }

    /// The server's own sentences (`livequiz/services.py`, `consumers.py`), for a frame that
    /// arrived without one.
    static func fallbackDetail(for code: String) -> String {
        switch code {
        case "bad_state": return "That question is not taking answers."
        case "unknown_question": return "That question has already moved on."
        case "too_late": return "Time is up for that question."
        case "already_answered": return "You have already answered this one."
        case "not_participant": return "You are not playing this quiz."
        default: return "Something went wrong handling that."
        }
    }
}

// MARK: - Why the room will not have us

/// Why the socket was refused for good, in the terms the student needs.
///
/// The server's close codes (4403, 4401, 4404, 4503) never reach a client that is refused at
/// the handshake — uvicorn turns a close-before-accept into a bare HTTP 403 — so the reason
/// is found afterwards over REST (`diagnose`).
public enum LiveQuizDenial: Sendable, Equatable {
    case featureOff
    /// The room is running, but this student holds no place in it: never joined here, or
    /// taken out. The code is the way in.
    case noPlace
    case notInClass
    /// The teacher stopped the room.
    case stopped
    /// The room is over, or gone.
    case over
    /// The teacher took this student out (`removed_from_session`, then close 4403).
    case removed
    /// No session to authenticate with — the app is signing out.
    case signedOut
    /// Refused, and REST could not say why.
    case unknown

    /// The reason, from `GET /livequiz/sessions/<id>/results/`.
    public static func diagnose(_ result: Result<LiveQuizResults, any Error>) -> LiveQuizDenial {
        switch result {
        case .failure(let error):
            guard let refusal = error as? LiveQuizRefusal else { return .unknown }
            switch refusal.reason {
            case .featureOff: return .featureOff
            case .notInClass: return .notInClass
            case .notFound: return .over
            default: return .unknown
            }
        case .success(let results):
            switch results.session.status {
            case .terminated:
                return .stopped
            case .finished:
                // A finished room still lets its players back in to see the final board, so
                // a refusal means there was never a place here.
                return results.myRows.isEmpty ? .over : .unknown
            case .unknown:
                return .unknown
            default:
                return results.myRows.isEmpty ? .noPlace : .unknown
            }
        }
    }

    /// What an ended connection already says without asking REST. Nil for a refused
    /// handshake (ask `diagnose`) and for a connection this side stopped.
    public init?(end: LiveQuizConnectionEnd) {
        switch end {
        case .stopped, .refused:
            return nil
        case .signedOut:
            self = .signedOut
        case .closed(let code, let wasOpen):
            // On an open socket, 4403 follows `removed_from_session` and means exactly that.
            if code == 4403, wasOpen {
                self = .removed
            } else {
                self = LiveQuizDenial(closeCode: code) ?? .unknown
            }
        }
    }

    /// The server's own close codes, for a server that manages to deliver one.
    public init?(closeCode: Int) {
        switch closeCode {
        case 4503: self = .featureOff
        case 4401: self = .signedOut
        case 4403: self = .noPlace
        case 4404: self = .over
        default: return nil
        }
    }
}

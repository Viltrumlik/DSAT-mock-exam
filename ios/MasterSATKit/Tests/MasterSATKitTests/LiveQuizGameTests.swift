import Foundation
import Testing
@testable import MasterSATKit

/// The game, frame by frame. Every "now" is handed in, so time is exact here.
@Suite struct LiveQuizGameTests {
    let t0 = Date(timeIntervalSince1970: 1_790_000_000)
    let me = LiveQuizParticipant(id: 4, userId: 2, displayName: "Ali Valiyev")
    let classmate = LiveQuizParticipant(id: 5, userId: 3, displayName: "Zarina Karimova")

    func question(_ id: Int = 7, index: Int = 0, total: Int = 3, seconds: Int = 20) -> LiveQuizQuestion {
        LiveQuizQuestion(
            id: id, index: index, total: total, prompt: "to become less intense",
            questionPrompt: "Which word means this?",
            choices: ["abate", "candid", "deft", "elated"].enumerated().map {
                LiveQuizChoice(id: ["A", "B", "C", "D"][$0.offset], text: $0.element)
            },
            timeLimitSeconds: seconds, form: "definition_to_word"
        )
    }

    func snapshot(
        _ status: LiveQuizStatus, question: LiveQuizQuestion? = nil, endsAt: Date? = nil, me: LiveQuizParticipant? = nil,
        participants: [LiveQuizParticipant]? = nil, currentIndex: Int = -1, config: LiveQuizConfig = .defaults
    ) -> LiveQuizSnapshot {
        LiveQuizSnapshot(
            sessionId: 1, joinCode: "KH3Y8U", status: status, currentIndex: currentIndex, questionTotal: 3,
            endsAt: endsAt, config: config, participants: participants ?? [self.me, classmate],
            question: question, me: me
        )
    }

    /// A game in the lobby, then with question `q` opened at t0 (20 s).
    func playing(_ q: LiveQuizQuestion? = nil, config: LiveQuizConfig = .defaults) -> LiveQuizGame {
        var game = LiveQuizGame(sessionId: 1, participantId: 4)
        game.apply(.sessionState(snapshot(.lobby, me: me, config: config)), receivedAt: t0.addingTimeInterval(-10))
        let q = q ?? question()
        game.apply(.questionStarted(question: q, startedAt: t0, endsAt: t0.addingTimeInterval(TimeInterval(q.timeLimitSeconds))), receivedAt: t0)
        return game
    }

    func ended(_ q: LiveQuizQuestion, answer: String = "A") -> LiveQuizServerMessage {
        .questionEnded(LiveQuizReveal(question: q, correctAnswer: answer, explanation: "The storm began to abate."))
    }

    // MARK: - Getting in

    @Test("Nothing heard yet is 'connecting'; the first snapshot is the lobby")
    func lobby() {
        var game = LiveQuizGame(sessionId: 1)
        #expect(game.phase == .connecting)
        let outbound = game.apply(.sessionState(snapshot(.lobby, me: me)), receivedAt: t0)
        #expect(outbound.isEmpty)
        #expect(game.phase == .lobby)
        #expect(game.participantId == 4 && game.userId == 2)
        #expect(game.joinCode == "KH3Y8U")
        #expect(game.participants.count == 2)
        #expect(game.questionTotal == 3)
    }

    @Test("Players coming and going update the room")
    func lobbyFrames() {
        var game = LiveQuizGame(sessionId: 1)
        game.apply(.sessionState(snapshot(.lobby, me: me, participants: [me])), receivedAt: t0)
        game.apply(.lobby(participants: [me, classmate]), receivedAt: t0)
        #expect(game.participants.map(\.id) == [4, 5])
    }

    @Test("A late joiner lands straight in the running game")
    func lateJoin() {
        var game = LiveQuizGame(sessionId: 1)
        game.apply(.sessionState(snapshot(.starting, me: me)), receivedAt: t0)
        #expect(game.phase == .starting)

        var mid = LiveQuizGame(sessionId: 1)
        mid.apply(.sessionState(snapshot(.questionActive, question: question(index: 1), endsAt: t0.addingTimeInterval(12),
                                         me: me, currentIndex: 1)), receivedAt: t0)
        #expect(mid.phase == .question)
        #expect(mid.question?.number == 2)
        #expect(mid.secondsLeft(at: t0) == 12)
        #expect(mid.currentAnswer == nil && mid.canSubmit(at: t0))
    }

    // MARK: - The clock

    @Test("The countdown runs from the moment the question arrived, for the question's length")
    func countdown() {
        var game = LiveQuizGame(sessionId: 1)
        game.apply(.sessionState(snapshot(.lobby, me: me)), receivedAt: t0)
        game.apply(.gameStarted(countdownSeconds: 3), receivedAt: t0)
        #expect(game.phase == .starting)
        // The server's clock is 300 s ahead of this phone; without a heartbeat yet, only the
        // question's own length can be trusted.
        let serverStart = t0.addingTimeInterval(300)
        game.apply(.questionStarted(question: question(), startedAt: serverStart, endsAt: serverStart.addingTimeInterval(20)),
                   receivedAt: t0.addingTimeInterval(3))
        #expect(game.phase == .question)
        #expect(game.secondsLeft(at: t0.addingTimeInterval(8)) == 15)
        #expect(!game.isWarning(at: t0.addingTimeInterval(8)))
        #expect(game.isWarning(at: t0.addingTimeInterval(18.5)))
        #expect(game.secondsLeft(at: t0.addingTimeInterval(40)) == 0)
    }

    @Test("A phone whose clock is out: the heartbeat's midpoint moves the server's deadline onto it")
    func clockOffset() {
        var game = LiveQuizGame(sessionId: 1)
        // The phone is 100 s behind the server. Heartbeat out at t0, back 0.1 s later; the
        // server stamped it half-way.
        game.apply(.pong(serverTime: t0.addingTimeInterval(100.05)), receivedAt: t0.addingTimeInterval(0.1), heartbeatSentAt: t0)
        #expect(game.hasClockSample)
        #expect(abs(game.clockOffset - 100) < 0.0001)

        // Reconnecting mid-question: the snapshot has only the server's deadline.
        game.apply(.sessionState(snapshot(.questionActive, question: question(), endsAt: t0.addingTimeInterval(100 + 20),
                                          me: me, currentIndex: 0)), receivedAt: t0)
        let left = game.secondsLeft(at: t0) ?? -1
        #expect(abs(left - 20) < 0.001)
    }

    @Test("A heartbeat stuck in the network measures the network, not the clock")
    func slowPongIgnored() {
        var game = LiveQuizGame(sessionId: 1)
        game.apply(.pong(serverTime: t0.addingTimeInterval(50)), receivedAt: t0.addingTimeInterval(4), heartbeatSentAt: t0)
        #expect(!game.hasClockSample && game.clockOffset == 0)
        // A pong with no heartbeat to pair it with says nothing either.
        game.apply(.pong(serverTime: t0.addingTimeInterval(50)), receivedAt: t0)
        #expect(!game.hasClockSample)
    }

    @Test("The warning frame turns the clock red, but only while a question is open")
    func warning() {
        var lobby = LiveQuizGame(sessionId: 1)
        lobby.apply(.sessionState(snapshot(.lobby, me: me)), receivedAt: t0)
        lobby.apply(.timeWarning(secondsLeft: 5), receivedAt: t0)
        #expect(!lobby.timeWarning)

        var game = playing()
        #expect(!game.isWarning(at: t0.addingTimeInterval(1)))
        game.apply(.timeWarning(secondsLeft: 5), receivedAt: t0.addingTimeInterval(1))
        #expect(game.isWarning(at: t0.addingTimeInterval(1)))
    }

    @Test("Out of time: the server's 750 ms of grace, then nothing more can be sent")
    func outOfTime() {
        let game = playing()
        let deadline = t0.addingTimeInterval(20)
        #expect(!game.isOutOfTime(at: deadline.addingTimeInterval(-0.1)))
        #expect(game.isOutOfTime(at: deadline))
        #expect(game.canSubmit(at: deadline.addingTimeInterval(0.5)))
        #expect(!game.canSubmit(at: deadline.addingTimeInterval(0.8)))
        var late = game
        #expect(late.submit("A", at: deadline.addingTimeInterval(1)) == nil)
    }

    // MARK: - Answering

    @Test("An answer goes once, and the choice is locked when the room allows no change")
    func submitAndLock() {
        var game = playing()
        let frame = game.submit("B", at: t0.addingTimeInterval(2))
        #expect(frame == .submitAnswer(questionId: 7, answer: "B"))
        #expect(game.currentAnswer == LiveQuizMyAnswer(choice: "B", state: .sending))
        #expect(game.isLocked)
        #expect(game.submit("C", at: t0.addingTimeInterval(3)) == nil)

        game.apply(.answerResult(LiveQuizAnswerResult(questionId: 7, responseTimeMs: 2000, isCorrect: false, pointsAwarded: 0)),
                   receivedAt: t0.addingTimeInterval(2.1))
        #expect(game.currentAnswer?.state == .accepted)
        #expect(game.currentAnswer?.isCorrect == false)
        #expect(game.isLocked && !game.canSubmit(at: t0.addingTimeInterval(3)))
    }

    @Test("Only one of the four options can be sent")
    func unknownChoice() {
        var game = playing()
        #expect(game.submit("E", at: t0) == nil)
        #expect(game.currentAnswer == nil)
    }

    @Test("With answer changes on, a counted answer can be replaced — and a refused replacement leaves it standing")
    func changeAnswer() {
        var config = LiveQuizConfig.defaults
        config.allowAnswerChange = true
        var game = playing(config: config)
        _ = game.submit("A", at: t0.addingTimeInterval(1))
        game.apply(.answerResult(LiveQuizAnswerResult(questionId: 7, isCorrect: true, pointsAwarded: 145)), receivedAt: t0.addingTimeInterval(1.1))
        #expect(!game.isLocked && game.canSubmit(at: t0.addingTimeInterval(2)))

        #expect(game.submit("C", at: t0.addingTimeInterval(2)) == .submitAnswer(questionId: 7, answer: "C"))
        game.apply(.error(code: "too_late", detail: ""), receivedAt: t0.addingTimeInterval(2.1))
        #expect(game.currentAnswer == LiveQuizMyAnswer(choice: "A", state: .accepted, isCorrect: true, pointsAwarded: 145))
        #expect(game.notice == LiveQuizNotice(code: "too_late", detail: "Time is up for that question."))
    }

    @Test("A refused answer did not count, and the refusal is said in the server's words")
    func refusedAnswer() {
        var game = playing()
        _ = game.submit("B", at: t0.addingTimeInterval(19.9))
        game.apply(.error(code: "too_late", detail: "Time is up for that question."), receivedAt: t0.addingTimeInterval(21))
        #expect(game.currentAnswer?.state == .refused(code: "too_late"))
        #expect(game.notice?.detail == "Time is up for that question.")
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(21))
        #expect(game.outcome == .timeRanOut(correctAnswer: "A"))
    }

    @Test("A fault that is not about the answer frees the choice for another try")
    func serverErrorFreesTheChoice() {
        var game = playing()
        _ = game.submit("B", at: t0.addingTimeInterval(2))
        game.apply(.error(code: "server_error", detail: "Something went wrong handling that."), receivedAt: t0.addingTimeInterval(2.1))
        #expect(game.currentAnswer == nil)
        #expect(game.canSubmit(at: t0.addingTimeInterval(3)))
        #expect(game.notice?.code == "server_error")
        // The next question starts clean.
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(5))
        game.apply(.questionStarted(question: question(8, index: 1), startedAt: t0.addingTimeInterval(8), endsAt: t0.addingTimeInterval(28)),
                   receivedAt: t0.addingTimeInterval(8))
        #expect(game.notice == nil)
    }

    // MARK: - Results

    @Test("Correct, with the points the server gave")
    func correctOutcome() {
        var game = playing()
        _ = game.submit("A", at: t0.addingTimeInterval(1))
        game.apply(.answerResult(LiveQuizAnswerResult(questionId: 7, responseTimeMs: 1000, isCorrect: true, pointsAwarded: 148)), receivedAt: t0.addingTimeInterval(1.1))
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(4))
        #expect(game.phase == .results)
        #expect(game.outcome == .correct(points: 148))
        #expect(game.reveal?.explanation == "The storm began to abate.")
        #expect(game.deadline == nil)
    }

    @Test("Not this time, and the answer it was")
    func wrongOutcome() {
        var game = playing()
        _ = game.submit("B", at: t0.addingTimeInterval(1))
        game.apply(.answerResult(LiveQuizAnswerResult(questionId: 7, isCorrect: false, pointsAwarded: 0)), receivedAt: t0.addingTimeInterval(1.1))
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(4))
        #expect(game.outcome == .notThisTime(correctAnswer: "A"))
        #expect(game.reveal?.correctChoiceText == "abate")
    }

    @Test("No answer: time ran out")
    func noAnswer() {
        var game = playing()
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(20))
        #expect(game.outcome == .timeRanOut(correctAnswer: "A"))
    }

    @Test("With correctness kept back, the card says the answer counted — not whether it was right")
    func revealOff() {
        var config = LiveQuizConfig.defaults
        config.revealCorrectness = false
        var game = playing(config: config)
        _ = game.submit("B", at: t0.addingTimeInterval(1))
        game.apply(.answerResult(LiveQuizAnswerResult(questionId: 7, responseTimeMs: 1000)), receivedAt: t0.addingTimeInterval(1.1))
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(4))
        #expect(game.outcome == .answerIn)
    }

    @Test("Standings between questions, and a new question clears the last result")
    func standingsThenNext() {
        var game = playing()
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(20))
        game.apply(.leaderboard(rows: [classmate, me]), receivedAt: t0.addingTimeInterval(20))
        #expect(game.standings.map(\.id) == [5, 4])
        game.apply(.questionStarted(question: question(8, index: 1), startedAt: t0.addingTimeInterval(30), endsAt: t0.addingTimeInterval(50)),
                   receivedAt: t0.addingTimeInterval(30))
        #expect(game.phase == .question)
        #expect(game.reveal == nil && game.outcome == nil)
        #expect(game.question?.number == 2)
        #expect(game.currentAnswer == nil)
    }

    // MARK: - Reconnecting

    @Test("Reconnecting mid-question: the answer in flight is sent again, and a duplicate reads as locked")
    func resendOnReconnect() {
        var game = playing()
        _ = game.submit("B", at: t0.addingTimeInterval(2))
        // The line drops before `answer_result`; the room comes back still on the question.
        let outbound = game.apply(.sessionState(snapshot(.questionActive, question: question(), endsAt: t0.addingTimeInterval(20),
                                                         me: me, currentIndex: 0)), receivedAt: t0.addingTimeInterval(6))
        #expect(outbound == [.submitAnswer(questionId: 7, answer: "B")])
        #expect(game.isLocked)

        // It had landed the first time.
        game.apply(.error(code: "already_answered", detail: "You have already answered this one."), receivedAt: t0.addingTimeInterval(6.1))
        #expect(game.currentAnswer?.state == .accepted)
        #expect(game.currentAnswer?.choice == "B")
        #expect(game.isLocked && game.notice == nil)

        // No verdict ever arrived, but the key and the choice settle it.
        game.apply(ended(question(), answer: "B"), receivedAt: t0.addingTimeInterval(20))
        #expect(game.outcome == .correct(points: nil))
    }

    @Test("An answer given on another device reads as locked here too")
    func alreadyAnsweredElsewhere() {
        var game = LiveQuizGame(sessionId: 1)
        game.apply(.sessionState(snapshot(.questionActive, question: question(), endsAt: t0.addingTimeInterval(15), me: me, currentIndex: 0)),
                   receivedAt: t0)
        _ = game.submit("C", at: t0)
        game.apply(.error(code: "already_answered", detail: ""), receivedAt: t0)
        #expect(game.isLocked)
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(15))
        // Our "C" was never recorded; what the server holds is unknown, so it is not called either way.
        #expect(game.currentAnswer?.choice == nil)
        #expect(game.outcome == .answerIn)
    }

    @Test("An answer still in flight after the deadline is not sent again")
    func noResendAfterDeadline() {
        var game = playing()
        _ = game.submit("B", at: t0.addingTimeInterval(19))
        let outbound = game.apply(.sessionState(snapshot(.questionActive, question: question(), endsAt: t0.addingTimeInterval(20),
                                                         me: me, currentIndex: 0)), receivedAt: t0.addingTimeInterval(25))
        #expect(outbound.isEmpty)
    }

    @Test("Reconnecting during the results keeps our result only for the question the room is on")
    func reconnectDuringResults() {
        var game = playing()
        game.apply(ended(question()), receivedAt: t0.addingTimeInterval(20))
        game.apply(.sessionState(snapshot(.questionResults, me: me, currentIndex: 0)), receivedAt: t0.addingTimeInterval(22))
        #expect(game.phase == .results)
        game.apply(.sessionState(snapshot(.questionResults, me: me, currentIndex: 1)), receivedAt: t0.addingTimeInterval(40))
        #expect(game.phase == .waitingForNext)

        var fresh = LiveQuizGame(sessionId: 1)
        fresh.apply(.sessionState(snapshot(.questionResults, me: me, currentIndex: 0)), receivedAt: t0)
        #expect(fresh.phase == .waitingForNext)
    }

    @Test("Reconnecting into a question never seen clears the last one's warning and notice")
    func reconnectIntoNewQuestion() {
        var game = playing()
        game.apply(.timeWarning(secondsLeft: 5), receivedAt: t0.addingTimeInterval(15))
        game.apply(.error(code: "invalid_command", detail: "Unknown command."), receivedAt: t0.addingTimeInterval(15))
        game.apply(.sessionState(snapshot(.questionActive, question: question(8, index: 1), endsAt: t0.addingTimeInterval(60),
                                          me: me, currentIndex: 1)), receivedAt: t0.addingTimeInterval(41))
        #expect(game.question?.id == 8)
        #expect(!game.timeWarning && game.notice == nil)
        #expect(!game.isWarning(at: t0.addingTimeInterval(41)))
    }

    // MARK: - Pause, stop, removal, finish

    @Test("A pause stops the clock; the resume brings the deadline moved on by the pause")
    func pauseAndResume() {
        var game = playing()
        game.apply(.paused(snapshot(.paused)), receivedAt: t0.addingTimeInterval(5))
        #expect(game.phase == .paused)
        #expect(game.deadline == nil && game.secondsLeft(at: t0.addingTimeInterval(30)) == nil)
        game.apply(.resumed(snapshot(.questionActive, question: question(), endsAt: t0.addingTimeInterval(45), currentIndex: 0)),
                   receivedAt: t0.addingTimeInterval(30))
        #expect(game.phase == .question)
        #expect(game.secondsLeft(at: t0.addingTimeInterval(30)) == 15)
    }

    @Test("The teacher stopping the room ends it")
    func terminated() {
        var game = playing()
        game.apply(.terminated(snapshot(.terminated)), receivedAt: t0.addingTimeInterval(3))
        #expect(game.phase == .terminated && game.phase.isFinal)
        #expect(game.deadline == nil)
    }

    @Test("A removal is about us only when the id is ours")
    func removal() {
        var game = playing()
        game.apply(.leaderboard(rows: [me, classmate]), receivedAt: t0)
        game.apply(.removed(participantId: 5), receivedAt: t0)
        #expect(game.phase == .question)
        #expect(game.participants.map(\.id) == [4] && game.standings.map(\.id) == [4])
        game.apply(.removed(participantId: 4), receivedAt: t0)
        #expect(game.phase == .removed && game.phase.isFinal)
    }

    @Test("The final board: our row by our own ids, never the frame's `me`")
    func finished() {
        var game = playing()
        let first = LiveQuizParticipant(id: 5, userId: 3, displayName: "Zarina Karimova", score: 290, correctCount: 2, rank: 1)
        let second = LiveQuizParticipant(id: 4, userId: 2, displayName: "Ali Valiyev", score: 150, correctCount: 1, rank: 2)
        // The frame was built by the classmate's connection, so its `me` is the classmate.
        game.apply(.finished(rows: [first, second], session: snapshot(.finished, me: first)), receivedAt: t0.addingTimeInterval(90))
        #expect(game.phase == .finished)
        #expect(game.myStanding?.id == 4)
        #expect(game.myStanding?.score == 150)
        #expect(game.myPlace == 2)
        #expect(game.participantId == 4)
    }

    @Test("A reconnect to a finished room shows the final board")
    func reconnectToFinished() {
        var game = LiveQuizGame(sessionId: 1)
        let ranked = [LiveQuizParticipant(id: 5, userId: 3, score: 150, rank: 1), LiveQuizParticipant(id: 4, userId: 2, score: 150, rank: 1)]
        game.apply(.sessionState(snapshot(.finished, me: ranked[1], participants: ranked)), receivedAt: t0)
        #expect(game.phase == .finished)
        #expect(game.myPlace == 1)
    }

    @Test("Places: the server's rank where it has one; otherwise a tie shares the place")
    func places() {
        let rows = [200, 150, 150, 100].enumerated().map { LiveQuizParticipant(id: $0.offset, score: $0.element) }
        #expect(LiveQuizGame.places(for: rows) == [1, 2, 2, 4])
        let ranked = [LiveQuizParticipant(id: 1, score: 9, rank: 1), LiveQuizParticipant(id: 2, score: 9, rank: 1), LiveQuizParticipant(id: 3, score: 1, rank: 3)]
        #expect(LiveQuizGame.places(for: ranked) == [1, 1, 3])
        #expect(LiveQuizGame.places(for: []) == [])
    }

    // MARK: - Why the room will not have us

    @Test("A refused socket is explained by the room's own report")
    func diagnose() {
        func results(_ status: LiveQuizStatus, rows: [LiveQuizParticipant] = []) -> Result<LiveQuizResults, any Error> {
            .success(LiveQuizResults(session: LiveQuizSummary(id: 1, status: status), myRows: rows))
        }
        #expect(LiveQuizDenial.diagnose(.failure(LiveQuizRefusal(reason: .featureOff))) == .featureOff)
        #expect(LiveQuizDenial.diagnose(.failure(LiveQuizRefusal(reason: .notInClass))) == .notInClass)
        #expect(LiveQuizDenial.diagnose(.failure(LiveQuizRefusal(reason: .notFound))) == .over)
        #expect(LiveQuizDenial.diagnose(.failure(APIError.transport(underlying: "offline"))) == .unknown)
        #expect(LiveQuizDenial.diagnose(results(.terminated)) == .stopped)
        #expect(LiveQuizDenial.diagnose(results(.finished)) == .over)
        #expect(LiveQuizDenial.diagnose(results(.lobby)) == .noPlace)
        #expect(LiveQuizDenial.diagnose(results(.questionActive)) == .noPlace)
        // A place, and still refused: nothing REST knows explains it.
        #expect(LiveQuizDenial.diagnose(results(.lobby, rows: [me])) == .unknown)
    }

    @Test("The server's own close codes, should one ever arrive")
    func closeCodes() {
        #expect(LiveQuizDenial(closeCode: 4503) == .featureOff)
        #expect(LiveQuizDenial(closeCode: 4401) == .signedOut)
        #expect(LiveQuizDenial(closeCode: 4403) == .noPlace)
        #expect(LiveQuizDenial(closeCode: 4404) == .over)
        #expect(LiveQuizDenial(closeCode: 1000) == nil)
    }

    @Test("What an ended connection says on its own, and what it leaves to REST")
    func fromEnd() {
        #expect(LiveQuizDenial(end: .closed(code: 4403, wasOpen: true)) == .removed)
        #expect(LiveQuizDenial(end: .closed(code: 4403, wasOpen: false)) == .noPlace)
        #expect(LiveQuizDenial(end: .closed(code: 4999, wasOpen: true)) == .unknown)
        #expect(LiveQuizDenial(end: .signedOut) == .signedOut)
        #expect(LiveQuizDenial(end: .refused(status: 403)) == nil)
        #expect(LiveQuizDenial(end: .stopped) == nil)
    }

    // MARK: - The real frames, end to end

    @Test("A whole question from the server's own text frames")
    func fromRealFrames() throws {
        typealias F = LiveQuizFixtures
        var game = LiveQuizGame(sessionId: 1, participantId: 1)
        let frames = [
            F.frame("session_state", F.state()),
            F.frame("game_started", ["countdown_seconds": 3]),
            F.frame("question_started", ["question": F.question(), "started_at": "2026-09-26T10:34:35.021235+00:00",
                                         "ends_at": "2026-09-26T10:34:55.021235+00:00"]),
        ]
        for text in frames {
            game.apply(try #require(LiveQuizServerMessage.decode(text)), receivedAt: t0)
        }
        #expect(game.phase == .question)
        let frame = game.submit("A", at: t0.addingTimeInterval(1))
        #expect(frame?.text == #"{"answer":"A","question_id":7,"type":"submit_answer"}"#)
        for text in [
            F.frame("answer_result", ["question_id": 7, "accepted": true, "response_time_ms": 1000, "is_correct": true, "points_awarded": 148]),
            F.frame("question_ended", ["question": F.question(), "correct_answer": "A", "explanation": "", "tally": ["answered": 1]]),
            F.frame("leaderboard_updated", ["rows": [F.participant(score: 148)]]),
        ] {
            game.apply(try #require(LiveQuizServerMessage.decode(text)), receivedAt: t0.addingTimeInterval(2))
        }
        #expect(game.outcome == .correct(points: 148))
        #expect(game.myStanding?.score == 148)
    }
}

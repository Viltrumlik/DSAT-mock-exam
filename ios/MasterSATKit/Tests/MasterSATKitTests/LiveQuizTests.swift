import Foundation
import Testing
@testable import MasterSATKit

// Payloads below are copied from the real server (uvicorn + Channels, `backend/livequiz`),
// not written from the spec — including the microsecond `+00:00` timestamps.

enum LiveQuizFixtures {
    static var config: [String: Any] {
        [
            "allow_answer_change": false, "show_leaderboard_between": true, "reveal_correctness": true,
            "speed_bonus_ratio": 0.5, "shuffle_questions": false, "manual_advance": true, "question_seconds": 20,
        ]
    }

    static func summary(id: Int = 1, code: Any = "KH3Y8U", status: String = "LOBBY") -> [String: Any] {
        [
            "id": id, "join_code": code, "status": status, "classroom_id": 1, "classroom_name": "LQ Smoke",
            "vocab_set_id": 1, "title": "Smoke Set", "host_id": 1, "current_index": -1, "question_total": 6,
            "config": config, "created_at": "2026-09-26T10:19:04.730803+00:00", "started_at": NSNull(),
            "finished_at": NSNull(), "counts": ["participants": 1, "present": 0],
        ]
    }

    static func participant(id: Int = 1, userId: Int = 2, name: String = "Ali Valiyev", score: Int = 0, rank: Any = NSNull()) -> [String: Any] {
        [
            "id": id, "user_id": userId, "display_name": name, "status": "JOINED", "present": true,
            "score": score, "correct_count": score > 0 ? 1 : 0, "answered_count": 1, "rank": rank,
        ]
    }

    static func question(id: Int = 7, index: Int = 0, total: Int = 6) -> [String: Any] {
        [
            "id": id, "index": index, "total": total, "prompt": "to become less intense or widespread",
            "question_prompt": "Which word means this?", "question_type": "multiple_choice",
            "choices": [["id": "A", "text": "abate"], ["id": "B", "text": "candid"], ["id": "C", "text": "deft"], ["id": "D", "text": "elated"]],
            "points": 1, "time_limit_seconds": 20, "form": "definition_to_word",
        ]
    }

    static func frame(_ type: String, _ data: Any) -> String {
        let object: [String: Any] = ["type": type, "data": data]
        return String(decoding: try! JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }

    static func state(status: String = "LOBBY", question: [String: Any]? = nil, endsAt: Any = NSNull(),
                      me: [String: Any]? = participant(), participants: [[String: Any]] = [participant()],
                      currentIndex: Int = -1, config: [String: Any] = config) -> [String: Any] {
        var data: [String: Any] = [
            "session_id": 1, "join_code": "KH3Y8U", "status": status, "current_index": currentIndex,
            "question_total": 6, "started_at": NSNull(), "finished_at": NSNull(), "ends_at": endsAt,
            "config": config, "participants": participants,
        ]
        if let question { data["question"] = question }
        if let me { data["me"] = me }
        return data
    }
}

// MARK: - REST

@Suite struct LiveQuizAPITests {
    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> LiveQuizAPI {
        LiveQuizAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("Joining sends the code the way the board shows it, and returns the room and the place")
    func joinDecodes() async throws {
        server.handler = { _ in
            .json(["session": LiveQuizFixtures.summary(), "participant": ["id": 4, "display_name": "Ali Valiyev", "score": 0]])
        }
        let joined = try await api().join(code: " kh3-y8u ")
        #expect(joined.session.id == 1)
        #expect(joined.session.joinCode == "KH3Y8U")
        #expect(joined.session.status == .lobby)
        #expect(joined.session.title == "Smoke Set")
        #expect(joined.session.classroomName == "LQ Smoke")
        #expect(joined.session.questionTotal == 6)
        #expect(joined.session.participantCount == 1 && joined.session.presentCount == 0)
        #expect(joined.session.config == .defaults)
        #expect(joined.participantId == 4)
        #expect(joined.displayName == "Ali Valiyev")

        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/livequiz/join/")
        let body = try #require(request.httpBody)
        let sent = try JSONSerialization.jsonObject(with: body) as? [String: String]
        #expect(sent == ["code": "KH3Y8U"])
    }

    @Test("Every refusal keeps its code — the server sends them all as 400")
    func refusalsAreTyped() async throws {
        let cases: [(String, LiveQuizRefusal.Reason)] = [
            ("bad_code", .badCode), ("not_in_class", .notInClass), ("host_cannot_play", .hostCannotPlay),
            ("removed", .removed), ("room_full", .roomFull), ("feature_off", .featureOff),
            ("bad_state", .finished), ("brand_new", .other("brand_new")),
        ]
        for (code, reason) in cases {
            server.handler = { _ in .json(["detail": "Sentence for \(code).", "code": code], status: 400) }
            do {
                _ = try await api().join(code: "ABC234")
                Issue.record("expected a refusal for \(code)")
            } catch let refusal as LiveQuizRefusal {
                #expect(refusal.reason == reason)
                #expect(refusal.errorDescription == "Sentence for \(code).")
            }
        }
    }

    @Test("A fixed server's 403 and 404 carry the same codes, and read the same")
    func properStatusesAreTypedToo() async throws {
        server.handler = { _ in .json(["detail": "This live quiz belongs to a class you are not in.", "code": "not_in_class"], status: 403) }
        await #expect(throws: LiveQuizRefusal(reason: .notInClass, detail: "This live quiz belongs to a class you are not in.", status: 403)) {
            _ = try await api().join(code: "ABC234")
        }
        server.handler = { _ in .json(["detail": "Live quizzes are not switched on.", "code": "feature_off"], status: 404) }
        await #expect(throws: LiveQuizRefusal(reason: .featureOff, detail: "Live quizzes are not switched on.", status: 404)) {
            _ = try await api().mine()
        }
    }

    @Test("A refusal with no sentence falls back to the server's own wording")
    func fallbackSentences() {
        #expect(LiveQuizRefusal(reason: .badCode).errorDescription == "That code does not match a live quiz.")
        #expect(LiveQuizRefusal(reason: .removed).errorDescription == "The host removed you from this quiz.")
        #expect(LiveQuizRefusal(reason: .roomFull).errorDescription == "This live quiz is full.")
    }

    @Test("The running list keeps the rows it can read and has no codes")
    func mineDecodes() async throws {
        server.handler = { _ in
            var noCode = LiveQuizFixtures.summary(id: 2, status: "QUESTION_ACTIVE")
            noCode.removeValue(forKey: "join_code")
            return .json(["results": [noCode, ["title": "no id"], LiveQuizFixtures.summary(id: 3, code: NSNull())]])
        }
        let rows = try await api().mine()
        #expect(rows.map(\.id) == [2, 3])
        #expect(rows[0].joinCode == nil && rows[1].joinCode == nil)
        #expect(rows[0].status == .questionActive && rows[0].status.isLive)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/livequiz/mine/")
    }

    @Test("Switched on, switched off, and could not tell are three different answers")
    func isEnabled() async throws {
        server.handler = { _ in .json(["results": []]) }
        #expect(await api().isEnabled() == true)
        server.handler = { _ in .json(["detail": "Live quizzes are not switched on.", "code": "feature_off"], status: 400) }
        #expect(await api().isEnabled() == false)
        server.handler = { _ in StubResponse(error: URLError(.notConnectedToInternet)) }
        #expect(await api().isEnabled() == nil)
    }

    @Test("Results give the room and only the student's own row")
    func resultsDecode() async throws {
        server.handler = { _ in
            .json(["session": LiveQuizFixtures.summary(status: "FINISHED"), "report": [
                "participants": [[
                    "participant_id": 4, "user_id": 2, "display_name": "Ali Valiyev", "score": 150, "rank": 1,
                    "correct_count": 1, "answered_count": 6, "answers": [],
                ]],
                "questions": [["question_id": 7, "order": 0, "prompt": "abate", "correct_answer": "D", "answered": 1, "correct": 0, "by_choice": ["A": 1]]],
            ]])
        }
        let results = try await api().results(sessionId: 1)
        #expect(results.session.status == .finished)
        #expect(results.myRows.map(\.id) == [4])
        #expect(results.myRows.first?.rank == 1)
        #expect(results.questionCount == 1)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/livequiz/sessions/1/results/")
    }
}

// MARK: - The code field

@Suite struct LiveQuizCodeTests {
    @Test("Typed as the board shows it: upper-case letters and digits, six at most")
    func normalises() {
        #expect(LiveQuizCode.normalized("kh3y8u") == "KH3Y8U")
        #expect(LiveQuizCode.normalized(" KH3-Y8U ") == "KH3Y8U")
        #expect(LiveQuizCode.normalized("KH3Y8U99") == "KH3Y8U")
        #expect(LiveQuizCode.normalized("k h 3") == "KH3")
        #expect(LiveQuizCode.normalized("é!?") == "")
        #expect(!LiveQuizCode.isComplete("KH3Y8"))
        #expect(LiveQuizCode.isComplete("kh3y8u"))
    }

    @Test("A Cyrillic look-alike is read as the Latin letter it looks like")
    func cyrillicLookalikes() {
        // К, Н, У typed on a Russian keyboard off the board.
        #expect(LiveQuizCode.normalized("КН3У8U") == "KH3Y8U")
        #expect(LiveQuizCode.normalized("авсехр") == "ABCEXP")
        // A Cyrillic letter with no Latin twin is dropped, as any other symbol is.
        #expect(LiveQuizCode.normalized("Ж2") == "2")
    }
}

// MARK: - The handshake

@Suite struct LiveQuizSocketRequestTests {
    @Test("Production: wss, the trailing slash, the Bearer token, and an Origin of our own")
    func production() async throws {
        let client = APIClient(
            config: APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/1.1.0"),
            storage: InMemoryTokenStorage(TokenPair(access: "ACCESS", refresh: "R"))
        )
        let request = try await client.liveQuizSocketRequest(sessionId: 12)
        #expect(request.url?.absoluteString == "wss://mastersat.uz/ws/livequiz/12/")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer ACCESS")
        #expect(request.value(forHTTPHeaderField: "Origin") == "https://mastersat.uz")
        #expect(request.value(forHTTPHeaderField: "X-MasterSAT-Client") == "ios/1.1.0")
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        #expect(request.httpShouldHandleCookies == false)
    }

    @Test("A local backend: ws, and the port stays on both the URL and the Origin")
    func local() throws {
        let request = try APIClient.liveQuizSocketRequest(
            sessionId: 3, baseURL: URL(string: "http://localhost:8000")!, accessToken: "T", clientIdentifier: "ios/dev"
        )
        #expect(request.url?.absoluteString == "ws://localhost:8000/ws/livequiz/3/")
        #expect(request.value(forHTTPHeaderField: "Origin") == "http://localhost:8000")
    }

    @Test("A base URL with a trailing slash does not double it")
    func trailingSlash() throws {
        let request = try APIClient.liveQuizSocketRequest(
            sessionId: 5, baseURL: URL(string: "https://mastersat.uz/")!, accessToken: "T", clientIdentifier: "ios"
        )
        #expect(request.url?.absoluteString == "wss://mastersat.uz/ws/livequiz/5/")
    }

    @Test("Signed out: there is nothing to authenticate the socket with")
    func signedOut() async {
        let client = APIClient(
            config: APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios"),
            storage: InMemoryTokenStorage()
        )
        await #expect(throws: APIError.self) { _ = try await client.liveQuizSocketRequest(sessionId: 1) }
    }
}

// MARK: - Frames

@Suite struct LiveQuizMessageTests {
    typealias F = LiveQuizFixtures

    @Test("session_state carries the whole room, the open question and our own row")
    func sessionState() throws {
        let text = F.frame("session_state", F.state(
            status: "QUESTION_ACTIVE", question: F.question(), endsAt: "2026-09-26T10:34:55.021235+00:00", currentIndex: 0
        ))
        guard case .sessionState(let s) = try #require(LiveQuizServerMessage.decode(text)) else {
            Issue.record("not a session_state"); return
        }
        #expect(s.status == .questionActive)
        #expect(s.joinCode == "KH3Y8U")
        #expect(s.currentIndex == 0 && s.questionTotal == 6)
        #expect(s.question?.id == 7)
        #expect(s.question?.choices.map(\.id) == ["A", "B", "C", "D"])
        #expect(s.question?.questionPrompt == "Which word means this?")
        #expect(s.endsAt == JSONCoding.parseServerDate("2026-09-26T10:34:55.021235+00:00"))
        #expect(s.me?.id == 1 && s.me?.userId == 2)
        #expect(s.participants.count == 1)
        #expect(s.config.questionSeconds == 20 && s.config.revealCorrectness)
    }

    @Test("The three lobby frames all carry the players")
    func lobbyFrames() throws {
        for type in ["participant_joined", "participant_left", "lobby_updated"] {
            let text = F.frame(type, ["session_id": 1, "status": "LOBBY", "participants": [F.participant(), F.participant(id: 2, userId: 3)],
                                      "participant_count": 2, "present_count": 2])
            #expect(LiveQuizServerMessage.decode(text) == .lobby(participants: [
                LiveQuizParticipant(id: 1, userId: 2, displayName: "Ali Valiyev", present: true, answeredCount: 1),
                LiveQuizParticipant(id: 2, userId: 3, displayName: "Ali Valiyev", present: true, answeredCount: 1),
            ]))
        }
    }

    @Test("A question frame decodes with both timestamps")
    func questionStarted() throws {
        let text = F.frame("question_started", ["question": F.question(), "started_at": "2026-09-26T10:34:35.021235+00:00",
                                                "ends_at": "2026-09-26T10:34:55.021235+00:00"])
        guard case .questionStarted(let q, let startedAt, let endsAt) = try #require(LiveQuizServerMessage.decode(text)) else {
            Issue.record("not question_started"); return
        }
        #expect(q.id == 7 && q.number == 1 && q.total == 6 && q.timeLimitSeconds == 20)
        let start = try #require(startedAt)
        let end = try #require(endsAt)
        #expect(abs(end.timeIntervalSince(start) - 20) < 0.01)
    }

    @Test("answer_result, with the verdict and without it")
    func answerResult() {
        #expect(LiveQuizServerMessage.decode(F.frame("answer_result", [
            "question_id": 7, "accepted": true, "response_time_ms": 43, "is_correct": true, "points_awarded": 150,
        ])) == .answerResult(LiveQuizAnswerResult(questionId: 7, responseTimeMs: 43, isCorrect: true, pointsAwarded: 150)))
        #expect(LiveQuizServerMessage.decode(F.frame("answer_result", [
            "question_id": 7, "accepted": true, "response_time_ms": 43,
        ])) == .answerResult(LiveQuizAnswerResult(questionId: 7, responseTimeMs: 43)))
    }

    @Test("question_ended brings the key, the example sentence and the tally")
    func questionEnded() throws {
        let text = F.frame("question_ended", ["question": F.question(), "correct_answer": "A", "explanation": "The storm began to abate.",
                                              "tally": ["answered": 3, "playing": 4, "correct": 2, "incorrect": 1, "by_choice": ["A": 2, "B": "1"]]])
        guard case .questionEnded(let reveal) = try #require(LiveQuizServerMessage.decode(text)) else {
            Issue.record("not question_ended"); return
        }
        #expect(reveal.correctAnswer == "A")
        #expect(reveal.correctChoiceText == "abate")
        #expect(reveal.explanation == "The storm began to abate.")
        #expect(reveal.tally == LiveQuizTally(answered: 3, playing: 4, correct: 2, incorrect: 1, byChoice: ["A": 2, "B": 1]))
    }

    @Test("The rest: countdown, warning, standings, pause, resume, stop, finish, removal, error, pong")
    func everythingElse() throws {
        #expect(LiveQuizServerMessage.decode(F.frame("game_started", ["countdown_seconds": 3])) == .gameStarted(countdownSeconds: 3))
        #expect(LiveQuizServerMessage.decode(F.frame("question_time_warning", ["seconds_left": 5])) == .timeWarning(secondsLeft: 5))
        #expect(LiveQuizServerMessage.decode(F.frame("leaderboard_updated", ["rows": [F.participant(score: 150)]]))
            == .leaderboard(rows: [LiveQuizParticipant(id: 1, userId: 2, displayName: "Ali Valiyev", score: 150, correctCount: 1, answeredCount: 1)]))

        guard case .paused(let paused) = try #require(LiveQuizServerMessage.decode(F.frame("game_paused", F.state(status: "PAUSED", me: nil)))) else {
            Issue.record("not paused"); return
        }
        #expect(paused.status == .paused && paused.me == nil)
        guard case .resumed(let resumed) = try #require(LiveQuizServerMessage.decode(F.frame("game_resumed", F.state(
            status: "QUESTION_ACTIVE", question: F.question(), endsAt: "2026-09-26T10:35:30+00:00", me: nil)))) else {
            Issue.record("not resumed"); return
        }
        #expect(resumed.status == .questionActive && resumed.endsAt != nil)
        guard case .terminated(let stopped) = try #require(LiveQuizServerMessage.decode(F.frame("session_terminated", F.state(status: "TERMINATED")))) else {
            Issue.record("not terminated"); return
        }
        #expect(stopped?.status == .terminated)

        guard case .finished(let rows, let session) = try #require(LiveQuizServerMessage.decode(F.frame("game_finished", [
            "leaderboard": ["rows": [F.participant(score: 150, rank: 1), F.participant(id: 2, userId: 3, score: 100, rank: 2)]],
            "session": F.state(status: "FINISHED"),
        ]))) else {
            Issue.record("not finished"); return
        }
        #expect(rows.map(\.rank) == [1, 2])
        #expect(session?.status == .finished)

        #expect(LiveQuizServerMessage.decode(F.frame("removed_from_session", ["participant_id": 4])) == .removed(participantId: 4))
        #expect(LiveQuizServerMessage.decode(F.frame("error", ["code": "too_late", "detail": "Time is up for that question."]))
            == .error(code: "too_late", detail: "Time is up for that question."))
        #expect(LiveQuizServerMessage.decode(F.frame("pong", ["ts": "2026-09-26T10:36:28.143000+00:00"]))
            == .pong(serverTime: JSONCoding.parseServerDate("2026-09-26T10:36:28.143000+00:00")))
    }

    @Test("Anything unknown or broken is ignored, never a crash")
    func defensive() {
        // A frame this build has never heard of, and the host-only tally a student never gets.
        #expect(LiveQuizServerMessage.decode(F.frame("confetti", ["colour": "gold"])) == .unknown(type: "confetti"))
        #expect(LiveQuizServerMessage.decode(F.frame("answer_tally", ["answered": 1])) == .unknown(type: "answer_tally"))
        // Known types whose bodies make no sense.
        #expect(LiveQuizServerMessage.decode(F.frame("question_started", ["question": ["prompt": "no id"]])) == .unknown(type: "question_started"))
        #expect(LiveQuizServerMessage.decode(F.frame("session_state", ["participants": []])) == .unknown(type: "session_state"))
        #expect(LiveQuizServerMessage.decode(F.frame("removed_from_session", [:])) == .unknown(type: "removed_from_session"))
        #expect(LiveQuizServerMessage.decode(#"{"type": "answer_result", "data": "nonsense"}"#) == .unknown(type: "answer_result"))
        // Not frames at all.
        #expect(LiveQuizServerMessage.decode("not json") == nil)
        #expect(LiveQuizServerMessage.decode(#"{"data": {}}"#) == nil)
        #expect(LiveQuizServerMessage.decode("[1, 2]") == nil)
        // A frame with no body at all still means what its type says.
        #expect(LiveQuizServerMessage.decode(#"{"type": "game_started"}"#) == .gameStarted(countdownSeconds: 3))
        #expect(LiveQuizServerMessage.decode(#"{"type": "pong"}"#) == .pong(serverTime: nil))
    }

    @Test("One bad player row costs that row, not the room")
    func lossyRows() throws {
        let text = F.frame("session_state", F.state(participants: [F.participant(), ["display_name": "no id"], F.participant(id: 3, userId: 9)]))
        guard case .sessionState(let s) = try #require(LiveQuizServerMessage.decode(text)) else {
            Issue.record("not a session_state"); return
        }
        #expect(s.participants.map(\.id) == [1, 3])
    }

    @Test("What the app sends, byte for byte")
    func clientFrames() {
        #expect(LiveQuizClientMessage.heartbeat.text == #"{"type":"heartbeat"}"#)
        #expect(LiveQuizClientMessage.submitAnswer(questionId: 7, answer: "B").text == #"{"answer":"B","question_id":7,"type":"submit_answer"}"#)
        #expect(LiveQuizClientMessage.leaveSession.text == #"{"type":"leave_session"}"#)
    }
}

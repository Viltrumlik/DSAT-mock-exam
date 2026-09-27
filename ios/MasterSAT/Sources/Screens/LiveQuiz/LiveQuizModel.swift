import SwiftUI
import MasterSATKit

/// The live game's screen state: the room (`LiveQuizGame`, from the kit), the line to it, and
/// the choice the student has picked but not sent.
///
/// The socket lives in `LiveQuizConnection` (an actor); its frames arrive here through
/// `events`, on the main actor, and nowhere else — so nothing off the main actor ever
/// touches what the screen draws.
@MainActor
@Observable
final class LiveQuizModel {
    enum Link: Equatable {
        /// The first attempt, or one after `retry()`.
        case connecting
        case open
        /// The line went and it is coming back — "Lost contact — trying to reconnect."
        case reconnecting
        /// Nothing more will come over this connection.
        case ended
    }

    let sessionId: Int
    /// The vocabulary set's name, when the screen was opened knowing it.
    let title: String
    private(set) var game: LiveQuizGame
    private(set) var link: Link = .connecting
    /// Why the room will not have us, once the connection has ended for good.
    private(set) var denial: LiveQuizDenial?
    /// Asking REST why the socket was refused.
    private(set) var diagnosing = false
    /// The option picked for the open question, not yet sent.
    private(set) var draft: String?
    /// Bumped by `retry()`; the screen restarts `run()` when it changes.
    private(set) var attempt = 0
    /// Changes when a result card appears, for the haptic.
    private(set) var outcomeTick = 0

    private let client: APIClient
    private let api: LiveQuizAPI
    private var connection: LiveQuizConnection?
    private var draftQuestionId: Int?
    private var lastOutcomeQuestionId: Int?

    init(sessionId: Int, participantId: Int?, title: String?, client: APIClient) {
        self.sessionId = sessionId
        self.title = title ?? ""
        self.client = client
        self.api = LiveQuizAPI(client: client)
        self.game = LiveQuizGame(sessionId: sessionId, participantId: participantId)
    }

    // MARK: - The connection

    /// Connect and play until the room ends or the screen goes away. Runs in the screen's
    /// `.task(id: attempt)`, so leaving the screen cancels it and closes the socket.
    func run() async {
        let connection = LiveQuizConnection(sessionId: sessionId, client: client)
        self.connection = connection
        denial = nil
        link = .connecting
        await connection.start()
        for await event in connection.events {
            await handle(event, on: connection)
        }
        await connection.stop()
        if self.connection === connection { self.connection = nil }
    }

    /// After a refusal nothing explained: try the whole connection again.
    func retry() {
        denial = nil
        link = .connecting
        attempt += 1
    }

    /// Background closes the socket (a suspended phone cannot answer, and a lingering socket
    /// counts the student as present); the foreground reconnects at once.
    func scenePhaseChanged(_ phase: ScenePhase) {
        guard let connection else { return }
        switch phase {
        case .background:
            Task { await connection.suspend() }
        case .active:
            Task { await connection.resume() }
        default:
            break
        }
    }

    /// Leaving: the place in the room is kept, and the running list can bring them back.
    func leave() {
        guard let connection else { return }
        Task { await connection.stop() }
    }

    private func handle(_ event: LiveQuizConnectionEvent, on connection: LiveQuizConnection) async {
        switch event {
        case .connecting(let attempt):
            link = attempt == 0 ? .connecting : .reconnecting
        case .open:
            link = .open
        case .dropped:
            link = .reconnecting
        case .message(let message, let receipt):
            let outbound = game.apply(message, receivedAt: receipt.receivedAt, heartbeatSentAt: receipt.heartbeatSentAt)
            afterFrame()
            for frame in outbound {
                _ = await connection.send(frame)
            }
            if game.phase.isFinal {
                // Finished, stopped or removed: nothing more will happen in this room.
                await connection.stop()
            }
        case .ended(let end):
            link = .ended
            await explain(end)
        }
    }

    private func afterFrame() {
        // A new question clears the choice picked for the last one.
        let open = game.question?.id
        if open != draftQuestionId {
            draft = nil
            draftQuestionId = open
        }
        if game.phase == .results, let closed = game.reveal?.question.id, closed != lastOutcomeQuestionId {
            lastOutcomeQuestionId = closed
            outcomeTick += 1
        }
    }

    private func explain(_ end: LiveQuizConnectionEnd) async {
        if let known = LiveQuizDenial(end: end) {
            denial = known
            return
        }
        guard case .refused = end else { return }
        // Every refusal is the same bare 403 at the handshake; the room's report says which.
        diagnosing = true
        let result: Result<LiveQuizResults, any Error>
        do {
            result = .success(try await api.results(sessionId: sessionId))
        } catch {
            result = .failure(error)
        }
        denial = LiveQuizDenial.diagnose(result)
        diagnosing = false
    }

    // MARK: - Answering

    /// The option shown as chosen: the one just picked, or else the one sent.
    var shownChoice: String? {
        draft ?? game.currentAnswer?.choice
    }

    var isSending: Bool {
        game.currentAnswer?.state == .sending
    }

    func pick(_ choiceId: String) {
        guard game.canSubmit(at: Date()) else { return }
        draft = choiceId
    }

    /// Send the picked option. If the line is down it stays "sending" and goes again as soon
    /// as the room comes back (`LiveQuizGame` hands the frame back from `session_state`).
    func submit() {
        guard let choice = draft, let frame = game.submit(choice, at: Date()) else { return }
        draft = nil
        guard let connection else { return }
        Task { _ = await connection.send(frame) }
    }
}

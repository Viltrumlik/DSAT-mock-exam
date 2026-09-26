import Foundation

/// What the connection tells its owner, in order, on `LiveQuizConnection.events`.
public enum LiveQuizConnectionEvent: Sendable, Equatable {
    /// An attempt is starting. `attempt` counts the failures since the socket was last open.
    case connecting(attempt: Int)
    /// The socket is open: the room's first frame arrived.
    case open
    case message(LiveQuizServerMessage, LiveQuizReceipt)
    /// The line went; the next attempt is in `retryIn` seconds (or sooner, on `resume()`).
    case dropped(retryIn: TimeInterval)
    /// Final — the stream finishes after this.
    case ended(LiveQuizConnectionEnd)
}

/// When a frame arrived, and — for a `pong` — when the heartbeat it answers left.
public struct LiveQuizReceipt: Sendable, Equatable {
    public let receivedAt: Date
    public let heartbeatSentAt: Date?

    public init(receivedAt: Date, heartbeatSentAt: Date? = nil) {
        self.receivedAt = receivedAt
        self.heartbeatSentAt = heartbeatSentAt
    }
}

/// Why the connection gave up.
public enum LiveQuizConnectionEnd: Sendable, Equatable {
    /// The upgrade was refused with this HTTP status even with a freshly refreshed token.
    /// Every refusal the server makes looks like this (uvicorn turns the consumer's close
    /// codes into a bare 403), so the reason has to be found over REST.
    case refused(status: Int)
    /// The server closed the socket with one of its own codes. The only one a player sees
    /// today is 4403 after `removed_from_session`.
    case closed(code: Int, wasOpen: Bool)
    /// No token pair, or the refresh was rejected: the app is signing the student out.
    case signedOut
    /// `stop()` was called.
    case stopped
}

/// Timings and the rules for what a failure means. The web's backoff (1 s, ×1.8, 15 s cap)
/// and heartbeat (25 s), plus a liveness check the browser does not need: a phone switching
/// from Wi-Fi to mobile data can hold a dead socket that never errors, so a heartbeat that
/// goes unanswered for `heartbeatTimeout` ends the socket and a new one is opened.
public struct LiveQuizReconnectPolicy: Sendable, Equatable {
    public var firstDelay: TimeInterval
    public var growth: Double
    public var maxDelay: TimeInterval
    public var heartbeatInterval: TimeInterval
    public var heartbeatTimeout: TimeInterval

    public init(
        firstDelay: TimeInterval = 1, growth: Double = 1.8, maxDelay: TimeInterval = 15,
        heartbeatInterval: TimeInterval = 25, heartbeatTimeout: TimeInterval = 10
    ) {
        self.firstDelay = firstDelay
        self.growth = growth
        self.maxDelay = maxDelay
        self.heartbeatInterval = heartbeatInterval
        self.heartbeatTimeout = heartbeatTimeout
    }

    public static let standard = LiveQuizReconnectPolicy()

    /// The wait before the next attempt, after `failures` failed ones in a row.
    public func delay(afterFailures failures: Int) -> TimeInterval {
        var delay = firstDelay
        for _ in 0..<max(0, failures) {
            delay *= growth
            if delay >= maxDelay { return maxDelay }
        }
        return min(delay, maxDelay)
    }

    public enum Verdict: Sendable, Equatable {
        case retry
        /// Renew the token, then try again at once — once.
        case refreshThenRetry
        case end(LiveQuizConnectionEnd)
    }

    public static func verdict(for failure: LiveQuizSocketFailure, wasOpen: Bool, refreshedAlready: Bool) -> Verdict {
        switch failure {
        case .lost:
            return .retry
        case .refused(let status):
            switch status {
            case 401, 403:
                // An expired access token is refused exactly like a student with no place
                // (uvicorn: 403 either way). One refresh tells them apart: a refusal that
                // survives a fresh token is not about the token.
                return refreshedAlready ? .end(.refused(status: status)) : .refreshThenRetry
            case 408, 425, 429, 500...599:
                // The server or nginx having a moment — a deploy restarts uvicorn.
                return .retry
            default:
                // Any other answer to this exact request will be the same answer.
                return .end(.refused(status: status))
            }
        case .closed(let code):
            switch code {
            case 4401:
                return refreshedAlready ? .end(.closed(code: code, wasOpen: wasOpen)) : .refreshThenRetry
            case 4000...4999:
                return .end(.closed(code: code, wasOpen: wasOpen))
            default:
                // 1000/1001/1006/1011/1012: the server went away or restarted. Come back.
                return .retry
            }
        }
    }
}

/// One student's socket to one room, kept alive.
///
/// Connects with the app's own token (`APIClient.liveQuizSocketRequest`), heartbeats,
/// reconnects with backoff after a drop, renews an expired token once on a refused
/// handshake, and gives up only when the server's answer will not change. Everything it hears
/// goes out on `events` — the only way out of the actor — so the receive loop never touches
/// anyone else's state, and a `@MainActor` owner reads the frames on its own actor.
///
/// Nothing is replayed on a reconnect: the server sends a complete `session_state` on every
/// connect, and `LiveQuizGame` rebuilds the room from it.
public actor LiveQuizConnection {
    public nonisolated let events: AsyncStream<LiveQuizConnectionEvent>
    private let continuation: AsyncStream<LiveQuizConnectionEvent>.Continuation

    private let sessionId: Int
    private let client: APIClient
    private let factory: any LiveQuizSocketFactory
    private let policy: LiveQuizReconnectPolicy

    private enum Mode { case idle, running, suspended, stopped }
    private var mode: Mode = .idle
    private var loop: Task<Void, Never>?
    private var socket: (any LiveQuizSocket)?
    private var socketIsOpen = false
    private var heartbeat: Task<Void, Never>?
    private var heartbeatSentAt: Date?
    private var lastFrameAt = Date.distantPast
    /// A socket this side closed because it stopped answering.
    private var abandoned: ObjectIdentifier?
    private var wake: CheckedContinuation<Void, Never>?
    private var wakeTimer: Task<Void, Never>?
    /// Which wait a timer belongs to, so a late timer cannot end the next wait early.
    private var waitGeneration = 0
    /// A `resume()` that arrived while nothing was waiting — the next wait is skipped.
    private var pendingWake = false

    public init(
        sessionId: Int,
        client: APIClient,
        factory: any LiveQuizSocketFactory = URLSessionLiveQuizSocketFactory.shared,
        policy: LiveQuizReconnectPolicy = .standard
    ) {
        let (stream, continuation) = AsyncStream.makeStream(of: LiveQuizConnectionEvent.self)
        self.events = stream
        self.continuation = continuation
        self.sessionId = sessionId
        self.client = client
        self.factory = factory
        self.policy = policy
        // The owner stopped listening (its task was cancelled, or it went away): nobody is
        // left to play, so the socket must not stay open counting the student as present.
        continuation.onTermination = { [weak self] _ in
            Task { await self?.stop() }
        }
    }

    // MARK: - Control

    /// Connect, and keep connecting until `stop()` or a final refusal.
    public func start() {
        guard mode == .idle else { return }
        mode = .running
        loop = Task { await self.run() }
    }

    /// Close for good. Nothing more is sent on `events` after `.ended(.stopped)`.
    public func stop() {
        guard mode != .stopped else { return }
        let neverStarted = mode == .idle
        mode = .stopped
        closeSocket()
        fireWake()
        if neverStarted { finish(.stopped) }
    }

    /// The app went to the background: close the socket and stay closed until `resume()`.
    ///
    /// A suspended app cannot answer anyway, and while its socket lingers the server counts
    /// the student as present — which stops a question closing early when everyone else
    /// has answered.
    public func suspend() {
        guard mode == .running else { return }
        mode = .suspended
        closeSocket()
        fireWake()
    }

    /// Back in the foreground, or "Try again": reconnect now rather than after the backoff.
    public func resume() {
        switch mode {
        case .suspended:
            mode = .running
            fireWake()
        case .running:
            // Only a wait is cut short; an open socket is left alone.
            if !socketIsOpen { fireWake() }
        case .idle, .stopped:
            break
        }
    }

    /// Send a frame. False when there is no open socket or the write failed — the caller's
    /// answer is sent again from `session_state` once the room comes back.
    public func send(_ message: LiveQuizClientMessage) async -> Bool {
        guard socketIsOpen, let socket else { return false }
        do {
            try await socket.send(message.text)
            return true
        } catch {
            return false
        }
    }

    // MARK: - The loop

    private func run() async {
        var failures = 0
        var refreshed = false

        while true {
            if mode == .stopped { break }
            if mode == .suspended {
                await sleepUntilWoken(after: nil)
                continue
            }

            continuation.yield(.connecting(attempt: failures))
            let request: URLRequest
            do {
                request = try await client.liveQuizSocketRequest(sessionId: sessionId)
            } catch {
                finish(.signedOut)
                return
            }
            // Stopped or suspended while the request was being built.
            guard mode == .running else { continue }

            let socket = factory.makeSocket(for: request)
            self.socket = socket
            socketIsOpen = false
            socket.open()

            var wasOpen = false
            var failure = LiveQuizSocketFailure.lost
            do {
                while true {
                    let text = try await socket.receive()
                    let now = Date()
                    lastFrameAt = now
                    if !wasOpen {
                        wasOpen = true
                        socketIsOpen = true
                        failures = 0
                        refreshed = false
                        pendingWake = false
                        continuation.yield(.open)
                        startHeartbeat(for: socket)
                    }
                    guard let message = LiveQuizServerMessage.decode(text) else { continue }
                    var sentAt: Date?
                    if case .pong = message {
                        sentAt = heartbeatSentAt
                        heartbeatSentAt = nil
                    }
                    continuation.yield(.message(message, LiveQuizReceipt(receivedAt: now, heartbeatSentAt: sentAt)))
                }
            } catch let socketFailure as LiveQuizSocketFailure {
                failure = socketFailure
            } catch {
                failure = .lost
            }

            stopHeartbeat()
            socketIsOpen = false
            if self.socket === socket { self.socket = nil }
            let wentQuiet = abandoned == ObjectIdentifier(socket)
            if wentQuiet { abandoned = nil }
            socket.close()

            if mode == .stopped { break }
            // Closed on purpose for the background; wait for `resume()` at the top.
            if mode == .suspended { continue }
            if wentQuiet { failure = .lost }

            switch LiveQuizReconnectPolicy.verdict(for: failure, wasOpen: wasOpen, refreshedAlready: refreshed) {
            case .retry:
                await backOff(&failures)
            case .refreshThenRetry:
                do {
                    try await client.refreshTokens()
                    refreshed = true
                } catch {
                    if APIClient.refreshFailureEndsSession(error) {
                        finish(.signedOut)
                        return
                    }
                    // Offline, or the server is deploying: the token may be fine. Wait and
                    // try the socket again; it will ask for the refresh again if it needs one.
                    await backOff(&failures)
                }
            case .end(let end):
                finish(end)
                return
            }
        }
        finish(.stopped)
    }

    private func backOff(_ failures: inout Int) async {
        // A little jitter, so a room of sixty phones that lost the server together does not
        // come back in the same millisecond.
        let delay = policy.delay(afterFailures: failures) * Double.random(in: 0.85...1.15)
        failures += 1
        continuation.yield(.dropped(retryIn: delay))
        await sleepUntilWoken(after: delay)
    }

    private func finish(_ end: LiveQuizConnectionEnd) {
        mode = .stopped
        stopHeartbeat()
        closeSocket()
        fireWake()
        continuation.yield(.ended(end))
        continuation.finish()
    }

    private func closeSocket() {
        socketIsOpen = false
        socket?.close()
    }

    // MARK: - Waiting

    /// Wait for `delay` seconds, or until `resume()`/`stop()`; with no delay, only the latter.
    private func sleepUntilWoken(after delay: TimeInterval?) async {
        guard mode != .stopped else { return }
        if pendingWake {
            pendingWake = false
            return
        }
        waitGeneration += 1
        let generation = waitGeneration
        await withCheckedContinuation { (waiter: CheckedContinuation<Void, Never>) in
            wake = waiter
            if let delay {
                wakeTimer = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(max(0, delay)))
                    if Task.isCancelled { return }
                    await self?.timerFired(generation)
                }
            }
        }
    }

    private func timerFired(_ generation: Int) {
        guard generation == waitGeneration, let waiter = wake else { return }
        wake = nil
        wakeTimer = nil
        waiter.resume()
    }

    private func fireWake() {
        wakeTimer?.cancel()
        wakeTimer = nil
        if let waiter = wake {
            wake = nil
            waiter.resume()
        } else if mode != .stopped {
            pendingWake = true
        }
    }

    // MARK: - Heartbeat

    private func startHeartbeat(for socket: any LiveQuizSocket) {
        heartbeat?.cancel()
        let interval = policy.heartbeatInterval
        let timeout = min(policy.heartbeatTimeout, interval)
        heartbeat = Task { [weak self] in
            // The first beat goes at once: its pong measures the server's clock before the
            // first countdown needs it.
            while !Task.isCancelled {
                guard let sentAt = await self?.beat(socket) else { return }
                try? await Task.sleep(for: .seconds(timeout))
                if Task.isCancelled { return }
                guard let alive = await self?.isAlive(socket, since: sentAt), alive else { return }
                try? await Task.sleep(for: .seconds(max(0, interval - timeout)))
            }
        }
    }

    private func stopHeartbeat() {
        heartbeat?.cancel()
        heartbeat = nil
        heartbeatSentAt = nil
    }

    /// Send one heartbeat on `socket` if it is still the live one. Returns when it left.
    private func beat(_ socket: any LiveQuizSocket) async -> Date? {
        guard socketIsOpen, self.socket === socket else { return nil }
        let now = Date()
        heartbeatSentAt = now
        do {
            try await socket.send(LiveQuizClientMessage.heartbeat.text)
        } catch {
            // The receive side will fail too and report it.
        }
        return now
    }

    /// Whether anything arrived since `since`. If not, the socket is dead in all but name:
    /// close it, and the loop reconnects.
    private func isAlive(_ socket: any LiveQuizSocket, since: Date) -> Bool {
        guard self.socket === socket else { return false }
        if lastFrameAt >= since { return true }
        abandoned = ObjectIdentifier(socket)
        socket.close()
        return false
    }
}

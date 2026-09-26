import Foundation
import Testing
@testable import MasterSATKit

// MARK: - A scripted socket

/// A socket that plays a script: refuse the upgrade, lose the line, or open and hand over
/// frames — then whatever the test pushes. `close()` fails a waiting `receive()` the way
/// URLSession does after this side cancels.
final class FakeLiveQuizSocket: LiveQuizSocket, @unchecked Sendable {
    enum Plan {
        case refuse(Int)
        case lose
        case accept([String])
        case closeAfter([String], code: Int)
    }

    let request: URLRequest
    private let lock = NSLock()
    private var queue: [Result<String, LiveQuizSocketFailure>]
    private var waiter: CheckedContinuation<String, any Error>?
    private var closedByClient = false
    private var sentFrames: [String] = []

    init(request: URLRequest, plan: Plan) {
        self.request = request
        switch plan {
        case .refuse(let status): queue = [.failure(.refused(status: status))]
        case .lose: queue = [.failure(.lost)]
        case .accept(let frames): queue = frames.map { .success($0) }
        case .closeAfter(let frames, let code): queue = frames.map { .success($0) } + [.failure(.closed(code: code))]
        }
    }

    var sent: [String] { lock.withLock { sentFrames } }
    var isClosed: Bool { lock.withLock { closedByClient } }

    func open() {}

    func receive() async throws -> String {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, any Error>) in
            let next: Result<String, LiveQuizSocketFailure>? = lock.withLock {
                if !queue.isEmpty { return queue.removeFirst() }
                if closedByClient { return .failure(.closed(code: 1000)) }
                waiter = continuation
                return nil
            }
            if let next { continuation.resume(with: next.mapError { $0 as any Error }) }
        }
    }

    /// The server sends a frame.
    func push(_ text: String) { deliver(.success(text)) }

    /// The line drops, or the server closes.
    func fail(_ failure: LiveQuizSocketFailure) { deliver(.failure(failure)) }

    private func deliver(_ result: Result<String, LiveQuizSocketFailure>) {
        let waiting: CheckedContinuation<String, any Error>? = lock.withLock {
            if let waiter {
                self.waiter = nil
                return waiter
            }
            queue.append(result)
            return nil
        }
        waiting?.resume(with: result.mapError { $0 as any Error })
    }

    func send(_ text: String) async throws {
        try lock.withLock {
            if closedByClient { throw LiveQuizSocketFailure.lost }
            sentFrames.append(text)
        }
    }

    func close() {
        let waiting: CheckedContinuation<String, any Error>? = lock.withLock {
            closedByClient = true
            let waiting = waiter
            waiter = nil
            return waiting
        }
        waiting?.resume(throwing: LiveQuizSocketFailure.closed(code: 1000))
    }
}

final class FakeLiveQuizSocketFactory: LiveQuizSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private var plans: [FakeLiveQuizSocket.Plan]
    private var made: [FakeLiveQuizSocket] = []

    init(_ plans: [FakeLiveQuizSocket.Plan]) {
        self.plans = plans
    }

    func makeSocket(for request: URLRequest) -> any LiveQuizSocket {
        lock.withLock {
            let plan = plans.isEmpty ? .accept([]) : plans.removeFirst()
            let socket = FakeLiveQuizSocket(request: request, plan: plan)
            made.append(socket)
            return socket
        }
    }

    var sockets: [FakeLiveQuizSocket] { lock.withLock { made } }
}

/// Rejects every request (401), 0.3 s late — without holding the loading thread. CFNetwork
/// runs every custom protocol in the process on one thread, so sleeping in `startLoading`
/// would stall every other suite's stub for as long.
final class LiveQuizLateRejectionProtocol: URLProtocol, @unchecked Sendable {
    final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        var value: Int { lock.withLock { count } }
        func increment() { lock.withLock { count += 1 } }
    }

    private struct Delivery: @unchecked Sendable {
        let protocolInstance: URLProtocol
        let client: (any URLProtocolClient)?
        let url: URL
    }

    static let started = Counter()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.started.increment()
        let delivery = Delivery(protocolInstance: self, client: client, url: request.url!)
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) {
            let response = HTTPURLResponse(url: delivery.url, statusCode: 401, httpVersion: "HTTP/1.1", headerFields: nil)!
            delivery.client?.urlProtocol(delivery.protocolInstance, didReceive: response, cacheStoragePolicy: .notAllowed)
            delivery.client?.urlProtocol(delivery.protocolInstance, didLoad: Data(#"{"detail": "Token is invalid or expired"}"#.utf8))
            delivery.client?.urlProtocolDidFinishLoading(delivery.protocolInstance)
        }
    }

    override func stopLoading() {}
}

actor LiveQuizEventLog {
    private(set) var events: [LiveQuizConnectionEvent] = []

    func append(_ event: LiveQuizConnectionEvent) { events.append(event) }

    var opens: Int { events.filter { $0 == .open }.count }
    var ended: LiveQuizConnectionEnd? {
        for case .ended(let end) in events { return end }
        return nil
    }
    var dropped: Int {
        events.filter { if case .dropped = $0 { return true } else { return false } }.count
    }
    var messages: [LiveQuizServerMessage] {
        events.compactMap { if case .message(let message, _) = $0 { return message } else { return nil } }
    }
    var pongReceipts: [LiveQuizReceipt] {
        events.compactMap { event in
            if case .message(.pong, let receipt) = event { return receipt }
            return nil
        }
    }
}

// MARK: - Tests

@Suite struct LiveQuizConnectionTests {
    let server = StubServer()
    let storage = InMemoryTokenStorage(TokenPair(access: "A", refresh: "R"))
    /// Backoff and heartbeat short enough for a test, long enough not to fire by accident.
    let fast = LiveQuizReconnectPolicy(firstDelay: 0.01, growth: 1, maxDelay: 0.01, heartbeatInterval: 60, heartbeatTimeout: 30)
    let state = LiveQuizFixtures.frame("session_state", LiveQuizFixtures.state())

    private func client(storage: TokenStorage? = nil) -> APIClient {
        APIClient(
            config: APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test"),
            storage: storage ?? self.storage,
            session: server.session()
        )
    }

    private func refreshes() -> Int {
        server.requests.filter { $0.url?.absoluteString.hasSuffix("/api/auth/refresh/") == true }.count
    }

    private func record(_ connection: LiveQuizConnection) -> (LiveQuizEventLog, Task<Void, Never>) {
        let log = LiveQuizEventLog()
        let task = Task {
            for await event in connection.events { await log.append(event) }
        }
        return (log, task)
    }

    private func eventually(_ timeout: TimeInterval = 3, _ condition: @Sendable () async -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return await condition()
    }

    @Test("It opens, says so, hands over the room, and sends a heartbeat at once")
    func opens() async throws {
        let factory = FakeLiveQuizSocketFactory([.accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        #expect(await connection.send(.heartbeat) == false)
        await connection.start()
        #expect(await eventually { await !log.messages.isEmpty })
        let events = await log.events
        #expect(events.prefix(2) == [.connecting(attempt: 0), .open])
        if case .sessionState(let snapshot) = try #require(await log.messages.first) {
            #expect(snapshot.status == .lobby)
        } else {
            Issue.record("the first frame was not the room")
        }

        let socket = try #require(factory.sockets.first)
        #expect(socket.request.url?.absoluteString == "wss://mastersat.uz/ws/livequiz/12/")
        #expect(socket.request.value(forHTTPHeaderField: "Authorization") == "Bearer A")
        #expect(socket.request.value(forHTTPHeaderField: "Origin") == "https://mastersat.uz")
        #expect(await eventually { socket.sent.contains(LiveQuizClientMessage.heartbeat.text) })

        // The pong is paired with the heartbeat it answers, so the game can read the clock.
        socket.push(LiveQuizFixtures.frame("pong", ["ts": "2026-09-26T10:36:28.143000+00:00"]))
        #expect(await eventually { await !log.pongReceipts.isEmpty })
        #expect(await log.pongReceipts.first?.heartbeatSentAt != nil)

        #expect(await connection.send(.submitAnswer(questionId: 7, answer: "B")))
        #expect(socket.sent.contains(#"{"answer":"B","question_id":7,"type":"submit_answer"}"#))

        await connection.stop()
        #expect(await eventually { await log.ended == .stopped })
        #expect(socket.isClosed)
    }

    @Test("A refused handshake renews the token once and tries again with the new one")
    func refreshThenRetry() async throws {
        server.handler = { request in
            request.url?.absoluteString.hasSuffix("/api/auth/refresh/") == true ? .json(["access": "A2", "refresh": "R2"]) : .json([:], status: 404)
        }
        let factory = FakeLiveQuizSocketFactory([.refuse(403), .accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.opens == 1 })
        #expect(factory.sockets.map { $0.request.value(forHTTPHeaderField: "Authorization") } == ["Bearer A", "Bearer A2"])
        #expect(refreshes() == 1)
        // A renewed token is not a failure: the next attempt goes at once, and says it is the first.
        #expect(await log.dropped == 0)
        #expect(await log.events.prefix(3) == [.connecting(attempt: 0), .connecting(attempt: 0), .open])
        await connection.stop()
    }

    @Test("Refused again with a fresh token: final — the reason is for REST to find")
    func refusedTwice() async {
        server.handler = { _ in .json(["access": "A2", "refresh": "R2"]) }
        let factory = FakeLiveQuizSocketFactory([.refuse(403), .refuse(403)])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.ended != nil })
        #expect(await log.ended == .refused(status: 403))
        #expect(refreshes() == 1)
        #expect(factory.sockets.count == 2)
    }

    @Test("A rejected refresh ends it as signed out")
    func refreshRejected() async {
        server.handler = { _ in .json(["detail": "Token is invalid or expired"], status: 401) }
        let factory = FakeLiveQuizSocketFactory([.refuse(403)])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.ended != nil })
        #expect(await log.ended == .signedOut)
        #expect(factory.sockets.count == 1)
    }

    @Test("Stopped while a refresh is in flight: it ends as stopped, even when the refresh then fails")
    func stopDuringRefresh() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LiveQuizLateRejectionProtocol.self]
        let slowClient = APIClient(
            config: APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test"),
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: URLSession(configuration: configuration)
        )
        let before = LiveQuizLateRejectionProtocol.started.value
        let factory = FakeLiveQuizSocketFactory([.refuse(403)])
        let connection = LiveQuizConnection(sessionId: 12, client: slowClient, factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { LiveQuizLateRejectionProtocol.started.value > before })
        await connection.stop()
        #expect(await eventually { await log.ended != nil })
        #expect(await log.ended == .stopped)
    }

    @Test("Offline during the refresh is not a sign-out: back off and try the socket again")
    func refreshOffline() async {
        server.handler = { request in
            request.url?.absoluteString.hasSuffix("/api/auth/refresh/") == true ? StubResponse(error: URLError(.notConnectedToInternet)) : .json([:])
        }
        let factory = FakeLiveQuizSocketFactory([.refuse(403), .accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.opens == 1 })
        #expect(await log.dropped == 1)
        #expect(await log.ended == nil)
        await connection.stop()
    }

    @Test("No token pair: signed out at once, and no socket")
    func signedOut() async {
        let factory = FakeLiveQuizSocketFactory([])
        let connection = LiveQuizConnection(sessionId: 12, client: client(storage: InMemoryTokenStorage()), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.ended != nil })
        #expect(await log.ended == .signedOut)
        #expect(factory.sockets.isEmpty)
    }

    @Test("A dropped line comes back after the backoff, and the room is sent again")
    func reconnects() async throws {
        let factory = FakeLiveQuizSocketFactory([.accept([state]), .accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.opens == 1 })
        try #require(factory.sockets.first).fail(.lost)
        #expect(await eventually { await log.opens == 2 })
        #expect(await log.dropped == 1)
        #expect(await log.events.contains(.connecting(attempt: 1)))
        // `.open` is logged before the frame that opened the socket; wait for the frame too.
        #expect(await eventually {
            await log.messages.filter { if case .sessionState = $0 { return true } else { return false } }.count == 2
        })
        #expect(refreshes() == 0)
        await connection.stop()
    }

    @Test("A deploy's 502 at the handshake is retried, without touching the token")
    func gatewayRetried() async {
        let factory = FakeLiveQuizSocketFactory([.refuse(502), .lose, .accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.opens == 1 })
        #expect(await log.dropped == 2)
        #expect(refreshes() == 0)
        await connection.stop()
    }

    @Test("Removed: the frame arrives, then close 4403 — final, no reconnect")
    func removed() async {
        let removed = LiveQuizFixtures.frame("removed_from_session", ["participant_id": 1])
        let factory = FakeLiveQuizSocketFactory([.closeAfter([state, removed], code: 4403)])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.ended != nil })
        #expect(await log.ended == .closed(code: 4403, wasOpen: true))
        #expect(await log.messages.contains(.removed(participantId: 1)))
        #expect(factory.sockets.count == 1)
    }

    @Test("An answer that will not change (404 at the handshake) is final at once")
    func otherRefusalFinal() async {
        let factory = FakeLiveQuizSocketFactory([.refuse(404)])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.ended != nil })
        #expect(await log.ended == .refused(status: 404))
        #expect(refreshes() == 0)
    }

    @Test("In the background the socket is closed, and nothing reconnects until resumed")
    func suspendAndResume() async throws {
        let factory = FakeLiveQuizSocketFactory([.accept([state]), .accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        #expect(await eventually { await log.opens == 1 })
        await connection.suspend()
        #expect(try #require(factory.sockets.first).isClosed)
        try await Task.sleep(for: .milliseconds(150))
        #expect(factory.sockets.count == 1)
        #expect(await log.dropped == 0)
        #expect(await connection.send(.heartbeat) == false)

        await connection.resume()
        #expect(await eventually { await log.opens == 2 })
        #expect(factory.sockets.count == 2)
        await connection.stop()
    }

    @Test("A socket that stops answering heartbeats is replaced")
    func livenessCheck() async {
        let policy = LiveQuizReconnectPolicy(firstDelay: 0.01, growth: 1, maxDelay: 0.01, heartbeatInterval: 0.3, heartbeatTimeout: 0.1)
        let factory = FakeLiveQuizSocketFactory([.accept([state]), .accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: policy)
        let (log, task) = record(connection)
        defer { task.cancel() }

        await connection.start()
        // Nobody answers the first heartbeat: 0.1 s later the socket is given up and a new one opens.
        #expect(await eventually { await log.opens == 2 })
        #expect(factory.sockets.first?.isClosed == true)
        #expect(await log.dropped >= 1)
        await connection.stop()
    }

    @Test("When its owner stops listening, the connection closes the socket")
    func ownerGone() async throws {
        let factory = FakeLiveQuizSocketFactory([.accept([state])])
        let connection = LiveQuizConnection(sessionId: 12, client: client(), factory: factory, policy: fast)
        let (log, task) = record(connection)

        await connection.start()
        #expect(await eventually { await log.opens == 1 })
        task.cancel()
        let socket = try #require(factory.sockets.first)
        #expect(await eventually { socket.isClosed })
    }

    // MARK: - The rules

    @Test("Backoff: 1 s, then ×1.8, never more than 15 s")
    func backoff() {
        let policy = LiveQuizReconnectPolicy.standard
        #expect(policy.delay(afterFailures: 0) == 1)
        #expect(abs(policy.delay(afterFailures: 1) - 1.8) < 1e-9)
        #expect(abs(policy.delay(afterFailures: 2) - 3.24) < 1e-9)
        #expect(policy.delay(afterFailures: 5) == 15)
        #expect(policy.delay(afterFailures: 500) == 15)
        #expect(policy.heartbeatInterval == 25)
    }

    @Test("What each failure means")
    func verdicts() {
        typealias P = LiveQuizReconnectPolicy
        #expect(P.verdict(for: .lost, wasOpen: true, refreshedAlready: false) == .retry)
        #expect(P.verdict(for: .refused(status: 403), wasOpen: false, refreshedAlready: false) == .refreshThenRetry)
        #expect(P.verdict(for: .refused(status: 403), wasOpen: false, refreshedAlready: true) == .end(.refused(status: 403)))
        #expect(P.verdict(for: .refused(status: 401), wasOpen: false, refreshedAlready: false) == .refreshThenRetry)
        #expect(P.verdict(for: .refused(status: 503), wasOpen: false, refreshedAlready: true) == .retry)
        #expect(P.verdict(for: .refused(status: 429), wasOpen: false, refreshedAlready: false) == .retry)
        #expect(P.verdict(for: .refused(status: 400), wasOpen: false, refreshedAlready: false) == .end(.refused(status: 400)))
        #expect(P.verdict(for: .closed(code: 4403), wasOpen: true, refreshedAlready: false) == .end(.closed(code: 4403, wasOpen: true)))
        #expect(P.verdict(for: .closed(code: 4401), wasOpen: false, refreshedAlready: false) == .refreshThenRetry)
        #expect(P.verdict(for: .closed(code: 4503), wasOpen: false, refreshedAlready: false) == .end(.closed(code: 4503, wasOpen: false)))
        #expect(P.verdict(for: .closed(code: 1001), wasOpen: true, refreshedAlready: false) == .retry)
        #expect(P.verdict(for: .closed(code: 1000), wasOpen: true, refreshedAlready: false) == .retry)
    }
}

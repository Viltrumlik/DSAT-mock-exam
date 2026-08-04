import Foundation

struct StubResponse: @unchecked Sendable {
    var status: Int
    var body: Data
    var headers: [String: String]

    init(status: Int = 200, body: Data = Data("{}".utf8), headers: [String: String] = [:]) {
        self.status = status
        self.body = body
        self.headers = headers
    }

    static func json(_ object: Any, status: Int = 200) -> StubResponse {
        StubResponse(status: status, body: try! JSONSerialization.data(withJSONObject: object))
    }
}

/// One scripted backend, isolated to one test.
///
/// `URLProtocol` subclasses are registered process-wide and instantiated by the loading
/// system, so a handler stored as a static would be shared by every test in the target and
/// tests running in parallel would answer each other's requests. Each server therefore
/// tags its session with an id header and looks itself up from that, which keeps suites
/// independent without forcing the whole target to run serially.
final class StubServer: @unchecked Sendable {
    static let idHeader = "X-Stub-Server"

    let id = UUID().uuidString
    private let lock = NSLock()
    private var _handler: @Sendable (URLRequest) -> StubResponse
    private var _requests: [URLRequest] = []

    init(handler: @escaping @Sendable (URLRequest) -> StubResponse = { _ in .json([:]) }) {
        _handler = handler
        StubRegistry.register(self)
    }

    deinit {
        StubRegistry.unregister(id)
    }

    var handler: @Sendable (URLRequest) -> StubResponse {
        get { lock.lock(); defer { lock.unlock() }; return _handler }
        set { lock.lock(); defer { lock.unlock() }; _handler = newValue }
    }

    /// Every request that reached the network, in order.
    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return _requests
    }

    func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        _requests.append(request)
    }

    /// A session that routes only to this server.
    func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        configuration.httpAdditionalHeaders = [StubServer.idHeader: id]
        return URLSession(configuration: configuration)
    }
}

private enum StubRegistry {
    nonisolated(unsafe) private static var servers: [String: StubServer] = [:]
    private static let lock = NSLock()

    static func register(_ server: StubServer) {
        lock.lock(); defer { lock.unlock() }
        servers[server.id] = server
    }

    static func unregister(_ id: String) {
        lock.lock(); defer { lock.unlock() }
        servers[id] = nil
    }

    static func server(for id: String?) -> StubServer? {
        guard let id else { return nil }
        lock.lock(); defer { lock.unlock() }
        return servers[id]
    }
}

final class StubURLProtocol: URLProtocol {

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // URLProtocol moves the body into `httpBodyStream`; read it back so assertions can
        // inspect what was actually sent.
        var recorded = request
        if recorded.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let size = 4096
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buffer, maxLength: size)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            stream.close()
            recorded.httpBody = data
        }

        let server = StubRegistry.server(for: request.value(forHTTPHeaderField: StubServer.idHeader))
        server?.record(recorded)
        let stub = server?.handler(recorded) ?? StubResponse(status: 500, body: Data("{}".utf8))

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: stub.status,
            httpVersion: "HTTP/1.1",
            headerFields: stub.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

import Foundation

// The WebSocket itself, behind a small protocol so the connection's reconnect rules can be
// tested with a scripted socket — URLProtocol stubs cannot fake a WebSocket.

/// How a socket stopped. Worked out from what URLSession leaves on the task, which was
/// checked against the real server (uvicorn 0.53, Channels 4.3):
///
/// - a refused upgrade — bad `Origin`, no or expired token, no place in the room, feature
///   off — fails the task with `NSURLErrorBadServerResponse` and leaves the HTTP status (403)
///   on `task.response`;
/// - a server close after the socket opened fails `receive()` with POSIX 57 and leaves the
///   code (4403 after a removal) on `task.closeCode`;
/// - no answer at all (offline, reset, server down) leaves neither.
public enum LiveQuizSocketFailure: Error, Sendable, Equatable {
    /// The server answered the upgrade with this HTTP status instead of switching protocols.
    case refused(status: Int)
    /// The socket was open and the server closed it with this code.
    case closed(code: Int)
    /// The line went: offline, timed out, reset.
    case lost
}

/// One WebSocket connection attempt.
public protocol LiveQuizSocket: AnyObject, Sendable {
    /// Start the handshake.
    func open()
    /// The next text frame. Throws `LiveQuizSocketFailure` when the socket is done.
    func receive() async throws -> String
    func send(_ text: String) async throws
    /// Close from this side — normal closure (1000), which the server reads as leaving.
    func close()
}

/// Makes the socket for one attempt.
public protocol LiveQuizSocketFactory: Sendable {
    func makeSocket(for request: URLRequest) -> any LiveQuizSocket
}

// MARK: - URLSession

/// Sockets over `URLSessionWebSocketTask`, on a session that never touches cookies.
///
/// The cookie rules are not tidiness. The server skips CSRF for the app only while a request
/// carries NO auth cookie (`users.auth_cookies.is_native_client`), so a stray `lms_access`
/// in shared storage would switch every REST write into CSRF-enforced mode and fail it.
public struct URLSessionLiveQuizSocketFactory: LiveQuizSocketFactory {
    public static let shared = URLSessionLiveQuizSocketFactory()

    private let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        // Bounds the handshake. An open socket is kept busy by the 25 s heartbeat.
        configuration.timeoutIntervalForRequest = 30
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    public func makeSocket(for request: URLRequest) -> any LiveQuizSocket {
        URLSessionLiveQuizSocket(task: session.webSocketTask(with: request))
    }
}

final class URLSessionLiveQuizSocket: LiveQuizSocket, @unchecked Sendable {
    // `URLSessionWebSocketTask` is thread-safe; nothing else here is mutable.
    private let task: URLSessionWebSocketTask

    init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    func open() {
        task.resume()
    }

    func receive() async throws -> String {
        do {
            switch try await task.receive() {
            case .string(let text):
                return text
            case .data(let data):
                return String(decoding: data, as: UTF8.self)
            @unknown default:
                return ""
            }
        } catch {
            throw failure()
        }
    }

    func send(_ text: String) async throws {
        do {
            try await task.send(.string(text))
        } catch {
            throw failure()
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }

    private func failure() -> LiveQuizSocketFailure {
        if let http = task.response as? HTTPURLResponse, http.statusCode != 101 {
            return .refused(status: http.statusCode)
        }
        let code = task.closeCode.rawValue
        return code == URLSessionWebSocketTask.CloseCode.invalid.rawValue ? .lost : .closed(code: code)
    }
}

// MARK: - The handshake request

extension APIClient {
    /// The authorised handshake for a live-quiz room: `wss://<host>/ws/livequiz/<id>/`.
    ///
    /// Three headers, each load-bearing:
    /// - `Authorization: Bearer <access>` — the socket authenticates the app by it
    ///   (`livequiz/auth.py`); the app never holds the `lms_access` cookie a browser sends.
    /// - `Origin: <scheme>://<host>[:port]` of the API base — the router sits behind Channels'
    ///   `AllowedHostsOriginValidator`, which refuses a handshake with no Origin at all.
    /// - `X-MasterSAT-Client` — the same identification every REST request carries.
    ///
    /// - Throws: `APIError.notAuthenticated` when there is no token pair.
    public func liveQuizSocketRequest(sessionId: Int) throws -> URLRequest {
        guard let tokens = currentTokens() else { throw APIError.notAuthenticated }
        return try Self.liveQuizSocketRequest(
            sessionId: sessionId, baseURL: config.baseURL, accessToken: tokens.access,
            clientIdentifier: config.clientIdentifier
        )
    }

    static func liveQuizSocketRequest(
        sessionId: Int, baseURL: URL, accessToken: String, clientIdentifier: String
    ) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), let host = components.host, !host.isEmpty
        else { throw APIError.transport(underlying: "Could not build the live quiz address") }

        let secure = scheme == "https" || scheme == "wss"
        let origin = "\(secure ? "https" : "http")://\(host)\(components.port.map { ":\($0)" } ?? "")"

        components.scheme = secure ? "wss" : "ws"
        // The trailing slash is required by the route (`^ws/livequiz/(?P<id>\d+)/$`). A base
        // with a path of its own keeps it, as `Endpoint` does for `/api`.
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = "\(basePath)/ws/livequiz/\(sessionId)/"
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw APIError.transport(underlying: "Could not build the live quiz address")
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue(clientIdentifier, forHTTPHeaderField: "X-MasterSAT-Client")
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }
}

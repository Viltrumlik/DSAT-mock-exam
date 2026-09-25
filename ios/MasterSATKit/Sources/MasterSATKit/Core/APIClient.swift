import Foundation

/// The single door to the backend.
///
/// An actor because the token pair is shared mutable state that many screens touch at once
/// — mid-quiz an answer write, a submit and a reload can all be in flight together. That
/// is also why the refresh is *single-flight*: three requests meeting a 401 at the same
/// moment must produce one refresh, not three. Three would be worse than wasteful:
/// rotation revokes the token it spends, so the second and third would present an
/// already-revoked refresh and sign the student out mid-quiz.
public actor APIClient {
    public let config: APIConfig
    private let storage: TokenStorage
    private let session: URLSession
    private var refreshTask: Task<TokenPair, Error>?

    /// Called when the session is definitively over (refresh rejected). The app clears its
    /// UI state and shows the sign-in screen.
    private let onSignOut: @Sendable () -> Void

    /// Things the app as a whole must hear about, whichever screen made the request: the
    /// server refusing this build, and responses the app could not make sense of. The
    /// second is how a phone that has fallen behind its backend gets noticed at all.
    private let onEvent: @Sendable (APIClientEvent) -> Void

    public init(
        config: APIConfig,
        storage: TokenStorage,
        session: URLSession = .shared,
        onSignOut: @escaping @Sendable () -> Void = {},
        onEvent: @escaping @Sendable (APIClientEvent) -> Void = { _ in }
    ) {
        self.config = config
        self.storage = storage
        self.session = session
        self.onSignOut = onSignOut
        self.onEvent = onEvent
    }

    public var isAuthenticated: Bool { storage.load() != nil }

    public func currentTokens() -> TokenPair? { storage.load() }

    public func setTokens(_ pair: TokenPair) { storage.save(pair) }

    public func signOutLocally() {
        refreshTask?.cancel()
        refreshTask = nil
        storage.clear()
    }

    // MARK: - Sending

    /// Send and decode. Retries exactly once, after a successful token refresh.
    public func send<T: Decodable & Sendable>(_ endpoint: Endpoint, as type: T.Type = T.self) async throws -> T {
        let data = try await sendForData(endpoint)
        if T.self == Empty.self, let empty = Empty() as? T { return empty }
        do {
            return try JSONCoding.decoder.decode(T.self, from: data)
        } catch {
            let detail = String(describing: error)
            onEvent(.decodingFailed(path: endpoint.path, detail: detail))
            throw APIError.decoding(context: endpoint.path, underlying: detail)
        }
    }

    /// Send and ignore the body.
    @discardableResult
    public func send(_ endpoint: Endpoint) async throws -> Data {
        try await sendForData(endpoint)
    }

    private func sendForData(_ endpoint: Endpoint, isRetry: Bool = false) async throws -> Data {
        let request = try buildRequest(endpoint)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(underlying: error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(underlying: "Response was not HTTP")
        }

        if (200..<300).contains(http.statusCode) { return data }

        if http.statusCode == 401 && !endpoint.isUnauthenticated && !isRetry {
            // One refresh, one retry. `isRetry` is what makes that a hard ceiling: a token
            // the server rejects twice is not a token a third attempt will fix.
            _ = try await refreshTokens()
            return try await sendForData(endpoint, isRetry: true)
        }

        throw mapFailure(status: http.statusCode, data: data, endpoint: endpoint)
    }

    private func buildRequest(_ endpoint: Endpoint) throws -> URLRequest {
        var request = URLRequest(url: try endpoint.url(relativeTo: config.baseURL))
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Identifies this as a native client so the backend can skip the CSRF pairing a
        // cookie-less app cannot satisfy. See `users.auth_cookies.is_native_client`.
        request.setValue(config.clientIdentifier, forHTTPHeaderField: "X-MasterSAT-Client")

        if let body = endpoint.body {
            request.httpBody = body
            request.setValue(endpoint.contentType ?? "application/json", forHTTPHeaderField: "Content-Type")
        }
        if let key = endpoint.idempotencyKey {
            request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        }
        if !endpoint.isUnauthenticated {
            guard let tokens = storage.load() else { throw APIError.notAuthenticated }
            request.setValue("Bearer \(tokens.access)", forHTTPHeaderField: "Authorization")
        } else if endpoint.attachesTokenIfAvailable, let tokens = storage.load() {
            request.setValue("Bearer \(tokens.access)", forHTTPHeaderField: "Authorization")
        }
        // Never let the URL loading system serve a stale snapshot from cache: an
        // attempt read from cache is an attempt whose answers are already out of date.
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func mapFailure(status: Int, data: Data, endpoint: Endpoint) -> APIError {
        let detail = Self.detail(from: data)
        switch status {
        case 401:
            return .unauthorized
        case 403:
            return .forbidden(detail: detail, reason: Self.reason(from: data))
        case 409:
            return .conflict(detail: detail)
        case 426:
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let error = APIError.upgradeRequired(
                detail: detail,
                minimumVersion: object?["minimum_version"] as? String,
                updateURL: object?["update_url"] as? String
            )
            onEvent(.upgradeRequired(error))
            return error
        case 502, 503, 504:
            // The body here is nginx's maintenance page or a gateway error, not the API's
            // JSON — there is no `detail` worth showing, only "wait a minute".
            return .unavailable(status: status)
        case 400:
            // A serializer refusal, not a malformed request. Only the field-map shape
            // qualifies — a plain `{"detail": …}` 400 already reads well as `.http`.
            let fields = Self.fieldErrors(from: data)
            guard !fields.isEmpty else { return .http(status: status, detail: detail) }
            return .validation(
                detail: detail.isEmpty ? Self.message(from: fields) : detail,
                code: Self.reason(from: data),
                fields: fields
            )
        default:
            if status >= 500 {
                onEvent(.serverError(status: status, path: endpoint.path))
            }
            return .http(status: status, detail: detail)
        }
    }

    /// The server's machine-readable code, where it sends one. Views branch on this
    /// rather than on the human sentence, which is written for people and may change.
    ///
    /// A serializer raises its code inside the error map, so `code` arrives as a
    /// single-element array (`{"code": ["duplicate_full_name"]}`) rather than a string.
    /// Reading only the string form is how that branch silently never fires.
    private static func reason(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        for key in ["reason", "code", "error"] {
            if let value = object[key] as? String, !value.isEmpty { return value }
            if let list = object[key] as? [Any],
               let first = list.compactMap({ $0 as? String }).first, !first.isEmpty {
                return first
            }
        }
        return nil
    }

    /// DRF's serializer errors: `{"email": ["…"], "username": ["…"]}`.
    ///
    /// Array values only. Every other 400 shape — a bare `detail` string, a nested object —
    /// is left to `detail(from:)`, so this never claims to be a field error when it isn't.
    private static func fieldErrors(from data: Data) -> [String: [String]] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        var out: [String: [String]] = [:]
        for (key, value) in object {
            guard let list = value as? [Any] else { continue }
            let messages = list.compactMap { $0 as? String }.filter { !$0.isEmpty }
            if !messages.isEmpty { out[key] = messages }
        }
        return out
    }

    /// One sentence to show, chosen the way the web's register page chooses it.
    ///
    /// The preferred order is not cosmetic: a form that reports the *last* problem sends a
    /// student round in circles. `code` is skipped because it is a branch, not a sentence,
    /// and the fallback is sorted so the same failure never produces two different messages
    /// — Swift's dictionary order is not stable between runs.
    private static func message(from fields: [String: [String]]) -> String {
        let preferred = ["full_name", "detail", "non_field_errors", "email", "username",
                         "first_name", "last_name", "password"]
        for key in preferred {
            if let first = fields[key]?.first { return first }
        }
        for key in fields.keys.sorted() where key != "code" {
            if let first = fields[key]?.first { return first }
        }
        return ""
    }

    private static func detail(from data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        if let detail = object["detail"] as? String { return detail }
        if let error = object["error"] as? String { return error }
        return ""
    }

    // MARK: - Refresh

    /// Renew the pair, coalescing concurrent callers onto one in-flight request.
    @discardableResult
    public func refreshTokens() async throws -> TokenPair {
        if let existing = refreshTask {
            return try await existing.value
        }
        guard let current = storage.load() else {
            onSignOut()
            throw APIError.notAuthenticated
        }

        let task = Task { [config, storage, session] () throws -> TokenPair in
            let endpoint = try Endpoint.post("/auth/refresh/", json: RefreshRequest(refresh: current.refresh))
            var request = URLRequest(url: try endpoint.url(relativeTo: config.baseURL))
            request.httpMethod = endpoint.method.rawValue
            request.httpBody = endpoint.body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(config.clientIdentifier, forHTTPHeaderField: "X-MasterSAT-Client")
            request.cachePolicy = .reloadIgnoringLocalCacheData

            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: request)
            } catch {
                // Offline is NOT a signed-out session — keep the pair so the student is
                // still signed in when the network comes back mid-exam.
                throw APIError.transport(underlying: error.localizedDescription)
            }
            guard let http = response as? HTTPURLResponse else {
                throw APIError.transport(underlying: "Response was not HTTP")
            }
            switch http.statusCode {
            case 200..<300:
                break
            case 426:
                // An old build asking to renew is refused as an old build, not as a bad
                // session: the tokens are fine and must survive until the update.
                let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                throw APIError.upgradeRequired(
                    detail: (object?["detail"] as? String) ?? "",
                    minimumVersion: object?["minimum_version"] as? String,
                    updateURL: object?["update_url"] as? String
                )
            // The server being deployed, overloaded or broken says nothing about the refresh
            // token. Treating these as a rejection signed out every student whose access
            // token happened to expire during a release.
            case 502, 503, 504:
                throw APIError.unavailable(status: http.statusCode)
            case 429, 500...599:
                throw APIError.http(status: http.statusCode, detail: "")
            default:
                throw APIError.unauthorized
            }
            guard let body = try? JSONCoding.decoder.decode(RefreshResponse.self, from: data),
                  let access = body.access, !access.isEmpty else {
                throw APIError.decoding(context: "/auth/refresh/", underlying: "missing access token")
            }
            // Rotation revoked the refresh we just spent. If the server did not hand back a
            // replacement, reusing the old one next time is guaranteed to 401 — so treat a
            // missing rotation as the contract violation it is rather than storing a token
            // already known to be dead.
            guard let rotated = body.refresh, !rotated.isEmpty else {
                throw APIError.decoding(context: "/auth/refresh/", underlying: "missing rotated refresh token")
            }
            let pair = TokenPair(access: access, refresh: rotated)
            storage.save(pair)
            return pair
        }
        refreshTask = task

        do {
            let pair = try await task.value
            refreshTask = nil
            return pair
        } catch {
            refreshTask = nil
            // Only a rejection ends the session. A transport failure, a server that is
            // down or deploying, or a refused old build all leave the tokens alone, so the
            // app recovers the moment the network, the server or the build does.
            if Self.refreshFailureEndsSession(error) {
                storage.clear()
                onSignOut()
            }
            if let apiError = error as? APIError, case .upgradeRequired = apiError {
                onEvent(.upgradeRequired(apiError))
            }
            throw error
        }
    }

    static func refreshFailureEndsSession(_ error: Error) -> Bool {
        guard let error = error as? APIError else { return true }
        switch error {
        case .transport, .unavailable, .upgradeRequired:
            return false
        case .http(let status, _):
            return !(status == 429 || status >= 500)
        default:
            return true
        }
    }
}

/// App-wide signals from the client. See `APIClient.onEvent`.
public enum APIClientEvent: Sendable {
    /// The server answered 426: this build is below the minimum. The app shows its update
    /// screen over everything.
    case upgradeRequired(APIError)
    /// A 2xx whose body did not match the model — the backend moved and this build did not.
    case decodingFailed(path: String, detail: String)
    /// A 5xx other than the deploy-time 502/503/504.
    case serverError(status: Int, path: String)
}

/// Decodable stand-in for endpoints with no meaningful body.
public struct Empty: Decodable, Sendable {
    public init() {}
}

private struct RefreshRequest: Encodable, Sendable {
    let refresh: String
}

private struct RefreshResponse: Decodable, Sendable {
    let access: String?
    let refresh: String?
}

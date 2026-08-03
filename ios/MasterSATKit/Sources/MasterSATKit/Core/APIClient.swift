import Foundation

/// The single door to the backend.
///
/// An actor because the token pair is shared mutable state that many screens touch at once
/// — during an exam the autosave, the status poll and a submit can all be in flight
/// together. That is also why the refresh is *single-flight*: three requests meeting a
/// 401 at the same moment must produce one refresh, not three. Three would be worse than
/// wasteful: rotation revokes the token it spends, so the second and third would present
/// an already-revoked refresh and get the student signed out mid-exam.
public actor APIClient {
    public let config: APIConfig
    private let storage: TokenStorage
    private let session: URLSession
    private var refreshTask: Task<TokenPair, Error>?

    /// Called when the session is definitively over (refresh rejected). The app clears its
    /// UI state and shows the sign-in screen.
    private let onSignOut: @Sendable () -> Void

    public init(
        config: APIConfig,
        storage: TokenStorage,
        session: URLSession = .shared,
        onSignOut: @escaping @Sendable () -> Void = {}
    ) {
        self.config = config
        self.storage = storage
        self.session = session
        self.onSignOut = onSignOut
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
            throw APIError.decoding(context: endpoint.path, underlying: String(describing: error))
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
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let key = endpoint.idempotencyKey {
            request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        }
        if !endpoint.isUnauthenticated {
            guard let tokens = storage.load() else { throw APIError.notAuthenticated }
            request.setValue("Bearer \(tokens.access)", forHTTPHeaderField: "Authorization")
        }
        // Never let the URL loading system serve an exam snapshot from cache: a stale
        // `remaining_seconds` is a wrong clock, and a stale `version_number` is a 409 loop.
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
            // save_attempt answers a stale `expected_version_number` with a hard 409 that
            // writes nothing and carries the canonical attempt. Surfacing it typed is what
            // lets the autosave adopt the snapshot instead of retrying into another 409.
            let conflict = try? JSONCoding.decoder.decode(VersionConflictBody.self, from: data)
            return .versionConflict(attempt: conflict?.attempt)
        default:
            return .http(status: status, detail: detail)
        }
    }

    /// The server's machine-readable code, where it sends one. Views branch on this
    /// rather than on the human sentence, which is written for people and may change.
    private static func reason(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return (object["reason"] as? String) ?? (object["code"] as? String) ?? (object["error"] as? String)
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
            guard (200..<300).contains(http.statusCode) else {
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
            // Only a rejection ends the session. A transport failure leaves the tokens
            // alone so the app recovers when connectivity returns.
            if case APIError.transport = error {} else {
                storage.clear()
                onSignOut()
            }
            throw error
        }
    }
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

private struct VersionConflictBody: Decodable, Sendable {
    let attempt: Attempt?
}

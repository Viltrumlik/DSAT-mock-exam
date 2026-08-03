import Foundation

/// Sign in, sign out, and knowing which of the two you are.
public struct AuthService: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Exchange credentials for a token pair.
    ///
    /// The backend returns raw tokens (and sets no cookie) because the request carries the
    /// native-client header — see `users.auth_cookies.is_native_client`. Teachers are
    /// refused on the student host by the login funnel and get a 403 pointing them at the
    /// teacher portal; that message is the server's and is passed straight through.
    @discardableResult
    public func signIn(email: String, password: String) async throws -> TokenPair {
        let endpoint = try Endpoint.post(
            "/auth/login/",
            json: LoginRequest(email: email, password: password),
            idempotencyKey: nil
        )
        var unauthenticated = endpoint
        unauthenticated.isUnauthenticated = true

        let response = try await client.send(unauthenticated, as: LoginResponse.self)
        guard let access = response.access, let refresh = response.refresh,
              !access.isEmpty, !refresh.isEmpty else {
            // Reaching here means the server treated us as a browser and set cookies
            // instead. The app cannot use those, so fail loudly rather than appear signed
            // in with nothing to send.
            throw APIError.decoding(context: "/auth/login/", underlying: "login returned no token pair")
        }
        let pair = TokenPair(access: access, refresh: refresh)
        await client.setTokens(pair)
        return pair
    }

    /// Sign out here and revoke the session server-side.
    ///
    /// The local tokens are cleared even if the network call fails — a student tapping
    /// "sign out" must end up signed out on this device no matter what.
    public func signOut() async {
        if let tokens = await client.currentTokens() {
            let endpoint = try? Endpoint.post("/auth/logout/", json: LogoutRequest(refresh: tokens.refresh))
            if var endpoint {
                endpoint.isUnauthenticated = true
                _ = try? await client.send(endpoint)
            }
        }
        await client.signOutLocally()
    }

    public func isSignedIn() async -> Bool {
        await client.isAuthenticated
    }
}

private struct LoginRequest: Encodable, Sendable {
    let email: String
    let password: String
}

private struct LoginResponse: Decodable, Sendable {
    let access: String?
    let refresh: String?
}

private struct LogoutRequest: Encodable, Sendable {
    let refresh: String
}

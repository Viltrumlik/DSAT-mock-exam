import Foundation
import Testing
@testable import MasterSATKit

@Suite struct APIClientTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/1.0.0")

    /// Each test instance gets a fresh scripted backend, so suites can run in parallel
    /// without answering each other's requests.
    let server = StubServer()

    private func makeClient(
        tokens: TokenPair? = TokenPair(access: "access-1", refresh: "refresh-1"),
        onSignOut: @escaping @Sendable () -> Void = {}
    ) -> (APIClient, InMemoryTokenStorage) {
        let storage = InMemoryTokenStorage(tokens)
        let client = APIClient(config: config, storage: storage, session: server.session(), onSignOut: onSignOut)
        return (client, storage)
    }

    // MARK: - Request shape

    @Test("Requests carry the bearer token and the native-client header")
    func requestCarriesAuthHeaders() async throws {
        server.handler = { _ in .json(["ok": true]) }
        let (client, _) = makeClient()

        _ = try await client.send(.get("/users/me/"))

        let request = try #require(server.requests.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        // Without this header the backend enforces a CSRF pairing the app cannot satisfy,
        // and every auth POST 403s.
        #expect(request.value(forHTTPHeaderField: "X-MasterSAT-Client") == "ios/1.0.0")
    }

    @Test("Paths are namespaced under /api")
    func pathsAreNamespaced() async throws {
        server.handler = { _ in .json([:]) }
        let (client, _) = makeClient()

        _ = try await client.send(.get("/mocks/attempts/5/status/"))

        #expect(
            server.requests.first?.url?.absoluteString
                == "https://mastersat.uz/api/mocks/attempts/5/status/"
        )
    }

    @Test("The idempotency key is sent")
    func idempotencyKeyIsSent() async throws {
        server.handler = { _ in .json([:]) }
        let (client, _) = makeClient()

        _ = try await client.send(.post("/mocks/attempts/5/start/", idempotencyKey: "start.5.abc"))

        #expect(server.requests.first?.value(forHTTPHeaderField: "Idempotency-Key") == "start.5.abc")
    }

    @Test("A signed-out client refuses to send")
    func signedOutClientRefuses() async throws {
        let (client, _) = makeClient(tokens: nil)

        do {
            _ = try await client.send(.get("/users/me/"))
            Issue.record("expected notAuthenticated")
        } catch APIError.notAuthenticated {
            // expected — and nothing reached the network
            #expect(server.requests.isEmpty)
        }
    }

    // MARK: - Error mapping

    @Test("A 409 carries the canonical attempt back")
    func versionConflictCarriesAttempt() async throws {
        // save_attempt answers a stale expected_version with a hard 409 that writes
        // nothing and sends back the authoritative attempt. Surfacing it typed is what
        // lets the autosave adopt it instead of retrying into another 409.
        // Encoded up front: a [String: Any] cannot cross into the @Sendable handler.
        let conflictBody = AttemptFixtures.data([
            "error": "Version conflict.",
            "attempt": AttemptFixtures.json(version: 42),
        ])
        server.handler = { _ in .init(status: 409, body: conflictBody) }
        let (client, _) = makeClient()

        do {
            _ = try await client.send(.post("/mocks/attempts/5/save_attempt/"), as: Attempt.self)
            Issue.record("expected a versionConflict")
        } catch APIError.versionConflict(let attempt) {
            #expect(attempt?.versionNumber == 42)
        }
    }

    @Test("A 403 keeps the server's own wording")
    func forbiddenKeepsDetail() async throws {
        server.handler = { _ in .json(["detail": "This mock is not available yet."], status: 403) }
        let (client, _) = makeClient()

        do {
            _ = try await client.send(.get("/mocks/attempts/5/results/"))
            Issue.record("expected a forbidden")
        } catch APIError.forbidden(let detail, _) {
            #expect(detail == "This mock is not available yet.")
        }
    }

    @Test("Only transient failures are retryable")
    func retryabilityIsCorrect() {
        #expect(APIError.http(status: 503, detail: "").isRetryable)
        #expect(APIError.transport(underlying: "offline").isRetryable)
        #expect(APIError.forbidden(detail: "", reason: nil).isRetryable == false)
        #expect(APIError.versionConflict(attempt: nil).isRetryable == false)
    }

    // MARK: - Refresh

    @Test("An expired access token is refreshed and the request retried")
    func expiredTokenIsRefreshed() async throws {
        server.handler = { request in
            let url = request.url?.absoluteString ?? ""
            if url.contains("/auth/refresh/") {
                return .json(["access": "access-2", "refresh": "refresh-2"])
            }
            // The first call presents the stale token; the retry presents the new one.
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1" {
                return .json(["detail": "Given token not valid"], status: 401)
            }
            return .json(["email": "s@example.com"])
        }
        let (client, storage) = makeClient()

        _ = try await client.send(.get("/users/me/"))

        #expect(storage.load()?.access == "access-2")
        // Rotation revoked the spent refresh, so the new one must have been stored too —
        // otherwise the next renewal presents a dead token.
        #expect(storage.load()?.refresh == "refresh-2")
        #expect(server.requests.count == 3, "original, refresh, retry")
    }

    @Test("Concurrent 401s share a single refresh")
    func concurrentRequestsShareOneRefresh() async throws {
        // Three requests meeting a 401 together must produce ONE refresh. Three would be
        // worse than wasteful: rotation revokes the token it spends, so the second and
        // third would present an already-revoked refresh and sign the student out
        // mid-exam.
        let refreshCount = Counter()
        server.handler = { request in
            let url = request.url?.absoluteString ?? ""
            if url.contains("/auth/refresh/") {
                refreshCount.increment()
                return .json(["access": "access-2", "refresh": "refresh-2"])
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1" {
                return .json(["detail": "expired"], status: 401)
            }
            return .json(["ok": true])
        }
        let (client, _) = makeClient()

        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<3 {
                group.addTask { _ = try? await client.send(.get("/users/me/")) }
            }
        }

        #expect(refreshCount.value == 1)
    }

    @Test("A rejected refresh signs out and clears the tokens")
    func rejectedRefreshSignsOut() async throws {
        server.handler = { request in
            if request.url?.absoluteString.contains("/auth/refresh/") == true {
                return .json(["detail": "Session revoked."], status: 401)
            }
            return .json(["detail": "expired"], status: 401)
        }
        let signedOut = Counter()
        let (client, storage) = makeClient(onSignOut: { signedOut.increment() })

        _ = try? await client.send(.get("/users/me/"))

        #expect(storage.load() == nil)
        #expect(signedOut.value == 1)
    }

    @Test("A refresh that did not rotate is refused")
    func refreshWithoutRotationIsRefused() async throws {
        // Storing an access token while silently keeping the spent refresh would look
        // fine for three hours and then lock the student out with no way back.
        server.handler = { request in
            if request.url?.absoluteString.contains("/auth/refresh/") == true {
                return .json(["access": "access-2"])
            }
            return .json(["detail": "expired"], status: 401)
        }
        let (client, storage) = makeClient()

        _ = try? await client.send(.get("/users/me/"))

        #expect(storage.load() == nil, "a refresh that did not rotate must not be accepted")
    }
}

/// Thread-safe tally for assertions made from concurrent stub handlers.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.lock(); defer { lock.unlock() }
        count += 1
    }

    var value: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }
}

import Foundation
import Testing
@testable import MasterSATKit

@Suite struct AuthServiceTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")

    let server = StubServer()

    private func makeClient(tokens: TokenPair? = nil) -> (APIClient, InMemoryTokenStorage) {
        let storage = InMemoryTokenStorage(tokens)
        return (APIClient(config: config, storage: storage, session: server.session()), storage)
    }

    @Test("Signing in stores the pair and sends no bearer header")
    func signInStoresPair() async throws {
        server.handler = { _ in .json(["access": "A", "refresh": "R"]) }
        let (client, storage) = makeClient()

        try await AuthService(client: client).signIn(email: "s@example.com", password: "pw")

        #expect(storage.load() == TokenPair(access: "A", refresh: "R"))
        let request = try #require(server.requests.first)
        // There is nothing to authenticate with yet; sending a stale header would be the
        // one way to get a confusing 401 on the login call itself.
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.value(forHTTPHeaderField: "X-MasterSAT-Client") == "ios/test")
    }

    @Test("A cookie-only login response is rejected")
    func cookieOnlyLoginIsRejected() async throws {
        // This is what the server sends a browser. The app cannot use a cookie it never
        // stores, so it must fail loudly rather than look signed in with nothing to send.
        server.handler = { _ in .json(["detail": "ok"]) }
        let (client, storage) = makeClient()

        await #expect(throws: Error.self) {
            try await AuthService(client: client).signIn(email: "s@example.com", password: "pw")
        }
        #expect(storage.load() == nil)
    }

    @Test("The server's own refusal reaches the caller")
    func teacherRefusalIsPassedThrough() async throws {
        // Teachers are refused on the student host by the login funnel, and the message
        // tells them where to go instead. Replacing it with a generic error would strand
        // them.
        let detail = "Teachers must sign in at the Teacher Portal: https://teacher.mastersat.uz"
        server.handler = { _ in .json(["detail": detail], status: 403) }
        let (client, _) = makeClient()

        do {
            try await AuthService(client: client).signIn(email: "t@example.com", password: "pw")
            Issue.record("expected a forbidden")
        } catch APIError.forbidden(let received, _) {
            #expect(received == detail)
        }
    }

    @Test("Signing out clears the device even when the network call fails")
    func signOutAlwaysClearsLocally() async throws {
        server.handler = { _ in .json(["detail": "boom"], status: 500) }
        let (client, storage) = makeClient(tokens: TokenPair(access: "A", refresh: "R"))

        await AuthService(client: client).signOut()

        #expect(storage.load() == nil)
    }

    @Test("Signing out names the refresh token to revoke")
    func signOutNamesTheToken() async throws {
        server.handler = { _ in .json(["ok": true]) }
        let (client, _) = makeClient(tokens: TokenPair(access: "A", refresh: "R"))

        await AuthService(client: client).signOut()

        let request = try #require(server.requests.first)
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        // A native client holds the token itself, so this is the only thing that tells the
        // server WHICH session ended — otherwise a signed-out phone keeps a live session.
        #expect(json["refresh"] as? String == "R")
    }
}

@Suite struct StudentAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")

    let server = StubServer()

    private func makeAPI() -> StudentAPI {
        StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
    }

    @Test("The mock list keeps the resume attempt and the result attempt apart")
    func mockListingSeparatesAttempts() async throws {
        // Conflating them made a freshly-earned score vanish the moment a student started
        // a retake.
        server.handler = { _ in
            .json(["results": [[
                "mock_id": 3,
                "title": "Full Mock 3",
                "break_minutes": 10,
                "module_count": 4,
                "attempt_id": 91,
                "state": "ENGLISH_M1_ACTIVE",
                "in_progress": true,
                "submitted": true,
                "total_score": 1340,
                "result_attempt_id": 80,
            ]]])
        }

        let mocks = try await makeAPI().mocks()

        let mock = try #require(mocks.first)
        #expect(mock.attemptId == 91, "Resume reopens the live attempt")
        #expect(mock.resultAttemptId == 80, "View result points at the last finished sitting")
        #expect(mock.totalScore == 1340)
    }

    @Test("Schedule events decode and get stable ids")
    func scheduleEventsDecode() async throws {
        server.handler = { _ in
            .json(["from": "2026-08-01", "to": "2026-08-31", "events": [
                ["date": "2026-08-05", "type": "class", "title": "Math ODD", "sub": "Math", "time": "09:00", "classroom_id": 2],
                ["date": "2026-08-07", "type": "mock", "title": "Mock 3", "sub": "Full-length", "time": "", "mock_exam_id": 9],
                ["date": "2026-08-09", "type": "something_new", "title": "?", "sub": "", "time": ""],
            ]])
        }

        let events = try await makeAPI().schedule(from: Date(), to: Date())

        #expect(events.count == 3)
        #expect(events[0].type == .classMeeting)
        #expect(events[1].type == .mock)
        // An event kind the app has never heard of must not break the whole calendar.
        #expect(events[2].type == .unknown)
        #expect(Set(events.map(\.id)).count == 3)
    }

    @Test("The schedule range is sent as plain calendar days")
    func scheduleSendsDayStrings() async throws {
        server.handler = { _ in .json(["events": []]) }
        let from = Date(timeIntervalSince1970: 1_785_000_000)

        _ = try await makeAPI().schedule(from: from, to: from)

        let url = try #require(server.requests.first?.url?.absoluteString)
        #expect(url.contains("from="))
        #expect(url.contains("to="))
    }

    @Test("The current user survives a payload full of fields the app ignores")
    func currentUserDecodesLeanly() async throws {
        server.handler = { _ in
            .json([
                "id": 12,
                "email": "s@example.com",
                "first_name": "Aziz",
                "last_name": "Karimov",
                "role": "student",
                "is_frozen": false,
                "profile_complete": true,
                // Fields the app does not model — they must simply pass by.
                "permissions": ["a", "b"],
                "security_step_up_active": false,
                "has_recent_security_alerts": false,
            ])
        }

        let user = try await makeAPI().me()

        #expect(user.displayName == "Aziz Karimov")
        #expect(user.initials == "AK")
        #expect(user.isFrozen == false)
    }

    @Test("Starting a mock attempt names the mock")
    func startMockAttemptNamesTheMock() async throws {
        let attempt = AttemptFixtures.data(AttemptFixtures.json())
        server.handler = { _ in .init(status: 201, body: attempt) }

        _ = try await makeAPI().startMockAttempt(mockId: 3)

        let request = try #require(server.requests.first)
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["mock"] as? Int == 3)
    }
}

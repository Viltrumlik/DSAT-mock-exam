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

    // MARK: - Registration

    @Test("Registering posts snake_case names without a bearer header")
    func registerPostsTheSitesPayload() async throws {
        server.handler = { _ in .json(["id": 41, "email": "s@example.com", "username": "sam", "first_name": "Sam", "last_name": "Turner"]) }
        let (client, storage) = makeClient()

        let account = try await AuthService(client: client).register(
            firstName: "Sam", lastName: "Turner", username: "sam",
            email: "s@example.com", password: "pw123456"
        )

        #expect(account.id == 41)
        #expect(account.firstName == "Sam")
        let request = try #require(server.requests.first)
        // absoluteString, not `path`: `URL.path` drops the trailing slash, and the slash is
        // the difference between a POST and Django's APPEND_SLASH redirect turning it into
        // a GET that never creates anything.
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/users/register/")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["first_name"] as? String == "Sam")
        #expect(json["last_name"] as? String == "Turner")
        #expect(json["username"] as? String == "sam")
        // Registration hands back a user, never a token pair — the app signs in afterwards.
        #expect(storage.load() == nil)
    }

    @Test("A taken address arrives as a sentence, not \"Request failed (400)\"")
    func takenAddressIsReadable() async throws {
        server.handler = { _ in .json(["email": ["user with this email already exists."]], status: 400) }
        let (client, _) = makeClient()

        do {
            try await AuthService(client: client).register(
                firstName: "Sam", lastName: "Turner", username: "sam",
                email: "taken@example.com", password: "pw123456"
            )
            Issue.record("expected a validation error")
        } catch APIError.validation(let detail, let code, let fields) {
            #expect(detail == "user with this email already exists.")
            #expect(code == nil)
            #expect(fields["email"]?.count == 1)
        }
    }

    @Test("duplicate_full_name reaches the screen as a code it can branch on")
    func duplicateFullNameCarriesItsCode() async throws {
        // The serializer raises the code inside the error map, so it arrives as a
        // single-element array. Reading only the string form silently loses the branch
        // that offers "sign in instead" rather than a dead end.
        server.handler = { _ in
            .json([
                "full_name": ["Someone with this name is already registered."],
                "code": ["duplicate_full_name"],
            ], status: 400)
        }
        let (client, _) = makeClient()

        do {
            try await AuthService(client: client).register(
                firstName: "Sam", lastName: "Turner", username: "sam2",
                email: "sam2@example.com", password: "pw123456"
            )
            Issue.record("expected a validation error")
        } catch APIError.validation(let detail, let code, _) {
            #expect(code == "duplicate_full_name")
            #expect(detail == "Someone with this name is already registered.")
        }
    }

    @Test("A 400 that is not a field map stays an http error")
    func plainDetail400IsNotValidation() async throws {
        server.handler = { _ in .json(["detail": "Malformed request."], status: 400) }
        let (client, _) = makeClient()

        do {
            try await AuthService(client: client).register(
                firstName: "Sam", lastName: "Turner", username: "sam",
                email: "s@example.com", password: "pw"
            )
            Issue.record("expected an http error")
        } catch APIError.http(let status, let detail) {
            #expect(status == 400)
            #expect(detail == "Malformed request.")
        }
    }

    @Test("With several problems, the first one named is the one worth fixing first")
    func messageOrderIsDeterministic() async throws {
        server.handler = { _ in
            .json([
                "password": ["This password is too common."],
                "username": ["Username must be at least 3 characters."],
                "zzz_unknown": ["Something else."],
            ], status: 400)
        }
        let (client, _) = makeClient()

        do {
            try await AuthService(client: client).register(
                firstName: "Sam", lastName: "Turner", username: "s",
                email: "s@example.com", password: "1234"
            )
            Issue.record("expected a validation error")
        } catch APIError.validation(let detail, _, let fields) {
            #expect(detail == "Username must be at least 3 characters.")
            #expect(fields.count == 3)
        }
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

}

import Foundation
import Testing
@testable import MasterSATKit

// MARK: - Fixtures

enum AccountFixtures {
    static func me(
        email: Any = "ali@example.com",
        emailVerified: Bool = true,
        firstName: Any = "Aliyev",
        lastName: Any = "Valiyev",
        username: Any = "aliyev",
        phone: Any = NSNull(),
        missing: [String] = [],
        telegram: Bool = false,
        photo: Any = NSNull(),
        lastPasswordChange: Any = NSNull()
    ) -> [String: Any] {
        [
            "id": 7, "email": email, "username": username, "first_name": firstName, "last_name": lastName,
            "phone_number": phone, "is_frozen": false, "is_admin": false, "telegram_linked": telegram,
            "profile_image_url": photo, "sat_exam_date": NSNull(), "target_score": NSNull(),
            "target_english": NSNull(), "target_math": NSNull(), "last_mock_result": NSNull(),
            "role": "student", "subject": NSNull(), "permissions": ["submit_test"],
            "last_password_change": lastPasswordChange, "security_step_up_active": false,
            "has_recent_security_alerts": false, "email_verified": emailVerified,
            "email_verified_at": emailVerified ? "2026-09-20T10:11:12.345678+05:00" : NSNull(),
            "email_released_at": NSNull(), "profile_complete": missing.isEmpty, "missing_fields": missing,
        ]
    }

    /// A JWT whose payload carries `iat`, the way simplejwt mints a refresh token.
    static func jwt(iat: Int?) -> String {
        func b64(_ object: Any) -> String {
            let data = try! JSONSerialization.data(withJSONObject: object)
            return data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        var payload: [String: Any] = ["token_type": "refresh", "exp": 1_791_022_601, "jti": "3ed49a8a", "user_id": "1"]
        if let iat { payload["iat"] = iat }
        return "\(b64(["alg": "HS256", "typ": "JWT"])).\(b64(payload)).c2lnbmF0dXJl"
    }

    /// `created_at` the way the sessions view writes it: `isoformat()` of a UTC datetime.
    static func iso(_ epoch: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date(timeIntervalSince1970: epoch))
    }
}

// MARK: - API

@Suite struct AccountAPITests {
    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api(tokens: TokenPair? = TokenPair(access: "A", refresh: "R")) -> AccountAPI {
        AccountAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(tokens),
            session: server.session()
        ))
    }

    private func body(_ request: URLRequest?) -> [String: Any] {
        guard let data = request?.httpBody else { return [:] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    @Test("The profile decodes everything the account screens read")
    func profileDecodes() async throws {
        server.handler = { _ in
            .json(AccountFixtures.me(
                phone: "+998901234567", telegram: true,
                photo: "https://mastersat.uz/media/profiles/p.jpg",
                lastPasswordChange: "2026-09-26T10:17:17.452824+00:00"
            ))
        }
        let me = try await api().profile()
        #expect(me.id == 7)
        #expect(me.email == "ali@example.com" && me.hasEmail && me.emailIsConfirmed)
        #expect(me.firstName == "Aliyev" && me.lastName == "Valiyev" && me.username == "aliyev")
        #expect(me.phoneNumber == "+998901234567")
        #expect(me.telegramLinked)
        #expect(me.hasPhoto)
        #expect(me.lastPasswordChange == "2026-09-26T10:17:17.452824+00:00")
        #expect(me.profileComplete == true && me.missingFields == [])
        #expect(me.displayName == "Aliyev Valiyev")
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/users/me/")
        #expect(server.requests.first?.httpMethod == "GET")
    }

    @Test("No address is nil, never a placeholder; nulls become empty strings")
    func sparseProfile() async throws {
        server.handler = { _ in
            .json(AccountFixtures.me(
                email: NSNull(), emailVerified: false, firstName: NSNull(), lastName: "", username: NSNull(),
                missing: ["first_name", "last_name", "username", "email"]
            ))
        }
        let me = try await api().profile()
        #expect(me.email == nil && !me.hasEmail && !me.emailIsConfirmed && me.realEmail == "")
        #expect(me.firstName == "" && me.lastName == "" && me.username == "" && me.phoneNumber == "")
        #expect(me.profileImageURL == nil && !me.hasPhoto)
        #expect(me.displayName == "")
        #expect(me.missingFields == ["first_name", "last_name", "username", "email"])
    }

    @Test("A blank address reads as no address")
    func blankEmail() throws {
        let data = try JSONSerialization.data(withJSONObject: ["id": 1, "email": "  "])
        let me = try JSONCoding.decoder.decode(AccountProfile.self, from: data)
        #expect(me.email == nil)
        #expect(me.profileComplete == nil && me.missingFields == nil)
    }

    @Test("Saving sends only what changed, trimmed, as a PATCH")
    func saveSendsChanges() async throws {
        server.handler = { _ in .json(AccountFixtures.me(firstName: "Aziza")) }
        let saved = AccountDetailsDraft(firstName: "Aziz", lastName: "Valiyev", username: "aliyev", phoneNumber: "+998901234567")
        var draft = saved
        draft.firstName = "  Aziza "
        draft.phoneNumber = "   "
        let me = try await api().updateDetails(draft.changes(since: saved))
        #expect(me.firstName == "Aziza")
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/users/me/")
        let sent = body(request)
        #expect(sent["first_name"] as? String == "Aziza")
        #expect(sent["phone_number"] is NSNull)
        #expect(sent["last_name"] == nil && sent["username"] == nil)
    }

    @Test("A refused save keeps its messages per field")
    func saveRefusedPerField() async throws {
        server.handler = { _ in
            .json([
                "first_name": ["First name must be at least 3 characters."],
                "phone_number": ["Phone number must be between 7 and 16 characters (digits and optional leading +)."],
            ], status: 400)
        }
        do {
            try await api().updateDetails(AccountDetailsChanges(firstName: "Al", phoneNumber: .some("12")))
            Issue.record("expected a refusal")
        } catch {
            let (fields, general) = AccountCopy.detailsFailure(error)
            #expect(fields[.firstName] == "First name must be at least 3 characters.")
            #expect(fields[.phoneNumber]?.hasPrefix("Phone number must be between 7 and 16") == true)
            #expect(general == nil)
        }
    }

    @Test("A photo goes up as multipart under profile_image, by PATCH")
    func photoUpload() async throws {
        server.handler = { _ in .json(AccountFixtures.me(photo: "https://mastersat.uz/media/profiles/profile-1.jpg")) }
        let me = try await api().uploadPhoto(Data([0xFF, 0xD8, 0xFF, 0xE0]), fileExtension: "jpg", mimeType: "image/jpeg")
        #expect(me.profileImageURL == "https://mastersat.uz/media/profiles/profile-1.jpg")
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "PATCH")
        #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let text = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        #expect(text.contains("name=\"profile_image\"; filename=\"profile-"))
        #expect(text.contains(".jpg\""))
        #expect(text.contains("Content-Type: image/jpeg"))
    }

    @Test("Removing the photo sends clear_profile_image")
    func photoRemove() async throws {
        server.handler = { _ in .json(AccountFixtures.me()) }
        let me = try await api().removePhoto()
        #expect(!me.hasPhoto)
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "PATCH")
        #expect(body(request)["clear_profile_image"] as? Bool == true)
    }

    @Test("A photo the server refuses says why, in the server's words")
    func photoRefused() async throws {
        server.handler = { _ in .json(["profile_image": ["Invalid profile image content type."]], status: 400) }
        do {
            try await api().uploadPhoto(Data([1, 2, 3]), fileExtension: "jpg", mimeType: "image/jpeg")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.photoFailure(error) == "Invalid profile image content type.")
        }
        #expect(AccountCopy.photoFailure(APIError.transport(underlying: "offline")) == AccountCopy.photoFailed)
    }

    @Test("A password change posts both passwords and reports what it signed out")
    func passwordChange() async throws {
        server.handler = { _ in
            .json(["ok": true, "signed_out_sessions": 2, "last_password_change": "2026-09-26T10:17:17.452824+00:00"])
        }
        let result = try await api().changePassword(current: "old-pass-1", new: "Tashkent-Sunrise-2026")
        #expect(result.signedOutSessions == 2)
        #expect(result.lastPasswordChange == "2026-09-26T10:17:17.452824+00:00")
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/auth/password/change/")
        #expect(request.httpMethod == "POST")
        let sent = body(request)
        #expect(sent["current_password"] as? String == "old-pass-1")
        #expect(sent["new_password"] as? String == "Tashkent-Sunrise-2026")
    }

    @Test("A wrong current password and validator refusals land under their fields")
    func passwordRefused() async throws {
        server.handler = { _ in .json(["current_password": ["That isn't your current password."]], status: 400) }
        do {
            _ = try await api().changePassword(current: "nope", new: "Tashkent-Sunrise-2026")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.passwordFailure(error) == ["current_password": "That isn't your current password."])
        }
        server.handler = { _ in
            .json(["new_password": ["This password is too common.", "This password is entirely numeric."]], status: 400)
        }
        do {
            _ = try await api().changePassword(current: "old-pass-1", new: "12345678")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.passwordFailure(error) == ["new_password": "This password is too common."])
        }
        server.handler = { _ in .json(["detail": "Request was throttled. Expected available in 3540 seconds."], status: 429) }
        do {
            _ = try await api().changePassword(current: "old-pass-1", new: "Tashkent-Sunrise-2026")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.passwordFailure(error) == ["detail": AccountCopy.passwordThrottled])
        }
        #expect(AccountCopy.passwordFailure(APIError.transport(underlying: "x")) == ["detail": AccountCopy.passwordFailed])
    }

    @Test("Sessions decode, and a malformed row is skipped rather than failing the list")
    func sessionsDecode() async throws {
        server.handler = { _ in
            .json(["sessions": [
                ["id": 1, "created_at": "2026-09-26T10:16:41.321201+00:00", "last_seen_at": "2026-09-26T10:16:41.321250+00:00",
                 "ip": "127.0.0.1", "user_agent": "MasterSAT/7 CFNetwork/1568.100.1 Darwin/24.6.0", "revoked_at": NSNull(),
                 "is_current": false],
                ["created_at": "no id"],
                ["id": 2, "created_at": NSNull(), "last_seen_at": NSNull(), "ip": NSNull(), "user_agent": NSNull()],
            ]])
        }
        let sessions = try await api().sessions()
        #expect(sessions.map(\.id) == [1, 2])
        #expect(sessions[0].userAgent.hasPrefix("MasterSAT/7"))
        #expect(!sessions[0].isCurrent)
        #expect(sessions[1].ip == "" && sessions[1].userAgent == "" && sessions[1].createdAt == nil)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/auth/sessions/")
    }

    @Test("Revoking one posts to its id; revoking all asks to keep nothing")
    func revokes() async throws {
        server.handler = { request in
            // `URL.path` drops the trailing slash, so match on the whole address.
            if request.url?.absoluteString.hasSuffix("/revoke_all/") == true {
                return .json(["ok": true, "revoked": 3, "kept_current": false])
            }
            return .json(["ok": true])
        }
        try await api().revokeSession(id: 42)
        let all = try await api().revokeAllSessions()
        #expect(all.revoked == 3 && !all.keptCurrent)
        let requests = server.requests
        #expect(requests.count == 2)
        #expect(requests[0].url?.absoluteString == "https://mastersat.uz/api/auth/sessions/42/revoke/")
        #expect(requests[0].httpMethod == "POST")
        #expect(requests[1].url?.absoluteString == "https://mastersat.uz/api/auth/sessions/revoke_all/")
        #expect(body(requests[1])["keep_current"] == nil)
    }

    @Test("A session already gone is a plain 404")
    func revokeMissing() async throws {
        server.handler = { _ in .json(["detail": "Session not found."], status: 404) }
        do {
            try await api().revokeSession(id: 99999)
            Issue.record("expected a 404")
        } catch APIError.http(let status, let detail) {
            #expect(status == 404 && detail == "Session not found.")
        }
    }

    @Test("Requesting a code posts the address and reads the lifetime")
    func requestCode() async throws {
        server.handler = { _ in
            .json(["detail": "If that address can receive mail, a code is on its way.", "expires_in_minutes": 15, "delivered": NSNull()], status: 202)
        }
        let sent = try await api().requestEmailCode("new@example.com")
        #expect(sent.expiresInMinutes == 15)
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/auth/email/request-code/")
        #expect(body(request)["email"] as? String == "new@example.com")
    }

    @Test("Send-code refusals are typed, and every failure has a sentence")
    func requestCodeRefusals() async throws {
        server.handler = { _ in .json(["detail": "Enter a real email address.", "code": "not_deliverable"], status: 400) }
        do {
            _ = try await api().requestEmailCode("x@nowhere")
            Issue.record("expected a refusal")
        } catch let refusal as EmailVerificationRefusal {
            #expect(refusal.reason == .notDeliverable)
            #expect(AccountCopy.emailRequestFailure(refusal) == "Enter a real email address.")
        }
        server.handler = { _ in
            .json(["detail": "This email is already confirmed on another account. Sign in with it, or ask an administrator for help.",
                   "code": "taken_verified"], status: 409)
        }
        do {
            _ = try await api().requestEmailCode("taken@example.com")
            Issue.record("expected a refusal")
        } catch let refusal as EmailVerificationRefusal {
            #expect(refusal.reason == .takenVerified && refusal.status == 409)
        }
        server.handler = { _ in .json(["detail": "Email is required."], status: 400) }
        do {
            _ = try await api().requestEmailCode("")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.emailRequestFailure(error) == "Email is required.")
        }
        server.handler = { _ in .json(["detail": "Request was throttled. Expected available in 3540 seconds."], status: 429) }
        do {
            _ = try await api().requestEmailCode("new@example.com")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.emailRequestFailure(error) == AccountCopy.emailThrottled)
        }
        #expect(AccountCopy.emailRequestFailure(APIError.transport(underlying: "x")) == AccountCopy.emailSendFailed)
    }

    @Test("Confirming posts address and code; the refusals the server really sends are typed")
    func confirmCode() async throws {
        server.handler = { _ in .json(["detail": "Email confirmed.", "email": "new@example.com", "email_verified": true]) }
        let confirmed = try await api().confirmEmailCode(email: "new@example.com", code: "123456")
        #expect(confirmed.email == "new@example.com")
        let sent = body(server.requests.first)
        #expect(sent["email"] as? String == "new@example.com" && sent["code"] as? String == "123456")

        let cases: [(String, Int, EmailVerificationRefusal.Reason)] = [
            ("bad_code", 400, .badCode), ("no_claim", 400, .noClaim), ("expired", 400, .expired),
            ("taken_unverified", 409, .takenUnverified),
        ]
        for (code, status, reason) in cases {
            server.handler = { _ in .json(["detail": "Sentence for \(code).", "code": code, "attempts_remaining": 3], status: status) }
            do {
                _ = try await api().confirmEmailCode(email: "new@example.com", code: "000000")
                Issue.record("expected a refusal for \(code)")
            } catch let refusal as EmailVerificationRefusal {
                #expect(refusal.reason == reason)
                #expect(AccountCopy.emailConfirmFailure(refusal) == "Sentence for \(code).")
            }
        }
        #expect(AccountCopy.emailConfirmFailure(APIError.http(status: 429, detail: "throttled")) == AccountCopy.emailThrottled)
        #expect(AccountCopy.emailConfirmFailure(APIError.transport(underlying: "x")) == AccountCopy.codeFailed)
    }

    @Test("A refusal without a sentence falls back to the server's own wording")
    func refusalFallbacks() {
        #expect(EmailVerificationRefusal(reason: .noClaim, detail: "", status: 400).errorDescription
            == "No pending request for that address. Request a new code.")
        #expect(EmailVerificationRefusal(reason: .burned, detail: "", status: 400).errorDescription == "That code is not correct.")
        #expect(EmailVerificationRefusal.Reason(code: "brand_new") == .other("brand_new"))
    }

    @Test("Telegram's config is read without a token, so it can never end a session")
    func telegramConfig() async throws {
        server.handler = { _ in
            .json(["enabled": true, "bot_username": "mastersat_bot", "client_id": "123", "start_url": "/api/users/telegram/start/"])
        }
        let config = try await api().telegramConfig()
        #expect(config.enabled && config.canConnect)
        let request = try #require(server.requests.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/users/telegram/config/")

        server.handler = { _ in .json(["enabled": false, "bot_username": NSNull(), "client_id": NSNull(), "start_url": NSNull()]) }
        #expect(try await api().telegramConfig().canConnect == false)
    }

    @Test("The held refresh token is the one in storage")
    func heldToken() async {
        #expect(await api().heldRefreshToken() == "R")
        #expect(await api(tokens: nil).heldRefreshToken() == nil)
    }
}

// MARK: - The completion gate

@Suite struct ProfileCompletionTests {
    private func user(_ extra: [String: Any]) throws -> CurrentUser {
        var object: [String: Any] = ["id": 1, "email": "a@b.co", "is_frozen": false]
        extra.forEach { object[$0.key] = $0.value }
        return try JSONCoding.decoder.decode(CurrentUser.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test("Only an explicit false with something missing stops the app")
    func gateRule() throws {
        #expect(try user(["profile_complete": false, "missing_fields": ["email"]]).mustCompleteProfile)
        #expect(try !user(["profile_complete": true, "missing_fields": []]).mustCompleteProfile)
        // An older backend, or an account cached before the fields existed: no opinion.
        #expect(try !user([:]).mustCompleteProfile)
        #expect(try !user(["profile_complete": false, "missing_fields": []]).mustCompleteProfile)
        #expect(try !user(["profile_complete": false]).mustCompleteProfile)
        // Frozen wins: that screen, not this one.
        #expect(try !user(["profile_complete": false, "missing_fields": ["email"], "is_frozen": true]).mustCompleteProfile)
    }

    @Test("Names first when any is missing, else straight to the email")
    func steps() {
        #expect(ProfileCompletion.firstStep(missing: ["username", "email"]) == .names)
        #expect(ProfileCompletion.firstStep(missing: ["email"]) == .email)
        #expect(ProfileCompletion.needsEmail(["first_name", "email"]))
        #expect(!ProfileCompletion.needsEmail(["first_name"]))
        #expect(ProfileCompletion.needsNames(["last_name"]))
        #expect(!ProfileCompletion.needsNames(["email"]))
    }

    @Test("Each name at least three characters once trimmed, first failure named")
    func nameCheck() {
        #expect(ProfileCompletion.nameProblem(firstName: "Ali", lastName: "Vali", username: "ali") == nil)
        #expect(ProfileCompletion.nameProblem(firstName: " Al ", lastName: "Vali", username: "ali")
            == "First name must be at least 3 characters.")
        #expect(ProfileCompletion.nameProblem(firstName: "Ali", lastName: "", username: "")
            == "Last name must be at least 3 characters.")
        #expect(ProfileCompletion.nameProblem(firstName: "Ali", lastName: "Vali", username: "  ab  ")
            == "Username must be at least 3 characters.")
    }
}

// MARK: - The Account form

@Suite struct AccountDetailsDraftTests {
    let saved = AccountDetailsDraft(firstName: "Aziz", lastName: "Li", username: "aziz", phoneNumber: "+998901234567")

    @Test("Whitespace alone is not a change")
    func whitespace() {
        var draft = saved
        draft.firstName = " Aziz  "
        #expect(!draft.isDirty(comparedTo: saved))
        #expect(draft.changes(since: saved).isEmpty)
    }

    @Test("Only changed fields are sent; an emptied phone is cleared with null")
    func changes() {
        var draft = saved
        draft.username = " aziz_2026 "
        draft.phoneNumber = ""
        let changes = draft.changes(since: saved)
        #expect(changes == AccountDetailsChanges(username: "aziz_2026", phoneNumber: .some(nil)))
        #expect(changes.body["username"] == .string("aziz_2026"))
        #expect(changes.body["phone_number"] == .null)
        #expect(changes.body["first_name"] == nil)
    }

    @Test("A short name saved long ago does not block a phone change")
    func legacyShortName() {
        var draft = saved
        draft.phoneNumber = "+998 90 765 43 21"
        #expect(draft.problems(since: saved).isEmpty)
        #expect(draft.changes(since: saved) == AccountDetailsChanges(phoneNumber: .some("+998 90 765 43 21")))
    }

    @Test("An emptied or too-short name is refused before it can lock the student out")
    func shortNames() {
        var draft = saved
        draft.firstName = "  "
        draft.username = "ab"
        let problems = draft.problems(since: saved)
        #expect(problems[.firstName] == "First name must be at least 3 characters.")
        #expect(problems[.username] == "Username must be at least 3 characters.")
        #expect(problems[.lastName] == nil && problems[.phoneNumber] == nil)
    }

    @Test("A refusal about a field the form does not show still gets said")
    func otherRefusals() {
        let (fields, general) = AccountCopy.detailsFailure(
            APIError.validation(detail: "x", code: nil, fields: ["non_field_errors": ["Something is off."]])
        )
        #expect(fields.isEmpty && general == "Something is off.")
        let (_, stray) = AccountCopy.detailsFailure(
            APIError.validation(detail: "x", code: nil, fields: ["sat_exam_date": ["This exam date is not available."]])
        )
        #expect(stray == "This exam date is not available.")
        let (none, generic) = AccountCopy.detailsFailure(APIError.http(status: 500, detail: ""))
        #expect(none.isEmpty && generic == AccountCopy.detailsFailed)
    }
}

// MARK: - Small rules

@Suite struct AccountSmallRulesTests {
    @Test("Password: every check the web makes, in its words")
    func passwordChecks() {
        #expect(PasswordChangeCheck.problems(current: "", new: "short", confirm: "")
            == [.current: "Enter your current password.", .new: "Use at least 8 characters."])
        #expect(PasswordChangeCheck.problems(current: "same-pass-1", new: "same-pass-1", confirm: "same-pass-1")
            == [.new: "Choose a password that is different from your current one."])
        #expect(PasswordChangeCheck.problems(current: "old-pass-1", new: "new-pass-22", confirm: "new-pass-2")
            == [.confirm: "The two new passwords don't match."])
        #expect(PasswordChangeCheck.problems(current: "old-pass-1", new: "new-pass-22", confirm: "new-pass-22").isEmpty)
        // Eight code points, as Django counts them.
        #expect(PasswordChangeCheck.problems(current: "x", new: "pässwörd", confirm: "pässwörd").isEmpty)
    }

    @Test("Photo: an image under 5 MB passes; anything else is named")
    func photoRules() {
        #expect(ProfilePhotoRules.problem(byteCount: 1_000, mimeType: "image/jpeg") == nil)
        #expect(ProfilePhotoRules.problem(byteCount: ProfilePhotoRules.maxBytes, mimeType: "image/png") == nil)
        #expect(ProfilePhotoRules.problem(byteCount: ProfilePhotoRules.maxBytes + 1, mimeType: "image/jpeg")
            == "That photo is over 5 MB. Choose a smaller one.")
        #expect(ProfilePhotoRules.problem(byteCount: 10, mimeType: "application/pdf") == "Choose a photo — a JPG or PNG image.")
    }

    @Test("Code box keeps six ASCII digits; the resend clock counts down to zero")
    func codeEntry() {
        #expect(EmailCodeEntry.sanitize("12 34-56 78") == "123456")
        #expect(EmailCodeEntry.sanitize("a1b2") == "12")
        #expect(EmailCodeEntry.sanitize("١٢٣") == "")
        #expect(EmailCodeEntry.isComplete("123456"))
        #expect(!EmailCodeEntry.isComplete("12345"))
        let sent = Date(timeIntervalSince1970: 1_000)
        #expect(EmailCodeEntry.cooldownRemaining(sentAt: sent, now: sent) == 60)
        #expect(EmailCodeEntry.cooldownRemaining(sentAt: sent, now: sent.addingTimeInterval(59.2)) == 1)
        #expect(EmailCodeEntry.cooldownRemaining(sentAt: sent, now: sent.addingTimeInterval(60)) == 0)
        #expect(EmailCodeEntry.cooldownRemaining(sentAt: nil) == 0)
    }

    @Test("Toast wording for signing others out")
    func othersWording() {
        #expect(AccountCopy.othersSignedOut(0) == "No other devices were signed in.")
        #expect(AccountCopy.othersSignedOut(1) == "Signed out on 1 other device.")
        #expect(AccountCopy.othersSignedOut(3) == "Signed out on 3 other devices.")
        #expect(AccountCopy.signOutOthersLabel(1) == "Sign out of 1 other device")
        #expect(AccountCopy.signOutOthersLabel(2) == "Sign out of 2 other devices")
    }

    @Test("When the password last changed, in the web's format")
    func passwordLine() {
        let utc = TimeZone(identifier: "UTC")!
        #expect(AccountCopy.passwordChangedLine("2026-09-26T10:17:17.452824+00:00", timeZone: utc) == "Last changed Sep 26, 2026")
        #expect(AccountCopy.passwordChangedLine(nil) == "You haven't changed it here yet.")
        #expect(AccountCopy.passwordChangedLine("not a date") == "You haven't changed it here yet.")
    }
}

// MARK: - Devices

@Suite struct DeviceSessionTests {
    @Test("User agents read the way the web names them")
    func describe() {
        let cases: [(String?, String, DeviceKind)] = [
            ("MasterSAT/2 CFNetwork/1568.100.1 Darwin/24.6.0", "MasterSAT app on iPhone", .app),
            ("MasterSAT/2 (iPad; iOS 18.0)", "MasterSAT app on iPad", .app),
            ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
             "Chrome on Windows", .computer),
            ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0",
             "Edge on Windows", .computer),
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
             "Safari on iPhone", .phone),
            ("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
             "Samsung Internet on Android", .phone),
            ("Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
             "Chrome on Android", .tablet),
            ("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1",
             "Chrome on iPad", .tablet),
            ("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox on Linux", .computer),
            ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
             "Safari on Mac", .computer),
            ("curl/8.4.0", "Unknown device", .computer),
            (nil, "Unknown device", .computer),
        ]
        for (ua, label, kind) in cases {
            #expect(DeviceDescription.describe(userAgent: ua) == DeviceDescription(label: label, kind: kind), "\(ua ?? "nil")")
        }
    }

    @Test("Last seen, the web's way")
    func lastActive() {
        let now = Date(timeIntervalSince1970: 1_790_417_801)
        func ago(_ seconds: Double) -> String { AccountFixtures.iso(now.timeIntervalSince1970 - seconds) }
        let utc = TimeZone(identifier: "UTC")!
        #expect(DeviceActivity.lastActiveLabel(ago(30), now: now) == "Active now")
        #expect(DeviceActivity.lastActiveLabel(ago(12 * 60), now: now) == "Active 12 minutes ago")
        #expect(DeviceActivity.lastActiveLabel(ago(3600), now: now) == "Active 1 hour ago")
        #expect(DeviceActivity.lastActiveLabel(ago(5 * 3600 + 100), now: now) == "Active 5 hours ago")
        #expect(DeviceActivity.lastActiveLabel(ago(30 * 3600), now: now) == "Active yesterday")
        #expect(DeviceActivity.lastActiveLabel(ago(3 * 86_400 + 10), now: now) == "Active 3 days ago")
        #expect(DeviceActivity.lastActiveLabel(ago(20 * 86_400), now: now, timeZone: utc) == "Active Sep 6")
        #expect(DeviceActivity.lastActiveLabel(nil, now: now) == "Active recently")
        #expect(DeviceActivity.lastActiveLabel("garbage", now: now) == "Active recently")
    }

    @Test("A JWT's iat is read; anything that is not a JWT reads as nothing")
    func jwt() {
        #expect(JWTClaims.issuedAt(of: AccountFixtures.jwt(iat: 1_790_417_801)) == Date(timeIntervalSince1970: 1_790_417_801))
        #expect(JWTClaims.issuedAt(of: AccountFixtures.jwt(iat: nil)) == nil)
        #expect(JWTClaims.issuedAt(of: "R") == nil)
        #expect(JWTClaims.issuedAt(of: "a.%%%.c") == nil)
    }

    private let iat = 1_790_417_801

    private func row(_ id: Int, createdOffset: Double?, current: Bool = false) -> DeviceSession {
        DeviceSession(
            id: id,
            createdAt: createdOffset.map { AccountFixtures.iso(Double(iat) + $0) },
            userAgent: "MasterSAT/2 CFNetwork/1568.100.1 Darwin/24.6.0",
            isCurrent: current
        )
    }

    @Test("The phone's row is the one written the moment its token was minted")
    func thisDeviceByIssue() {
        let token = AccountFixtures.jwt(iat: iat)
        // 0.35 s after iat: what the real login and rotation measured.
        let sessions = [row(5, createdOffset: -3_600), row(6, createdOffset: 0.35), row(7, createdOffset: -86_400)]
        #expect(DeviceSessionRules.thisDevice(in: sessions, refreshToken: token) == 6)
        let ordered = DeviceSessionRules.ordered(sessions, thisDevice: 6)
        #expect(ordered.map(\.id) == [6, 5, 7])
        #expect(DeviceSessionRules.others(in: sessions, thisDevice: 6).map(\.id) == [5, 7])
    }

    @Test("The server's own mark wins when it sends one")
    func serverMarkWins() {
        let sessions = [row(5, createdOffset: 0.2), row(6, createdOffset: -100, current: true)]
        #expect(DeviceSessionRules.thisDevice(in: sessions, refreshToken: AccountFixtures.jwt(iat: iat)) == 6)
    }

    @Test("Two rows in the window, none, or no readable token: unknown, and nobody is 'the others'")
    func unknown() {
        let token = AccountFixtures.jwt(iat: iat)
        let twins = [row(5, createdOffset: 0.3), row(6, createdOffset: 4)]
        #expect(DeviceSessionRules.thisDevice(in: twins, refreshToken: token) == nil)
        let stale = [row(5, createdOffset: 60), row(6, createdOffset: -30)]
        #expect(DeviceSessionRules.thisDevice(in: stale, refreshToken: token) == nil)
        #expect(DeviceSessionRules.thisDevice(in: [row(5, createdOffset: 0.3)], refreshToken: "R") == nil)
        #expect(DeviceSessionRules.thisDevice(in: [row(5, createdOffset: 0.3)], refreshToken: nil) == nil)
        #expect(DeviceSessionRules.thisDevice(in: [row(5, createdOffset: nil)], refreshToken: token) == nil)
        #expect(DeviceSessionRules.others(in: stale, thisDevice: nil).isEmpty)
        #expect(DeviceSessionRules.ordered(stale, thisDevice: nil).map(\.id) == [5, 6])
    }
}

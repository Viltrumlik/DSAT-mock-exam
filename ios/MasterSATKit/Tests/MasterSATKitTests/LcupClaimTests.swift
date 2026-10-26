import Foundation
import Testing
@testable import MasterSATKit

// MARK: - The two steps before anything else

@Suite struct LcupClaimAPITests {
    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> LcupClaimAPI {
        LcupClaimAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    private func body(_ request: URLRequest?) -> [String: Any] {
        guard let data = request?.httpBody else { return [:] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    @Test("The first password is posted on its own, and 204 answers with nothing")
    func setsInitialPassword() async throws {
        server.handler = { _ in StubResponse(status: 204, body: Data()) }
        try await api().setInitialPassword("Tashkent-Sunrise-2026")
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/lcup/claim/password/")
        #expect(request.httpMethod == "POST")
        #expect(body(request) as? [String: String] == ["password": "Tashkent-Sunrise-2026"])
    }

    @Test("A password Django refuses, and an account with nothing to choose, each say why")
    func initialPasswordRefused() async throws {
        server.handler = { _ in .json(["password": ["This password is too common."]], status: 400) }
        do {
            try await api().setInitialPassword("12345678")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.initialPasswordFailure(error) == "This password is too common.")
        }
        server.handler = { _ in .json(["detail": "There is no first password to choose for this account."], status: 403) }
        do {
            try await api().setInitialPassword("Tashkent-Sunrise-2026")
            Issue.record("expected a refusal")
        } catch {
            // The error as caught, not one rebuilt from its parts: a sentence is only proven
            // to reach the screen if the thing the screen is handed is the thing that threw.
            #expect(AccountCopy.initialPasswordFailure(error)
                == "There is no first password to choose for this account.")
        }
        // Throttled: DRF's own sentence says how long, so it is shown rather than replaced.
        server.handler = { _ in .json(["detail": "Request was throttled. Expected available in 42 seconds."], status: 429) }
        do {
            try await api().setInitialPassword("Tashkent-Sunrise-2026")
            Issue.record("expected a refusal")
        } catch {
            #expect(AccountCopy.initialPasswordFailure(error)
                == "Request was throttled. Expected available in 42 seconds.")
        }
        // A 400 with no sentence of its own is still Django's verdict on the password, so the
        // fallback may advise a longer one.
        #expect(AccountCopy.initialPasswordFailure(APIError.validation(detail: "", code: nil, fields: [:]))
            == AccountCopy.initialPasswordFailed)
    }

    @Test("A failure that was not about the password does not blame the password")
    func initialPasswordNotBlamed() {
        // Offline, a 5xx and a throttle say nothing about what was typed. "Try a longer one"
        // there has a student rewriting a password the server never saw.
        for failure: APIError in [
            .transport(underlying: "offline"),
            .http(status: 500, detail: ""),
            .http(status: 429, detail: ""),
            .unavailable(status: 503),
            .forbidden(detail: "", reason: nil),
        ] {
            #expect(AccountCopy.initialPasswordFailure(failure) == AccountCopy.initialPasswordNotSaved)
            #expect(!AccountCopy.initialPasswordFailure(failure).contains("longer"))
        }
        // A sentence the server did send still wins over both fallbacks.
        #expect(AccountCopy.initialPasswordFailure(APIError.forbidden(detail: "Nothing to choose.", reason: nil))
            == "Nothing to choose.")
    }

    @Test("The number is posted as typed, and the answer says whether the link moved")
    func confirmsPhone() async throws {
        server.handler = { _ in .json(["moved": true]) }
        #expect(try await api().confirmPhone("+998 90 123 45 67").moved)
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/lcup/claim/phone/")
        #expect(request.httpMethod == "POST")
        #expect(body(request) as? [String: String] == ["phone": "+998 90 123 45 67"])

        server.handler = { _ in .json(["moved": false]) }
        #expect(try await api().confirmPhone("998901234567").moved == false)
    }

    @Test("A wrong number is shown in the server's own sentence, digits and all")
    func wrongNumber() async throws {
        server.handler = { _ in
            .json([
                "phone": ["Bu raqam administratordagi raqamga mos kelmadi. Administratordagi raqam ••77 bilan tugaydi."],
                "hint": "77",
            ], status: 400)
        }
        do {
            _ = try await api().confirmPhone("+998901234500")
            Issue.record("expected a refusal")
        } catch let refusal as PhoneClaimRefusal {
            #expect(refusal.reason == .wrongNumber)
            // The digits are kept because the sentence is passed through untouched — never
            // because the app read `••77` back out of it. There is no `hint` value to read.
            #expect(refusal.errorDescription?.contains("••77 bilan tugaydi.") == true)
            #expect(AccountCopy.phoneFailure(refusal) == refusal.detail)
        }
        // A number the server could not even read: the same refusal, its own sentence.
        server.handler = { _ in .json(["phone": ["Raqamni to'liq kiriting, masalan: +998 90 123 45 67."]], status: 400) }
        do {
            _ = try await api().confirmPhone("998")
            Issue.record("expected a refusal")
        } catch let refusal as PhoneClaimRefusal {
            #expect(refusal.reason == .wrongNumber)
            #expect(refusal.detail == "Raqamni to'liq kiriting, masalan: +998 90 123 45 67.")
        }
    }

    @Test("Nothing to confirm, another student's account and too many tries are told apart")
    func phoneRefusals() async throws {
        let cases: [(Int, String, PhoneClaimRefusal.Reason)] = [
            (403, "Bu akkauntda tasdiqlanadigan raqam yo'q.", .nothingToConfirm),
            (409, "Bu akkaunt boshqa o'quvchiga bog'langan. Administratorga murojaat qiling.", .linkedElsewhere),
            (429, "Urinishlar juda ko'p bo'ldi. Administratorga murojaat qiling.", .tooManyTries),
        ]
        for (status, detail, reason) in cases {
            server.handler = { _ in .json(["detail": detail], status: status) }
            do {
                _ = try await api().confirmPhone("+998901234567")
                Issue.record("expected a refusal for \(status)")
            } catch let refusal as PhoneClaimRefusal {
                #expect(refusal.reason == reason)
                #expect(AccountCopy.phoneFailure(refusal) == detail)
            }
        }
    }

    @Test("A failure that is not one of the four is rethrown as it came")
    func otherFailuresPassThrough() async throws {
        server.handler = { _ in .json(["detail": "Server error."], status: 500) }
        do {
            _ = try await api().confirmPhone("+998901234567")
            Issue.record("expected a failure")
        } catch APIError.http(let status, _) {
            #expect(status == 500)
        }
        #expect(AccountCopy.phoneFailure(APIError.transport(underlying: "offline")) == AccountCopy.phoneSaveFailed)
        // A `.validation` cannot reach `phoneFailure` from this endpoint — `LcupClaimAPI` has
        // already turned it into a `.wrongNumber` refusal carrying `fields["phone"]`. Handed
        // one anyway, it says the refusal's `detail`; there is no second field-map read.
        #expect(AccountCopy.phoneFailure(APIError.validation(detail: "Noto'g'ri so'rov.", code: nil, fields: ["phone": ["ignored"]]))
            == "Noto'g'ri so'rov.")
    }

    @Test("A reason is only the status it came from, so nothing may read it as a verdict")
    func reasonIsOnlyAStatus() async throws {
        // Not the phone question at all: a host guard's 403, with its own sentence. It lands in
        // `.nothingToConfirm` because the reason is derived from the status alone — which is
        // exactly why the gate advances on a re-read profile and never on a reason.
        server.handler = { _ in .json(["detail": "Not allowed on this host."], status: 403) }
        do {
            _ = try await api().confirmPhone("+998901234567")
            Issue.record("expected a refusal")
        } catch let refusal as PhoneClaimRefusal {
            #expect(refusal.reason == .nothingToConfirm)
            #expect(refusal.detail == "Not allowed on this host.")
        }
    }

    @Test("A namesake's answer posts not_me, and its own failure has its own sentence")
    func saysNotMe() async throws {
        server.handler = { _ in StubResponse(status: 204, body: Data()) }
        try await api().sayNotMe()
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/lcup/claim/phone/")
        #expect(body(request)["not_me"] as? Bool == true)
        #expect(body(request)["phone"] == nil)

        server.handler = { _ in .json(["detail": "Bu akkauntda tasdiqlanadigan raqam yo'q."], status: 403) }
        do {
            try await api().sayNotMe()
            Issue.record("expected a refusal")
        } catch let refusal as PhoneClaimRefusal {
            #expect(refusal.reason == .nothingToConfirm)
        }
        #expect(AccountCopy.phoneFailure(APIError.transport(underlying: "x"), fallback: AccountCopy.notMeFailed)
            == AccountCopy.notMeFailed)
    }

    @Test("A refusal without a sentence falls back to the server's own wording")
    func refusalFallbacks() {
        #expect(PhoneClaimRefusal(reason: .tooManyTries, detail: "").errorDescription
            == "Urinishlar juda ko'p bo'ldi. Administratorga murojaat qiling.")
        #expect(PhoneClaimRefusal(reason: .wrongNumber, detail: "").errorDescription
            == "Bu raqam administratordagi raqamga mos kelmadi.")
        #expect(PhoneClaimRefusal(reason: .nothingToConfirm, detail: "").errorDescription
            == "Bu akkauntda tasdiqlanadigan raqam yo'q.")
        #expect(PhoneClaimRefusal(reason: .linkedElsewhere, detail: "").errorDescription
            == "Bu akkaunt boshqa o'quvchiga bog'langan. Administratorga murojaat qiling.")
    }
}

// MARK: - What each step checks before it sends

@Suite struct LcupClaimChecksTests {
    @Test("Eight code points, and both boxes the same")
    func initialPassword() {
        #expect(InitialPasswordCheck.problem(password: "Toshkent", again: "Toshkent") == nil)
        #expect(InitialPasswordCheck.problem(password: "Toshken", again: "Toshken") == "Use at least 8 characters.")
        #expect(InitialPasswordCheck.problem(password: "Toshkent", again: "Toshkenti") == "The two passwords are different.")
        // Counted as Python counts (code points): eight scalars, drawn as four flags.
        #expect(InitialPasswordCheck.problem(password: "🇺🇿🇺🇿🇺🇿🇺🇿", again: "🇺🇿🇺🇿🇺🇿🇺🇿") == nil)
        #expect(InitialPasswordCheck.problem(password: "🇺🇿🇺🇿🇺🇿", again: "🇺🇿🇺🇿🇺🇿") == "Use at least 8 characters.")
    }

    @Test("The phone step asks for a number, in Uzbek")
    func phoneEntry() {
        #expect(PhoneClaimEntry.problem("") == "Telefon raqamingizni kiriting.")
        #expect(PhoneClaimEntry.problem("   ") == "Telefon raqamingizni kiriting.")
        #expect(PhoneClaimEntry.problem("+998 90 123 45 67") == nil)
    }
}

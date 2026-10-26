import Foundation

/// The two steps an lc-up student meets on their first sign-in, both asked by the
/// profile-completion gate and both reached from behind it (`IsAuthenticated`).
///
/// Two things about these endpoints shape how the gate must use them:
///
/// - choosing the first password does NOT end the session: `lcup/claims.py:set_initial_password`
///   writes `password` and `password_set_at` and nothing else — no `last_password_change`, no
///   revocation, unlike `/auth/password/change/` — so the gate walks straight on and the app
///   must not sign out;
/// - neither answer carries the verdict, so after each one the gate re-reads
///   `AccountAPI.profile()` and asks `ProfileCompletion.next(after:missing:)` what is left.
///   That is what the web's `invalidateMe` does.
public struct LcupClaimAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// `POST /lcup/claim/password/` — the student's own first password. 204, nothing to read.
    ///
    /// - Throws: `APIError.validation` with `fields["password"]` for a password Django's
    ///   validators refuse, `APIError.forbidden` when this account has no first password to
    ///   choose. `AccountCopy.initialPasswordFailure` turns either into a sentence.
    public func setInitialPassword(_ password: String) async throws {
        try await client.send(try .post("/lcup/claim/password/", json: ["password": password]))
    }

    /// `POST /lcup/claim/phone/` — the number the administrator holds, typed on the account the
    /// student actually uses, makes that account the one lc-up is linked to.
    ///
    /// `moved` means another account held the link until now: the server then follows the
    /// student (`tasks.follow_student`), and their seats and marks arrive when they arrive —
    /// there is nothing for the app to wait for.
    public func confirmPhone(_ phone: String) async throws -> PhoneClaim {
        do {
            return try await client.send(
                try .post("/lcup/claim/phone/", json: ["phone": phone]),
                as: PhoneClaim.self
            )
        } catch {
            throw PhoneClaimRefusal(error) ?? error
        }
    }

    /// `POST /lcup/claim/phone/` with `{"not_me": true}` — a namesake. The question goes from
    /// this account and no link moves. 204.
    public func sayNotMe() async throws {
        do {
            try await client.send(try .post("/lcup/claim/phone/", json: ["not_me": JSONValue.bool(true)]))
        } catch {
            throw PhoneClaimRefusal(error) ?? error
        }
    }
}

/// The answer to a confirmed number: whether lc-up's link moved to this account.
public struct PhoneClaim: Decodable, Sendable, Equatable {
    public let moved: Bool

    public init(moved: Bool) {
        self.moved = moved
    }
}

/// Why the phone step refused, keeping the server's own sentence.
///
/// The screen branches on `reason` and shows `errorDescription`, never the other way round:
/// the sentences are the owner's Uzbek from `lcup/phone_confirm.py`, written to be edited.
///
/// **A reason is read from the HTTP status and nothing else**, so each case means no more than
/// "this request got that status". `.nothingToConfirm` means "this request got a 403" — a host
/// guard, a frozen-account rule or any 403 the server grows later lands there too, and none of
/// them says the phone question has been answered.
///
/// So a caller must **never** treat a reason as "this step is done" and advance on it. Only a
/// fresh `AccountAPI.profile()` read, whose `missing_fields` no longer lists the step's field,
/// may say that (`CompleteProfileView.advance(from:)`). Taking a reason for a verdict is how
/// the gate's earlier trap was built.
public struct PhoneClaimRefusal: Error, Sendable, Equatable {
    public enum Reason: Sendable, Equatable {
        /// 403 — the server refused. Usually "no pending question on this account" (already
        /// answered, or never asked), but see the type's note: any other 403 is this case too.
        case nothingToConfirm
        /// 400 — not the number lc-up holds.
        ///
        /// No hint value: the server sends the number's last two digits as a top-level `hint`
        /// string beside DRF's field map (`lcup/views.py:367`), which `APIError.validation`
        /// cannot carry — it keeps only the array-valued keys. Nothing needs it either: the
        /// sentence shown to the student is the sentence the server built those digits into
        /// (`••77`). Reading them back out of Uzbek prose would break silently the day that
        /// sentence is reworded.
        case wrongNumber
        /// 409 — this account is lc-up's for a different student; an administrator untangles it.
        case linkedElsewhere
        /// 429 — `MAX_PHONE_ATTEMPTS` wrong numbers. Only an administrator can help now.
        case tooManyTries
    }

    public let reason: Reason
    /// The sentence written for the student. May be empty.
    public let detail: String

    public init(reason: Reason, detail: String) {
        self.reason = reason
        self.detail = detail
    }

    /// The refusal in `error`, or nil when the failure was not one of the four — a transport
    /// failure, a 500 or an expired session is rethrown as it came.
    init?(_ error: Error) {
        guard let failure = error as? APIError else { return nil }
        switch failure {
        case .forbidden(let detail, _):
            self.init(reason: .nothingToConfirm, detail: detail)
        case .conflict(let detail):
            self.init(reason: .linkedElsewhere, detail: detail)
        case .http(let status, let detail) where status == 429:
            self.init(reason: .tooManyTries, detail: detail)
        case .validation(let detail, _, let fields):
            // A wrong number arrives as DRF's field map, so `detail` is that message already;
            // keep reading `phone` so a refusal about some other field still says its own.
            self.init(reason: .wrongNumber, detail: fields["phone"]?.first ?? detail)
        default:
            return nil
        }
    }
}

extension PhoneClaimRefusal: LocalizedError {
    /// The server's own sentence — the `wrongNumber` one carries the `••NN` hint — and its
    /// wording from `lcup/phone_confirm.py` when a refusal arrived without one.
    public var errorDescription: String? {
        if !detail.isEmpty { return detail }
        switch reason {
        case .nothingToConfirm: return "Bu akkauntda tasdiqlanadigan raqam yo'q."
        case .wrongNumber: return "Bu raqam administratordagi raqamga mos kelmadi."
        case .linkedElsewhere: return "Bu akkaunt boshqa o'quvchiga bog'langan. Administratorga murojaat qiling."
        case .tooManyTries: return "Urinishlar juda ko'p bo'ldi. Administratorga murojaat qiling."
        }
    }
}

import Foundation

// MARK: - The profile-completion gate

/// When a signed-in student must finish their profile before using anything else.
///
/// The rule itself lives on the server (`users.profile_completeness`): first name, last name
/// and username at least three characters once trimmed, and an email that is present AND
/// confirmed. The server reports the verdict as `profile_complete` + `missing_fields`, and —
/// like the web — the app never recomputes it; it only reads what the server said.
public enum ProfileCompletion {
    /// The server's `MIN_IDENTITY_LEN`.
    public static let minimumLength = 3

    /// The three identity fields, in the order the completion form asks for them.
    public static let nameFields = ["first_name", "last_name", "username"]

    /// The two extras the server adds to `missing_fields` for an account the lc-up sync created
    /// (`users/profile_completeness.py` appends them): its own first password
    /// (`lcup/claims.py`), then the number that decides which same-name account lc-up follows
    /// (`lcup/phone_confirm.py`, `REQUIREMENT`).
    public static let passwordField = "password"
    public static let phoneField = "lcup_phone"

    /// Whether the app must stop at the completion screen.
    ///
    /// The web's `AuthGuard`, exactly: the server has to say so explicitly —
    /// `profile_complete == false` AND a non-empty `missing_fields`. Absent fields (an older
    /// backend, or an account cached before they existed) mean "no opinion", never
    /// "incomplete". A frozen account belongs to the frozen screen, which wins.
    public static func isRequired(profileComplete: Bool?, missingFields: [String]?, isFrozen: Bool) -> Bool {
        guard !isFrozen, profileComplete == false else { return false }
        return !(missingFields ?? []).isEmpty
    }

    public static func isRequired(for user: CurrentUser) -> Bool {
        isRequired(profileComplete: user.profileComplete, missingFields: user.missingFields, isFrozen: user.isFrozen)
    }

    /// Declared in the order the gate walks them, which `firstStep` and `next(after:)` read:
    /// the web's order (`ProfileCompletionGate`) — the first password, then the lc-up phone,
    /// then the names (one save), then the email (a round trip).
    public enum Step: Sendable, Equatable, CaseIterable {
        case password
        case phone
        case names
        case email
    }

    public static func needsPassword(_ missing: [String]) -> Bool {
        missing.contains(passwordField)
    }

    public static func needsPhone(_ missing: [String]) -> Bool {
        missing.contains(phoneField)
    }

    public static func needsNames(_ missing: [String]) -> Bool {
        missing.contains { nameFields.contains($0) }
    }

    /// "email" covers both no address and an unconfirmed one.
    public static func needsEmail(_ missing: [String]) -> Bool {
        missing.contains("email")
    }

    /// The first step the server says is outstanding.
    ///
    /// With nothing missing it still answers `.email`, which only `isRequired` makes
    /// unreachable: it already refuses an empty `missing_fields`, so the gate is never mounted
    /// for a student with nothing to do.
    ///
    /// A requirement this app has not been taught falls there too. The server's extras are
    /// open-ended (`users/profile_completeness.py`, `register_requirement`), so a future one
    /// arrives as a name no `Step` claims — and the student then meets the email step, which
    /// they can at least act on, rather than a lifted gate. It reads the list, never its order.
    public static func firstStep(missing: [String]) -> Step {
        outstanding(from: 0, missing: missing) ?? .email
    }

    /// The next step still outstanding after `step`, or nil when the gate is finished.
    ///
    /// Every step asks this against a freshly read `missing_fields` rather than deciding from
    /// the answer it just sent — and never repeats itself, even if the field it saved is still
    /// listed. Trusting one step's own answer is how an lc-up student whose `missing_fields`
    /// was `["password"]` ended up on an email step that could not clear it.
    public static func next(after step: Step, missing: [String]) -> Step? {
        guard let index = Step.allCases.firstIndex(of: step) else { return nil }
        return outstanding(from: index + 1, missing: missing)
    }

    /// What the server calls the fields a step fills, so a step that could not re-read the
    /// verdict can drop its own from the list it was last given. The names step fills three.
    public static func fields(of step: Step) -> [String] {
        switch step {
        case .password: return [passwordField]
        case .phone: return [phoneField]
        case .names: return nameFields
        case .email: return ["email"]
        }
    }

    /// Whether a freshly read `missing_fields` says this step is already done.
    ///
    /// The one question a refused save may ask (rulings S1-R5, S1-R8). Once a field is gone the
    /// server refuses its step for good — "There is no first password to choose for this
    /// account." (`lcup/claims.py`), `NOTHING_TO_CONFIRM` (`lcup/phone_confirm.py`) — which
    /// happens when a save landed but its reply did not, when the step was done on another
    /// device, or when a namesake's confirm answered this account's prompt. Without this the
    /// student sits on a form that can never succeed.
    ///
    /// It reads the list and nothing else: the refusal itself never decides, so a 403 from a
    /// host guard, a 409 or a 429 all find the field still listed and keep their sentence.
    public static func isCleared(_ step: Step, in fresh: [String]) -> Bool {
        !fresh.contains(where: fields(of: step).contains)
    }

    /// What the gate does once a step is done: the whole decision, so it is tested here rather
    /// than eyeballed inside a view.
    public enum Outcome: Sendable, Equatable {
        case show(Step)
        case finished
    }

    /// The decision after `step`, and the list it was made from (the gate keeps that list).
    ///
    /// `missing` is the freshly read `missing_fields`. **nil means it could not be read at
    /// all** — the server was unreachable, or its answer carried no readable list — and then
    /// the verdict falls back to `lastKnown` without this step's own fields, which is what the
    /// email step has always done. Reading nil as an empty list is how an offline student gets
    /// told their profile is all set.
    ///
    /// **`next(after:) == nil` is not "done" on its own** (ruling S1-R9). It means "no step
    /// after this one is outstanding", which is also what a requirement this build has never
    /// heard of looks like: the server's extras are open-ended
    /// (`users/profile_completeness.py`, `register_requirement`). So on `nil` the decision is
    /// re-derived from the list — empty means finished, anything else means `firstStep`, even
    /// if that is this step again. A student then always has a step they can act on, instead
    /// of the gate lifting and remounting under them a moment later.
    ///
    /// Only a read list may say a step is done. Nothing here looks at why a save failed
    /// (ruling S1-R8): a 403 from a host guard or a future rule would otherwise read as
    /// "already answered" and skip the step it was refusing.
    public static func outcome(
        after step: Step,
        missing: [String]?,
        lastKnown: [String]
    ) -> (missing: [String], outcome: Outcome) {
        let outstanding = missing ?? lastKnown.filter { !fields(of: step).contains($0) }
        if let next = next(after: step, missing: outstanding) {
            return (outstanding, .show(next))
        }
        guard outstanding.isEmpty else {
            return (outstanding, .show(firstStep(missing: outstanding)))
        }
        return (outstanding, .finished)
    }

    private static func outstanding(from index: Int, missing: [String]) -> Step? {
        Step.allCases[index...].first { isOutstanding($0, missing: missing) }
    }

    static func isOutstanding(_ step: Step, missing: [String]) -> Bool {
        switch step {
        case .password: return needsPassword(missing)
        case .phone: return needsPhone(missing)
        case .names: return needsNames(missing)
        case .email: return needsEmail(missing)
        }
    }

    /// The completion form's own check before it saves: all three at least three characters
    /// once trimmed. The web's sentence for the first one that is short, or nil.
    public static func nameProblem(firstName: String, lastName: String, username: String) -> String? {
        let fields: [(String, String)] = [("First name", firstName), ("Last name", lastName), ("Username", username)]
        for (label, value) in fields where tooShort(value) {
            return "\(label) must be at least \(minimumLength) characters."
        }
        return nil
    }

    static func tooShort(_ value: String) -> Bool {
        value.trimmingCharacters(in: .whitespacesAndNewlines).count < minimumLength
    }
}

extension CurrentUser {
    /// See `ProfileCompletion.isRequired(for:)`.
    public var mustCompleteProfile: Bool { ProfileCompletion.isRequired(for: self) }
}

// MARK: - Account details (name, username, phone)

/// A field of the Account form, keyed by its name on the wire.
public enum AccountField: String, Sendable, CaseIterable {
    case firstName = "first_name"
    case lastName = "last_name"
    case username
    case phoneNumber = "phone_number"

    public var label: String {
        switch self {
        case .firstName: return "First name"
        case .lastName: return "Last name"
        case .username: return "Username"
        case .phoneNumber: return "Phone number"
        }
    }
}

/// The Account form while it is being typed.
public struct AccountDetailsDraft: Equatable, Sendable {
    public var firstName: String
    public var lastName: String
    public var username: String
    public var phoneNumber: String

    public init(firstName: String = "", lastName: String = "", username: String = "", phoneNumber: String = "") {
        self.firstName = firstName
        self.lastName = lastName
        self.username = username
        self.phoneNumber = phoneNumber
    }

    public init(_ profile: AccountProfile) {
        self.init(
            firstName: profile.firstName,
            lastName: profile.lastName,
            username: profile.username,
            phoneNumber: profile.phoneNumber
        )
    }

    public func value(_ field: AccountField) -> String {
        switch field {
        case .firstName: return firstName
        case .lastName: return lastName
        case .username: return username
        case .phoneNumber: return phoneNumber
        }
    }

    public mutating func set(_ field: AccountField, _ value: String) {
        switch field {
        case .firstName: firstName = value
        case .lastName: lastName = value
        case .username: username = value
        case .phoneNumber: phoneNumber = value
        }
    }

    /// Fields whose trimmed value differs from what is saved. Whitespace alone is not a change,
    /// exactly as on the web.
    public func changedFields(since saved: AccountDetailsDraft) -> [AccountField] {
        AccountField.allCases.filter { trimmed(value($0)) != trimmed(saved.value($0)) }
    }

    public func isDirty(comparedTo saved: AccountDetailsDraft) -> Bool {
        !changedFields(since: saved).isEmpty
    }

    /// What to send: only what changed, trimmed; a phone emptied out is sent as `null`,
    /// which is how the server clears it.
    ///
    /// Only the changed fields, where the web sends all four. A name saved before the
    /// three-character rule existed would otherwise be refused on every save — including one
    /// that only touched the phone number.
    public func changes(since saved: AccountDetailsDraft) -> AccountDetailsChanges {
        var out = AccountDetailsChanges()
        for field in changedFields(since: saved) {
            let value = trimmed(self.value(field))
            switch field {
            case .firstName: out.firstName = value
            case .lastName: out.lastName = value
            case .username: out.username = value
            case .phoneNumber: out.phoneNumber = .some(value.isEmpty ? nil : value)
            }
        }
        return out
    }

    /// Checked before sending. The server ACCEPTS an emptied name or username — and the
    /// profile-completion gate then locks the student out of everything until they put one
    /// back. So a changed identity field must still be three characters, with the
    /// completion form's own sentence. Everything else (phone format, a taken username) is
    /// left to the server, whose message is shown as it sends it.
    public func problems(since saved: AccountDetailsDraft) -> [AccountField: String] {
        var out: [AccountField: String] = [:]
        for field in changedFields(since: saved) where field != .phoneNumber {
            if ProfileCompletion.tooShort(value(field)) {
                out[field] = "\(field.label) must be at least \(ProfileCompletion.minimumLength) characters."
            }
        }
        return out
    }

    private func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// A `PATCH /api/users/me/` body. `nil` leaves a field alone; `phoneNumber == .some(nil)`
/// clears the phone.
public struct AccountDetailsChanges: Equatable, Sendable {
    public var firstName: String?
    public var lastName: String?
    public var username: String?
    public var phoneNumber: String??

    public init(firstName: String? = nil, lastName: String? = nil, username: String? = nil, phoneNumber: String?? = nil) {
        self.firstName = firstName
        self.lastName = lastName
        self.username = username
        self.phoneNumber = phoneNumber
    }

    public var isEmpty: Bool {
        firstName == nil && lastName == nil && username == nil && phoneNumber == nil
    }

    var body: [String: JSONValue] {
        var body: [String: JSONValue] = [:]
        if let firstName { body[AccountField.firstName.rawValue] = .string(firstName) }
        if let lastName { body[AccountField.lastName.rawValue] = .string(lastName) }
        if let username { body[AccountField.username.rawValue] = .string(username) }
        if let phoneNumber { body[AccountField.phoneNumber.rawValue] = phoneNumber.map(JSONValue.string) ?? .null }
        return body
    }
}

// MARK: - Profile photo

public enum ProfilePhotoRules {
    /// The server's `USER_PROFILE_MAX_IMAGE_BYTES`, checked first so a student is not made to
    /// wait for an upload the server would refuse.
    public static let maxBytes = 5 * 1024 * 1024

    /// The web's sentence when a picked file cannot be sent, or nil when it can.
    public static func problem(byteCount: Int, mimeType: String) -> String? {
        guard mimeType.lowercased().hasPrefix("image/") else { return "Choose a photo — a JPG or PNG image." }
        guard byteCount <= maxBytes else { return "That photo is over 5 MB. Choose a smaller one." }
        return nil
    }
}

// MARK: - Password

/// The change-password form's checks, made before anything is sent so a typo costs nothing.
/// The web's `PasswordForm`, rule for rule and sentence for sentence.
public enum PasswordChangeCheck {
    public static let minimumLength = 8

    public enum Field: String, Sendable {
        case current = "current_password"
        case new = "new_password"
        case confirm
    }

    public static func problems(current: String, new: String, confirm: String) -> [Field: String] {
        var out: [Field: String] = [:]
        if current.isEmpty { out[.current] = "Enter your current password." }
        // Counted as the server counts (`len()` in Python: code points), not as grapheme
        // clusters, so the two can never disagree about an eight-character password.
        if new.unicodeScalars.count < minimumLength {
            out[.new] = "Use at least 8 characters."
        } else if new == current {
            out[.new] = "Choose a password that is different from your current one."
        }
        if out[.new] == nil, confirm != new { out[.confirm] = "The two new passwords don't match." }
        return out
    }
}

// MARK: - The lc-up first sign-in

/// The first-password step's checks, made before anything is sent. The web's
/// `ProfileCompletionGate.savePassword`, rule for rule and sentence for sentence; everything
/// harder (too common, entirely numeric) is Django's validators' to refuse.
public enum InitialPasswordCheck {
    /// The web's `MIN_PASSWORD_LEN`, which is also Django's `MinimumLengthValidator` default.
    /// A shorter one is refused here rather than by a round trip; everything else is Django's.
    public static let minimumLength = 8

    /// The first problem, or nil. Counted as the server counts (`len()` in Python: code
    /// points), as `PasswordChangeCheck` does, so the two can never disagree about an
    /// eight-character password.
    public static func problem(password: String, again: String) -> String? {
        if password.unicodeScalars.count < minimumLength { return "Use at least 8 characters." }
        if password != again { return "The two passwords are different." }
        return nil
    }
}

/// The lc-up phone step's one check before sending; the server decides whether the number is
/// the administrator's.
///
/// Uzbek, verbatim from the web. This is the one screen whose words the owner wrote, for the
/// number an administrator holds, and a second translation would be a second meaning.
public enum PhoneClaimEntry {
    public static func problem(_ phone: String) -> String? {
        phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Telefon raqamingizni kiriting."
            : nil
    }
}

// MARK: - Email code

public enum EmailCodeEntry {
    public static let length = 6
    /// The web's resend cooldown.
    public static let resendCooldownSeconds = 60
    /// `EmailClaim.TTL_MINUTES`, for when the server's answer does not say.
    public static let defaultLifetimeMinutes = 15

    /// What the code box keeps of what was typed or pasted: ASCII digits, at most six.
    public static func sanitize(_ raw: String) -> String {
        String(raw.unicodeScalars.filter { ("0"..."9").contains($0) }.prefix(length).map(Character.init))
    }

    public static func isComplete(_ code: String) -> Bool {
        code.count == length && sanitize(code) == code
    }

    /// Seconds left before "Resend code" works again, never negative.
    public static func cooldownRemaining(sentAt: Date?, now: Date = Date()) -> Int {
        guard let sentAt else { return 0 }
        let left = Double(resendCooldownSeconds) - now.timeIntervalSince(sentAt)
        return left > 0 ? Int(left.rounded(.up)) : 0
    }
}

// MARK: - What the screens say

/// Every sentence the account screens show, in the site's words, and which one a failure
/// becomes. Pure, so the mapping is tested rather than eyeballed.
public enum AccountCopy {
    // Account
    public static let detailsSaved = "Your details are saved."
    public static let detailsFailed = "That didn't save. Nothing has changed — try again."
    public static let photoUploaded = "Your new photo is up."
    public static let photoFailed = "The photo didn't upload. Try again."
    public static let photoRemoved = "Your photo is removed."
    public static let photoRemoveFailed = "The photo wasn't removed. Try again."

    // Password
    public static let passwordThrottled = "Too many tries for now. Wait a while, then try again."
    public static let passwordFailed = "That didn't go through. Your password hasn't changed — try again."

    // lc-up first sign-in — the web's three fallbacks, the phone step's in Uzbek
    public static let initialPasswordFailed = "Could not save the password. Try a longer one."
    /// When the refusal was not about the password: nothing was heard back, or the server
    /// broke. "Try a longer one" there sends a student rewriting a password that was fine, and
    /// saying it is not saved would claim to know something a timeout cannot tell us — the save
    /// may well have landed, which is what `isCleared` finds on the next tap.
    public static let initialPasswordNotSaved = "That didn't go through. Try again."
    public static let phoneSaveFailed = "Raqamni saqlab bo'lmadi. Qaytadan urinib ko'ring."
    public static let notMeFailed = "Saqlab bo'lmadi. Qaytadan urinib ko'ring."

    // Email
    public static let emailRequired = "Enter your email address."
    public static let codeRequired = "Enter the 6-digit code."
    public static let emailThrottled = "Too many attempts. Wait a few minutes and try again."
    public static let emailSendFailed = "Could not send the code. Check the address and try again."
    public static let codeFailed = "That code is not correct."
    public static let emailConfirmed = "Your email is confirmed."

    // Devices
    public static let deviceSignOutFailed = "That device wasn't signed out. Try again."
    public static let othersSignOutFailed = "The other devices weren't signed out. Try again."
    public static let everywhereFailed = "That didn't go through. You're still signed in everywhere."

    /// "{label} is signed out."
    public static func deviceSignedOut(_ label: String) -> String { "\(label) is signed out." }

    /// The toast after "Sign out of N other devices".
    public static func othersSignedOut(_ count: Int) -> String {
        count > 0 ? "Signed out on \(count) other \(count == 1 ? "device" : "devices")." : "No other devices were signed in."
    }

    /// "Sign out of 2 other devices".
    public static func signOutOthersLabel(_ count: Int) -> String {
        "Sign out of \(count) other \(count == 1 ? "device" : "devices")"
    }

    /// The first message per field of a DRF refusal, or nil when the failure was not one.
    public static func fieldMessages(_ error: Error) -> [String: String]? {
        guard case .validation(_, _, let fields)? = error as? APIError else { return nil }
        var out: [String: String] = [:]
        for (key, messages) in fields {
            if let first = messages.first { out[key] = first }
        }
        return out.isEmpty ? nil : out
    }

    /// A failed Account save: messages under the fields they belong to, and at most one
    /// sentence for the form as a whole.
    public static func detailsFailure(_ error: Error) -> (fields: [AccountField: String], general: String?) {
        guard let messages = fieldMessages(error) else { return ([:], detailsFailed) }
        var fields: [AccountField: String] = [:]
        for field in AccountField.allCases {
            if let message = messages[field.rawValue] { fields[field] = message }
        }
        let general = messages["non_field_errors"] ?? messages["detail"]
        // A refusal about some field this form does not show still has to be said somewhere.
        if fields.isEmpty, general == nil { return ([:], messages.sorted { $0.key < $1.key }.first?.value ?? detailsFailed) }
        return (fields, general)
    }

    /// A failed photo upload: the server's own word on the file, else the web's sentence.
    public static func photoFailure(_ error: Error) -> String {
        fieldMessages(error)?["profile_image"] ?? photoFailed
    }

    /// A failed password change, keyed like the form: `current_password`, `new_password`,
    /// `detail` for the form as a whole.
    public static func passwordFailure(_ error: Error) -> [String: String] {
        if let fields = fieldMessages(error) { return fields }
        if case .http(429, _)? = error as? APIError { return ["detail": passwordThrottled] }
        return ["detail": passwordFailed]
    }

    /// A refused first password: Django's own word on it (`{"password": ["This password is too
    /// common."]}`), else the 403's sentence, else a fallback.
    ///
    /// Which fallback depends on who was refusing. "Try a longer one" is advice about the
    /// password, so it is only for a 400 — Django's verdict on the password, arriving without a
    /// sentence of its own. A transport failure, a 5xx or a 429 says nothing about the password,
    /// and blaming it there would have a student rewriting a password the server never saw.
    public static func initialPasswordFailure(_ error: Error) -> String {
        if let message = fieldMessages(error)?[ProfileCompletion.passwordField] { return message }
        if let sentence = serverSentence(error) { return sentence }
        if case .validation(_, _, _)? = error as? APIError { return initialPasswordFailed }
        return initialPasswordNotSaved
    }

    /// A refused phone answer, in the server's Uzbek — the `wrongNumber` sentence carries the
    /// `••NN` hint, so it is shown as it arrives. `fallback` is the "Bu men emasman" path's
    /// (`notMeFailed`), which has no number to blame.
    ///
    /// No field-message branch: `LcupClaimAPI` turns every `.validation` from that endpoint
    /// into a `PhoneClaimRefusal` (`.wrongNumber`, carrying `fields["phone"]` as its sentence)
    /// before it can reach here, so reading `fields["phone"]` again would be dead code.
    /// `serverSentence` still says a `.validation`'s `detail` for anything else that arrives.
    public static func phoneFailure(_ error: Error, fallback: String = phoneSaveFailed) -> String {
        if let refusal = error as? PhoneClaimRefusal { return refusal.errorDescription ?? fallback }
        return serverSentence(error) ?? fallback
    }

    /// The `{"detail": "…"}` of a refusal that carries one. A transport failure's sentence is
    /// the app's own, never the server's, so it is not one.
    private static func serverSentence(_ error: Error) -> String? {
        guard let failure = error as? APIError else { return nil }
        switch failure {
        case .forbidden(let detail, _), .conflict(let detail), .http(_, let detail), .validation(let detail, _, _):
            return detail.isEmpty ? nil : detail
        default:
            return nil
        }
    }

    /// A failed "Send code".
    ///
    /// 429 gets the web's own fallback sentence rather than DRF's "Request was throttled.
    /// Expected available in 3540 seconds." — which is what the web itself shows, because it
    /// prefers any `detail` string it is given.
    public static func emailRequestFailure(_ error: Error) -> String {
        if let refusal = error as? EmailVerificationRefusal { return refusal.errorDescription ?? emailSendFailed }
        if case .http(let status, let detail)? = error as? APIError {
            if status == 429 { return emailThrottled }
            if status == 400, !detail.isEmpty { return detail }
        }
        return emailSendFailed
    }

    /// A failed "Confirm".
    public static func emailConfirmFailure(_ error: Error) -> String {
        if let refusal = error as? EmailVerificationRefusal { return refusal.errorDescription ?? codeFailed }
        if case .http(let status, let detail)? = error as? APIError {
            if status == 429 { return emailThrottled }
            if status == 400, !detail.isEmpty { return detail }
        }
        return codeFailed
    }

    /// "Last changed Sep 26, 2026", or the web's line for a password never changed here.
    public static func passwordChangedLine(_ iso: String?, timeZone: TimeZone = .current) -> String {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return "You haven't changed it here yet." }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "MMM d, yyyy"
        return "Last changed \(f.string(from: date))"
    }
}

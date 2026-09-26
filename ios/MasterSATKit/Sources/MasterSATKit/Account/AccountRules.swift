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

    public enum Step: Sendable, Equatable {
        case names
        case email
    }

    public static func needsNames(_ missing: [String]) -> Bool {
        missing.contains { nameFields.contains($0) }
    }

    /// "email" covers both no address and an unconfirmed one.
    public static func needsEmail(_ missing: [String]) -> Bool {
        missing.contains("email")
    }

    /// Names first when any of the three is missing — they are one save, the email is a
    /// round trip — otherwise straight to the email.
    public static func firstStep(missing: [String]) -> Step {
        needsNames(missing) ? .names : .email
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

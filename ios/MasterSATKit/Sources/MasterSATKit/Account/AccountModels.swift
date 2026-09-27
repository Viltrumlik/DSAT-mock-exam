import Foundation

/// The student's own account as the settings screens read it, from `GET /api/users/me/`.
///
/// Wider than `CurrentUser` on purpose. That one is the lean identity the whole app is built
/// from, and it is cached on the phone for an offline launch; this one carries what only the
/// account screens need: the phone number, Telegram, when the password last changed. Both
/// decode the same payload, so a save made here and a later `/users/me/` refresh always agree.
///
/// Strings the web coerces to `""` are coerced here too, so a form can be seeded from the
/// profile without a nil check per field.
public struct AccountProfile: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    /// `nil` when the account has no address: a Telegram sign-up, or an address released to
    /// someone who proved they read it. The server no longer invents placeholders.
    public let email: String?
    public let username: String
    public let firstName: String
    public let lastName: String
    public let phoneNumber: String
    public let isFrozen: Bool
    public let telegramLinked: Bool
    public let profileImageURL: String?
    public let role: String
    public let emailVerified: Bool
    public let emailVerifiedAt: String?
    public let lastPasswordChange: String?
    public let profileComplete: Bool?
    public let missingFields: [String]?

    /// The address to show a person, or `""` when there is none. The web's `displayEmail`.
    public var realEmail: String {
        (email ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var hasEmail: Bool { !realEmail.isEmpty }

    /// Present and proved: the only state the site calls "Confirmed".
    public var emailIsConfirmed: Bool { hasEmail && emailVerified }

    public var hasPhoto: Bool {
        !(profileImageURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// "First Last", else the username — the web's hero name.
    public var displayName: String {
        let full = "\(firstName) \(lastName)".trimmingCharacters(in: .whitespacesAndNewlines)
        return full.isEmpty ? username : full
    }

    public init(
        id: Int,
        email: String? = nil,
        username: String = "",
        firstName: String = "",
        lastName: String = "",
        phoneNumber: String = "",
        isFrozen: Bool = false,
        telegramLinked: Bool = false,
        profileImageURL: String? = nil,
        role: String = "student",
        emailVerified: Bool = false,
        emailVerifiedAt: String? = nil,
        lastPasswordChange: String? = nil,
        profileComplete: Bool? = nil,
        missingFields: [String]? = nil
    ) {
        self.id = id
        self.email = email
        self.username = username
        self.firstName = firstName
        self.lastName = lastName
        self.phoneNumber = phoneNumber
        self.isFrozen = isFrozen
        self.telegramLinked = telegramLinked
        self.profileImageURL = profileImageURL
        self.role = role
        self.emailVerified = emailVerified
        self.emailVerifiedAt = emailVerifiedAt
        self.lastPasswordChange = lastPasswordChange
        self.profileComplete = profileComplete
        self.missingFields = missingFields
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, username, role
        case firstName = "first_name"
        case lastName = "last_name"
        case phoneNumber = "phone_number"
        case isFrozen = "is_frozen"
        case telegramLinked = "telegram_linked"
        case profileImageURL = "profile_image_url"
        case emailVerified = "email_verified"
        case emailVerifiedAt = "email_verified_at"
        case lastPasswordChange = "last_password_change"
        case profileComplete = "profile_complete"
        case missingFields = "missing_fields"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        let rawEmail = (try? c.decodeIfPresent(String.self, forKey: .email)) ?? nil
        email = rawEmail.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        username = ((try? c.decodeIfPresent(String.self, forKey: .username)) ?? nil) ?? ""
        firstName = ((try? c.decodeIfPresent(String.self, forKey: .firstName)) ?? nil) ?? ""
        lastName = ((try? c.decodeIfPresent(String.self, forKey: .lastName)) ?? nil) ?? ""
        phoneNumber = ((try? c.decodeIfPresent(String.self, forKey: .phoneNumber)) ?? nil) ?? ""
        isFrozen = ((try? c.decodeIfPresent(Bool.self, forKey: .isFrozen)) ?? nil) ?? false
        telegramLinked = ((try? c.decodeIfPresent(Bool.self, forKey: .telegramLinked)) ?? nil) ?? false
        let photo = (try? c.decodeIfPresent(String.self, forKey: .profileImageURL)) ?? nil
        profileImageURL = photo.flatMap { $0.isEmpty ? nil : $0 }
        role = ((try? c.decodeIfPresent(String.self, forKey: .role)) ?? nil) ?? ""
        emailVerified = ((try? c.decodeIfPresent(Bool.self, forKey: .emailVerified)) ?? nil) ?? false
        emailVerifiedAt = (try? c.decodeIfPresent(String.self, forKey: .emailVerifiedAt)) ?? nil
        lastPasswordChange = (try? c.decodeIfPresent(String.self, forKey: .lastPasswordChange)) ?? nil
        profileComplete = (try? c.decodeIfPresent(Bool.self, forKey: .profileComplete)) ?? nil
        missingFields = (try? c.decodeIfPresent([String].self, forKey: .missingFields)) ?? nil
    }
}

/// One device signed in to the account: a live refresh-token session, from
/// `GET /api/auth/sessions/`.
///
/// A session rotates on every renewal (the old row is revoked, a new one written), so
/// `createdAt` is when this device last renewed its sign-in and `lastSeenAt` is the same
/// moment to the microsecond — the row is written once and never touched again. "Active 3
/// hours ago" therefore means "renewed 3 hours ago", which is also what the web shows.
public struct DeviceSession: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let createdAt: String?
    public let lastSeenAt: String?
    public let ip: String
    public let userAgent: String
    /// The server's own "this device". It is worked out from the web's refresh COOKIE, so for
    /// the app it is false on every row, its own included — see `DeviceSessionRules.thisDevice`.
    public let isCurrent: Bool

    public init(
        id: Int,
        createdAt: String? = nil,
        lastSeenAt: String? = nil,
        ip: String = "",
        userAgent: String = "",
        isCurrent: Bool = false
    ) {
        self.id = id
        self.createdAt = createdAt
        self.lastSeenAt = lastSeenAt
        self.ip = ip
        self.userAgent = userAgent
        self.isCurrent = isCurrent
    }

    private enum CodingKeys: String, CodingKey {
        case id, ip
        case createdAt = "created_at"
        case lastSeenAt = "last_seen_at"
        case userAgent = "user_agent"
        case isCurrent = "is_current"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil
        lastSeenAt = (try? c.decodeIfPresent(String.self, forKey: .lastSeenAt)) ?? nil
        ip = ((try? c.decodeIfPresent(String.self, forKey: .ip)) ?? nil) ?? ""
        userAgent = ((try? c.decodeIfPresent(String.self, forKey: .userAgent)) ?? nil) ?? ""
        isCurrent = ((try? c.decodeIfPresent(Bool.self, forKey: .isCurrent)) ?? nil) ?? false
    }
}

/// What `POST /api/auth/password/change/` reports.
public struct PasswordChangeResult: Decodable, Sendable, Equatable {
    /// Sessions the change revoked. For the app this INCLUDES the phone itself: the server
    /// spares only the session it can identify by the web's refresh cookie, and the app has
    /// none — so the phone is signed out along with everything else.
    public let signedOutSessions: Int
    public let lastPasswordChange: String?

    private enum CodingKeys: String, CodingKey {
        case signedOutSessions = "signed_out_sessions"
        case lastPasswordChange = "last_password_change"
    }

    public init(signedOutSessions: Int, lastPasswordChange: String?) {
        self.signedOutSessions = signedOutSessions
        self.lastPasswordChange = lastPasswordChange
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        signedOutSessions = ((try? c.decodeIfPresent(Int.self, forKey: .signedOutSessions)) ?? nil) ?? 0
        lastPasswordChange = (try? c.decodeIfPresent(String.self, forKey: .lastPasswordChange)) ?? nil
    }
}

/// What `POST /api/auth/sessions/revoke_all/` reports.
public struct RevokeAllResult: Decodable, Sendable, Equatable {
    public let revoked: Int
    /// Always false for the app, which has no refresh cookie for the server to spare.
    public let keptCurrent: Bool

    private enum CodingKeys: String, CodingKey {
        case revoked
        case keptCurrent = "kept_current"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revoked = ((try? c.decodeIfPresent(Int.self, forKey: .revoked)) ?? nil) ?? 0
        keptCurrent = ((try? c.decodeIfPresent(Bool.self, forKey: .keptCurrent)) ?? nil) ?? false
    }
}

/// `202` from `POST /api/auth/email/request-code/`. The same answer whether or not the address
/// can receive mail — telling the two apart would make the endpoint a mailbox oracle.
public struct EmailCodeSent: Decodable, Sendable, Equatable {
    public let expiresInMinutes: Int

    private enum CodingKeys: String, CodingKey {
        case expiresInMinutes = "expires_in_minutes"
    }

    public init(expiresInMinutes: Int = EmailCodeEntry.defaultLifetimeMinutes) {
        self.expiresInMinutes = expiresInMinutes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let minutes = ((try? c.decodeIfPresent(Int.self, forKey: .expiresInMinutes)) ?? nil) ?? 0
        expiresInMinutes = minutes > 0 ? minutes : EmailCodeEntry.defaultLifetimeMinutes
    }
}

/// `200` from `POST /api/auth/email/confirm-code/`: the address is now the account's, confirmed.
public struct EmailConfirmation: Decodable, Sendable, Equatable {
    /// Normalised (lower-cased) by the server — what the account now holds.
    public let email: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        email = ((try? c.decodeIfPresent(String.self, forKey: .email)) ?? nil) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case email }
}

/// `GET /api/users/telegram/config/` — whether the site offers Telegram sign-in at all.
public struct TelegramSignInConfig: Decodable, Sendable, Equatable {
    public let enabled: Bool
    /// Set only when the server-mediated link flow is configured. The web connects an
    /// account by sending the browser here; without it the site shows no Connect button.
    public let startURL: String?

    /// The web offers "Connect Telegram" exactly when both hold.
    public var canConnect: Bool { enabled && !(startURL ?? "").isEmpty }

    public init(enabled: Bool, startURL: String?) {
        self.enabled = enabled
        self.startURL = startURL
    }

    private enum CodingKeys: String, CodingKey {
        case enabled
        case startURL = "start_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = ((try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? nil) ?? false
        startURL = (try? c.decodeIfPresent(String.self, forKey: .startURL)) ?? nil
    }
}

/// A refusal from the email-code endpoints, typed by the server's `code`.
///
/// The screen branches on the reason, never on the English sentence — a copy edit on the
/// server must not become a bug here.
public struct EmailVerificationRefusal: Error, Sendable, Equatable {
    public enum Reason: Sendable, Equatable {
        /// The address cannot receive mail (400).
        case notDeliverable
        /// Another account already proved it reads this address (409).
        case takenVerified
        /// No live code for this address — never requested, or used up by five wrong guesses.
        case noClaim
        case expired
        /// Wrong code. The fifth one burns the claim, but the server still answers
        /// `bad_code` for it and `no_claim` for the next try — `burned` never reaches the wire.
        case badCode
        case burned
        /// Another account holds the address unconfirmed and it cannot be moved (409).
        case takenUnverified
        case other(String)

        public init(code: String) {
            switch code {
            case "not_deliverable": self = .notDeliverable
            case "taken_verified": self = .takenVerified
            case "no_claim": self = .noClaim
            case "expired": self = .expired
            case "bad_code": self = .badCode
            case "burned": self = .burned
            case "taken_unverified": self = .takenUnverified
            default: self = .other(code)
            }
        }
    }

    public let reason: Reason
    public let detail: String
    public let status: Int

    public init(reason: Reason, detail: String, status: Int) {
        self.reason = reason
        self.detail = detail
        self.status = status
    }

    init(_ refusal: APIRefusal) {
        self.init(reason: Reason(code: refusal.code), detail: refusal.detail, status: refusal.status)
    }
}

extension EmailVerificationRefusal: LocalizedError {
    /// The server's own sentence; its wording from `users/views.py` when it sent none.
    public var errorDescription: String? {
        if !detail.isEmpty { return detail }
        switch reason {
        case .notDeliverable: return "Enter a real email address."
        case .takenVerified:
            return "This email is already confirmed on another account. Sign in with it, or ask an administrator for help."
        case .noClaim: return "No pending request for that address. Request a new code."
        case .expired: return "That code has expired. Request a new one."
        case .badCode, .burned: return "That code is not correct."
        case .takenUnverified: return "This email belongs to another account. An administrator has to move it."
        case .other: return "Could not confirm that code."
        }
    }
}

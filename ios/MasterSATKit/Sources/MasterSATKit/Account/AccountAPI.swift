import Foundation

/// The student's own account: profile details, photo, password, email, and the devices
/// signed in to it.
///
/// Three things about these endpoints shape how the app must use them, all because the app
/// authenticates with a bearer token and never holds the web's refresh cookie:
///
/// - `sessions()` marks no row as this phone (`is_current` is cookie-based) —
///   `DeviceSessionRules.thisDevice` finds it from the token the app holds.
/// - `revokeAllSessions()` always signs this phone out too: "keep this one" is decided by the
///   cookie, so it cannot be honoured for the app. The caller must sign out locally after.
/// - `changePassword` revokes this phone's session along with every other one. Its access
///   token keeps working for up to three hours, then the renewal is refused — so the caller
///   ends the session itself, with words, instead of letting it expire mid-task.
public struct AccountAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    // MARK: Profile

    /// `GET /users/me/`. Frozen students may still read it.
    public func profile() async throws -> AccountProfile {
        try await client.send(.get("/users/me/"), as: AccountProfile.self)
    }

    /// `PATCH /users/me/` with the fields that changed. Refusals come back per field
    /// (`APIError.validation`), e.g. `{"username": ["user with this username already exists."]}`.
    @discardableResult
    public func updateDetails(_ changes: AccountDetailsChanges) async throws -> AccountProfile {
        try await client.send(try .patch("/users/me/", json: changes.body), as: AccountProfile.self)
    }

    /// `PATCH /users/me/` as multipart, with the photo under `profile_image`.
    ///
    /// Hand it bytes that are already a JPEG or PNG: the server stores what it is given,
    /// shrunk to 512 px, and a HEIC it cannot open is stored as-is and never draws.
    @discardableResult
    public func uploadPhoto(_ data: Data, fileExtension: String, mimeType: String) async throws -> AccountProfile {
        var form = MultipartForm()
        let stamp = Int(Date().timeIntervalSince1970)
        form.add(file: MultipartForm.File(
            field: "profile_image",
            filename: "profile-\(stamp).\(fileExtension)",
            mimeType: mimeType,
            data: data
        ))
        let endpoint = Endpoint(
            path: "/users/me/",
            method: .patch,
            body: form.encoded(),
            contentType: form.contentType
        )
        return try await client.send(endpoint, as: AccountProfile.self)
    }

    /// `PATCH /users/me/` with `{"clear_profile_image": true}`.
    @discardableResult
    public func removePhoto() async throws -> AccountProfile {
        try await client.send(try .patch("/users/me/", json: ["clear_profile_image": JSONValue.bool(true)]), as: AccountProfile.self)
    }

    // MARK: Password

    /// `POST /auth/password/change/`. Throttled to 10 an hour per account (429).
    ///
    /// Signs this phone out along with every other device — see the type's notes.
    public func changePassword(current: String, new: String) async throws -> PasswordChangeResult {
        try await client.send(
            try .post("/auth/password/change/", json: PasswordChangeRequest(currentPassword: current, newPassword: new)),
            as: PasswordChangeResult.self
        )
    }

    // MARK: Devices

    /// `GET /auth/sessions/` — live sessions only, at most 50, most recently seen first.
    public func sessions() async throws -> [DeviceSession] {
        try await client.send(.get("/auth/sessions/"), as: SessionsEnvelope.self).sessions
    }

    /// `POST /auth/sessions/{id}/revoke/`. A session that is already gone answers 404
    /// ("Session not found."), which the caller can treat as done.
    public func revokeSession(id: Int) async throws {
        try await client.send(.post("/auth/sessions/\(id)/revoke/"))
    }

    /// `POST /auth/sessions/revoke_all/` with no `keep_current` — every session, this phone's
    /// included. Sending `keep_current` would change nothing for the app (the server spares
    /// only the session named by the web's cookie) and would read as a promise it cannot keep.
    @discardableResult
    public func revokeAllSessions() async throws -> RevokeAllResult {
        try await client.send(.post("/auth/sessions/revoke_all/"), as: RevokeAllResult.self)
    }

    /// The refresh token this phone holds right now — only to find its own row in `sessions()`.
    public func heldRefreshToken() async -> String? {
        await client.currentTokens()?.refresh
    }

    // MARK: Email

    /// `POST /auth/email/request-code/` — mail a six-digit code to `email`.
    ///
    /// - Throws: `EmailVerificationRefusal` (`notDeliverable`, `takenVerified`);
    ///   `APIError.http(429)` past 5 an hour per address or 10 per account.
    public func requestEmailCode(_ email: String) async throws -> EmailCodeSent {
        do {
            return try await client.sendCoded(
                try .post("/auth/email/request-code/", json: ["email": email]),
                as: EmailCodeSent.self
            )
        } catch let refusal as APIRefusal {
            throw EmailVerificationRefusal(refusal)
        }
    }

    /// `POST /auth/email/confirm-code/` — prove the address; it becomes the account's, confirmed.
    ///
    /// - Throws: `EmailVerificationRefusal` (`noClaim`, `expired`, `badCode`, `takenUnverified`);
    ///   `APIError.http(429)` past 20 an hour.
    public func confirmEmailCode(email: String, code: String) async throws -> EmailConfirmation {
        do {
            return try await client.sendCoded(
                try .post("/auth/email/confirm-code/", json: ["email": email, "code": code]),
                as: EmailConfirmation.self
            )
        } catch let refusal as APIRefusal {
            throw EmailVerificationRefusal(refusal)
        }
    }

    // MARK: Telegram

    /// `GET /users/telegram/config/` — public, so it never refreshes or ends a session.
    public func telegramConfig() async throws -> TelegramSignInConfig {
        try await client.send(
            Endpoint(path: "/users/telegram/config/", isUnauthenticated: true),
            as: TelegramSignInConfig.self
        )
    }

    // MARK: Wire shapes

    private struct PasswordChangeRequest: Encodable, Sendable {
        let currentPassword: String
        let newPassword: String

        enum CodingKeys: String, CodingKey {
            case currentPassword = "current_password"
            case newPassword = "new_password"
        }
    }

    private struct SessionsEnvelope: Decodable, Sendable {
        let sessions: [DeviceSession]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            sessions = (try? c.decodeIfPresent(CommunityLossyList<DeviceSession>.self, forKey: .sessions))?
                .elements ?? []
        }

        enum CodingKeys: String, CodingKey { case sessions }
    }
}

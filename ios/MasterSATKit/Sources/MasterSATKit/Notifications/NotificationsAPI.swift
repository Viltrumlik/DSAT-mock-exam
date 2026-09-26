import Foundation

/// The bell, its switches, and this phone's push registration.
///
/// Everything here is scoped to the signed-in student by the server — there is no endpoint
/// that takes a recipient — so the app cannot read or change anybody else's inbox by
/// construction.
public struct NotificationsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    // MARK: - The inbox

    /// The newest 50, optionally narrowed to one section and/or to what is unread.
    ///
    /// `unreadTotal` in the answer is always across every section, even when `category` is
    /// set — it is the bell's number, not the section's.
    public func list(category: String? = nil, unreadOnly: Bool = false) async throws -> NotificationInbox {
        var query: [URLQueryItem] = []
        if let category, !category.isEmpty {
            query.append(URLQueryItem(name: "category", value: category.uppercased()))
        }
        if unreadOnly {
            query.append(URLQueryItem(name: "unread", value: "1"))
        }
        return try await client.send(.get("/notifications/", query: query), as: NotificationInbox.self)
    }

    /// Just the counts. What the bell polls, so it never fetches a list to draw a number.
    public func summary() async throws -> NotificationSummary {
        try await client.send(.get("/notifications/summary/"), as: NotificationSummary.self)
    }

    /// Mark particular rows read.
    ///
    /// **An empty list sends nothing.** The server reads a missing or empty `ids` as "mark
    /// EVERYTHING read" (`services.mark_read` tests `if ids:`), so passing `[]` through would
    /// silently clear the student's whole inbox. That case answers locally with zero moved.
    public func markRead(ids: [Int]) async throws -> MarkReadResult? {
        let unique = Array(Set(ids)).sorted()
        guard !unique.isEmpty else { return nil }
        return try await client.send(
            try .post("/notifications/read/", json: MarkReadBody(ids: unique, category: nil)),
            as: MarkReadResult.self
        )
    }

    /// Mark one section read — "Mark this section as read".
    public func markRead(category: String) async throws -> MarkReadResult {
        try await client.send(
            try .post("/notifications/read/", json: MarkReadBody(ids: nil, category: category.uppercased())),
            as: MarkReadResult.self
        )
    }

    /// Mark everything read — "Mark all as read". The body is `{}`, which is how the server
    /// spells "all".
    public func markAllRead() async throws -> MarkReadResult {
        try await client.send(.post("/notifications/read/"), as: MarkReadResult.self)
    }

    // MARK: - Preferences

    public func preferences() async throws -> NotificationPreferences {
        try await client.send(.get("/notifications/preferences/"), as: NotificationPreferences.self)
    }

    /// Save one change. The answer is the whole new state, in the same shape as the GET, so
    /// the caller writes it straight back instead of fetching again to learn what it was told.
    public func updatePreferences(_ patch: NotificationPreferencesPatch) async throws -> NotificationPreferences {
        try await client.send(
            try .patch("/notifications/preferences/", json: patch),
            as: NotificationPreferences.self
        )
    }

    // MARK: - Push

    /// Whether the server can push at all — per transport.
    public func pushConfig() async throws -> PushConfig {
        try await client.send(.get("/notifications/push/config/"), as: PushConfig.self)
    }

    /// Tell the server which phone to buzz for the signed-in student.
    ///
    /// Upserted on the token server-side: re-registering moves the row to whoever is signed in
    /// now, so a phone handed to a sibling stops buzzing for the first student. Answers 201
    /// for a new row and 200 for a refreshed one; both mean the same thing here.
    @discardableResult
    public func registerAPNs(
        token: String,
        environment: APNsEnvironment,
        bundleId: String,
        appVersion: String
    ) async throws -> Int? {
        let body = ApnsRegisterBody(
            token: token.lowercased(),
            environment: environment.rawValue,
            bundleId: bundleId,
            appVersion: appVersion
        )
        return try await client.send(
            try .post("/notifications/push/apns/register/", json: body),
            as: ApnsRegisterAnswer.self
        ).id
    }

    /// Stop buzzing this phone for the signed-in student. Sent on sign-out, BEFORE the tokens
    /// are cleared — afterwards the request cannot be authenticated. Returns how many rows
    /// the server deleted (0 when it never knew the token).
    @discardableResult
    public func unregisterAPNs(token: String) async throws -> Int {
        try await client.send(
            try .post("/notifications/push/apns/unregister/", json: ApnsUnregisterBody(token: token.lowercased())),
            as: ApnsUnregisterAnswer.self
        ).deleted
    }
}

// MARK: - Wire bodies

private struct MarkReadBody: Encodable, Sendable {
    let ids: [Int]?
    let category: String?

    enum CodingKeys: String, CodingKey { case ids, category }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(ids, forKey: .ids)
        try c.encodeIfPresent(category, forKey: .category)
    }
}

private struct ApnsRegisterBody: Encodable, Sendable {
    let token: String
    let environment: String
    let bundleId: String
    let appVersion: String

    enum CodingKeys: String, CodingKey {
        case token, environment
        case bundleId = "bundle_id"
        case appVersion = "app_version"
    }
}

private struct ApnsUnregisterBody: Encodable, Sendable {
    let token: String
}

private struct ApnsRegisterAnswer: Decodable, Sendable {
    let id: Int?

    enum CodingKeys: String, CodingKey { case id }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(Int.self, forKey: .id)) ?? nil
    }
}

private struct ApnsUnregisterAnswer: Decodable, Sendable {
    let deleted: Int

    enum CodingKeys: String, CodingKey { case deleted }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deleted = ((try? c.decodeIfPresent(Int.self, forKey: .deleted)) ?? nil) ?? 0
    }
}

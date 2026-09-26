import Foundation

/// Where the site thinks this student stands with the class Telegram group, from
/// `GET /api/classes/<id>/telegram/` (and, with `already_member`, from `POST …/join/`).
///
/// The rules come from the server rather than being written into the app, because the bot
/// enforces them and the two must not be able to drift.
public struct TelegramGroupState: Decodable, Sendable, Equatable {
    /// True when the class group is under the bot's control. False means the old world: a
    /// static invite link in `groupURL`, or nothing at all.
    public let managed: Bool
    public let groupURL: String
    /// True once the BOT has met this student — they pressed Start on their own `/start`
    /// link. Signing in with Telegram does not count: that is a different number.
    public let telegramLinked: Bool
    /// NONE · PENDING · JOINED · LEFT · REMOVED
    public let status: String
    public let removedReason: String
    public let eligible: Bool
    public let reason: String
    /// Why they are not eligible, in words meant for the student. Empty when eligible.
    public let message: String
    /// Empty unless a link has been minted and has not expired.
    public let inviteLink: String
    public let inviteExpiresAt: String?
    public let rules: [String]
    public let inviteTTLMinutes: Int
    /// Only on the join response: they were already in the group, so nothing was minted.
    public let alreadyMember: Bool?

    public var isJoined: Bool { status.uppercased() == "JOINED" }

    /// The one step the dialog shows. The branches are exclusive on the web and stay so here.
    public enum Step: Equatable, Sendable {
        /// Not allowed in the group (frozen, or no longer in the class): say why, offer nothing.
        case notEligible(message: String)
        /// Not allowed, and the server gave no sentence — show the rules alone.
        case nothing
        /// Step 1: meet the bot, so it knows which Telegram account is theirs.
        case openBot
        /// A live single-use invite is on screen.
        case inviteReady(link: String)
        /// Connected, no live invite: offer to cut one ("Get my invite link" / "Get a new link").
        case getLink
    }

    public var step: Step {
        if !eligible {
            let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? .nothing : .notEligible(message: text)
        }
        if !telegramLinked { return .openBot }
        if !inviteLink.isEmpty { return .inviteReady(link: inviteLink) }
        return .getLink
    }

    private enum CodingKeys: String, CodingKey {
        case managed, status, eligible, reason, message, rules
        case groupURL = "group_url"
        case telegramLinked = "telegram_linked"
        case removedReason = "removed_reason"
        case inviteLink = "invite_link"
        case inviteExpiresAt = "invite_expires_at"
        case inviteTTLMinutes = "invite_ttl_minutes"
        case alreadyMember = "already_member"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        managed = (try? c.decodeIfPresent(Bool.self, forKey: .managed)) as? Bool ?? false
        groupURL = ((try? c.decodeIfPresent(String.self, forKey: .groupURL)) as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        telegramLinked = (try? c.decodeIfPresent(Bool.self, forKey: .telegramLinked)) as? Bool ?? false
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) as? String ?? "NONE"
        removedReason = (try? c.decodeIfPresent(String.self, forKey: .removedReason)) as? String ?? ""
        eligible = (try? c.decodeIfPresent(Bool.self, forKey: .eligible)) as? Bool ?? false
        reason = (try? c.decodeIfPresent(String.self, forKey: .reason)) as? String ?? ""
        message = (try? c.decodeIfPresent(String.self, forKey: .message)) as? String ?? ""
        inviteLink = ((try? c.decodeIfPresent(String.self, forKey: .inviteLink)) as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        inviteExpiresAt = try? c.decodeIfPresent(String.self, forKey: .inviteExpiresAt)
        rules = (try? c.decodeIfPresent([String].self, forKey: .rules)) as? [String] ?? []
        inviteTTLMinutes = (try? c.decodeIfPresent(Int.self, forKey: .inviteTTLMinutes)) as? Int ?? 30
        alreadyMember = try? c.decodeIfPresent(Bool.self, forKey: .alreadyMember)
    }
}

/// What the class header offers for Telegram.
public enum TelegramGroupButton: Equatable, Sendable {
    /// A bot-managed group: the button opens the join sheet. "Telegram group" once joined,
    /// "Join Telegram group" before.
    case join(isJoined: Bool)
    /// A class with only the old static link: a plain link, exactly as before.
    case link(String)
    /// Neither: no button at all.
    case none

    /// A failed state lookup lands in the link branch, which is the right way to fail — the
    /// static link still works, and the sheet explains itself if they get that far.
    public static func resolve(state: TelegramGroupState?, classroomGroupURL: String?) -> TelegramGroupButton {
        if let state, state.managed { return .join(isJoined: state.isJoined) }
        let link = (classroomGroupURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = link.isEmpty ? (state?.groupURL ?? "") : link
        return fallback.isEmpty ? .none : .link(fallback)
    }

    public var title: String? {
        switch self {
        case .join(let joined): return joined ? "Telegram group" : "Join Telegram group"
        case .link: return "Join Telegram group"
        case .none: return nil
        }
    }
}

/// The class Telegram group: the state, the bot link, and the invite.
///
/// Both POSTs mint a live, single-use credential and spend any earlier one, and they share
/// a 10-an-hour throttle — so callers mint once per sheet opening and never retry on
/// their own.
public struct ClassroomTelegramAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func state(classroomId: Int) async throws -> TelegramGroupState {
        try await client.send(.get("/classes/\(classroomId)/telegram/"), as: TelegramGroupState.self)
    }

    /// A single-use `https://t.me/<bot>?start=<token>` that introduces this student to the
    /// bot. Valid for an hour; minting one cancels the last.
    public func botLink(classroomId: Int) async throws -> String {
        let reply = try await client.send(.post("/classes/\(classroomId)/telegram/bot-link/"), as: BotLinkReply.self)
        guard let link = reply.botLink, !link.isEmpty else {
            throw APIError.decoding(context: "/classes/\(classroomId)/telegram/bot-link/", underlying: "no bot_link")
        }
        return link
    }

    /// Cut this student's single-use invite. The reply IS the new state (plus
    /// `already_member`), so the caller shows it rather than reloading.
    public func join(classroomId: Int) async throws -> TelegramGroupState {
        try await client.send(.post("/classes/\(classroomId)/telegram/join/"), as: TelegramGroupState.self)
    }
}

private struct BotLinkReply: Decodable, Sendable {
    let botLink: String?

    private enum CodingKeys: String, CodingKey { case botLink = "bot_link" }
}

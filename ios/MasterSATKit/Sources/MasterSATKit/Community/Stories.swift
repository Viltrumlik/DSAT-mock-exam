import Foundation

/// One notice on the dashboard's story rail. School-wide: every signed-in student sees the
/// same rail, and nothing records who has watched what.
public struct Story: Decodable, Identifiable, Sendable, Equatable, Hashable {
    public let id: Int
    /// The word or two under the circle (≤ 80 characters).
    public let title: String
    /// Read once the story is open, under the picture.
    public let caption: String
    /// Signed and expiring (~1h) — reload the rail rather than keep one for long. Nil when
    /// the story was saved without a picture, which the Django admin allows.
    public let imageURL: String?
    /// "" or an absolute URL.
    public let linkURL: String
    public let sortOrder: Int
    public let startsAt: String?
    public let endsAt: String?
    public let createdAt: String?

    /// The place on THIS SITE the story's link means — everything the router can act on. A
    /// notice that points at `/events` belongs on the Events screen, signed in, inside the
    /// app; a notice that points at `/blog/2026/mock-day`, which the app has no screen for,
    /// stays `.unknown` carrying its site path, and the router's `.web` branch hands that to
    /// the browser (`AppLink.webURL(base:)`). Either way the viewer closes, the way following
    /// a same-site link on the website leaves the story open.
    ///
    /// Nil for no link at all and for anywhere that is not this site — including a
    /// protocol-relative `//evil.com/x`, which `AppLink.path` keeps as written so that
    /// `webURL(base:)` refuses it. Those go to `openableLink`, or nowhere.
    public var routedLink: AppLink? {
        let trimmed = linkURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let link = AppLink.parse(trimmed)
        if case .unknown(let location) = link {
            // A site path the app has no screen for is still the site's: keep it, and let the
            // router open it on the website. Anything `webURL(base:)` would refuse — an
            // off-site absolute, `mailto:`, `javascript:`, `//host/path` — is not ours.
            guard location.hasPrefix("/"), !location.hasPrefix("//") else { return nil }
        }
        return link
    }

    /// Where "Open" goes when `routedLink` is nil — the system browser, where the student's
    /// web session lives. Web pages only: a story is a notice, not a launcher for other apps.
    public var openableLink: URL? {
        let trimmed = linkURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    public init(
        id: Int, title: String, caption: String = "", imageURL: String? = nil,
        linkURL: String = "", sortOrder: Int = 0, startsAt: String? = nil,
        endsAt: String? = nil, createdAt: String? = nil
    ) {
        self.id = id
        self.title = title
        self.caption = caption
        self.imageURL = imageURL
        self.linkURL = linkURL
        self.sortOrder = sortOrder
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, caption
        case imageURL = "image_url"
        case linkURL = "link_url"
        case sortOrder = "sort_order"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        caption = (try? c.decodeIfPresent(String.self, forKey: .caption)) ?? ""
        imageURL = (try? c.decodeIfPresent(String.self, forKey: .imageURL)).flatMap {
            $0.isEmpty ? nil : $0
        }
        linkURL = (try? c.decodeIfPresent(String.self, forKey: .linkURL)) ?? ""
        sortOrder = (try? c.decodeIfPresent(Int.self, forKey: .sortOrder)) ?? 0
        startsAt = (try? c.decodeIfPresent(String.self, forKey: .startsAt)) ?? nil
        endsAt = (try? c.decodeIfPresent(String.self, forKey: .endsAt)) ?? nil
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil
    }
}

/// `/api/stories/` — the rail. Open to any signed-in user.
public struct StoriesAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Only what is live right now, already in rail order (`sort_order`, then newest), at
    /// most 30. Not re-sorted or re-filtered here: the server's order is the rail's order.
    public func rail() async throws -> [Story] {
        try await client.send(.get("/stories/"), as: Envelope.self).stories
    }

    private struct Envelope: Decodable, Sendable {
        let stories: [Story]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // A payload with no readable `stories` throws rather than reading as an empty
            // rail: "the school has posted nothing" and "we could not read the answer" are
            // different statements, and the rail says the second one out loud. The list
            // itself stays lossy, so one malformed story never costs the whole rail. A null
            // `stories` is unreadable too, not an empty rail: the endpoint always sends a
            // list, so a null is the server saying something went wrong, and the rail says
            // so rather than claiming the school has posted nothing.
            stories = try c.decode(CommunityLossyList<Story>.self, forKey: .stories).elements
        }

        enum CodingKeys: String, CodingKey { case stories }
    }
}

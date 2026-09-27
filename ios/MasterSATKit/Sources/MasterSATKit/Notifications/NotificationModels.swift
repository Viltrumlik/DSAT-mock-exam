import Foundation

// The in-app inbox — the web's bell — and the student's switches for it.
//
// Contract: `backend/notifications/views.py` + `serializers.py`. Every shape here is decoded
// defensively: the bell is on the first screen a student sees, and a field the server renames
// must cost one detail on one row, never the whole inbox.

/// One thing a student is told.
///
/// `category` is a plain string rather than a closed enum on purpose: the server serves the
/// list of sections (`categories`) so that a section added to the platform appears without an
/// app release. A closed enum would turn that new section into a decoding failure.
public struct AppNotification: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    /// `GRADES`, `HOMEWORK`, … Upper-cased on the way in (the server's own spelling).
    public let category: String
    /// The server's name for the section — "Rewards & Shop", not a client-side guess.
    public let categoryLabel: String
    /// Machine-readable: `HOMEWORK_GRADED`, `MIDTERM_RESULT`, …
    public let event: String
    public let title: String
    public let body: String
    /// Where tapping it goes: a relative web path, or `""` for "nothing to open". See
    /// `link`, which is how the app reads it.
    public let linkURL: String
    public private(set) var isRead: Bool
    public private(set) var readAt: String?
    /// Kept as the server's string, like every other timestamp in this kit. A repeat of the
    /// same fact within the hour *bumps* this (and makes the row unread again), so a row can
    /// move back to the top of the list with new text.
    public let createdAt: String

    public var createdDate: Date? { JSONCoding.parseServerDate(createdAt) }

    /// Where the row leads, or nil when it leads nowhere (the web just marks such a row read).
    public var link: AppLink? {
        let trimmed = linkURL.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : AppLink.parse(trimmed)
    }

    /// The same row, read. For an optimistic update while the POST is on the wire.
    public func markedRead(at timestamp: String) -> AppNotification {
        var copy = self
        copy.isRead = true
        copy.readAt = copy.readAt ?? timestamp
        return copy
    }

    public init(
        id: Int,
        category: String,
        categoryLabel: String,
        event: String,
        title: String,
        body: String = "",
        linkURL: String = "",
        isRead: Bool = false,
        readAt: String? = nil,
        createdAt: String
    ) {
        self.id = id
        self.category = category.uppercased()
        self.categoryLabel = categoryLabel
        self.event = event
        self.title = title
        self.body = body
        self.linkURL = linkURL
        self.isRead = isRead
        self.readAt = readAt
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, category, event, title, body
        case categoryLabel = "category_label"
        case linkURL = "link_url"
        case isRead = "is_read"
        case readAt = "read_at"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        // A notification the server could not categorise lands in SYSTEM there too
        // (`constants.category_for`), so that is the honest default here.
        let rawCategory = ((try? c.decodeIfPresent(String.self, forKey: .category)) ?? nil) ?? ""
        category = rawCategory.isEmpty ? "SYSTEM" : rawCategory.uppercased()
        let label = ((try? c.decodeIfPresent(String.self, forKey: .categoryLabel)) ?? nil) ?? ""
        categoryLabel = label.isEmpty ? NotificationCategoryOption.fallbackLabel(for: category) : label
        event = ((try? c.decodeIfPresent(String.self, forKey: .event)) ?? nil) ?? ""
        title = ((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? ""
        body = ((try? c.decodeIfPresent(String.self, forKey: .body)) ?? nil) ?? ""
        linkURL = ((try? c.decodeIfPresent(String.self, forKey: .linkURL)) ?? nil) ?? ""
        readAt = (try? c.decodeIfPresent(String.self, forKey: .readAt)) ?? nil
        // `is_read` is derived from `read_at` on the server; if it ever goes missing, derive it
        // the same way rather than showing every row as new.
        isRead = ((try? c.decodeIfPresent(Bool.self, forKey: .isRead)) ?? nil) ?? (readAt != nil)
        createdAt = ((try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil) ?? ""
    }
}

/// One inbox section, as the server names and orders it.
public struct NotificationCategoryOption: Decodable, Sendable, Equatable, Hashable, Identifiable {
    /// `GRADES`, … — what `?category=` and `muted_categories` take.
    public let value: String
    public let label: String

    public var id: String { value }

    public init(value: String, label: String) {
        self.value = value.uppercased()
        self.label = label
    }

    enum CodingKeys: String, CodingKey { case value, label }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The value is the identity: a section with no value cannot be filtered or muted, so
        // it is dropped (by the lossy list around it) rather than invented.
        let raw = try c.decode(String.self, forKey: .value)
        guard !raw.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .value, in: c, debugDescription: "empty category")
        }
        value = raw.uppercased()
        let given = ((try? c.decodeIfPresent(String.self, forKey: .label)) ?? nil) ?? ""
        label = given.isEmpty ? Self.fallbackLabel(for: value) : given
    }

    /// `REWARDS` → `Rewards`. Only used when the server sent no label at all.
    static func fallbackLabel(for value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}

/// `GET /notifications/` — the list, and the counts that go with it.
public struct NotificationInbox: Decodable, Sendable, Equatable {
    /// At most 50, newest first. No paging: the bell is recent history, not an archive.
    public var notifications: [AppNotification]
    /// Across ALL sections, even when the list was fetched with `?category=`.
    public var unreadTotal: Int
    /// Only sections with something unread appear here; a missing key means zero.
    public var unreadByCategory: [String: Int]
    /// The sections, in the server's order.
    public var categories: [NotificationCategoryOption]

    public init(
        notifications: [AppNotification],
        unreadTotal: Int,
        unreadByCategory: [String: Int],
        categories: [NotificationCategoryOption]
    ) {
        self.notifications = notifications
        self.unreadTotal = unreadTotal
        self.unreadByCategory = unreadByCategory
        self.categories = categories
    }

    /// Unread in one section, or across all of them when `category` is nil.
    public func unread(in category: String?) -> Int {
        guard let category else { return unreadTotal }
        return unreadByCategory[category.uppercased()] ?? 0
    }

    /// The counts on their own — what the bell badge is built from.
    public var summary: NotificationSummary {
        NotificationSummary(total: unreadTotal, byCategory: unreadByCategory)
    }

    enum CodingKeys: String, CodingKey {
        case notifications, categories
        case unreadTotal = "unread_total"
        case unreadByCategory = "unread_by_category"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The list is the point of this response: if it is absent altogether the payload is
        // not an inbox, and saying "You're all caught up" over it would be a lie. So that one
        // key is required; one bad ROW inside it only costs that row.
        notifications = try c.decode(LossyList<AppNotification>.self, forKey: .notifications).elements
        unreadByCategory = CountMap.decode(c, forKey: .unreadByCategory)
        unreadTotal = ((try? c.decodeIfPresent(Int.self, forKey: .unreadTotal)) ?? nil)
            ?? unreadByCategory.values.reduce(0, +)
        categories = ((try? c.decodeIfPresent(LossyList<NotificationCategoryOption>.self, forKey: .categories)) ?? nil)?
            .elements ?? []
    }
}

/// `GET /notifications/summary/` — just the counts. What the bell polls for.
public struct NotificationSummary: Decodable, Sendable, Equatable {
    public let total: Int
    public let byCategory: [String: Int]

    public static let zero = NotificationSummary(total: 0, byCategory: [:])

    public init(total: Int, byCategory: [String: Int]) {
        self.total = max(0, total)
        self.byCategory = byCategory
    }

    enum CodingKeys: String, CodingKey {
        case total
        case byCategory = "by_category"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // `total` is the one number the badge shows. Without it this is not a summary, and a
        // badge of 0 drawn from nothing would hide real unread work — so it is required.
        let byCategory = CountMap.decode(c, forKey: .byCategory)
        self.init(total: try c.decode(Int.self, forKey: .total), byCategory: byCategory)
    }
}

/// `POST /notifications/read/` answers with how many moved and the new counts, so the bell
/// can be corrected without a second request.
public struct MarkReadResult: Decodable, Sendable, Equatable {
    public let marked: Int
    public let summary: NotificationSummary

    enum CodingKeys: String, CodingKey {
        case marked, total
        case byCategory = "by_category"
    }

    public init(marked: Int, summary: NotificationSummary) {
        self.marked = marked
        self.summary = summary
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        marked = ((try? c.decodeIfPresent(Int.self, forKey: .marked)) ?? nil) ?? 0
        summary = NotificationSummary(
            total: try c.decode(Int.self, forKey: .total),
            byCategory: CountMap.decode(c, forKey: .byCategory)
        )
    }
}

/// `GET/PATCH /notifications/preferences/` — which sections the student wants, and whether
/// their phone should buzz.
///
/// The server stores **exceptions only**: `mutedCategories` is what is switched OFF. A section
/// the platform adds later therefore arrives switched on for everybody, rather than silently
/// muted for every student who set their preferences before it existed.
public struct NotificationPreferences: Decodable, Sendable, Equatable {
    public var mutedCategories: [String]
    /// Separate from the sections: a student may want the bell but not their phone buzzing.
    /// Device-agnostic on the server — it gates Web Push and APNs alike.
    public var pushEnabled: Bool
    public var categories: [NotificationCategoryOption]

    public init(mutedCategories: [String], pushEnabled: Bool, categories: [NotificationCategoryOption]) {
        self.mutedCategories = mutedCategories.map { $0.uppercased() }
        self.pushEnabled = pushEnabled
        self.categories = categories
    }

    /// Whether a section is on — the inverse of muted, which is what a switch shows.
    public func isOn(_ category: String) -> Bool {
        !mutedCategories.contains(category.uppercased())
    }

    /// The muted list to send when a section's switch is turned to `on`.
    ///
    /// On removes it; off adds it once. Order is kept stable so the same change never produces
    /// two different requests.
    public func mutedList(setting category: String, on: Bool) -> [String] {
        let code = category.uppercased()
        if on { return mutedCategories.filter { $0 != code } }
        return mutedCategories.contains(code) ? mutedCategories : mutedCategories + [code]
    }

    enum CodingKeys: String, CodingKey {
        case categories
        case mutedCategories = "muted_categories"
        case pushEnabled = "push_enabled"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let muted = ((try? c.decodeIfPresent(LossyList<String>.self, forKey: .mutedCategories)) ?? nil)?.elements ?? []
        self.init(
            mutedCategories: muted,
            // The server's own default (`NotificationPreference.push_enabled = True`).
            pushEnabled: ((try? c.decodeIfPresent(Bool.self, forKey: .pushEnabled)) ?? nil) ?? true,
            categories: ((try? c.decodeIfPresent(LossyList<NotificationCategoryOption>.self, forKey: .categories)) ?? nil)?
                .elements ?? []
        )
    }
}

/// The writable half of the preferences. PATCH, not PUT: the server merges only the keys
/// present, so the push switch and the section switches save independently and neither one
/// can clobber the other with a stale value. A nil field is left out of the body entirely.
public struct NotificationPreferencesPatch: Encodable, Sendable, Equatable {
    public var mutedCategories: [String]?
    public var pushEnabled: Bool?

    public init(mutedCategories: [String]? = nil, pushEnabled: Bool? = nil) {
        self.mutedCategories = mutedCategories
        self.pushEnabled = pushEnabled
    }

    enum CodingKeys: String, CodingKey {
        case mutedCategories = "muted_categories"
        case pushEnabled = "push_enabled"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(mutedCategories, forKey: .mutedCategories)
        try c.encodeIfPresent(pushEnabled, forKey: .pushEnabled)
    }
}

/// `GET /notifications/push/config/` — whether each push transport is configured at all.
public struct PushConfig: Decodable, Sendable, Equatable {
    /// Web Push (VAPID keys set). The browser's transport, not the app's.
    public let webPushEnabled: Bool
    public let publicKey: String
    /// APNs — the app's transport. False on a server that predates it, which is the truth:
    /// such a server cannot reach a phone.
    public let apnsEnabled: Bool

    public init(webPushEnabled: Bool, publicKey: String = "", apnsEnabled: Bool) {
        self.webPushEnabled = webPushEnabled
        self.publicKey = publicKey
        self.apnsEnabled = apnsEnabled
    }

    enum CodingKeys: String, CodingKey {
        case enabled
        case publicKey = "public_key"
        case apnsEnabled = "apns_enabled"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        webPushEnabled = ((try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? nil) ?? false
        publicKey = ((try? c.decodeIfPresent(String.self, forKey: .publicKey)) ?? nil) ?? ""
        apnsEnabled = ((try? c.decodeIfPresent(Bool.self, forKey: .apnsEnabled)) ?? nil) ?? false
    }
}

/// Which APNs host a device token belongs to. A development build's token is refused by the
/// production host and vice versa, so the app says which one it is rather than the server
/// guessing.
public enum APNsEnvironment: String, Sendable, Codable, CaseIterable {
    case sandbox
    case production
}

// MARK: - Decoding helpers

/// Decodes an array element by element and drops the ones that fail, so one malformed row
/// costs that row and not the list around it.
struct LossyList<Element: Decodable>: Decodable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var out: [Element] = []
        while !container.isAtEnd {
            if let element = try? container.decode(Element.self) {
                out.append(element)
            } else {
                // A failed decode does not advance an unkeyed container. Skip the element
                // explicitly, or this loop would retry the same bad row forever.
                _ = try? container.decode(SkippedElement.self)
            }
        }
        elements = out
    }
}

/// Accepts any JSON value and keeps nothing — used to step over a bad array element.
private struct SkippedElement: Decodable {
    init(from decoder: Decoder) throws {}
}

/// `{"GRADES": 2, "HOMEWORK": 1}` → upper-cased keys, non-negative counts. A count that is not
/// a number (or a map that is not a map) reads as "nothing unread there" for that key only.
enum CountMap {
    static func decode<K: CodingKey>(_ c: KeyedDecodingContainer<K>, forKey key: K) -> [String: Int] {
        guard let raw = ((try? c.decodeIfPresent([String: LossyCount].self, forKey: key)) ?? nil) else { return [:] }
        var out: [String: Int] = [:]
        for (category, count) in raw {
            guard let value = count.value, value > 0 else { continue }
            out[category.uppercased(), default: 0] += value
        }
        return out
    }
}

/// One count in a count map, tolerant of the value's type.
struct LossyCount: Decodable {
    let value: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) {
            value = n
        } else if let d = try? c.decode(Double.self), d.isFinite {
            value = Int(d)
        } else if let s = try? c.decode(String.self) {
            value = Int(s)
        } else {
            value = nil
        }
    }
}

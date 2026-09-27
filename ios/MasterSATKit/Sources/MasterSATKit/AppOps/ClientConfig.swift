import Foundation

/// What the server says about this build of the app, from `GET /api/mobile/config/`.
///
/// The release policy lives on the server — set in the console, not compiled in — because
/// the one moment you most need to change it is after a build has already shipped: an API
/// change an old app would mangle data against, or a crash that only a new build fixes.
public struct ClientConfig: Decodable, Sendable, Equatable {
    /// The newest build in the store. Below it, the app may *suggest* updating.
    public let latestVersion: String?
    /// The oldest build still allowed to talk to the API. Below it, the app stops.
    public let minimumVersion: String?
    /// Where "Update" goes — the App Store page. Empty until the app is listed.
    public let updateURL: String?
    /// An optional sentence from the school to show with the prompt.
    public let message: String?
    /// The server's own verdict for the version this request declared. The client also
    /// works the answer out itself from the two versions above and takes the STRICTER of
    /// the two, so a header the server failed to parse cannot wave an old build through.
    public let update: String?

    public init(
        latestVersion: String? = nil,
        minimumVersion: String? = nil,
        updateURL: String? = nil,
        message: String? = nil,
        update: String? = nil
    ) {
        self.latestVersion = latestVersion
        self.minimumVersion = minimumVersion
        self.updateURL = updateURL
        self.message = message
        self.update = update
    }

    private enum CodingKeys: String, CodingKey {
        case message, update
        case latestVersion = "latest_version"
        case minimumVersion = "minimum_version"
        case updateURL = "update_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Every field is tolerated missing: this document gates the whole app, and a strict
        // decode that failed would have to be treated as "no policy" anyway.
        latestVersion = try? c.decodeIfPresent(String.self, forKey: .latestVersion)
        minimumVersion = try? c.decodeIfPresent(String.self, forKey: .minimumVersion)
        updateURL = try? c.decodeIfPresent(String.self, forKey: .updateURL)
        message = try? c.decodeIfPresent(String.self, forKey: .message)
        update = try? c.decodeIfPresent(String.self, forKey: .update)
    }

    /// The URL to open, if there is one worth opening.
    public var storeURL: URL? {
        guard let updateURL, !updateURL.isEmpty, let url = URL(string: updateURL),
              let scheme = url.scheme?.lowercased(), ["https", "itms-apps"].contains(scheme) else { return nil }
        return url
    }

    /// Where this build stands against the policy.
    public func requirement(for current: AppVersion?) -> UpdateRequirement {
        let local = Self.localRequirement(
            current: current,
            minimum: AppVersion(minimumVersion),
            latest: AppVersion(latestVersion)
        )
        let server = UpdateRequirement(serverValue: update)
        return max(local, server)
    }

    static func localRequirement(current: AppVersion?, minimum: AppVersion?, latest: AppVersion?) -> UpdateRequirement {
        // An unreadable own version fails OPEN. Blocking the app because a plist string was
        // odd would punish every student for a build mistake they cannot fix.
        guard let current else { return .none }
        if let minimum, current < minimum { return .required }
        if let latest, current < latest { return .available }
        return .none
    }
}

/// How urgently this build should be replaced. Ordered, so the stricter of two opinions wins.
public enum UpdateRequirement: Int, Comparable, Sendable {
    case none = 0
    /// A newer build exists. Say so once in a while; never block.
    case available = 1
    /// This build is below the minimum. Nothing else is usable until it is updated.
    case required = 2

    init(serverValue: String?) {
        switch serverValue?.lowercased() {
        case "required": self = .required
        case "available": self = .available
        default: self = .none
        }
    }

    public static func < (lhs: UpdateRequirement, rhs: UpdateRequirement) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// When to show the gentle "a new version is out" prompt again.
///
/// Once per new version, and then no more often than every few days: a prompt on every
/// launch trains a student to dismiss it without reading, which is exactly when the
/// required-update screen will need them to read.
public enum UpdateNudge {
    public static let interval: TimeInterval = 3 * 24 * 3600

    public static func shouldShow(
        latest: String?,
        lastShownVersion: String?,
        lastShownAt: Date?,
        now: Date = Date()
    ) -> Bool {
        guard let latest, !latest.isEmpty else { return false }
        guard lastShownVersion == latest, let lastShownAt else { return true }
        return now.timeIntervalSince(lastShownAt) >= interval
    }
}

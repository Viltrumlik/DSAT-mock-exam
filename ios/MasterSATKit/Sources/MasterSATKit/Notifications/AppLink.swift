import Foundation

/// A place in the app, read from a web path.
///
/// Notifications carry `link_url` — a path on the website, such as `/classes/12/assignments/34`
/// — because the server writes one notification for every client. The web follows the path;
/// the app has to know which of its own screens that path means. This is that mapping, kept
/// pure so every route the server produces can be tested without a device.
///
/// Accepted forms, all reduced to the same path first:
/// - relative: `/classes/12`, `classes/12`, with or without a trailing slash;
/// - the site's own absolute URLs: `https://mastersat.uz/classes/12`, `www.` included;
/// - the app's scheme: `mastersat://classes/12` (and `mastersat:///classes/12`).
///
/// Query strings and fragments are ignored. Route words match case-insensitively; identifiers
/// (a certificate code) keep their case. Anything else — another host, another scheme, a path
/// the app has no screen for — is `.unknown`, never a guess.
public enum AppLink: Hashable, Sendable {
    /// `/` — the dashboard. Also what an empty link means when it arrives by push.
    case home
    /// `/classes`
    case classes
    /// `/classes/{id}` — also what a HOMEWORK_DUE_SOON, HOMEWORK_GRADED or class announcement
    /// links to.
    case classroom(id: Int)
    /// `/classes/{classroomId}/assignments/{assignmentId}` — HOMEWORK_ASSIGNED.
    case homework(classroomId: Int, assignmentId: Int)
    /// `/midterm` — MIDTERM_SCHEDULED.
    case midterms
    /// `/midterm/result/{attemptId}` — MIDTERM_RESULT for a midterm sat in the midterms app.
    case midtermResult(attemptId: Int)
    /// `/review/{attemptId}` — MIDTERM_RESULT for an old-style midterm (a test attempt).
    case examReview(attemptId: Int)
    /// `/certificate/{code}` — CERTIFICATE_READY.
    case certificate(code: String)
    /// `/support` — SUPPORT_BOOKED.
    case support
    /// `/services`
    case services
    /// `/events` — every EVENT_* notification.
    case events
    /// `/rewards` — the Points page. REWARD_EARNED.
    case points
    /// `/shop` — SHOP_ORDER_READY, STRIKE_LOST.
    case shop
    /// `/leaderboard`
    case leaderboard
    /// `/surveys`
    case surveys
    /// `/surveys/{id}`
    case survey(id: Int)
    /// `/roadmap`
    case roadmap
    /// `/roadmap/{deliveryId}`
    case roadmapDelivery(id: Int)
    /// `/progress` (and its old address, `/analytics`)
    case progress
    /// `/live`, or `/live/{sessionId}` for one game.
    case liveQuiz(sessionId: Int?)
    /// `/vocabulary`
    case vocabulary
    /// `/vocabulary/sections/{id}`
    case vocabularySection(id: Int)
    /// `/vocabulary/sets/{id}` — including its study modes (`…/flashcards`, `…/test`).
    case vocabularySet(id: Int)
    /// `/assessments` and anything under it.
    case assessments
    /// `/profile` (and `/complete-profile`)
    case profile
    /// Anything else. Carries the site path (starting with `/`) when the location is on the
    /// site — `webURL(base:)` can then open it in the browser — or the text as received when
    /// it is not, in which case it must not be opened at all.
    case unknown(String)

    /// The app's own URL scheme.
    public static let scheme = "mastersat"

    /// Hosts that are this site. Other subdomains are consoles for staff, not the student
    /// site, so a link to one is not something the app should interpret.
    static let siteHosts: Set<String> = ["mastersat.uz", "www.mastersat.uz"]

    public init(linkURL: String) {
        self = AppLink.parse(linkURL)
    }

    /// Read any accepted form of location. Never fails: what cannot be read is `.unknown`.
    public static func parse(_ raw: String) -> AppLink {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // An empty link is "open the app". The inbox does not come here for an empty
        // `link_url` (a row with no link only marks itself read, as on the web); a push with
        // no link does, and the dashboard is where that belongs.
        if text.isEmpty { return .home }
        guard let path = sitePath(of: text) else { return .unknown(text) }
        return route(path)
    }

    /// Read a URL handed to the app (`onOpenURL`, a universal link).
    public static func parse(_ url: URL) -> AppLink {
        parse(url.absoluteString)
    }

    // MARK: - Where it points on the site

    /// The site path this link means, canonical form. `parse(link.path) == link` for every
    /// case but `.unknown`.
    public var path: String {
        switch self {
        case .home: return "/"
        case .classes: return "/classes"
        case .classroom(let id): return "/classes/\(id)"
        case .homework(let classroomId, let assignmentId): return "/classes/\(classroomId)/assignments/\(assignmentId)"
        case .midterms: return "/midterm"
        case .midtermResult(let attemptId): return "/midterm/result/\(attemptId)"
        case .examReview(let attemptId): return "/review/\(attemptId)"
        case .certificate(let code): return "/certificate/\(Self.encodeSegment(code))"
        case .support: return "/support"
        case .services: return "/services"
        case .events: return "/events"
        case .points: return "/rewards"
        case .shop: return "/shop"
        case .leaderboard: return "/leaderboard"
        case .surveys: return "/surveys"
        case .survey(let id): return "/surveys/\(id)"
        case .roadmap: return "/roadmap"
        case .roadmapDelivery(let id): return "/roadmap/\(id)"
        case .progress: return "/progress"
        case .liveQuiz(let sessionId): return sessionId.map { "/live/\($0)" } ?? "/live"
        case .vocabulary: return "/vocabulary"
        case .vocabularySection(let id): return "/vocabulary/sections/\(id)"
        case .vocabularySet(let id): return "/vocabulary/sets/\(id)"
        case .assessments: return "/assessments"
        case .profile: return "/profile"
        case .unknown(let raw): return raw
        }
    }

    /// The same place on the website, for a destination the app has no screen of its own for.
    /// Nil when the link does not point at the site — that must never be opened.
    public func webURL(base: URL) -> URL? {
        let path = self.path
        guard path.hasPrefix("/"), !path.hasPrefix("//") else { return nil }
        return URL(string: path, relativeTo: base)?.absoluteURL
    }

    // MARK: - Parsing

    /// The site path a location points at, without query or fragment — or nil when it points
    /// somewhere that is not this site.
    static func sitePath(of text: String) -> String? {
        if text.hasPrefix("/") {
            // `//host/path` is protocol-relative: an absolute URL that happens to start with
            // a slash. Read it as one, never as a path.
            if text.hasPrefix("//") { return absolutePath(of: "https:" + text) }
            return stripQueryAndFragment(text)
        }
        if hasScheme(text) { return absolutePath(of: text) }
        // A path written without its leading slash (or nothing but a query: `?from=push`).
        let rest = stripQueryAndFragment(text)
        return rest.hasPrefix("/") ? rest : "/" + rest
    }

    private static func absolutePath(of text: String) -> String? {
        guard let components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased() else { return nil }
        switch scheme {
        case Self.scheme:
            // `mastersat://classes/12` puts the first segment in the host position.
            let host = components.percentEncodedHost ?? ""
            let rest = components.percentEncodedPath
            var path = host.isEmpty ? "" : "/" + host
            if !rest.isEmpty { path += rest.hasPrefix("/") ? rest : "/" + rest }
            return path.isEmpty ? "/" : path
        case "http", "https":
            guard let host = components.host?.lowercased(),
                  siteHosts.contains(host.hasSuffix(".") ? String(host.dropLast()) : host)
            else { return nil }
            let path = components.percentEncodedPath
            return path.isEmpty ? "/" : path
        default:
            return nil
        }
    }

    /// RFC 3986: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"` before any slash.
    private static func hasScheme(_ text: String) -> Bool {
        guard let colon = text.firstIndex(of: ":") else { return false }
        let scheme = text[..<colon]
        guard let first = scheme.first, first.isASCII, first.isLetter else { return false }
        return scheme.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "+-.".contains($0)) }
    }

    private static func stripQueryAndFragment(_ text: String) -> String {
        guard let cut = text.firstIndex(where: { $0 == "?" || $0 == "#" }) else { return text }
        let path = String(text[..<cut])
        return path.isEmpty ? "/" : path
    }

    private static func encodeSegment(_ segment: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#;")
        return segment.addingPercentEncoding(withAllowedCharacters: allowed) ?? segment
    }

    /// A site path → a destination. Paths that name a section but not a valid id fall back to
    /// the section itself (`/classes/abc` is the class list), which is always a real page.
    static func route(_ path: String) -> AppLink {
        let segments = path
            .split(separator: "/", omittingEmptySubsequences: true)
            .map { String($0).removingPercentEncoding ?? String($0) }
        guard let head = segments.first?.lowercased() else { return .home }

        func segment(_ index: Int) -> String? { index < segments.count ? segments[index] : nil }
        func word(_ index: Int) -> String? { segment(index)?.lowercased() }
        func id(_ index: Int) -> Int? {
            guard let text = segment(index), let value = Int(text), value > 0 else { return nil }
            return value
        }

        switch head {
        case "classes":
            guard let classroomId = id(1) else { return .classes }
            if word(2) == "assignments", let assignmentId = id(3) {
                return .homework(classroomId: classroomId, assignmentId: assignmentId)
            }
            return .classroom(id: classroomId)
        case "midterm":
            if word(1) == "result", let attemptId = id(2) { return .midtermResult(attemptId: attemptId) }
            return .midterms
        case "review":
            if let attemptId = id(1) { return .examReview(attemptId: attemptId) }
            return .unknown(path)
        case "certificate":
            if let code = segment(1), !code.isEmpty { return .certificate(code: code) }
            return .unknown(path)
        case "support": return .support
        case "services": return .services
        case "events": return .events
        case "rewards": return .points
        case "shop": return .shop
        case "leaderboard": return .leaderboard
        case "surveys":
            if let surveyId = id(1) { return .survey(id: surveyId) }
            return .surveys
        case "roadmap":
            if let deliveryId = id(1) { return .roadmapDelivery(id: deliveryId) }
            return .roadmap
        case "progress", "analytics": return .progress
        case "live": return .liveQuiz(sessionId: id(1))
        case "vocabulary":
            if word(1) == "sets", let setId = id(2) { return .vocabularySet(id: setId) }
            if word(1) == "sections", let sectionId = id(2) { return .vocabularySection(id: sectionId) }
            return .vocabulary
        case "assessments": return .assessments
        case "profile", "complete-profile": return .profile
        default: return .unknown(path)
        }
    }
}

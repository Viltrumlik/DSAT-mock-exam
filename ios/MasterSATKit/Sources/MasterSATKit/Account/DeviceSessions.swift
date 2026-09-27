import Foundation

// MARK: - Naming a device

public enum DeviceKind: String, Sendable, Equatable {
    case phone, tablet, computer, app
}

/// "Chrome on Windows" out of `Mozilla/5.0 (Windows NT 10.0; Win64; x64) …`.
///
/// A port of the web's `describeDevice`, test for test, so the same session reads the same on
/// both. Order matters: Edge, Opera and Samsung Internet all also say "Chrome", and Chrome
/// also says "Safari". The app's own sessions carry the default `URLSession` agent
/// (`MasterSAT/2 CFNetwork/… Darwin/…`), which names the app but not the device — so an iPad
/// running the app reads as "MasterSAT app on iPhone", on the web too.
public struct DeviceDescription: Sendable, Equatable {
    public let label: String
    public let kind: DeviceKind

    public init(label: String, kind: DeviceKind) {
        self.label = label
        self.kind = kind
    }

    public static func describe(userAgent: String?) -> DeviceDescription {
        let ua = userAgent ?? ""
        func has(_ pattern: String, caseInsensitive: Bool = false) -> Bool {
            var options: String.CompareOptions = [.regularExpression]
            if caseInsensitive { options.insert(.caseInsensitive) }
            return ua.range(of: pattern, options: options) != nil
        }

        if has("MasterSAT", caseInsensitive: true) {
            return DeviceDescription(label: has("iPad") ? "MasterSAT app on iPad" : "MasterSAT app on iPhone", kind: .app)
        }

        let os: String?
        if has("iPhone") { os = "iPhone" }
        else if has("iPad") { os = "iPad" }
        else if has("Android") { os = "Android" }
        else if has("Windows") { os = "Windows" }
        else if has("CrOS") { os = "ChromeOS" }
        else if has("Mac OS X|Macintosh") { os = "Mac" }
        else if has("Linux") { os = "Linux" }
        else { os = nil }

        let browser: String?
        if has("Edg(e|A|iOS)?/") { browser = "Edge" }
        else if has("OPR/|Opera") { browser = "Opera" }
        else if has("SamsungBrowser/") { browser = "Samsung Internet" }
        else if has("YaBrowser/") { browser = "Yandex Browser" }
        else if has("Firefox/|FxiOS/") { browser = "Firefox" }
        else if has("Chrome/|CriOS/") { browser = "Chrome" }
        else if has("Safari/") { browser = "Safari" }
        else { browser = nil }

        let kind: DeviceKind
        if os == "iPhone" || (os == "Android" && has("Mobile")) { kind = .phone }
        else if os == "iPad" || os == "Android" { kind = .tablet }
        else { kind = .computer }

        if let browser, let os { return DeviceDescription(label: "\(browser) on \(os)", kind: kind) }
        if let browser { return DeviceDescription(label: browser, kind: kind) }
        if let os { return DeviceDescription(label: os, kind: kind) }
        return DeviceDescription(label: "Unknown device", kind: kind)
    }
}

// MARK: - When it was last seen

public enum DeviceActivity {
    /// "Active now", "Active 12 minutes ago", "Active yesterday", "Active Sep 3" — the web's
    /// `lastActiveLabel`, rounding and all.
    public static func lastActiveLabel(_ iso: String?, now: Date = Date(), timeZone: TimeZone = .current) -> String {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return "Active recently" }
        let minute = 60.0, hour = 3600.0, day = 86_400.0
        let ago = max(0, now.timeIntervalSince(date))
        if ago < 2 * minute { return "Active now" }
        if ago < hour { return "Active \(Int((ago / minute).rounded())) minutes ago" }
        if ago < day {
            let hours = Int((ago / hour).rounded())
            return "Active \(hours) \(hours == 1 ? "hour" : "hours") ago"
        }
        let days = Int((ago / day).rounded(.down))
        if days == 1 { return "Active yesterday" }
        if days < 7 { return "Active \(days) days ago" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "MMM d"
        return "Active \(f.string(from: date))"
    }
}

// MARK: - Which row is this phone

/// Picking the phone's own session out of the device list.
///
/// The server marks "this device" by the web's refresh COOKIE, which the app does not have,
/// so every row arrives `is_current: false` — the phone's own included. Left like that, the
/// phone lists itself as a stranger with a Sign out button, and "sign out the others" would
/// have no way to spare it.
///
/// What the app does have is its own refresh token, and a JWT carries `iat`, the second it
/// was minted. The server writes the session row in the same request, right after minting —
/// at login and at every rotation — so the row's `created_at` lands within a second of `iat`
/// (0.3–0.5 s measured against the real views, the floor of `iat` included). A row inside a
/// few seconds of that moment is this phone's. Two rows inside the window (two devices signed
/// in within the same seconds) is ambiguous, and ambiguous is treated as unknown: marking the
/// wrong row would hide a stranger's Sign out button.
public enum DeviceSessionRules {
    /// How far after `iat` the row may have been written. Generous: the real gap is
    /// milliseconds plus up to one second of `iat` being rounded down.
    static let windowAfter: TimeInterval = 10
    /// And before — one server clock writes both, so this only absorbs rounding.
    static let windowBefore: TimeInterval = 2

    /// The id of the row this phone renews with, or nil when it cannot be told.
    public static func thisDevice(in sessions: [DeviceSession], refreshToken: String?) -> Int? {
        if let marked = sessions.first(where: \.isCurrent) { return marked.id }
        guard let refreshToken, let issued = JWTClaims.issuedAt(of: refreshToken) else { return nil }
        let matches = sessions.filter { session in
            guard let raw = session.createdAt, let created = JSONCoding.parseServerDate(raw) else { return false }
            let gap = created.timeIntervalSince(issued)
            return gap >= -windowBefore && gap <= windowAfter
        }
        return matches.count == 1 ? matches[0].id : nil
    }

    /// This phone first, then the rest in the server's order (most recently seen first).
    public static func ordered(_ sessions: [DeviceSession], thisDevice: Int?) -> [DeviceSession] {
        guard let thisDevice, let mine = sessions.first(where: { $0.id == thisDevice }) else { return sessions }
        return [mine] + sessions.filter { $0.id != thisDevice }
    }

    /// Everything that is not this phone. Empty when this phone is unknown: "the others" cannot
    /// be told apart from "all of them" then, and signing out the phone by accident is worse
    /// than offering one button fewer.
    public static func others(in sessions: [DeviceSession], thisDevice: Int?) -> [DeviceSession] {
        guard let thisDevice else { return [] }
        return sessions.filter { $0.id != thisDevice }
    }
}

/// Reading a JWT's claims without verifying it — the app only ever reads its OWN token, to
/// learn when it was issued. Nothing here is trusted for anything the server decides.
public enum JWTClaims {
    /// The `iat` claim, when the token is a JWT and carries one.
    public static func issuedAt(of token: String) -> Date? {
        guard let claims = payload(of: token) else { return nil }
        if let seconds = claims["iat"] as? Double { return Date(timeIntervalSince1970: seconds) }
        if let seconds = claims["iat"] as? Int { return Date(timeIntervalSince1970: TimeInterval(seconds)) }
        return nil
    }

    static func payload(of token: String) -> [String: Any]? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var base64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: base64) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}

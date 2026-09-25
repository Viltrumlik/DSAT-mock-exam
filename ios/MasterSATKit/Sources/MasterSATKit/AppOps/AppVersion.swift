import Foundation

/// A marketing version — `1.4.2` — compared the way a person reads it.
///
/// String comparison is the classic trap here: `"1.10.0" < "1.9.0"` is true for strings and
/// false for versions, and an update gate built on it would lock out the NEWER app. So the
/// parts are integers, missing parts are zero (`1.4` == `1.4.0`), and anything after the
/// numbers (`1.4.2-beta`, `1.4.2 (57)`) is ignored rather than rejected: a gate that cannot
/// read a version must fail open, never shut a student out of the app.
public struct AppVersion: Comparable, Hashable, Sendable, CustomStringConvertible {
    public let major: Int
    public let minor: Int
    public let patch: Int

    public init(major: Int, minor: Int = 0, patch: Int = 0) {
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    /// `nil` for an empty or non-numeric string. Callers treat `nil` as "no requirement".
    public init?(_ raw: String?) {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Leading run of digits and dots only: "2.1.0-rc1" → "2.1.0", "1.3 (40)" → "1.3".
        let numeric = trimmed.prefix { $0.isNumber || $0 == "." }
        let parts = numeric.split(separator: ".", omittingEmptySubsequences: false).prefix(3)
        guard let first = parts.first, let major = Int(first) else { return nil }
        let rest = parts.dropFirst().map { Int($0) }
        // "1..2" or "1.x" is not a version. Refusing it keeps a typo in the console from
        // quietly meaning "1.0.0".
        guard !rest.contains(where: { $0 == nil }) else { return nil }
        self.major = major
        self.minor = rest.count > 0 ? rest[0]! : 0
        self.patch = rest.count > 1 ? rest[1]! : 0
    }

    public static func < (lhs: AppVersion, rhs: AppVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }

    public var description: String { "\(major).\(minor).\(patch)" }
}

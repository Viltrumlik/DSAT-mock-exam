import Foundation

public enum JSONCoding {
    // These four are shared, configured once, and only ever *used* — never reconfigured
    // after setup. Foundation's coders and ISO8601DateFormatter are documented as safe to
    // use concurrently for encode/decode/parse; what is unsafe is mutating their options,
    // which nothing here does after the initializer closure returns. `nonisolated(unsafe)`
    // states exactly that, rather than paying for a lock on every decode or re-creating a
    // formatter on every attempt snapshot.
    nonisolated(unsafe) public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        // Sorted keys make an encoded payload byte-stable, which is what lets the autosave
        // compare "what I am about to send" against "what the server already accepted"
        // without the comparison depending on dictionary ordering.
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    nonisolated(unsafe) public static let decoder = JSONDecoder()

    /// Django REST Framework emits `2026-08-03T09:12:44.123456Z` — microseconds, which
    /// `ISO8601DateFormatter` rejects unless told to expect fractional seconds. Both forms
    /// appear in the same payload (`server_now` carries microseconds,
    /// `current_module_start_time` may not), so try the fractional parser first.
    public static func parseServerDate(_ raw: String) -> Date? {
        if let d = fractional.date(from: raw) { return d }
        return plain.date(from: raw)
    }

    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

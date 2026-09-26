import Foundation

// Lenient reads for the rewards, leaderboard and shop payloads.
//
// None of these endpoints are in `backend/openapi.yaml`, so the models are written by hand
// against the views — and a hand-written model is exactly where a harmless server change (a
// number that arrives as "7", a key that is sometimes absent, a null where there used to be a
// string) turns into a screen that will not open. Everything that is not an identity key is
// read through these and given a default; identity keys (`id`, `student_id`, `rank`, a rule's
// `event`) stay strict, because a row without one cannot be shown honestly.
//
// Prefixed `rewards…` so they cannot collide with a helper another feature adds to the same
// module: extension members share one namespace across the whole target.

extension KeyedDecodingContainer {
    /// A number, a numeric string ("7", "7.0") or a whole double. Nil when absent, null or
    /// not a number at all.
    func rewardsInt(_ key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let text = try? decodeIfPresent(String.self, forKey: key) {
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            if let value = Int(trimmed) { return value }
            if let value = Double(trimmed), value.isFinite { return Int(value.rounded()) }
            return nil
        }
        if let value = try? decodeIfPresent(Double.self, forKey: key), value.isFinite {
            return Int(value.rounded())
        }
        return nil
    }

    /// A string; a number is written out rather than dropped. Nil when absent or null.
    func rewardsString(_ key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        return nil
    }

    /// A bool, or the 0/1 and "true"/"false" spellings of one.
    func rewardsBool(_ key: Key) -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        if let text = try? decodeIfPresent(String.self, forKey: key) {
            switch text.lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }

    /// A required number, lenient about its spelling but not about its presence.
    func rewardsRequiredInt(_ key: Key) throws -> Int {
        guard let value = rewardsInt(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(codingPath: codingPath, debugDescription: "Missing or non-numeric \(key.stringValue)")
            )
        }
        return value
    }

    /// A list whose rows are decoded one at a time, so one malformed row costs that row and
    /// not the whole screen.
    ///
    /// But not silently to nothing: when the server sent rows and **every** one of them failed,
    /// that is a contract change, not a bad row — and swallowing it would render an error as
    /// "nothing yet", which on these screens reads as a student having earned nothing. That
    /// case throws, and the screen shows its failure state instead. Absent or null is a
    /// genuinely empty list.
    func rewardsList<Element: Decodable>(_ type: Element.Type, _ key: Key) throws -> [Element] {
        guard contains(key), (try? decodeNil(forKey: key)) == false else { return [] }
        var container = try nestedUnkeyedContainer(forKey: key)
        var decoded: [Element] = []
        var sent = 0
        while !container.isAtEnd {
            sent += 1
            if let element = try? container.decode(Element.self) {
                decoded.append(element)
                continue
            }
            // Step over the bad element: a failed `decode` does not advance the container.
            // `RewardsSkipped` accepts any value, so this cannot fail — the `break` is only
            // there so that a decoder behaving otherwise can never spin this loop forever.
            if (try? container.decode(RewardsSkipped.self)) == nil { break }
        }
        if sent > 0 && decoded.isEmpty {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "None of the \(sent) \(key.stringValue) rows could be read"
            )
        }
        return decoded
    }
}

/// Swallows any one JSON value — object, array, string, number or null — so an unkeyed
/// container can move past a row it could not read. It never throws: a synthesized init would
/// ask for a keyed container and fail on anything that is not an object.
private struct RewardsSkipped: Decodable {
    init(from decoder: Decoder) throws {
        _ = try? decoder.singleValueContainer()
    }
}

/// How these screens write their numbers.
public enum RewardsFormat {
    /// `+5` for an earning, `-30` for a spend.
    ///
    /// A conversion is the one row in the points feed that SPENDS, and the app used to print it
    /// as `"+\(points)"` — "+-30". Plain `String` interpolation, never a `LocalizedStringKey`, so
    /// no locale can slip a thousands separator into a balance.
    public static func signed(_ value: Int) -> String {
        value < 0 ? "-\(value.magnitude)" : "+\(value)"
    }

    /// "1 coin", "3 coins", "1 lesson", "2 lessons".
    public static func count(_ value: Int, _ singular: String, _ plural: String? = nil) -> String {
        "\(value) \(value == 1 ? singular : (plural ?? singular + "s"))"
    }
}

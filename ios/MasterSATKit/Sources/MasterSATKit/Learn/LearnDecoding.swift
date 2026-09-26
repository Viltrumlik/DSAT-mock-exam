import Foundation

/// Lenient readers for the roadmap and progress payloads.
///
/// These two pages are built from several nested lists — tracks, levels, lessons, groups,
/// months — and a strict decode would let one malformed lesson blank a student's whole
/// roadmap. So every field except a true identity key falls back to a default, numbers are
/// read in whichever form Python happened to serialise them (`12`, `12.0`, or a DRF decimal
/// string `"12.0"`), and a list drops the one element it cannot read rather than failing.
enum LearnDecode {
    static func string<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> String? {
        try? c.decodeIfPresent(String.self, forKey: key)
    }

    static func int<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Int? {
        if let value = try? c.decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? c.decodeIfPresent(Double.self, forKey: key), value.isFinite {
            return Int(value.rounded())
        }
        if let raw = try? c.decodeIfPresent(String.self, forKey: key) {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if let value = Int(trimmed) { return value }
            if let value = Double(trimmed), value.isFinite { return Int(value.rounded()) }
        }
        return nil
    }

    static func double<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Double? {
        if let value = try? c.decodeIfPresent(Double.self, forKey: key) { return value }
        if let raw = try? c.decodeIfPresent(String.self, forKey: key) {
            return Double(raw.trimmingCharacters(in: .whitespaces))
        }
        return nil
    }

    static func bool<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Bool? {
        if let value = try? c.decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? c.decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        return nil
    }

    /// A list, keeping every element that decodes and dropping the ones that do not.
    static func list<T: Decodable, K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> [T] {
        guard let wrapped = try? c.decodeIfPresent([LearnLenient<T>].self, forKey: key) else { return [] }
        return wrapped.compactMap(\.value)
    }

    /// Present-or-absent matters for these, so absence is `nil` and not an empty list.
    static func optionalList<T: Decodable, K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> [T]? {
        guard c.contains(key),
              let wrapped = try? c.decodeIfPresent([LearnLenient<T>].self, forKey: key) else { return nil }
        return wrapped.compactMap(\.value)
    }
}

/// One element of a list, or nothing — never a failure that takes its siblings down.
struct LearnLenient<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

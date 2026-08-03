import Foundation

/// A value the server declares as untyped JSON.
///
/// Assessment answers are one of these: a choice id, a typed number, free text, or a
/// boolean. Decoding them into `String` would work today — the grader coerces — but it
/// would also silently turn a `null` into `"null"` on the way back, which reads as an
/// answered question. Keeping the shape lets "not answered" stay distinguishable.
public enum JSONValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        // Arrays and objects can appear on legacy questions with several accepted
        // answers. Nothing on a phone reads them, and refusing to decode would take
        // the whole attempt down, so they land as null.
        self = .null
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let d):
            // Whole numbers go out without a decimal point: "12", not "12.0". The grader
            // parses either, but a student's own answer is echoed back in review.
            if d == d.rounded(), abs(d) < 1e15 { try c.encode(Int(d)) } else { try c.encode(d) }
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        }
    }

    /// What to show, and what to compare against for "have they answered this?".
    public var displayText: String {
        switch self {
        case .string(let s): return s
        case .number(let d): return d == d.rounded() ? String(Int(d)) : String(d)
        case .bool(let b): return b ? "True" : "False"
        case .null: return ""
        }
    }

    public var isEmpty: Bool {
        switch self {
        case .null: return true
        case .string(let s): return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: return false
        }
    }
}

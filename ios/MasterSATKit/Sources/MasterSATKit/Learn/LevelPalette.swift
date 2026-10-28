import Foundation

// The Class tab's level colours and the Class page's dark theme, exactly as the owner's design
// computes them (`Class Tab.dc.html` `PALETTE`, `Class Detail v4.dc.html` `mix()` and `T`).
// Plain RGB numbers, no SwiftUI: the app maps them to `Color`, the tests pin the maths.

/// One sRGB colour, 0…255 per channel.
public struct RGB: Sendable, Equatable, Hashable, CustomStringConvertible {
    public let r: Int
    public let g: Int
    public let b: Int

    public init(_ r: Int, _ g: Int, _ b: Int) {
        self.r = Self.channel(r)
        self.g = Self.channel(g)
        self.b = Self.channel(b)
    }

    /// `0x2A68C0` — the design's `#2A68C0`.
    public init(hex: UInt32) {
        self.init(Int((hex >> 16) & 0xFF), Int((hex >> 8) & 0xFF), Int(hex & 0xFF))
    }

    /// The design's base colours to mix towards.
    public static let dark = RGB(5, 8, 20)
    public static let white = RGB(255, 255, 255)

    /// The design's `mix(a, b, t)`: each channel `Math.round(a + (b - a) * t)`. Rounded as
    /// JavaScript rounds — a half goes up — so every colour matches the reference to the unit.
    public func mix(_ other: RGB, _ t: Double) -> RGB {
        func blend(_ a: Int, _ b: Int) -> Int {
            Self.jsRound(Double(a) + Double(b - a) * t)
        }
        return RGB(blend(r, other.r), blend(g, other.g), blend(b, other.b))
    }

    /// 0…1 per channel, for `Color(red:green:blue:)`.
    public var unit: (red: Double, green: Double, blue: Double) {
        (Double(r) / 255, Double(g) / 255, Double(b) / 255)
    }

    /// `#2A68C0`.
    public var description: String { String(format: "#%02X%02X%02X", r, g, b) }

    /// JavaScript's `Math.round`: the nearest integer, a half towards +∞ (so 2.5 → 3 and
    /// -2.5 → -2) — not Swift's away-from-zero, and not the banker's rounding of `.rounded()`'s
    /// even rule.
    static func jsRound(_ x: Double) -> Int {
        let floor = x.rounded(.down)
        return Int(x - floor >= 0.5 ? floor + 1 : floor)
    }

    private static func channel(_ value: Int) -> Int { min(255, max(0, value)) }
}

/// One of the seven level gradients. A card runs `start` → `end` at 135°.
public enum LevelPalette: String, Sendable, Equatable, CaseIterable {
    case mathFoundation
    case mathJunior
    case mathMiddle
    case mathSenior
    case englishJunior
    case englishMiddle
    case englishSenior

    /// The subject's palette for a level code. A level the subject has no colour for (an
    /// English class mis-tagged `foundation`) gets the subject's Junior, as the design does.
    public init(subject: ClassSubject, level: String) {
        switch (subject, level.lowercased()) {
        case (.math, "foundation"): self = .mathFoundation
        case (.math, "middle"): self = .mathMiddle
        case (.math, "senior"): self = .mathSenior
        case (.math, _): self = .mathJunior
        case (.english, "middle"): self = .englishMiddle
        case (.english, "senior"): self = .englishSenior
        case (.english, _): self = .englishJunior
        }
    }

    /// The design's `c1`.
    public var start: RGB {
        switch self {
        case .mathFoundation: return RGB(hex: 0x0E8F84)
        case .mathJunior: return RGB(hex: 0x2A68C0)
        case .mathMiddle: return RGB(hex: 0x3B4FC4)
        case .mathSenior: return RGB(hex: 0x1D3A7A)
        case .englishJunior: return RGB(hex: 0x6A4BC4)
        case .englishMiddle: return RGB(hex: 0xB8457A)
        case .englishSenior: return RGB(hex: 0x9A6432)
        }
    }

    /// The design's `c2`.
    public var end: RGB {
        switch self {
        case .mathFoundation: return RGB(hex: 0x2BB3A3)
        case .mathJunior: return RGB(hex: 0x4A8BE0)
        case .mathMiddle: return RGB(hex: 0x5D71E0)
        case .mathSenior: return RGB(hex: 0x33579E)
        case .englishJunior: return RGB(hex: 0x8C6EE2)
        case .englishMiddle: return RGB(hex: 0xD8689A)
        case .englishSenior: return RGB(hex: 0xC2915F)
        }
    }

    /// The Class page tinted from this level.
    public var theme: ClassTheme { ClassTheme(start: start, end: end) }
}

/// One stop of a vertical gradient: a colour at 0…1 down the page.
public struct GradientStop: Sendable, Equatable {
    public let color: RGB
    public let location: Double

    public init(_ color: RGB, at location: Double) {
        self.color = color
        self.location = location
    }
}

/// The Class page's colours, derived from one level's gradient exactly as the design's `T`.
/// `c1` is mixed towards `RGB.dark` for the depths and `c2` towards white for the light.
public struct ClassTheme: Sendable, Equatable {
    /// The level's own two colours — the "Resume" button's gradient runs `c2` → `c1`.
    public let c1: RGB
    public let c2: RGB

    /// The page background, top to bottom: `c1` mixed 5 %, 25 %, 55 %, 78 % towards dark at
    /// 0, 0.32, 0.68 and 1 (a dot texture goes over it).
    public let background: [GradientStop]
    /// The glass top strip: `c1` 4 % towards white.
    public let strip: RGB
    /// The fade under the strip: `c1` 20 % towards dark, solid → clear.
    public let topFade: RGB
    /// The fade behind the tab bar: `c1` 78 % towards dark, clear → 92 %.
    public let bottomFade: RGB
    /// The ink on the tab bar's selected pill: `c1` 25 % towards dark.
    public let deep: RGB
    /// `c2` 35 % towards white: glows — done nodes, the now node, the lit links, the bar.
    public let l1: RGB
    /// `c2` 65 % towards white: rings — the now card's edge, node rims, lit links, the bar's end.
    public let l2: RGB
    /// `c2` 90 % towards white: the lit path's core line and the class card's icon ink.
    public let l3: RGB
    /// `c2` itself: the bar's start, the now card's glow, the lit path's wide halo.
    public let mid: RGB
    /// Node discs under their tint: `c1` 35 % (done), 45 % (to do), 55 % (locked) towards dark.
    public let base1: RGB
    public let base2: RGB
    public let base3: RGB

    public init(start c1: RGB, end c2: RGB) {
        self.c1 = c1
        self.c2 = c2
        background = [
            GradientStop(c1.mix(.dark, 0.05), at: 0),
            GradientStop(c1.mix(.dark, 0.25), at: 0.32),
            GradientStop(c1.mix(.dark, 0.55), at: 0.68),
            GradientStop(c1.mix(.dark, 0.78), at: 1),
        ]
        strip = c1.mix(.white, 0.04)
        topFade = c1.mix(.dark, 0.2)
        bottomFade = c1.mix(.dark, 0.78)
        deep = c1.mix(.dark, 0.25)
        l1 = c2.mix(.white, 0.35)
        l2 = c2.mix(.white, 0.65)
        l3 = c2.mix(.white, 0.9)
        mid = c2
        base1 = c1.mix(.dark, 0.35)
        base2 = c1.mix(.dark, 0.45)
        base3 = c1.mix(.dark, 0.55)
    }
}

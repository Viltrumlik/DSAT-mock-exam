import SwiftUI
import MasterSATKit

/// Vocabulary's colour identity — the web's `sectionTone.ts` and `modeTone.ts`, with the
/// light and dark values `app/globals.css` gives those tokens.
///
/// Two tables, one idea: a colour means one thing everywhere it appears. A **section** owns a
/// hue and a glyph (keyed on its id — see `VocabSectionTone`), carried by its hub card, its
/// own page and every set page under it. A **game** owns a colour too, and the four-segment
/// bar on every set is painted in them, so the bar says *which* game is still owed rather
/// than only how many. An unearned segment or ring is a tint of its own hue, never grey.
///
/// Kept out of `Theme` on purpose: these are the vocabulary feature's own marks, not the
/// app's semantic colours, and the two must be free to change independently.
enum VocabPalette {

    struct Tone {
        /// Bars, rings, the glyph, the top edge.
        let solid: Color
        /// Text written in the tone — a count, "Open section", a game's name. The web's
        /// `-foreground` shade where it uses one, which reads on white where `solid` would not.
        let ink: Color

        /// The part of a bar or ring not yet earned.
        var track: Color { solid.opacity(0.15) }
        /// The square behind a glyph.
        var tile: Color { solid.opacity(0.14) }
        /// A chip on a white card.
        var chip: Color { solid.opacity(0.10) }
    }

    // MARK: - Sections

    static func section(_ tone: VocabSectionTone) -> Tone {
        switch tone {
        case .primary: return primary
        case .amber: return amber
        case .violet: return violet
        case .emerald: return emerald
        case .rose: return rose
        case .sky: return sky
        }
    }

    static func section(id: Int) -> Tone { section(VocabSectionTone.of(sectionId: id)) }

    /// One glyph per slot, so colour and shape always travel together. The web's lucide
    /// Library, Feather, Compass, Rocket, Landmark and Gem, as the nearest SF Symbols.
    static func glyph(_ tone: VocabSectionTone) -> String {
        switch tone {
        case .primary: return "books.vertical.fill"
        case .amber: return "pencil.and.scribble"
        case .violet: return "safari.fill"
        case .emerald: return "paperplane.fill"
        case .rose: return "building.columns.fill"
        case .sky: return "diamond.fill"
        }
    }

    static func glyph(sectionId: Int) -> String { glyph(VocabSectionTone.of(sectionId: sectionId)) }

    /// A student's own set has no section to borrow a colour from, so "mine" wears violet.
    static let custom = violet
    static let customGlyph = "sparkles"

    /// A fully mastered card, section or set switches to this.
    static let mastered = emerald

    // MARK: - Games

    static func game(_ mode: VocabStudyMode) -> Tone {
        switch mode {
        case .flashcard: return flashcardBlue
        case .matching: return sky
        case .speed: return amber
        case .test: return emerald
        }
    }

    static func gameGlyph(_ mode: VocabStudyMode) -> String {
        switch mode {
        case .flashcard: return "square.3.layers.3d"
        case .matching: return "shuffle"
        case .speed: return "timer"
        case .test: return "list.clipboard"
        }
    }

    static func gameName(_ mode: VocabStudyMode) -> String {
        switch mode {
        case .flashcard: return "Flashcard"
        case .matching: return "Matching"
        case .speed: return "Speed"
        case .test: return "Test"
        }
    }

    /// What each game asks of you, in one line — shared by the launcher on a set's page and
    /// the guide on the hub, so a student is never told two different things about one game.
    static func gameBlurb(_ mode: VocabStudyMode) -> String {
        switch mode {
        case .flashcard: return "Flip each card and mark what you knew. Missed words come back."
        case .matching: return "Pair every word with its definition. The clock runs the whole way."
        case .speed: return "Sixty seconds. Pick the right meaning as fast as you can."
        case .test: return "Multiple choice, true/false and spelling — every word, once."
        }
    }

    // MARK: - The six hues (light / dark)

    /// `--primary`; text in dark mode lifts to `--primary-hover`, as the web's does.
    private static let primary = Tone(solid: hex(0x2a68c0, 0x3170d6), ink: hex(0x2a68c0, 0x5b8def))
    /// The flashcard game's `text-primary` stays on the primary itself in dark mode.
    private static let flashcardBlue = Tone(solid: hex(0x2a68c0, 0x3170d6), ink: hex(0x2a68c0, 0x3170d6))
    /// `--warning`, ink `--warning-foreground`.
    private static let amber = Tone(solid: hex(0xd97706, 0xfbbf24), ink: hex(0xb45309, 0xfcd34d))
    /// `--chart-6`.
    private static let violet = Tone(solid: hex(0x7c3aed, 0xa78bfa), ink: hex(0x7c3aed, 0xa78bfa))
    /// `--success`, ink `--success-foreground`.
    private static let emerald = Tone(solid: hex(0x059669, 0x34d399), ink: hex(0x047857, 0x6ee7b7))
    /// `--chart-5`.
    private static let rose = Tone(solid: hex(0xdb2777, 0xf472b6), ink: hex(0xdb2777, 0xf472b6))
    /// `--info`, ink `--info-foreground`.
    private static let sky = Tone(solid: hex(0x0284c7, 0x38bdf8), ink: hex(0x0369a1, 0x7dd3fc))

    private static func hex(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

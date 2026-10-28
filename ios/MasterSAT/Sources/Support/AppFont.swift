import SwiftUI
import UIKit

extension View {
    /// `.font(.system(size:weight:design:))` that follows the phone's text-size setting.
    ///
    /// The app is drawn in points, and a system font given points never scales — a student who
    /// has set their phone to a larger size got the same 13-pt caption as everyone else. This
    /// keeps every size exactly where it is at the default setting and scales it from there
    /// along the curve of the text style it is closest to, so a caption grows like a caption.
    ///
    /// `weight` and `design` stay optional, as in `Font.system`, so a call that named neither
    /// builds the very font it built before.
    ///
    /// `monospacedDigits` sets the digits inside the font, as `.system(…).monospacedDigit()`
    /// did before the scale. A View `.monospacedDigit()` after this sits outside the font it
    /// sets, and that pair was the suspect when a pill's count (`PillTabs`) came out "1:".
    nonisolated func appFont(
        _ size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil, monospacedDigits: Bool = false
    ) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: design, monospacedDigits: monospacedDigits))
    }
}

extension View {
    /// The design's display face — Archivo at weight 800, width 112% (`ArchivoDisplay-ExtraBold`,
    /// bundled in Resources/Fonts) — for the new Class screens' headings and big numbers.
    ///
    /// It scales exactly as `appFont` does: the size is kept at the default setting and grows along
    /// the curve of the nearest text style (`ScaledFont.textStyle(for:)`), through the same
    /// `@ScaledMetric` (`UIFontMetrics`), so a `.dynamicTypeSize(...)` cap above it holds it too.
    /// Should the face ever fail to load, it falls back to the heavy rounded system font those
    /// headings used before, at the same size.
    nonisolated func appDisplayFont(_ size: CGFloat, monospacedDigits: Bool = false) -> some View {
        modifier(ScaledDisplayFont(size: size, monospacedDigits: monospacedDigits))
    }
}

extension View {
    /// For a glyph or numeral inside a frame of a fixed size — a 30-pt badge, a 32-pt close disc,
    /// a 22-pt rank column. The frame cannot grow with its text, and a symbol at three times its
    /// size spills out of one at one. So type stops growing at `xxxLarge`, where it still fits,
    /// the way the system's own navigation and tab bars hold still; put it after `appFont`.
    nonisolated func capDynamicType() -> some View {
        dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    /// The same cap for an icon-only control, and the system's answer for a control that holds
    /// still while the text around it grows: a press-and-hold shows it large (the large content
    /// viewer), with this `label`. Put it on the `Button` itself, after its accessibility label,
    /// not on the glyph: the viewer is then offered over the whole tap target, and a sheet or a
    /// popover hung off the button stays uncapped.
    nonisolated func capDynamicType(label: String, systemImage: String? = nil) -> some View {
        dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityShowsLargeContentViewer {
                if let systemImage {
                    Label(label, systemImage: systemImage)
                } else {
                    Text(label)
                }
            }
    }
}

extension View {
    /// A title cut to `lines` lines to keep a row tidy — until the student's text is set at an
    /// accessibility size. Then room matters more than tidiness: the cut lifts, so nothing is
    /// ever shortened to "…" because a student asked for larger words.
    nonisolated func titleLineLimit(_ lines: Int) -> some View {
        modifier(TitleLineLimit(lines: lines))
    }
}

private struct TitleLineLimit: ViewModifier {
    let lines: Int
    @Environment(\.dynamicTypeSize) private var typeSize

    func body(content: Content) -> some View {
        content.lineLimit(typeSize.isAccessibilitySize ? nil : lines)
    }
}

struct ScaledFont: ViewModifier {
    /// Initialised from the base size and scaled for `relativeTo`, so at the default setting it
    /// is the base size and not a point off. The environment it reads includes a
    /// `.dynamicTypeSize(...)` cap above this view, which is how the chrome stops growing.
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight?
    private let design: Font.Design?
    private let monospacedDigits: Bool

    nonisolated init(size: CGFloat, weight: Font.Weight?, design: Font.Design?, monospacedDigits: Bool = false) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: Self.textStyle(for: size))
        self.weight = weight
        self.design = design
        self.monospacedDigits = monospacedDigits
    }

    func body(content: Content) -> some View {
        let font = Font.system(size: size, weight: weight, design: design)
        content.font(monospacedDigits ? font.monospacedDigit() : font)
    }

    /// The system text style whose default size is the nearest one at or below `size`: a 13-pt
    /// label is a footnote, a 17-pt line is body. The tiers are the same at every call site, so
    /// two pieces of type of one size always grow together.
    nonisolated static func textStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case 28...: .title
        case 22...: .title2
        case 20...: .title3
        case 17...: .body
        case 15...: .subheadline
        case 13...: .footnote
        case 12...: .caption
        default: .caption2
        }
    }
}

struct ScaledDisplayFont: ViewModifier {
    /// The PostScript name of the bundled face.
    nonisolated static let faceName = "ArchivoDisplay-ExtraBold"
    /// Looked up once: whether `UIAppFonts` registered the face.
    nonisolated static let isAvailable = UIFont(name: faceName, size: 12) != nil

    @ScaledMetric private var size: CGFloat
    private let monospacedDigits: Bool

    nonisolated init(size: CGFloat, monospacedDigits: Bool = false) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: ScaledFont.textStyle(for: size))
        self.monospacedDigits = monospacedDigits
    }

    func body(content: Content) -> some View {
        let font = Self.isAvailable
            ? Font.custom(Self.faceName, fixedSize: size)
            : Font.system(size: size, weight: .heavy, design: .rounded)
        content.font(monospacedDigits ? font.monospacedDigit() : font)
    }
}

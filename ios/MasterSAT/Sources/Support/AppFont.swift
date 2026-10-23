import SwiftUI

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
    nonisolated func appFont(_ size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: design))
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

    nonisolated init(size: CGFloat, weight: Font.Weight?, design: Font.Design?) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: Self.textStyle(for: size))
        self.weight = weight
        self.design = design
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: design))
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

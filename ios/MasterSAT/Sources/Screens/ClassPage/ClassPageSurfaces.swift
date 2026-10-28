import SwiftUI
import MasterSATKit

// The class page's surfaces, as the owner's "Class Detail v4" draws them: the level-tinted page with
// its dot texture, the glass it cuts every card from, and the fixed colours its badges use. Every
// number here is the design's (`class-detail-body.txt`); a CSS blur radius is halved for SwiftUI's.

/// The design's fixed colours — the ones that do not follow the level.
enum ClassPageInk {
    /// `rgba(10,12,40,…)`: every shadow on the page.
    static let shade = Color(.sRGB, red: 10 / 255, green: 12 / 255, blue: 40 / 255)
    /// `#0E1424`: the Resume popover's title.
    static let popoverTitle = Color(.sRGB, red: 14 / 255, green: 20 / 255, blue: 36 / 255)
    /// `#4E5B75`: the Resume popover's line under it.
    static let popoverMeta = Color(.sRGB, red: 78 / 255, green: 91 / 255, blue: 117 / 255)

    /// The Completed badge: `rgb(110,231,183)` glass, `#A7F3D0` ink.
    static let green = Color(.sRGB, red: 110 / 255, green: 231 / 255, blue: 183 / 255)
    static let greenInk = Color(.sRGB, red: 167 / 255, green: 243 / 255, blue: 208 / 255)
    /// The In progress badge — and the XP pill, which the design draws in the same warm family as
    /// its coin pill: `rgb(252,211,77)` glass, `#FDE68A` ink.
    static let amber = Color(.sRGB, red: 252 / 255, green: 211 / 255, blue: 77 / 255)
    static let amberInk = Color(.sRGB, red: 253 / 255, green: 230 / 255, blue: 138 / 255)
    /// The XP pill's disc: the app's amber, as `XPCapChip` and every other "+N XP" wear it.
    static let amberDisc = Color(.sRGB, red: 245 / 255, green: 158 / 255, blue: 11 / 255)
}

/// CSS `box-shadow` under glass. A SwiftUI shadow on a 7 % fill is 7 % of a shadow, and one on the
/// whole card shadows every word on it; a box shadow is neither. So it is cast by an opaque copy of
/// the shape, and the shape itself is cut back out — the shadow shows around the card, never
/// through it.
struct GlassShadow<S: Shape>: View {
    let shape: S
    let color: Color
    let radius: CGFloat
    var y: CGFloat = 0

    var body: some View {
        shape
            .fill(.black)
            .shadow(color: color, radius: radius, y: y)
            .mask {
                Rectangle()
                    .padding(-(radius * 3 + abs(y)))
                    .overlay { shape.blendMode(.destinationOut) }
                    .compositingGroup()
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The page behind everything: the level's dark gradient with a white dot every 16 pt at 7 %. It
/// stays put while the sessions scroll over it, as in the design.
struct ClassPageBackdrop: View {
    let theme: ClassTheme

    var body: some View {
        theme.backgroundGradient
            .overlay { DotTexture() }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// `radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.4px) 0 0 / 16px 16px` — one soft dot
/// in the middle of every 16-pt tile. Drawn once per size: the page does not scroll it.
private struct DotTexture: View {
    var body: some View {
        Canvas { context, size in
            var dots = Path()
            var y: CGFloat = 8
            while y < size.height {
                var x: CGFloat = 8
                while x < size.width {
                    dots.addEllipse(in: CGRect(x: x - 1.2, y: y - 1.2, width: 2.4, height: 2.4))
                    x += 16
                }
                y += 16
            }
            context.fill(dots, with: .color(.white.opacity(0.07)))
        }
    }
}

/// The glass strip across the top: white at 7 %, rounded 34 at the bottom, a light edge along its
/// lower rim and a soft shadow under it. It reaches up under the status bar and ends 50 pt below the
/// navigation bar (the design's 156 on a 874-pt phone), so the class card overhangs its rim.
struct ClassPageTopStrip: View {
    var body: some View {
        // The reader sits where the page's content starts, under the status and navigation bars; how
        // far down that is, it reads off its own frame. (A reader told to ignore the safe area reads
        // an inset of 0.) The strip then reaches back up to the screen's edge.
        GeometryReader { proxy in
            let top = max(0, proxy.frame(in: .global).minY)
            let shape = UnevenRoundedRectangle(bottomLeadingRadius: 34, bottomTrailingRadius: 34, style: .continuous)
            shape
                .fill(.white.opacity(0.07))
                .overlay(alignment: .bottom) {
                    // `inset 0 -1px 0 rgba(255,255,255,0.14)`: a hairline of light on the rim.
                    shape.stroke(.white.opacity(0.14), lineWidth: 1).mask(alignment: .bottom) {
                        Rectangle().frame(height: 34)
                    }
                }
                .background(GlassShadow(shape: shape, color: ClassPageInk.shade.opacity(0.25), radius: 16, y: 12))
                .frame(height: top + 50)
                .offset(y: -top)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The two fades the design lays over the scrolling sessions: one under the class card, so a card
/// leaving the top melts into the page, and one behind the tab bar.
struct ClassPageFade: View {
    enum Edge { case top, bottom }

    let edge: Edge
    let theme: ClassTheme

    var body: some View {
        switch edge {
        case .top:
            // `linear-gradient(rgb(topFade), rgba(topFade,0))`, 22 pt.
            LinearGradient(colors: [Color(theme.topFade), Color(theme.topFade, opacity: 0)], startPoint: .top, endPoint: .bottom)
                .frame(height: 22)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        case .bottom:
            // `linear-gradient(rgba(botFade,0), rgba(botFade,0.92) 60%)`, 130 pt from the bottom edge.
            LinearGradient(
                stops: [
                    .init(color: Color(theme.bottomFade, opacity: 0), location: 0),
                    .init(color: Color(theme.bottomFade, opacity: 0.92), location: 0.6),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 130)
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

/// One of the page's pills — a session's badge, a midterm's state: a glass capsule with a ring, an
/// icon and a word (`height:24; padding:0 10px 0 7px; font-size:11.5px; font-weight:800`).
struct ClassPageBadge: View {
    let text: String
    let icon: String
    let fill: Color
    let ring: Color
    let ink: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .appFont(11, weight: .bold)
                .accessibilityHidden(true)
            Text(text)
                .appFont(11.5, weight: .heavy)
                .lineLimit(1)
        }
        .foregroundStyle(ink)
        .padding(.leading, 7)
        .padding(.trailing, 10)
        .frame(minHeight: 24)
        .background(Capsule().fill(fill))
        .overlay(Capsule().strokeBorder(ring, lineWidth: 1))
        .fixedSize()
    }

    static func completed() -> ClassPageBadge {
        ClassPageBadge(
            text: "Completed", icon: "checkmark.circle.fill",
            fill: ClassPageInk.green.opacity(0.16), ring: ClassPageInk.green.opacity(0.35), ink: ClassPageInk.greenInk
        )
    }

    static func inProgress(_ text: String = "In progress", icon: String = "timelapse") -> ClassPageBadge {
        ClassPageBadge(
            text: text, icon: icon,
            fill: ClassPageInk.amber.opacity(0.16), ring: ClassPageInk.amber.opacity(0.40), ink: ClassPageInk.amberInk
        )
    }

    static func locked() -> ClassPageBadge {
        ClassPageBadge(
            text: "Locked", icon: "lock.fill",
            fill: .white.opacity(0.08), ring: .white.opacity(0.18), ink: .white.opacity(0.75)
        )
    }
}

extension ClassSubject {
    /// The class card's glyph. Math wears the app's `function` everywhere; Reading & Writing the
    /// design's open book.
    var classPageIcon: String { self == .math ? "function" : "book.fill" }
}

import SwiftUI
import UIKit
import MasterSATKit

// The owner's "Master SAT Home (animated)" look (mockups in `ios-redesign/mockups`, the kit in
// `kit/kit.css`), as tokens and small controls every restyled screen shares: Today first, then
// Practice & results, Words and the states. The Class tab (#322) started the look; its band and
// colours live in `ClassTabChrome.swift` and are reused, not copied.
//
// Light mode is the kit to the unit. Dark mode keeps the kit's hues on a navy ground, as the
// Class tab does — the design has no dark version yet.

// MARK: - Colours

enum NewLook {
    /// `--page` #F2F4F9: the grey-blue every tab root and pushed page sits on.
    static let page = dynamic(light: 0xF2F4F9, dark: 0x0C111D)
    /// `--sheet` #F5F7FB: a bottom sheet's ground.
    static let sheet = dynamic(light: 0xF5F7FB, dark: 0x111827)
    /// `--card` #FFFFFF.
    static let card = dynamic(light: 0xFFFFFF, dark: 0x1A2133)
    /// `--line` #EEF1F6: hairlines inside a card.
    static let line = dynamic(light: 0xEEF1F6, dark: 0x273049)
    /// `--field` #E6EAF2: an input's border.
    static let field = dynamic(light: 0xE6EAF2, dark: 0x2C354D)
    static let grabber = dynamic(light: 0xCFD5E0, dark: 0x3A4459)
    /// `--dots` #C6CDDA: the three dots between two runs of a board.
    static let dots = dynamic(light: 0xC6CDDA, dark: 0x4A5470)

    /// `--ink` #0E1424 and its lighter steps.
    static let ink = dynamic(light: 0x0E1424, dark: 0xF2F4F9)
    static let ink2 = dynamic(light: 0x33405A, dark: 0xD5DBE6)
    static let ink4 = dynamic(light: 0x4E5B75, dark: 0xB4BCCB)
    /// `--muted` #7A8396: captions, caps labels.
    static let muted = dynamic(light: 0x7A8396, dark: 0x8F98AB)
    /// `.lrow .chev` #B4BCCB.
    static let chevron = dynamic(light: 0xB4BCCB, dark: 0x5C667D)

    /// `--blue` #2A68C0: fills (buttons, the open tab, medals). The band is `ClassTabPalette.band`.
    static let blue = dynamic(light: 0x2A68C0, dark: 0x3573CF)
    /// Blue as text: the fill's blue on paper, a lighter step at night so it reads on navy.
    static let blueText = dynamic(light: 0x2A68C0, dark: 0x8AB0F0)
    /// `--blue-deep` #1F57A8: text on a blue tint.
    static let blueDeep = dynamic(light: 0x1F57A8, dark: 0xA9C4F3)
    /// `--blue-50` #E7EEF9: tiles, tints, the student's own row.
    static let blue50 = dynamic(light: 0xE7EEF9, dark: 0x203052)
    static let blueRing = Color(RGB(hex: 0x5D8FDB))

    static let bronze = Color(RGB(hex: 0x9A6432))
    static let bronzeRing = Color(RGB(hex: 0xC2915F))
    static let bronze50 = dynamic(light: 0xF3E9DF, dark: 0x3A2B1E)
    static let bronzeInk = dynamic(light: 0x6B4220, dark: 0xE6C29C)

    static let orange = Color(RGB(hex: 0xFF8A00))
    static let orangeRing = Color(RGB(hex: 0xFFB55C))
    static let orange50 = dynamic(light: 0xFFF0DA, dark: 0x3D2A12)
    static let orangeInk = dynamic(light: 0xC25700, dark: 0xFFB55C)

    static let green = Color(RGB(hex: 0x1E9E5A))
    static let green50 = dynamic(light: 0xE3F6EA, dark: 0x173A29)
    static let greenInk = dynamic(light: 0x12753A, dark: 0x74D6A0)

    static let red = Color(RGB(hex: 0xE0302A))
    static let red50 = dynamic(light: 0xFFE8E5, dark: 0x3F1D1B)
    static let redInk = dynamic(light: 0xAE3D27, dark: 0xFF9A8A)

    static let violet = Color(RGB(hex: 0x6A4BC4))
    static let violet50 = dynamic(light: 0xECE6FB, dark: 0x2C2449)
    static let teal = Color(RGB(hex: 0x139A74))
    static let teal50 = dynamic(light: 0xDBF2EC, dark: 0x163A33)
    static let sky = Color(RGB(hex: 0x0484C9))
    static let sky50 = dynamic(light: 0xDDF0FA, dark: 0x14303F)

    /// The rank pills of a board's first three.
    static let gold50 = dynamic(light: 0xFFE7A3, dark: 0x4A3B12)
    static let goldInk = dynamic(light: 0x7A4F00, dark: 0xF6D27A)
    static let silver50 = dynamic(light: 0xE5E9F0, dark: 0x2E3546)
    static let silverInk = dynamic(light: 0x4E5A6B, dark: 0xC7CED9)
    static let copper50 = dynamic(light: 0xF7DCC8, dark: 0x45291A)
    static let copperInk = dynamic(light: 0x7E431B, dark: 0xF0B791)

    /// A tile's tint and its glyph's colour, by name — the kit's `.tile-ic.<tone>`.
    enum Tone: Sendable {
        case blue, bronze, orange, green, violet, teal, sky, red

        var fill: Color {
            switch self {
            case .blue: NewLook.blue50
            case .bronze: NewLook.bronze50
            case .orange: NewLook.orange50
            case .green: NewLook.green50
            case .violet: NewLook.violet50
            case .teal: NewLook.teal50
            case .sky: NewLook.sky50
            case .red: NewLook.red50
            }
        }

        var glyph: Color {
            switch self {
            case .blue: NewLook.blueText
            case .bronze: NewLook.bronze
            case .orange: NewLook.orange
            case .green: NewLook.green
            case .violet: NewLook.violet
            case .teal: NewLook.teal
            case .sky: NewLook.sky
            case .red: NewLook.red
            }
        }
    }

    fileprivate static func dynamic(light: Int, dark: Int) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

// MARK: - Shadows and surfaces

/// The kit's shadows, each two layers of the design's navy `rgba(14,36,80,…)`.
enum NewLookShadow {
    /// `--sh-card`: stat cards, list cards.
    case card
    /// `--sh-tile`: service tiles, flat cards.
    case tile
    /// `--sh-shop`: the Shop rail's cards.
    case shop
    /// `--sh-pop`: a floating window.
    case pop
    /// `--sh-blue`: a blue button.
    case blue

    fileprivate var layers: (near: (Double, CGFloat, CGFloat), far: (Double, CGFloat, CGFloat)) {
        switch self {
        case .card: ((0.05, 1, 1), (0.10, 14, 10))
        case .tile: ((0.04, 1, 1), (0.06, 12, 8))
        case .shop: ((0.04, 1, 1), (0.07, 8, 6))
        case .pop: ((0.06, 3, 2), (0.20, 28, 24))
        case .blue: ((0, 0, 0), (0.30, 6, 4))
        }
    }
}

private let shadowNavy = Color(.sRGB, red: 14 / 255, green: 36 / 255, blue: 80 / 255)
private let shadowBlue = Color(.sRGB, red: 42 / 255, green: 104 / 255, blue: 192 / 255)

extension View {
    /// One of the kit's shadows. CSS blur is twice SwiftUI's radius, so the radii are halved.
    func newLookShadow(_ shadow: NewLookShadow) -> some View {
        let tone = shadow == .blue ? shadowBlue : shadowNavy
        let layers = shadow.layers
        return self
            .shadow(color: tone.opacity(layers.near.0), radius: layers.near.1, y: layers.near.2)
            .shadow(color: tone.opacity(layers.far.0), radius: layers.far.1, y: layers.far.2)
    }

    /// The kit's `.card`: white, r20, p14, `--sh-card`, the full width. `radius` 24 is `.card.lg`
    /// and `.card.soft`; `fill` picks the soft blue for the latter.
    func newLookCard(
        padding: CGFloat = 14,
        radius: CGFloat = 20,
        fill: Color = NewLook.card,
        shadow: NewLookShadow = .card
    ) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .newLookShadow(shadow)
    }
}

// MARK: - Type

extension View {
    /// `.cap`: 10.5 pt, bold, tracked 0.1 em, upper case, muted.
    func newLookCaps(_ color: Color = NewLook.muted) -> some View {
        self
            .appFont(10.5, weight: .bold)
            .tracking(1.05)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

/// A section's heading row — `.h-section` (Archivo 19) with an optional count bubble and a
/// trailing action ("See all").
struct NewLookSectionHeader: View {
    let title: String
    var count: Int?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        // At the accessibility sizes the action drops under the heading rather than squeezing it.
        AdaptiveStack(spacing: 9, columnSpacing: 4) {
            HStack(spacing: 8) {
                Text(title)
                    .appDisplayFont(19)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
                    .accessibilityAddTraits(.isHeader)
                    .layoutPriority(1)
                if let count {
                    Text(String(count))
                        .appFont(12, weight: .heavy)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .fixedSize()
                        .frame(minWidth: 22, minHeight: 22)
                        .padding(.horizontal, 4)
                        .background(NewLook.blue, in: Capsule())
                        .accessibilityLabel("\(count) to do")
                }
            }
            AdaptiveSpacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .appFont(14, weight: .bold)
                    .foregroundStyle(NewLook.blueText)
                    .buttonStyle(.plain)
                    .hitTarget(44)
            }
        }
        .padding(.horizontal, 2)
    }
}

// MARK: - Tiles, chips, the date shield

/// `.tile-ic`: a 44-pt r14 tinted square with one SF Symbol (34 pt r11 when `small`).
struct NewLookTile: View {
    let systemName: String
    var tone: NewLook.Tone = .blue
    var small = false

    private var side: CGFloat { small ? 34 : 44 }

    var body: some View {
        RoundedRectangle(cornerRadius: small ? 11 : 14, style: .continuous)
            .fill(tone.fill)
            .frame(width: side, height: side)
            .overlay {
                Image(systemName: systemName)
                    .font(.system(size: small ? 16 : 20, weight: .semibold))
                    .foregroundStyle(tone.glyph)
            }
            .accessibilityHidden(true)
    }
}

/// `.chip.sm` and friends: a small capsule with an optional glyph.
struct NewLookChip: View {
    enum Style { case blue, orange, green, red, gray, white }

    let text: String
    var systemImage: String?
    var style: Style = .gray
    var small = true

    private var colors: (fill: Color, text: Color, glyph: Color) {
        switch style {
        case .blue: (NewLook.blue50, NewLook.blueDeep, NewLook.blueText)
        case .orange: (NewLook.orange50, NewLook.orangeInk, NewLook.orange)
        case .green: (NewLook.green50, NewLook.greenInk, NewLook.green)
        case .red: (NewLook.red50, NewLook.redInk, NewLook.red)
        case .gray: (NewLook.line, NewLook.ink4, NewLook.muted)
        case .white: (NewLook.card, NewLook.ink2, NewLook.blueText)
        }
    }

    var body: some View {
        HStack(spacing: small ? 3 : 5) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: small ? 10 : 13, weight: .bold))
                    .foregroundStyle(colors.glyph)
                    .accessibilityHidden(true)
            }
            Text(text)
                .appFont(small ? 12 : 13, weight: .bold)
                .foregroundStyle(colors.text)
                .lineLimit(1)
        }
        .padding(.leading, systemImage == nil ? 9 : 7)
        .padding(.trailing, 9)
        .frame(minHeight: small ? 24 : 32)
        .background(colors.fill, in: Capsule())
        .fixedSize()
    }
}

/// `.shield`: the date badge (OCT / 27) — the event invitation, the Daily Challenge.
struct DateShield: View {
    let date: Date
    var tone: Color = NewLook.blue
    var calendar: Calendar = ServicesTime.calendar

    private var month: String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMM")
        return f.string(from: date).uppercased()
    }

    var body: some View {
        VStack(spacing: 1) {
            Text(month)
                .appDisplayFont(8.5)
                .tracking(1.2)
                .opacity(0.85)
            Text(String(calendar.component(.day, from: date)))
                .appDisplayFont(19, monospacedDigits: true)
                .tracking(-0.4)
        }
        .foregroundStyle(.white)
        .padding(.bottom, 4)
        .frame(width: 42, height: 48)
        .background(tone, in: ShieldShape())
        .shadow(color: tone.opacity(0.25), radius: 5, y: 4)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityHidden(true)
    }
}

/// The shield's outline: square shoulders, a rounded point — the kit's
/// `border-radius: 5px 5px 50% 50% / 5px 5px 44% 44%`.
struct ShieldShape: Shape {
    func path(in rect: CGRect) -> Path {
        let corner: CGFloat = 5
        let curveTop = rect.minY + rect.height * 0.56
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + corner))
        path.addQuadCurve(to: CGPoint(x: rect.minX + corner, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - corner, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + corner), control: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: curveTop))
        path.addCurve(
            to: CGPoint(x: rect.midX, y: rect.maxY),
            control1: CGPoint(x: rect.maxX, y: rect.maxY - rect.height * 0.14),
            control2: CGPoint(x: rect.midX + rect.width * 0.28, y: rect.maxY)
        )
        path.addCurve(
            to: CGPoint(x: rect.minX, y: curveTop),
            control1: CGPoint(x: rect.midX - rect.width * 0.28, y: rect.maxY),
            control2: CGPoint(x: rect.minX, y: rect.maxY - rect.height * 0.14)
        )
        path.closeSubpath()
        return path
    }
}

// MARK: - Buttons

/// The kit's `.btn`: a blue pill with its shadow, and the variants every screen uses.
struct NewLookButtonStyle: ButtonStyle {
    enum Kind { case primary, light, tint, ghost, green, danger }
    enum Size {
        /// `.btn`: 40 pt.
        case regular
        /// `.btn.block`: the full width, 46 pt.
        case block
        /// `.btn.block.lg`: the full width, 52 pt.
        case large
    }

    var kind: Kind = .primary
    var size: Size = .regular

    @Environment(\.isEnabled) private var isEnabled

    private var height: CGFloat {
        switch size {
        case .regular: 40
        case .block: 46
        case .large: 52
        }
    }

    private var fill: Color {
        guard isEnabled || kind == .ghost else { return Color(RGB(hex: 0xDCE2EC)) }
        switch kind {
        case .primary: return NewLook.blue
        case .light: return NewLook.card
        case .tint: return NewLook.blue50
        case .ghost: return .clear
        case .green: return NewLook.green
        case .danger: return NewLook.red50
        }
    }

    private var text: Color {
        guard isEnabled else { return Color(RGB(hex: 0x9AA3B4)) }
        switch kind {
        case .primary, .green: return .white
        case .light, .ghost: return NewLook.blueText
        case .tint: return NewLook.blueDeep
        case .danger: return NewLook.red
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(size == .large ? 17 : (size == .block ? 16 : 15), weight: .bold)
            .foregroundStyle(text)
            .padding(.horizontal, size == .large ? 22 : 18)
            .frame(maxWidth: size == .regular ? nil : .infinity, minHeight: height)
            .background(fill.opacity(configuration.isPressed ? 0.85 : 1), in: Capsule())
            .modifier(ButtonShadow(kind: kind, enabled: isEnabled))
            .contentShape(Capsule())
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.96)
    }
}

private struct ButtonShadow: ViewModifier {
    let kind: NewLookButtonStyle.Kind
    let enabled: Bool

    func body(content: Content) -> some View {
        switch kind {
        case .primary where enabled:
            content.newLookShadow(.blue)
        case .green where enabled:
            content.shadow(color: NewLook.green.opacity(0.28), radius: 6, y: 4)
        case .light where enabled:
            content.shadow(color: shadowNavy.opacity(0.08), radius: 1, y: 1)
        default:
            content
        }
    }
}

// MARK: - Sheets

/// The kit's `.sheet-head`: a tile (or a shield), the sheet's title in Archivo 22, one line
/// under it, and either a round ✕ or a "Done" on the right.
struct NewLookSheetHeader<Badge: View>: View {
    let title: String
    var subtitle: String?
    var closeTitle: String?
    let onClose: (() -> Void)?
    @ViewBuilder let badge: () -> Badge

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            badge()
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .appDisplayFont(22)
                    .tracking(-0.4)
                    .foregroundStyle(NewLook.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .appFont(13, weight: .medium)
                        .foregroundStyle(NewLook.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            if let onClose {
                if let closeTitle {
                    Button(closeTitle, action: onClose)
                        .appFont(17, weight: .bold)
                        .foregroundStyle(NewLook.blueText)
                        .buttonStyle(.plain)
                        .hitTarget(44)
                } else {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(NewLook.ink4)
                            .frame(width: 34, height: 34)
                            .background(NewLook.line, in: Circle())
                            .hitTarget(44)
                    }
                    .buttonStyle(PressBounce())
                    .accessibilityLabel("Close")
                }
            }
        }
    }
}

/// The blue rounded square a sheet's header leads with (`.shield` with a glyph in the kit's
/// leaderboard sheet; a tile elsewhere).
struct NewLookBadge: View {
    let systemName: String
    var tone: Color = NewLook.blue

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 21, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.bottom, 4)
            .frame(width: 44, height: 50)
            .background(tone, in: ShieldShape())
            .shadow(color: tone.opacity(0.25), radius: 5, y: 4)
            .accessibilityHidden(true)
    }
}

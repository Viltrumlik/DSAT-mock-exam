import SwiftUI
import MasterSATKit

// The new look's Practice & results furniture (mockups 30–39): the pushed page's title block,
// the glass capsule the runner's bars borrow from the tab bar, the answer option (`.opt`), the
// small count box, the blue score card and the floating window (`.pop`). Tokens are
// `NewLook`'s; nothing here decides what a screen shows.

// MARK: - The pushed page's title

/// `.nav`'s title block on a pushed page: an optional blue caps eyebrow, the page name in
/// Archivo 28 (`.h-page`), and one muted line under it. The back button stays the system's.
struct NewLookPageTitle: View {
    let title: String
    var subtitle: String?
    var eyebrow: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let eyebrow {
                Text(eyebrow)
                    .newLookCaps(NewLook.blueText)
            }
            Text(title)
                .appDisplayFont(eyebrow == nil ? 28 : 24)
                .tracking(-0.6)
                .foregroundStyle(NewLook.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle)
                    .appFont(14, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Glass

extension View {
    /// The tab bar's glass, for the runner's bottom bar and its top pills (`.runbar`,
    /// `.pill-btn`, `.toolpill`): a frosted white capsule with a hairline and a soft navy shadow.
    func newLookGlassCapsule(lifted: Bool = false) -> some View {
        background {
            Capsule()
                .fill(.regularMaterial)
                .overlay(Capsule().fill(NewLook.card.opacity(0.55)))
                .overlay(Capsule().strokeBorder(NewLook.ink.opacity(0.07), lineWidth: 0.5))
                .shadow(
                    color: Color(.sRGB, red: 14 / 255, green: 36 / 255, blue: 80 / 255, opacity: lifted ? 0.14 : 0.07),
                    radius: lifted ? 15 : 5,
                    y: lifted ? 10 : 3
                )
        }
    }
}

// MARK: - The answer option

/// What an option says about itself. `picked` is the only state while answering; `right`,
/// `wrong` and `faded` belong to the review alone — the runner never says whether a pick is right.
enum NewLookOptionState: Equatable {
    case idle, picked, right, wrong, faded
}

/// `.opt .mk`: the option's letter in a 28-pt disc (scaled with the runner's zoom).
struct NewLookOptionMark: View {
    let letter: String
    let state: NewLookOptionState
    var scale: Double = 1

    private var colors: (fill: Color, ink: Color) {
        switch state {
        case .idle: (NewLook.blue50, NewLook.blueText)
        case .picked: (NewLook.blue, .white)
        case .right: (NewLook.green, .white)
        case .wrong: (NewLook.red, .white)
        case .faded: (NewLook.field, NewLook.muted)
        }
    }

    var body: some View {
        Text(letter)
            .font(.system(size: 13 * scale, weight: .heavy))
            .foregroundStyle(colors.ink)
            .frame(width: 28 * scale, height: 28 * scale)
            .background(colors.fill, in: Circle())
            .accessibilityHidden(true)
    }
}

extension View {
    /// `.opt`'s ground and ring: the sheet grey with a hairline while idle (`.optrow .opt`), a
    /// 2-pt blue ring when picked, green or red only on the review, flat grey when faded.
    func newLookOptionSurface(_ state: NewLookOptionState, radius: CGFloat = 16, idleFill: Color = NewLook.sheet) -> some View {
        let fill: Color
        let ring: Color
        let width: CGFloat
        switch state {
        case .idle: (fill, ring, width) = (idleFill, NewLook.field, 1)
        case .picked: (fill, ring, width) = (NewLook.optionPicked, NewLook.blue, 2)
        case .right: (fill, ring, width) = (NewLook.green50, NewLook.green, 2)
        case .wrong: (fill, ring, width) = (NewLook.red50, NewLook.red, 2)
        case .faded: (fill, ring, width) = (NewLook.sheet, .clear, 0)
        }
        return self
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(ring, lineWidth: width)
            )
    }
}

extension NewLook {
    /// `#F4F8FE`: a picked option's ground under its blue ring.
    static let optionPicked = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x1B / 255, green: 0x2A / 255, blue: 0x48 / 255, alpha: 1)
            : UIColor(red: 0xF4 / 255, green: 0xF8 / 255, blue: 0xFE / 255, alpha: 1)
    })
}

// MARK: - Count box

/// `.fact`: one count in a grey box — the hand-in window's answered · blank · flagged, the
/// error report's numbers. `alignment: .leading` gives the report's left-set box with a caption.
struct NewLookCountBox: View {
    let value: String
    let label: String
    var caption: String?
    var alignment: HorizontalAlignment = .center
    var fill: Color = NewLook.sheet

    var body: some View {
        VStack(alignment: alignment, spacing: alignment == .center ? 2 : 4) {
            if alignment == .leading {
                Text(label).newLookCaps()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Text(value)
                .appDisplayFont(alignment == .center ? 22 : 24, monospacedDigits: true)
                .foregroundStyle(NewLook.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if alignment == .center {
                Text(label).newLookCaps()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if let caption {
                Text(caption)
                    .appFont(12, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .center ? .center : .leading)
        .padding(.vertical, 10)
        .padding(.horizontal, alignment == .center ? 6 : 14)
        .background(fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The blue score card

extension View {
    /// The review's and the midterm report's score card, and the next-midterm countdown: the
    /// band's blue as a card on a pushed page (`.hero`), r26, with the drifting shield watermark.
    func newLookBlueCard(padding: EdgeInsets = EdgeInsets(top: 22, leading: 18, bottom: 18, trailing: 18)) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity)
            .background {
                ZStack(alignment: .topTrailing) {
                    LinearGradient(
                        colors: [ClassTabPalette.band, Color(RGB(hex: 0x1F57A8))],
                        startPoint: UnitPoint(x: 0.1, y: 0),
                        endPoint: UnitPoint(x: 0.9, y: 1)
                    )
                    ShieldWatermark()
                        .scaleEffect(210 / 270, anchor: .topTrailing)
                        .offset(x: 48, y: -18)
                }
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .shadow(color: Color(RGB(hex: 0x1F57A8)).opacity(0.28), radius: 14, y: 10)
            }
    }
}

/// A count inside the blue card (`.hero .tiles > div`): white on white-at-13 %.
struct NewLookBlueTile: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .appDisplayFont(24, monospacedDigits: true)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .appFont(11, weight: .bold)
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 10)
        .padding(.bottom, 9)
        .background(.white.opacity(0.13), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// A chip on the blue card (`.hero .up`, the subject and verdict chips): white on white-at-20 %.
struct NewLookBlueChip: View {
    let text: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
                    .accessibilityHidden(true)
            }
            Text(text).appFont(12.5, weight: .heavy)
        }
        .foregroundStyle(.white)
        .padding(.leading, systemImage == nil ? 11 : 8)
        .padding(.trailing, 11)
        .frame(minHeight: 26)
        .background(.white.opacity(0.2), in: Capsule())
    }
}

// MARK: - The floating window

extension View {
    /// The kit's `.dim` + `.pop`: a floating window over this view, in place of a system alert.
    /// The dim does not close it — the window's own buttons say what happens next. A fade (and a
    /// 0.96 scale unless Reduce Motion) in ≤ 250 ms; the same views either way.
    func newLookWindow<Window: View>(
        isPresented: Bool,
        @ViewBuilder window: @escaping () -> Window
    ) -> some View {
        modifier(NewLookWindowModifier(isPresented: isPresented, window: window))
    }
}

private struct NewLookWindowModifier<Window: View>: ViewModifier {
    let isPresented: Bool
    let window: () -> Window
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .accessibilityHidden(isPresented)
            .overlay {
                ZStack {
                    if isPresented {
                        Color(.sRGB, red: 10 / 255, green: 22 / 255, blue: 50 / 255, opacity: 0.36)
                            .ignoresSafeArea()
                            .contentShape(Rectangle())
                            .accessibilityHidden(true)
                            .transition(.opacity)
                        window()
                            .padding(18)
                            .frame(maxWidth: 440)
                            .newLookSurface(NewLook.card, radius: 26, shadow: .pop)
                            .padding(.horizontal, 18)
                            .accessibilityAddTraits(.isModal)
                            .transition(reduceMotion ? .opacity : .scale(scale: 0.96).combined(with: .opacity))
                    }
                }
                .animation(reduceMotion ? Motion.focus : .easeOut(duration: 0.22), value: isPresented)
            }
    }
}

// MARK: - The focus shell's pills

/// `.pill-btn`: a 44-pt glass pill on a focus screen — the runner's "Save and exit", the live
/// quiz's "Back".
struct NewLookPillLabel: View {
    let title: String
    let systemImage: String
    var tint: Color = NewLook.blueText

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .bold))
                .accessibilityHidden(true)
            Text(title)
                .appFont(15, weight: .bold)
                .lineLimit(1)
        }
        .foregroundStyle(tint)
        .padding(.leading, 12)
        .padding(.trailing, 16)
        .frame(minHeight: 44)
        .newLookGlassCapsule()
        .contentShape(Capsule())
    }
}

/// A label with its icon after the title — "Next ›".
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon
        }
    }
}

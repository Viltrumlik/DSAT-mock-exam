import SwiftUI
import MasterSATKit

// Pieces of the new look the Words pages (mockups 40–48) brought, kept general so any pushed page
// can use them: a pushed page's big heading, the grey fact tile with its carved glyph, the tone
// edge along a card's top, the white glass pill a full-screen page leads with, and a filled
// button in any colour.

/// `.h-page` on a pushed page: the page's name in Archivo 28 under the system's back button,
/// one muted line under it. The navigation bar keeps no title of its own.
struct NewLookPageHeading: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .appDisplayFont(28)
                .tracking(-0.6)
                .foregroundStyle(NewLook.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .appFont(15, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 2)
    }
}

/// `.fact` / `.ftile`: a caps label and a number in Archivo on the sheet grey, a big outline
/// glyph carved into the corner. `detail` — a second fact, never the number again — sits on the
/// right in the `.row` layout (the section page) and is absent from the `.stacked` one (the set
/// page's 2×2 grid).
struct NewLookFactTile: View {
    enum Layout { case row, stacked }

    let label: String
    let value: String
    var valueColor: Color = NewLook.ink
    var detail: String?
    var carve: String?
    var layout: Layout = .stacked

    var body: some View {
        Group {
            switch layout {
            case .row:
                HStack(alignment: .center, spacing: 14) {
                    figure(size: 26)
                    Spacer(minLength: 0)
                    if let detail {
                        Text(detail)
                            .appFont(12, weight: .medium)
                            .foregroundStyle(NewLook.ink4)
                            .multilineTextAlignment(.trailing)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            case .stacked:
                figure(size: 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }
        }
        .background(NewLook.sheet)
        .overlay(alignment: .bottomTrailing) {
            if let carve {
                Image(systemName: carve)
                    .font(.system(size: layout == .row ? 52 : 44, weight: .light))
                    .foregroundStyle(NewLook.ink.opacity(0.05))
                    .offset(x: 6, y: 10)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func figure(size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .newLookCaps()
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .appDisplayFont(size, monospacedDigits: true)
                .tracking(-0.5)
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

/// `.edge::before`: a 4-pt band along a card's top, the tone fading to its tint by the middle and
/// to nothing at the right — the one mark of colour that still reads when the card is scrolled to
/// its title. Laid over the card and clipped by it.
struct NewLookToneEdge: View {
    let color: Color
    var height: CGFloat = 4

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: color, location: 0),
                .init(color: color.opacity(0.15), location: 0.55),
                .init(color: color.opacity(0), location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: height)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /// A white card (`.card`) with a tone edge along its top: the card's shape clips the edge, and
    /// the shadow stays on the shape.
    func newLookEdgedCard(_ tone: Color, padding: CGFloat = 14, radius: CGFloat = 20, shadow: NewLookShadow = .card) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NewLook.card)
            .overlay(alignment: .top) { NewLookToneEdge(color: tone) }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .background {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(NewLook.card)
                    .newLookShadow(shadow)
            }
    }
}

/// `.pill-btn`: the white glass pill a full-screen page leads with (a study session's Back).
struct NewLookPillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(15, weight: .semibold)
            .foregroundStyle(NewLook.ink2)
            .padding(.leading, 10)
            .padding(.trailing, 14)
            .frame(minWidth: 44, minHeight: 44)
            .background {
                Capsule()
                    .fill(NewLook.card.opacity(0.92))
                    .shadow(color: .black.opacity(0.07), radius: 1.5, y: 1)
                    .shadow(color: .black.opacity(0.06), radius: 5, y: 3)
            }
            .contentShape(Capsule())
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.96)
    }
}

/// `.btn.tone`: a filled pill in any colour — a game's own on its end screen, the test's green
/// Submit — white text, the colour's own soft shadow.
struct NewLookToneButtonStyle: ButtonStyle {
    let tone: Color
    var size: NewLookButtonStyle.Size = .large

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(size == .large ? 17 : 16, weight: .bold)
            .foregroundStyle(isEnabled ? Color.white : Color(RGB(hex: 0x9AA3B4)))
            .padding(.horizontal, 22)
            .frame(maxWidth: size == .regular ? nil : .infinity, minHeight: size == .large ? 52 : (size == .block ? 46 : 40))
            .background {
                Capsule()
                    .fill(isEnabled ? tone.opacity(configuration.isPressed ? 0.85 : 1) : Color(RGB(hex: 0xDCE2EC)))
                    .shadow(color: isEnabled ? tone.opacity(0.3) : .clear, radius: 6, y: 4)
            }
            .contentShape(Capsule())
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.96)
    }
}

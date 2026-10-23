import SwiftUI
import MasterSATKit

/// Settings › Appearance: the phone's setting, or always light, or always dark.
///
/// The website's Appearance section, as a phone draws it: three cards, each with a small picture
/// of the app in that look, the current one ringed and ticked. The change is made at once and the
/// page you are looking at changes with it, which is the preview that matters most.
///
/// The choice is the device's (`AppAppearance`): no request is made, and nothing here touches the
/// account.
struct AppearanceView: View {
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Taps that changed the choice. The haptic's trigger, not `appearance`: a write with no
    /// thumb on it must not tick.
    @State private var tapped = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AccountPageHeading(title: "Appearance", description: "How MasterSAT looks on this phone.")

                VStack(spacing: 12) {
                    ForEach(AppAppearance.allCases) { choice in
                        AppearanceChoiceCard(choice: choice, isCurrent: choice == appearance) {
                            choose(choice)
                        }
                    }
                }

                Text("Saved on this phone only. The website keeps its own look in each browser.")
                    .appFont(12.5, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.selection, trigger: tapped)
    }

    private func choose(_ choice: AppAppearance) {
        // A tap on the look already in place changes nothing, so it writes nothing.
        guard choice != appearance else { return }
        tapped += 1
        // One transaction for the ring, the tick and whatever re-colours with them: Reduce Motion
        // turns animation off for the whole change, it does not pick a gentler one.
        var swap = Transaction(animation: AppAppearance.swapAnimation(reduceMotion: reduceMotion))
        swap.disablesAnimations = reduceMotion
        withTransaction(swap) { appearance = choice }
    }
}

// MARK: - A choice

/// What each choice is called. The title is also what VoiceOver says, so the words on the card
/// and the words spoken cannot differ.
private extension AppAppearance {
    var title: String {
        switch self {
        case .system: "Use the phone's setting"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var hint: String {
        switch self {
        case .system: "Changes when your phone does"
        case .light: "Bright and clear"
        case .dark: "Easy on the eyes at night"
        }
    }

    var symbol: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max.fill"
        case .dark: "moon.fill"
        }
    }
}

private struct AppearanceChoiceCard: View {
    let choice: AppAppearance
    let isCurrent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                AppearanceSwatch(choice: choice)
                HStack(spacing: 12) {
                    // Beside the words while they share a line; above them at the accessibility
                    // sizes, where "Use the phone's setting" needs the card's whole width.
                    AdaptiveStack(spacing: 12, columnSpacing: 8) {
                        IconTile(systemName: choice.symbol, tone: Theme.subjectEnglish, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(choice.title)
                                .appFont(15, weight: .heavy)
                                .foregroundStyle(.primary)
                            Text(choice.hint)
                                .appFont(12.5, weight: .medium)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    AppearanceTick(isOn: isCurrent)
                }
            }
            .cardStyle(padding: 12)
            // The current card's ring. Always in the tree and faded in, so the change is a value
            // and not a view arriving: one chain whatever the setting.
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .strokeBorder(Theme.accent, lineWidth: 2)
                    .opacity(isCurrent ? 1 : 0)
                    .allowsHitTesting(false)
            }
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        }
        .buttonStyle(AppearanceChoiceStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(choice.title)
        .accessibilityHint(choice.hint)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

/// A card is large, so it dips a little on a press instead of squashing the way a pill does.
private struct AppearanceChoiceStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.97)
    }
}

/// The ring-and-tick at a choice's trailing edge: a filled disc with a check when current, an
/// empty ring when not. The check is faded, not removed, so nothing arrives or leaves the tree.
private struct AppearanceTick: View {
    let isOn: Bool

    var body: some View {
        Circle()
            .fill(isOn ? Theme.accent : Color.clear)
            .overlay(Circle().strokeBorder(Theme.accent.opacity(isOn ? 1 : 0.28), lineWidth: 2))
            .overlay {
                Image(systemName: "checkmark")
                    .appFont(11, weight: .heavy)
                    // Inside a 24-pt disc: a glyph that grew with the text would leave it.
                    .capDynamicType()
                    .foregroundStyle(.white)
                    .opacity(isOn ? 1 : 0)
            }
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
    }
}

// MARK: - The pictures

/// The small picture on a card: the app in that look. System shows both, light on the left and
/// dark on the right, the way the website's does.
private struct AppearanceSwatch: View {
    let choice: AppAppearance

    var body: some View {
        ZStack {
            switch choice {
            case .system:
                AppearancePicture(scheme: .light)
                // The dark copy lies over the light one, kept to its right half, so the two halves
                // line up as one picture.
                AppearancePicture(scheme: .dark)
                    .mask {
                        HStack(spacing: 0) {
                            Color.clear
                            Color.black
                        }
                    }
            case .light:
                AppearancePicture(scheme: .light)
            case .dark:
                AppearancePicture(scheme: .dark)
            }
        }
        .frame(height: 92)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        // The light picture sits on a light card; this is its edge.
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Theme.separator.opacity(0.7), lineWidth: 1)
        )
        .accessibilityHidden(true)
    }
}

/// A miniature of a page of the app — a headline, a card with a tile and a pill, three small
/// figures — drawn from the app's own tokens in a scheme it is told, not the one the phone is in.
/// The picture has to look light while the app around it is dark, and the other way round.
private struct AppearancePicture: View {
    let scheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Capsule().fill(Color.primary).frame(width: 72, height: 6)
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(Theme.accentSoft)
                    .frame(width: 16, height: 16)
                VStack(alignment: .leading, spacing: 3) {
                    Capsule().fill(Color.primary).frame(width: 88, height: 4)
                    Capsule().fill(Theme.textLabel).frame(width: 54, height: 3)
                }
                Spacer(minLength: 0)
                Capsule().fill(Theme.accent).frame(width: 24, height: 9)
            }
            .padding(6)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            HStack(spacing: 5) {
                figure(Theme.accent)
                figure(Theme.success)
                figure(Theme.amber)
            }
            .frame(maxHeight: .infinity)
        }
        .padding(9)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background)
        // Outside the background, so that the page colour is resolved in this scheme too.
        .environment(\.colorScheme, scheme)
    }

    private func figure(_ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(tint).frame(width: 6, height: 6)
            Capsule().fill(tint).frame(width: 26, height: 4)
            Spacer(minLength: 0)
        }
        .padding(5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

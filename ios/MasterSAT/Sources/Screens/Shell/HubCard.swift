import SwiftUI
import MasterSATKit

/// A card that opens a page: tile, title, one line, an optional second line, an optional
/// count, a chevron.
///
/// The second line is what a live card adds under its one line ("Open now: Quadratics"); a card
/// with nothing live to say leaves it out and is the plain card it always was. The words swap
/// with a fade, not a slide, and the animation that carries them is the screen's — a card
/// resizes and its neighbours move, which only the container holding all of them can animate
/// together.
struct HubCard<Route: Hashable>: View {
    let title: String
    let subtitle: String
    var detail: String?
    let icon: String
    let tone: Color
    var count: Int?
    /// What the count counts, said after the number to VoiceOver ("open for sign-up"). Without
    /// it a bare "2" is all it hears.
    var countMeaning: String?
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            // The count and the chevron go under the words at the accessibility sizes, where beside
            // them they would leave the title a column a few letters wide.
            AdaptiveStack(spacing: 14, columnSpacing: 10) {
                IconTile(systemName: icon, tone: tone, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .appFont(16, weight: .heavy, design: .rounded)
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .appFont(13, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                        .contentTransition(.opacity)
                    if let detail {
                        Text(detail)
                            .appFont(13, weight: .semibold)
                            // Text, not a fill: the brand blue is about 3.6:1 on a dark card.
                            .foregroundStyle(Theme.accentText)
                            .multilineTextAlignment(.leading)
                            .contentTransition(.opacity)
                            .transition(.opacity)
                    }
                }
                AdaptiveSpacer()
                HStack(spacing: 14) {
                    // Zero is not shown: no badge says "nothing waiting" better than a grey 0.
                    if let count, count > 0 {
                        Text(ScoreText.string(count))
                            .appFont(12, weight: .heavy, design: .rounded, monospacedDigits: true)
                            .foregroundStyle(tone)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(tone.opacity(0.13)))
                            .contentTransition(.numericText(value: Double(count)))
                    }
                    Image(systemName: "chevron.right")
                        .appFont(13, weight: .bold)
                        .foregroundStyle(Theme.textLabel)
                }
            }
            .cardStyle()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressBounce())
        // One button: the lines read in order, not as separate stops, and the count says what it
        // counts.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityAddTraits(.isButton)
    }

    /// "Events. Your ticket: Open day. Tue, 28 Oct, Ticket 4K29. 2 open for sign-up."
    private var spokenLabel: String {
        var parts = [title, subtitle]
        if let detail { parts.append(detail) }
        if let count, count > 0 {
            let number = ScoreText.string(count)
            parts.append(countMeaning.map { "\(number) \($0)" } ?? number)
        }
        // Each part is a sentence of its own, so a full stop it already carries is not doubled.
        let sentences = parts.map { $0.hasSuffix(".") ? String($0.dropLast()) : $0 }
        // Separators are read as pauses, here only: the card still shows its "·".
        return sentences.joined(separator: ". ").spokenSeparators + "."
    }
}

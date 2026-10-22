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
            HStack(spacing: 14) {
                IconTile(systemName: icon, tone: tone, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                        .contentTransition(.opacity)
                    if let detail {
                        Text(detail)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                            .multilineTextAlignment(.leading)
                            .contentTransition(.opacity)
                            .transition(.opacity)
                    }
                }
                Spacer(minLength: 0)
                // Zero is not shown: no badge says "nothing waiting" better than a grey 0.
                if let count, count > 0 {
                    Text(ScoreText.string(count))
                        .font(.system(size: 12, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundStyle(tone)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(tone.opacity(0.13)))
                        .contentTransition(.numericText(value: Double(count)))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
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

import SwiftUI
import MasterSATKit

// Small reward pieces for other screens to carry.

// MARK: - What the numbers are

/// The sentences behind the "!" beside XP, points and strikes on the web's dashboard and
/// profile (`features/rewards/explainers.tsx`), shared so a rule is never true in one place and
/// stale in the other.
///
/// **The word is STRIKE, not streak.** The streak is the run of lessons underneath; the strikes
/// are what that run has earned and not yet spent. They are different numbers the moment a
/// student buys anything.
enum RewardsExplainer: String, CaseIterable, Identifiable {
    case xp, points, strike

    var id: String { rawValue }

    var title: String {
        switch self {
        case .xp: return "What XP is"
        case .points: return "Points and coins"
        case .strike: return "What a strike is"
        }
    }

    /// Markdown — the strike explainer bolds "present or late", as the web does.
    var text: String {
        switch self {
        case .xp:
            return "XP is the record of what you have done, and it is never spent — it only adds up. Most rules pay XP alongside points; the rewards page says which ones. Scoring badly never costs you XP. The only thing that takes it back is a corrected record, such as a lesson marked present and later changed to absent."
        case .points:
            return "Points are the half you spend. You turn them into coins yourself, on the rewards page — it does not happen on its own — and coins are what the coin shop takes. Unlike strikes, coins keep: missing a lesson does not touch them. XP keeps counting either way, so spending never costs you position."
        case .strike:
            return "Every lesson you attend in your current run earns one strike — **present or late** both count. Strikes are what the Strike shop takes. They do not keep: one missed lesson ends the run, an excused absence included, and the strikes go with it. Coins are the half that keeps."
        }
    }
}

/// The "!" itself: a small button that opens the explainer in a popover beside it.
struct RewardsExplainButton: View {
    let explainer: RewardsExplainer

    @State private var shown = false

    var body: some View {
        Button {
            shown = true
        } label: {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(explainer.title)
        .popover(isPresented: $shown) {
            VStack(alignment: .leading, spacing: 8) {
                Text(explainer.title)
                    .font(.system(size: 15, weight: .heavy))
                Text(LocalizedStringKey(explainer.text))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(width: 300, alignment: .leading)
            .presentationCompactAdaptation(.popover)
        }
    }
}

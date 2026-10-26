import SwiftUI
import MasterSATKit

// Small reward pieces for other screens to carry — the Me sheet's four figures use these.

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
    /// The words beside the glyph, for a place with room for them — the strikes window says
    /// "What a strike is" in full, where a tile's corner can only hold the mark. Nil, and the
    /// button is the bare glyph it has always been, so every existing call site is untouched.
    var title: String?

    @State private var shown = false

    var body: some View {
        Button {
            shown = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.circle")
                    .appFont(14, weight: .semibold)
                    // The glyph is capped even in the titled case, where the button as a whole is
                    // not: `frame` does not clip, so a 14-pt symbol rendering near 35 pt at AX5
                    // grew straight out of its 28-pt square and into the title beside it. A no-op
                    // for the bare-glyph call sites, which the cap below already holds here.
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .frame(width: 28, height: 28)
                if let title {
                    Text(title).appFont(12, weight: .semibold)
                }
            }
            .foregroundStyle(Theme.textSecondary)
            // Drawn small in its tile's corner; reached like any other button.
            .hitTarget(44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(explainer.title)
        // A glyph in a fixed 28-pt square cannot grow, so it is held still and shown large on a
        // long press (`capDynamicType`, spelled out here). With words beside it there is a line
        // that can wrap instead, and capping those would be holding back type a student asked to
        // be larger — so only the TEXT is let go here; the glyph keeps its own cap, above.
        .dynamicTypeSize(...(title == nil ? DynamicTypeSize.xxxLarge : .accessibility5))
        .accessibilityShowsLargeContentViewer {
            Label(explainer.title, systemImage: "exclamationmark.circle")
        }
        // After the cap, so the explainer's own words still grow with the phone's setting —
        // and scroll, at the largest sizes, rather than run off the popover.
        .popover(isPresented: $shown) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(explainer.title)
                        .appFont(15, weight: .heavy)
                        .accessibilityAddTraits(.isHeader)
                    Text(LocalizedStringKey(explainer.text))
                        .appFont(13, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(width: 300)
            .presentationCompactAdaptation(.popover)
        }
    }
}

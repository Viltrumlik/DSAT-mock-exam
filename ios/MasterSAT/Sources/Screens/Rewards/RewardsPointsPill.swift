import SwiftUI
import MasterSATKit

// Small reward pieces for other screens to carry — Home's header, Profile's tiles.

// MARK: - The points pill

/// The site's header pill: the silver point and the points, a divider, the blue coin and the
/// coins. A dash while it loads and if it fails — it stays a way in to the Points page either
/// way, which vanishing would not be.
///
/// Display only. `RewardsPointsPill` is the one that fetches.
struct RewardsPointsPillLabel: View {
    let points: Int?
    let coins: Int?

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                RewardsCoinArt(kind: .point, size: 20)
                Text(ScoreText.string(points))
            }
            Rectangle()
                .fill(Theme.separator)
                .frame(width: 1, height: 16)
            HStack(spacing: 5) {
                RewardsCoinArt(kind: .coin, size: 20)
                Text(ScoreText.string(coins))
            }
        }
        .font(.system(size: 14, weight: .bold).monospacedDigit())
        .foregroundStyle(.primary)
        .padding(.horizontal, 10)
        .frame(height: 36)
        .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 3, x: 0, y: 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(points == nil ? "Points and coins" : "\(points ?? 0) points, \(coins ?? 0) coins")
    }
}

/// The pill, reading `/rewards/me/` itself. Wrap it in a link to `PointsView()` where it
/// should open the Points page, as the web's does:
///
///     NavigationLink { PointsView() } label: { RewardsPointsPill() }
///
/// Refetched every time it appears, so a conversion on the Points page is on the pill when the
/// student comes back. A failed refresh keeps the last numbers it had.
struct RewardsPointsPill: View {
    @Environment(Session.self) private var session
    @State private var mine: MyRewards?

    var body: some View {
        RewardsPointsPillLabel(points: mine?.points, coins: mine?.coins)
            .onAppear { Task { await load() } }
    }

    @MainActor
    private func load() async {
        if let fresh = try? await session.rewards.me() {
            mine = fresh
        }
    }
}

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

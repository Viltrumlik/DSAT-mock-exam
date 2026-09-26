import SwiftUI
import MasterSATKit

/// The Rewards tab: the three reward pages, each behind a card that already says the number a
/// student opens it for — where they stand, what they have, what they can spend.
///
/// A tab root, so it owns its `NavigationStack` and may hide the bar; the pages it pushes keep
/// theirs, because on a pushed screen that bar carries the only Back button there is. Pushes
/// are `NavigationLink { … } label:` — nothing here pushes by value.
///
/// Two requests feed the cards: `/rewards/me/` (points, coins, XP, strikes) and the default
/// leaderboard (global, all time) — the same slice and the same `standing` rule the
/// Leaderboard page opens on, so the card and the page can never show two different ranks.
/// Reloaded every time the tab appears, so a conversion or a purchase made one level down is
/// on the card when the student comes back.
struct RewardsHubView: View {
    @Environment(Session.self) private var session

    @State private var mine: MyRewards?
    @State private var meFailed = false
    @State private var board: LeaderboardBoard?
    @State private var boardFailed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PageTitle("Rewards")

                    // The cards stay and keep working when a total fails — each page loads and
                    // explains itself — but the failure is said, not left as a row of dashes.
                    if meFailed {
                        RewardsErrorState(
                            title: "Points aren't loading right now.",
                            message: "Nothing has been lost — the page just couldn't fetch your total."
                        ) { await load() }
                        .cardStyle(padding: 8)
                    } else if boardFailed {
                        RewardsErrorState(
                            title: "The leaderboard isn't loading right now.",
                            message: "Your XP is safe — only this list failed to load."
                        ) { await load() }
                        .cardStyle(padding: 8)
                    }

                    NavigationLink {
                        LeaderboardView()
                    } label: {
                        RewardsHubCard(
                            title: "Leaderboard",
                            subtitle: "Ranked on XP — what you earn by turning up and doing the work.",
                            icon: "trophy.fill",
                            tone: Theme.amber,
                            stats: leaderboardStats
                        )
                    }
                    .buttonStyle(.plain)

                    NavigationLink {
                        PointsView()
                    } label: {
                        RewardsHubCard(
                            title: "Points",
                            subtitle: "What you've earned for showing up and doing the work.",
                            icon: "sparkles",
                            tone: Theme.accent,
                            stats: pointsStats
                        )
                    }
                    .buttonStyle(.plain)

                    NavigationLink {
                        ShopView()
                    } label: {
                        RewardsHubCard(
                            title: "Shop",
                            subtitle: "Spend what you've earned. Coins keep; strikes don't — miss a lesson and they're gone.",
                            icon: "bag.fill",
                            tone: Theme.success,
                            stats: shopStats
                        )
                    }
                    .buttonStyle(.plain)
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Rewards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await load() }
            .onAppear { Task { await load() } }
        }
    }

    // MARK: - The numbers on the cards

    /// A dash, never a zero, whenever the answer is not in — while loading and after a failure.
    private func number(_ value: Int?) -> String { ScoreText.string(value) }

    private var standing: LeaderboardRow? { boardFailed ? nil : board?.standing }

    private var leaderboardStats: [RewardsHubStat] {
        [
            RewardsHubStat(
                label: "Your rank",
                value: standing.map { "#\($0.rank)" } ?? "—",
                media: .symbol(standing?.rank == 1 ? "crown.fill" : "trophy.fill", RewardsPalette.gold.solid)
            ),
            // The board's figure where the student is on it, so the card agrees with the page;
            // the wallet's otherwise — a student with no XP yet has no row, but does have a 0.
            RewardsHubStat(
                label: "XP",
                value: number(standing?.xp ?? (meFailed ? nil : mine?.xp)),
                media: .symbol("bolt.fill", Theme.accent)
            ),
        ]
    }

    private var pointsStats: [RewardsHubStat] {
        let r = meFailed ? nil : mine
        return [
            RewardsHubStat(label: "Points", value: number(r?.points), media: .art(.point)),
            RewardsHubStat(label: "Coins", value: number(r?.coins), media: .art(.coin)),
            RewardsHubStat(label: "XP", value: number(r?.xp), media: .symbol("bolt.fill", Theme.accent)),
        ]
    }

    private var shopStats: [RewardsHubStat] {
        let r = meFailed ? nil : mine
        return [
            RewardsHubStat(label: "Coins to spend", value: number(r?.coins), media: .art(.coin)),
            // The same `strikes.state` the storefront reads, so the two cannot disagree.
            RewardsHubStat(label: "Strikes", value: number(r?.strikes), media: .symbol("flame.fill", Theme.amber)),
        ]
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let me: Void = loadMe()
        async let theBoard: Void = loadBoard()
        _ = await (me, theBoard)
    }

    @MainActor
    private func loadMe() async {
        let api = session.rewards
        do {
            mine = try await api.me()
            meFailed = false
        } catch {
            meFailed = true
        }
    }

    @MainActor
    private func loadBoard() async {
        let api = LeaderboardAPI(client: session.client)
        do {
            board = try await api.board(LeaderboardQuery())
            boardFailed = false
        } catch {
            boardFailed = true
        }
    }
}

// MARK: - Card

/// One number on a hub card, with the coin or glyph that says what it counts.
struct RewardsHubStat: Identifiable {
    enum Media {
        case art(RewardsCoinArt.Kind)
        case symbol(String, Color)
    }

    let label: String
    let value: String
    let media: Media

    var id: String { label }
}

/// The Learn hub's card, with the numbers under the title: a student sees where they stand
/// and what they have before deciding whether to open the page at all.
struct RewardsHubCard: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    let stats: [RewardsHubStat]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                IconTile(systemName: icon, tone: tone, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }

            HStack(spacing: 8) {
                ForEach(stats) { stat in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            switch stat.media {
                            case .art(let kind):
                                RewardsCoinArt(kind: kind, size: 20)
                            case .symbol(let name, let colour):
                                Image(systemName: name)
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(colour)
                                    .frame(width: 20, height: 20)
                            }
                            Text(stat.value)
                                .font(.system(size: 18, weight: .heavy))
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                        Text(stat.label.uppercased())
                            .font(.system(size: 10, weight: .heavy))
                            .tracking(0.7)
                            .foregroundStyle(Theme.textLabel)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.background))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(stat.label): \(stat.value == "—" ? "not loaded" : stat.value)")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(alignment: .leading) { Rectangle().fill(tone).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

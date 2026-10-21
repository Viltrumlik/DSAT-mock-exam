import SwiftUI
import MasterSATKit

/// The Rewards tab: where the student stands, what they have, where it came from, and what to
/// spend it on — the trophy hero, streak and coins, the board, the XP ledger and the shop.
///
/// A tab root, so it owns its `NavigationStack` and hides the bar; every push is an `AppLink`
/// VALUE resolved at this root (the leaderboard, points and shop pages keep their own bars and
/// Back buttons). It reloads every time the tab appears, so a conversion or a purchase made one
/// level down is on the cards when the student comes back, and refreshes detached
/// (`TabRootScroll(onRefresh:)`).
///
/// Four requests, four outcomes, each said where it lands: `/rewards/me/` (streak, coins, the
/// ledger, the header), the default board (the hero — global, all time, XP), the rules (which
/// earnings add XP) and, when the board section asks something else, its own board. A failed
/// reload keeps what was last read; only a card with nothing to show says it failed.
struct RewardsHubView: View {
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var mine: MyRewards?
    @State private var meFailed = false
    /// The default board — global, all time, XP: the hero's, and the section's when it asks the same.
    @State private var hero: LeaderboardBoard?
    @State private var heroFailed = false
    /// Which earnings add XP. Without them the ledger keeps every earning (`XPLedger`).
    @State private var rules: [RewardRule]?
    @State private var metric: LeaderboardMetric = .xp
    @State private var window = LeaderboardQuery.allTime
    /// The section's own board, when it asks something the hero's does not answer.
    @State private var other: LeaderboardBoard?
    @State private var otherFailed = false
    @State private var converting = false
    @State private var confirmingConvert = false
    @State private var convertNote: String?
    /// Counts conversions whose coin burst was skipped (a sheet or a cover is up), so the haptic
    /// the burst would have given is still given — once, by the card.
    @State private var convertBuzz = 0
    @State private var coinsSpot = FrameBox()
    @State private var shown = false
    /// Each return to the tab: a new trophy (`RankHeroContent.plays`).
    @State private var trophyPlays = 0

    /// What the hero asks: the default board — global, all time, XP — at the server's largest
    /// page, so "N XP to pass <name>" reaches the row above a student who is deep in the board
    /// (Ruling P3-R3). The full leaderboard page keeps the default page.
    private static let heroQuery = LeaderboardQuery(limit: 200)

    /// What the board section asks. The strike board is a run and always all time, so a window
    /// chosen for XP is not part of that question (and switching it asks nothing new).
    private var sectionQuery: LeaderboardQuery {
        LeaderboardQuery(scope: .global, window: metric == .strikes ? LeaderboardQuery.allTime : window, metric: metric)
    }

    /// Whether the hero's board already answers the section — the same slice, without its
    /// page size (the section shows five rows and the student's own).
    private var sectionIsHero: Bool { sectionQuery == LeaderboardQuery() }

    /// The board the section shows — only one that answers what is chosen, so a strike board
    /// never shows under "XP" while the next one loads.
    private var sectionBoard: LeaderboardBoard? {
        guard let board = sectionIsHero ? hero : other, board.metric == metric else { return nil }
        guard metric == .strikes || board.window == window else { return nil }
        return board
    }

    private var sectionFailed: Bool { sectionIsHero ? heroFailed : otherFailed }

    private var heroState: RankHeroContent.State {
        guard let hero else { return .loading }
        guard let standing = hero.standing else { return .unranked }
        return .ranked(rank: standing.rank, pass: hero.passTarget)
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .rewards, onRefresh: { await load() }) {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader(title: "Rewards").stagger(0, shown: shown)

                    heroCard.stagger(1, shown: shown)

                    if meFailed && mine == nil {
                        RewardsErrorState(
                            title: "Points aren't loading right now.",
                            message: "Nothing has been lost — the page just couldn't fetch your total."
                        ) { await loadMe() }
                        .cardStyle(padding: 8)
                    }

                    HStack(alignment: .top, spacing: 12) {
                        StreakCard(
                            streak: celebrations.streakShown(rewards.streak) ?? mine?.currentStreak,
                            best: mine?.bestStreak
                        )
                        CoinsCard(rewards: mine, converting: converting, note: convertNote) {
                            confirmingConvert = true
                        }
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { coinsSpot.rect = $0 }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .stagger(2, shown: shown)

                    RewardsBoardSection(
                        metric: $metric,
                        window: $window,
                        board: sectionBoard,
                        failed: sectionFailed && sectionBoard == nil
                    ) { await retrySection() }
                    .stagger(3, shown: shown)

                    if let mine {
                        XPLedgerCard(rows: XPLedger.rows(mine.history, rules: rules))
                            .stagger(4, shown: shown)
                    }

                    HubCard(
                        title: "Shop",
                        subtitle: "Spend coins and strikes, then collect it from the desk",
                        icon: "bag.fill",
                        tone: Theme.success,
                        route: AppLink.shop
                    )
                    .stagger(5, shown: shown)
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Rewards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            // Not `.task`: a TabView never tears its tabs down.
            .onAppear {
                if !shown {
                    shown = true
                } else {
                    trophyPlays += 1
                }
                // Yesterday's "Converted 30 points…" is not news on a later visit.
                if convertNote != nil, !converting { convertNote = nil }
                Task { await load() }
            }
            // A chip or a segment asked a new board. Cancelled when it changes again, and a
            // cancelled load stores nothing (`loadSection`).
            .task(id: sectionQuery) {
                if otherFailed { otherFailed = false }
                await loadSection()
            }
            .sensoryFeedback(.success, trigger: convertBuzz)
            .alert(
                Text(verbatim: "Convert \(mine?.maxConvertiblePoints ?? 0) points into \(RewardsFormat.count(mine?.convertibleCoins ?? 0, "coin"))?"),
                isPresented: $confirmingConvert
            ) {
                Button("Convert") { Task { await convert() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Converted points don't come back, and your XP stays where it is. To choose an amount, open Points.")
            }
        }
    }

    // MARK: - The hero

    @ViewBuilder private var heroCard: some View {
        if hero == nil && heroFailed {
            // Said as a failure, never as "not on the board".
            RewardsErrorState(
                title: "Your place isn't loading right now.",
                message: "Your XP is safe — only the board failed to load."
            ) { await loadHero() }
            .chunky(Theme.amber)
        } else {
            NavigationLink(value: AppLink.leaderboard) {
                RankHeroContent(state: heroState, plays: trophyPlays)
            }
            .buttonStyle(ChunkyButtonStyle(tint: Theme.amber))
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let me: Void = loadMe()
        async let board: Void = loadHero()
        async let earning: Void = loadRules()
        async let section: Void = loadSection()
        _ = await (me, board, earning, section)
    }

    /// A number that changes rolls (Reduce Motion: a quick fade); nothing is written when it
    /// did not change — every write to `@State` the root reads re-renders the tab.
    @MainActor
    private func setMine(_ fresh: MyRewards) {
        guard mine != fresh else { return }
        withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { mine = fresh }
    }

    @MainActor
    private func loadMe() async {
        // Taken before asking, so an answer older than the header's own refresh cannot wind it back.
        let ticket = rewards.ticket()
        do {
            let me = try await session.rewards.me()
            setMine(me)
            if meFailed { meFailed = false }
            // The header reads the same answer, so the two never disagree.
            rewards.apply(me, ticket: ticket)
        } catch {
            // A cancelled read is not a failed one; and a failed one keeps the last good numbers.
            guard !Task.isCancelled else { return }
            meFailed = true
        }
    }

    @MainActor
    private func loadHero() async {
        do {
            let board = try await LeaderboardAPI(client: session.client).board(Self.heroQuery)
            if hero != board {
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { hero = board }
            }
            if heroFailed { heroFailed = false }
            // What the student has now seen — "while you were away" measures from it.
            rewards.noteRank(board.standing?.rank)
        } catch {
            guard !Task.isCancelled else { return }
            heroFailed = true
        }
    }

    @MainActor
    private func loadRules() async {
        guard let fresh = try? await session.rewards.rules() else { return }
        if rules != fresh { rules = fresh }
    }

    /// The section's own board — nothing to do when it asks what the hero's already answers.
    @MainActor
    private func loadSection() async {
        let asked = sectionQuery
        guard asked != LeaderboardQuery() else { return }
        do {
            let fresh = try await LeaderboardAPI(client: session.client).board(asked)
            guard !Task.isCancelled, asked == sectionQuery else { return }
            if other != fresh { other = fresh }
            if otherFailed { otherFailed = false }
        } catch {
            guard !Task.isCancelled, asked == sectionQuery else { return }
            otherFailed = true
        }
    }

    /// "Try again" under the board: the hero's own read when the section shows the hero's board
    /// (`loadSection` has nothing to ask then), the section's otherwise.
    @MainActor
    private func retrySection() async {
        if sectionIsHero { await loadHero() } else { await loadSection() }
    }

    // MARK: - Converting

    /// Spends Max — every point that buys a whole coin. Not idempotent (a second call is a second
    /// conversion), so it runs once per confirmation, with the button off while it is in flight,
    /// and is never retried. Either way the truth is read back.
    ///
    /// A coin bursts only when a coin was minted, and only where the stage is clear: under a
    /// sheet or a cover `coinBurst` does nothing, so the card says what happened itself — in
    /// words, to VoiceOver, and with the success haptic the burst would have given.
    @MainActor
    private func convert() async {
        guard !converting, let before = mine, before.convertibleCoins > 0 else { return }
        converting = true
        convertNote = nil
        do {
            let result = try await session.rewards.convert(points: nil)
            let after = before.applying(result.balances)
            setMine(after)
            if result.minted > 0 {
                let bursts = celebrations.coinCount
                celebrations.coinBurst(at: coinsSpot.rect.celebrationPoint)
                if celebrations.coinCount == bursts { convertBuzz += 1 }
            }
            convertNote = result.detail.isEmpty
                ? (result.minted > 0
                    ? "Converted \(result.pointsSpent) points into \(RewardsFormat.count(result.minted, "coin"))."
                    : "Not enough points yet — \(RewardsFormat.count(after.pointsToNextCoin, "point")) to your next coin.")
                : result.detail
        } catch {
            // The press may still have landed (a dropped answer); the read-back below shows
            // which, and the button is gone if it did.
            convertNote = "That didn't go through. Check your coins, then try again."
        }
        converting = false
        if let convertNote { AccessibilityNotification.Announcement(convertNote).post() }
        await loadMe()
    }
}

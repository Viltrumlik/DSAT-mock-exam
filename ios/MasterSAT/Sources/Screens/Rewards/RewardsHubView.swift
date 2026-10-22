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
                        subtitle: "Spend coins and strikes, collect your order from the desk",
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
        async let me: MyRewards? = loadMe()
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

    /// Reads `/rewards/me/` and returns the answer the cards now show — nil when the read failed
    /// or was cancelled (the cards keep what they had).
    ///
    /// The cards take an answer only when the header's store does (`apply` says so): requests are
    /// ordered by ticket, and an older answer landing after a newer one — a slow read from the tab
    /// appearing against the conversion's read-back — would put back coins the header has moved
    /// past, and revive a Convert button for points already spent. A refused answer means a newer
    /// one went elsewhere (the header's own check), which this tab never saw: it asks once more,
    /// so the cards neither trail the header nor stay empty.
    @MainActor
    @discardableResult
    private func loadMe(again: Bool = true) async -> MyRewards? {
        // Taken before asking, so an answer older than the header's own refresh cannot wind it back.
        let ticket = rewards.ticket()
        do {
            let me = try await session.rewards.me()
            if meFailed { meFailed = false }
            // The header reads the same answer, so the two never disagree.
            if rewards.apply(me, ticket: ticket) {
                setMine(me)
                return me
            }
            if again, !Task.isCancelled { return await loadMe(again: false) }
            return nil
        } catch {
            // A cancelled read is not a failed one; and a failed one keeps the last good numbers.
            guard !Task.isCancelled else { return nil }
            meFailed = true
            return nil
        }
    }

    @MainActor
    private func loadHero() async {
        do {
            let board = try await LeaderboardAPI(client: session.client).board(.heroBoard)
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
    /// conversion), so it runs once per confirmation, with the button off from the press until
    /// the read-back has settled, and is never retried.
    ///
    /// The read-back is the truth either way — and the button stays off through it, because an
    /// answer that was dropped on the way back may still have been a conversion that landed.
    /// When it shows the coins rose after an error, the note says it worked (and the coin
    /// bursts, once), rather than leaving "That didn't go through" over a card that went up.
    ///
    /// A coin bursts only when a coin was minted, and only where the stage is clear: under a
    /// sheet or a cover `coinBurst` does nothing, so the card gives the success haptic itself —
    /// and always the words and the VoiceOver announcement, which the burst never carries.
    @MainActor
    private func convert() async {
        guard !converting, let before = mine, before.convertibleCoins > 0 else { return }
        converting = true
        convertNote = nil
        var answered = false
        do {
            let result = try await session.rewards.convert(points: nil)
            answered = true
            let after = before.applying(result.balances)
            setMine(after)
            if result.minted > 0 { celebrateMint() }
            convertNote = result.detail.isEmpty
                ? (result.minted > 0
                    ? "Converted \(result.pointsSpent) points into \(RewardsFormat.count(result.minted, "coin"))."
                    : "Not enough points yet — \(RewardsFormat.count(after.pointsToNextCoin, "point")) to your next coin.")
                : result.detail
        } catch {
            // Said only after the read-back below: it decides which note is true.
        }
        let fresh = await loadMe()
        if !answered {
            if let fresh, fresh.coins > before.coins {
                // The answer was lost but the conversion was not.
                celebrateMint()
                convertNote = "Converted points into \(RewardsFormat.count(fresh.coins - before.coins, "coin"))."
            } else if fresh != nil {
                convertNote = "That didn't go through — your coins are as they were. Try again."
            } else {
                convertNote = "We couldn't confirm that went through. Pull down to check your coins."
            }
        }
        converting = false
        if let convertNote { AccessibilityNotification.Announcement(convertNote).post() }
    }

    /// A coin bursts where the card is; when the burst is skipped (a sheet or a cover is up) the
    /// success haptic it would have given is given here instead — never both.
    @MainActor
    private func celebrateMint() {
        let bursts = celebrations.coinCount
        celebrations.coinBurst(at: coinsSpot.rect.celebrationPoint)
        if celebrations.coinCount == bursts { convertBuzz += 1 }
    }
}

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
///
/// The hero's place is read only while the celebrations are quiet (`CelebrationCenter.whenQuiet`)
/// — however the read was asked: the tab opening, a pull, "See the board", a return to the app —
/// so the hub never shows a place before the header has rolled to it and its card has played.
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
    /// The section's own boards — XP this month, Strikes — each kept under its question, so a
    /// toggle shows the last one at once while it reads again.
    @State private var boards: [LeaderboardQuery: LeaderboardBoard] = [:]
    /// The questions whose last read failed: an error with nothing kept, a stale line over a board.
    @State private var boardsFailed: Set<LeaderboardQuery> = []
    @State private var reads = HubReads()
    @State private var converting = false
    @State private var confirmingConvert = false
    @State private var convertNote: String?
    /// Counts conversions whose coin burst was skipped (a sheet or a cover is up), so the haptic
    /// the burst would have given is still given — once, by the card.
    @State private var convertBuzz = 0
    @State private var coinsSpot = FrameBox()
    /// VoiceOver's cursor, sent to the coins card when a conversion is over (`convert`).
    @AccessibilityFocusState private var coinsFocused: Bool
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
        guard let board = sectionIsHero ? hero : boards[sectionQuery], board.metric == metric else { return nil }
        guard metric == .strikes || board.window == window else { return nil }
        return board
    }

    private var sectionFailed: Bool { sectionIsHero ? heroFailed : boardsFailed.contains(sectionQuery) }

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

                    // Side by side; one above the other at the accessibility sizes, where half the
                    // phone cannot hold a number set that large.
                    AdaptiveStack(rowAlignment: .top, spacing: 12) {
                        StreakCard(
                            streak: celebrations.streakShown(rewards.streak) ?? mine?.currentStreak,
                            best: mine?.bestStreak
                        )
                        CoinsCard(
                            rewards: mine, failed: meFailed, converting: converting, note: convertNote,
                            focus: $coinsFocused
                        ) {
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
                        failed: sectionFailed && sectionBoard == nil,
                        stale: sectionFailed && sectionBoard != nil
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
                let first = !shown
                if first {
                    shown = true
                } else {
                    trophyPlays += 1
                }
                // Yesterday's "Converted 30 points…" is not news on a later visit.
                if convertNote != nil, !converting { convertNote = nil }
                // The first appearance's section board is the `.task(id:)` below's to read — it
                // runs then too — so it is read once, not twice.
                Task { await load(includingSection: !first) }
            }
            // A chip or a segment asked a new board — the first appearance too. Cancelled when it
            // changes again, and a cancelled load stores nothing (`loadSection`). A board kept for
            // the question stays on screen while it reads again; one with nothing kept gives its
            // failure back to the skeleton.
            .task(id: sectionQuery) {
                let asked = sectionQuery
                if boards[asked] == nil, boardsFailed.contains(asked) { boardsFailed.remove(asked) }
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
    private func load(includingSection: Bool = true) async {
        async let me: MyRewards? = loadMe()
        async let board: Void = loadHero()
        async let earning: Void = loadRules()
        if includingSection { await loadSection() }
        _ = await (me, board, earning)
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
            // A read went through, so "pull down to check" has been done: the coins now say it.
            // Not the conversion's own read-back, which decides its note itself.
            if !converting, convertNote == Self.unconfirmedNote { convertNote = nil }
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

    /// The key the hero's read and its answer wait under — its own, so the welcome-back reload
    /// waiting beside it is never replaced by it.
    private static let heroQuietKey = "rewards.hero"

    /// The hero's board, read once the celebrations are quiet: a flight still in the air, a read
    /// still out, a welcome-back check or a trophy card still to play could each be about to
    /// bring the place this read would show. Awaited when the stage is quiet already (a pull's
    /// spinner waits for it); otherwise it waits under its key, the newest ask replacing an older.
    @MainActor
    private func loadHero() async {
        guard celebrations.isQuiet else {
            celebrations.whenQuiet(Self.heroQuietKey) { Task { await readHero() } }
            return
        }
        await readHero()
    }

    /// Only the newest read asked is shown (`LatestOnly.isNewestAsked`): its answer may wait for
    /// the stage below, and an older one waiting in its place would be shown after it.
    @MainActor
    private func readHero() async {
        let ticket = reads.hero.issue()
        do {
            let board = try await LeaderboardAPI(client: session.client).board(.heroBoard)
            guard reads.hero.isNewestAsked(ticket) else { return }
            // The stage can have turned busy while the read was out — a return to the app, a
            // task's own read: the place waits for it as well.
            celebrations.whenQuiet(Self.heroQuietKey) { showHero(board, ticket: ticket) }
        } catch {
            guard !Task.isCancelled, reads.hero.isNewestAsked(ticket) else { return }
            if !heroFailed { heroFailed = true }
        }
    }

    @MainActor
    private func showHero(_ board: LeaderboardBoard, ticket: UInt64) {
        guard reads.hero.isNewestAsked(ticket) else { return }
        if hero != board {
            withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { hero = board }
        }
        if heroFailed { heroFailed = false }
        // What the student has now seen — "while you were away" measures from it.
        rewards.noteRank(board.standing?.rank)
    }

    @MainActor
    private func loadRules() async {
        guard let fresh = try? await session.rewards.rules() else { return }
        if rules != fresh { rules = fresh }
    }

    /// The section's own board — nothing to do when it asks what the hero's already answers.
    /// Kept under its question, so an answer that lands after a toggle still fills its own slot;
    /// of two reads of one question only the newer is kept.
    @MainActor
    private func loadSection() async {
        let asked = sectionQuery
        guard asked != LeaderboardQuery() else { return }
        let ticket = reads.issue(asked)
        do {
            let fresh = try await LeaderboardAPI(client: session.client).board(asked)
            guard !Task.isCancelled, reads.isNewestAsked(ticket, asked) else { return }
            if boards[asked] != fresh { boards[asked] = fresh }
            if boardsFailed.contains(asked) { boardsFailed.remove(asked) }
        } catch {
            guard !Task.isCancelled, reads.isNewestAsked(ticket, asked) else { return }
            if !boardsFailed.contains(asked) { boardsFailed.insert(asked) }
        }
    }

    /// "Try again" under the board: the hero's own read when the section shows the hero's board
    /// (`loadSection` has nothing to ask then), the section's otherwise.
    @MainActor
    private func retrySection() async {
        if sectionIsHero { await loadHero() } else { await loadSection() }
    }

    // MARK: - Converting

    /// Nothing is known — the answer was lost and so was the read-back — so the note sends the
    /// student to look; the next read that goes through takes it away (`loadMe`).
    private static let unconfirmedNote = "We couldn't confirm that went through. Pull down to check your coins."

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
        // Coins were minted. Only that note is news the screen already shows; every other note
        // is the only spoken signal that the conversion did not happen.
        var minted = false
        do {
            let result = try await session.rewards.convert(points: nil)
            answered = true
            minted = result.minted > 0
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
                minted = true
                celebrateMint()
                convertNote = "Converted points into \(RewardsFormat.count(fresh.coins - before.coins, "coin"))."
            } else if fresh != nil {
                convertNote = "That didn't go through — your coins are as they were. Try again."
            } else {
                convertNote = Self.unconfirmedNote
            }
        }
        converting = false
        // A conversion that spent every coin it could leaves no Convert button, and VoiceOver's
        // cursor goes with it: the coins card is where the result shows, so the cursor goes there.
        coinsFocused = true
        if let convertNote {
            // After the card has been read, not over it: speech started by the cursor's move is
            // not cut off. A success waits its turn behind that read; a conversion that did not
            // go through is said at normal priority, so it cannot be dropped.
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            celebrations.announce(convertNote, queued: minted)
        }
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

/// The hub's request order, nothing renders from — a reference, so taking a ticket never
/// re-renders the tab. One ticket line for the hero, one per section question.
@MainActor
private final class HubReads {
    var hero = LatestOnly()
    private var sections: [LeaderboardQuery: LatestOnly] = [:]

    func issue(_ query: LeaderboardQuery) -> UInt64 {
        sections[query, default: LatestOnly()].issue()
    }

    func isNewestAsked(_ ticket: UInt64, _ query: LeaderboardQuery) -> Bool {
        sections[query]?.isNewestAsked(ticket) ?? false
    }
}

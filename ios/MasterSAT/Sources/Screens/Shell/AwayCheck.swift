import SwiftUI
import MasterSATKit

/// "While you were away": compares what the header last showed this student (`LastSeenBook`)
/// with the server now, and hands what improved to the celebrations — XP through the queue like
/// any confirmed gain (captioned from the newest history row), a longer streak to the flame, a
/// better place to the trophy card. Nothing on the first launch on this phone; nothing that went
/// down.
///
/// Runs on launch and each time the app comes back to the front: iOS keeps a backgrounded app
/// alive for hours, so a student coming back after a lesson rarely LAUNCHES it — the return is
/// the moment. A quick app switch costs the one `/rewards/me/` read the header refresh already
/// made there, and celebrates nothing unless something changed.
///
/// The baseline is what the header SHOWS (XP still held for a flight is not seen yet). It is
/// written after every check, whenever what the header shows changes (`RewardsRefresher`) and
/// when the app leaves the front, so it never lags the pill: a relaunch after a gain was
/// celebrated finds nothing left to celebrate. Per student, and one `AwayCheck` per signed-in
/// identity (`RootTabView` is rebuilt per user id), like the `CelebrationCenter` it feeds.
@MainActor
final class AwayCheck {
    private let book: LastSeenBook
    private var running = false

    init(book: LastSeenBook = LastSeenBook()) {
        self.book = book
    }

    func run(userID: Int, session: Session, rewards: RewardsStore, celebrations: CelebrationCenter) async {
        // Launch, the first scene-active and a reconnect can all ask: one check at a time.
        guard !running else { return }
        running = true
        defer { running = false }

        let seen = book.read(userID: userID)
        // Before the read: a rise another refresh brings meanwhile is held, never shown early.
        // Every path below resolves it — an entry left pending would hold the pill for good.
        let away = celebrations.expectAway(xpSeen: seen?.xp)
        let ticket = rewards.ticket()
        guard let me = try? await session.rewards.me() else {
            // Nothing measured (a read that was cancelled is no failure either, and says
            // nothing), nothing flies, and the baseline stays as it was.
            celebrations.resolveAway(away, xpAfter: nil, label: nil)
            return
        }
        // Before the store takes the new streak, so no flame shows it early.
        if let rise = WelcomeBack.streak(seen: seen, now: me.currentStreak) {
            celebrations.streakRose(rise)
        }
        rewards.apply(me, ticket: ticket)
        let caption = await flightCaption(me.history, seen: seen, xpNow: rewards.xp, api: session.rewards)
        celebrations.resolveAway(away, xpAfter: rewards.xp, label: caption)

        // The owner's board for the hero: global, all time, XP — the server's default.
        if WelcomeBack.readsRank(seen: seen, xpNow: me.xp),
           let board = try? await LeaderboardAPI(client: session.client).board(LeaderboardQuery()) {
            let now = board.standing?.rank
            if let rise = WelcomeBack.rank(seen: seen?.rank, now: now) {
                celebrations.rankRose(rise)
            }
            // Read, so noted — a place that fell is the new baseline too, not a stale best.
            rewards.noteRank(now)
        }
        remember(userID: userID, rewards: rewards, celebrations: celebrations)
    }

    /// Writes the baseline as the header shows it now. Before anything has loaded the old one
    /// stays; a number not read this time keeps its old value.
    func remember(userID: Int, rewards: RewardsStore, celebrations: CelebrationCenter) {
        guard let xp = rewards.xp else { return }
        let old = book.read(userID: userID)
        let held = celebrations.heldXP
        book.write(
            LastSeen(
                xp: max(0, xp - held),
                // Every change, drops included: a run that restarted and grows again is new
                // growth from the restart, never from the old best.
                streak: celebrations.streakShown(rewards.streak) ?? old?.streak ?? 0,
                rank: celebrations.rankNotShown?.from ?? rewards.rank ?? old?.rank,
                // XP in the air keeps its caption's starting point too: a kill before it lands
                // flies both again, once.
                newestAwardID: held > 0 ? old?.newestAwardID : (rewards.newestAwardID ?? old?.newestAwardID)
            ),
            userID: userID
        )
    }

    /// What the flight says it was for — only worth asking the rules when XP rose. Without the
    /// loaded rules an earning the school has since switched off could be named, so a caption
    /// waits for them and is left out when they will not load.
    private func flightCaption(_ history: [PointAward], seen: LastSeen?, xpNow: Int?, api: RewardsAPI) async -> String? {
        guard let seen, let xpNow, xpNow > seen.xp else { return nil }
        guard let rules = try? await api.rules() else { return nil }
        return WelcomeBack.label(history: history, since: seen.newestAwardID, rules: rules)
    }
}

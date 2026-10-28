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
/// the moment. A quick app switch costs one `/rewards/me/` read — the rules a caption needs are
/// kept ten minutes, and the board is read only when the place can have changed
/// (`WelcomeBack.readsRank`: XP rose, a place is still unread, or none has been noted yet) — and
/// celebrates nothing unless something changed.
///
/// The baseline is what the header SHOWS, not what the server said: XP still held for a flight,
/// a streak waiting to roll and a place whose card has not been shown are not seen yet
/// (`LastSeenRule`). It is written after every check that read, whenever what the header shows
/// changes (`RewardsRefresher`) and when the app leaves the front, so it never lags the pill: a
/// relaunch after a gain was celebrated finds nothing left to celebrate. Per student, and one
/// `AwayCheck` per signed-in identity (`RootTabView` is rebuilt per user id), like the
/// `CelebrationCenter` it feeds — and every answer is checked against the session still being
/// that student's before it is used.
@MainActor
final class AwayCheck {
    /// What a check did, for the caller that shows the student the result.
    enum Outcome: Equatable {
        /// The check ran to its end: `/rewards/me/` answered for this student and what it showed
        /// was handed on. The header store holds the answer unless a newer read had already
        /// landed (`RewardsStore.apply` refuses a stale one), and the board may still have failed
        /// — its place is then left unread for the next check.
        case read
        /// Another check was already running; this one did nothing.
        case skipped
        /// The check stopped early: the `/rewards/me/` read failed or was cancelled, or the
        /// session stopped being this student's — before the answer was used or while the board
        /// was read. It writes no baseline.
        case failed
    }

    private let book: LastSeenBook
    private var running = false
    /// Whether the board read this process made for the place failed. Nil until it has made one
    /// (or decided it need not): the stored `rankUnread` stands until then.
    private var rankReadFailed: Bool?
    /// What earns XP, kept for a few minutes so a quick app switch costs no second request.
    private var rulesRead: (rules: [RewardRule], at: Date)?
    private static let rulesLife: TimeInterval = 600

    init(book: LastSeenBook = LastSeenBook()) {
        self.book = book
    }

    @discardableResult
    func run(userID: Int, session: Session, rewards: RewardsStore, celebrations: CelebrationCenter) async -> Outcome {
        // Launch, the first scene-active and a reconnect can all ask: one check at a time.
        guard !running else { return .skipped }
        running = true
        defer { running = false }

        let seen = book.read(userID: userID)
        // Before the read: a rise another refresh brings meanwhile is held, never shown early.
        // Every path below resolves it — an entry left pending would hold the pill for good.
        let away = celebrations.expectAway(xpSeen: seen?.xp)
        // On every path, after the board too: until then the stage is not quiet, so the hub
        // never reads a place this check is about to put on a card.
        defer { celebrations.awayCheckEnded() }
        let ticket = rewards.ticket()
        // Out WITH the read, not after it: a caption's rules never add a second round trip to
        // the time the pill is held. Only a student with a baseline can have a gain to name.
        let api = session.rewards
        async let rules = rulesForCaption(api: api, wanted: seen != nil)
        guard let me = try? await api.me(), isSignedIn(as: userID, in: session) else {
            // Nothing measured (a read that was cancelled is no failure either, and says
            // nothing; neither is an answer that came back for another account), nothing flies,
            // and the baseline stays as it was.
            celebrations.resolveAway(away, xpAfter: nil, label: nil)
            // Today's stat cards stop waiting for numbers that are not coming.
            if isSignedIn(as: userID, in: session) { rewards.noteReadFailed() }
            return .failed
        }
        // Before the store takes the new streak, so no flame shows it early.
        if let rise = WelcomeBack.streak(seen: seen, now: me.currentStreak) {
            celebrations.streakRose(rise)
        }
        rewards.apply(me, ticket: ticket)
        let loadedRules = await rules
        guard isSignedIn(as: userID, in: session) else {
            celebrations.resolveAway(away, xpAfter: nil, label: nil)
            return .failed
        }
        celebrations.resolveAway(
            away,
            xpAfter: rewards.xp,
            label: caption(me.history, seen: seen, xpNow: rewards.xp, rules: loadedRules)
        )

        // The owner's board for the hero: global, all time, XP — asked exactly as the hero asks
        // it (`LeaderboardQuery.heroBoard`), so a place read here and one read there are the same
        // number. (On main the table and `my` number ties the same way — competition ranks.)
        var failed = false
        if WelcomeBack.readsRank(seen: seen, xpNow: me.xp) {
            // Unread until the board answers: while it is in flight `remember` can run (the pill
            // rolled, the app left the front), and a kill then must find the place still unread,
            // not a baseline that has already moved on to the new one.
            rankReadFailed = true
            let board = try? await LeaderboardAPI(client: session.client).board(.heroBoard)
            guard isSignedIn(as: userID, in: session) else { return .failed }
            if let board {
                let now = board.standing?.rank
                if let rise = WelcomeBack.rank(seen: seen?.rank, now: now) {
                    celebrations.rankRose(rise)
                }
                // Read, so noted — a place that fell is the new baseline too, not a stale best.
                rewards.noteRank(now)
            } else {
                // The place may have improved and this read could not say: the next check reads
                // it again, however the XP moved meanwhile (`LastSeen.rankUnread`).
                failed = true
            }
        }
        rankReadFailed = failed
        remember(userID: userID, rewards: rewards, celebrations: celebrations)
        return .read
    }

    /// Writes the baseline as the header shows it now (`LastSeenRule`). Before anything has
    /// loaded the old one stays; a number not read this time keeps its old value.
    func remember(userID: Int, rewards: RewardsStore, celebrations: CelebrationCenter) {
        let shown = LastSeenRule.Shown(
            xp: rewards.xp,
            streak: celebrations.streakShown(rewards.streak),
            rank: rewards.rank,
            newestAwardID: rewards.newestAwardID
        )
        let inFlight = LastSeenRule.InFlight(
            heldXP: celebrations.heldXP,
            rankNotShown: celebrations.rankNotShown,
            rankReadFailed: rankReadFailed
        )
        guard let seen = LastSeenRule.baseline(old: book.read(userID: userID), shown: shown, inFlight: inFlight) else { return }
        book.write(seen, userID: userID)
    }

    /// Whether the session is still this student's: sign-out followed by a quick sign-in as
    /// someone else must never write the new account's place into the old one's baseline.
    private func isSignedIn(as userID: Int, in session: Session) -> Bool {
        if case .signedIn(let user) = session.phase { return user.id == userID }
        return false
    }

    /// What the flight says it was for — only when XP rose over the baseline. Without the loaded
    /// rules an earning the school has since switched off could be named, so a caption waits for
    /// them and is left out when they will not load.
    private func caption(_ history: [PointAward], seen: LastSeen?, xpNow: Int?, rules: [RewardRule]?) -> String? {
        guard let seen, let xpNow, xpNow > seen.xp, let rules else { return nil }
        return WelcomeBack.label(history: history, since: seen.newestAwardID, rules: rules)
    }

    /// The rules, from the last few minutes' read or a new one. A failed read falls back to the
    /// older rules rather than none; nil when there are none at all.
    private func rulesForCaption(api: RewardsAPI, wanted: Bool) async -> [RewardRule]? {
        guard wanted else { return nil }
        if let read = rulesRead, Date.now.timeIntervalSince(read.at) < Self.rulesLife { return read.rules }
        if let fresh = try? await api.rules() {
            rulesRead = (fresh, .now)
            return fresh
        }
        return rulesRead?.rules
    }
}

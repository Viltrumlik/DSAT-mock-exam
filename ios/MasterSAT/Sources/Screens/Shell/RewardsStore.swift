import SwiftUI
import MasterSATKit

/// The three numbers every tab header shows. A failed refresh keeps the last known values:
/// a header that blanks on a bad connection reads as "you lost your XP".
///
/// Answers are applied in REQUEST order (`LatestOnly`): two reads in flight can come back the
/// wrong way round, and the older must not wind the header back — a celebration measures its
/// gain against these numbers.
@MainActor
@Observable
final class RewardsStore {
    private(set) var xp: Int?
    /// The run of lessons attended — the streak, not the spendable strikes.
    private(set) var streak: Int?
    private(set) var coins: Int?
    /// The place on the default board (global, all time, XP) last read — by the Rewards hero, the
    /// leaderboard on its default slice, or the welcome-back check. Bookkeeping for "while you
    /// were away"; nothing renders from it.
    @ObservationIgnored private(set) var rank: Int?
    /// The highest history row id last applied — where the next welcome-back caption starts
    /// counting new earnings. The highest id, not the first row: the history is ordered by when
    /// an award was dated, and an award dated back can still be the newest to arrive.
    @ObservationIgnored private(set) var newestAwardID: Int?
    @ObservationIgnored private var order = LatestOnly()

    /// Take one before asking `/rewards/me/` yourself, and hand it back to `apply`.
    func ticket() -> UInt64 { order.issue() }

    /// Refreshes, and returns the XP the header shows afterwards — nil when the read failed.
    @discardableResult
    func refresh(using api: RewardsAPI) async -> Int? {
        let ticket = ticket()
        guard let me = try? await api.me() else { return nil }
        apply(me, ticket: ticket)
        return xp
    }

    /// Takes the numbers from a `/rewards/me/` answer, so the Rewards hub and the header never
    /// show two totals. Animated, so the numbers roll; guarded, because every write to an
    /// `@Observable` property notifies, equal or not.
    func apply(_ me: MyRewards, ticket: UInt64) {
        guard order.accept(ticket) else { return }
        if let newest = me.history.map(\.id).max(), newest != newestAwardID { newestAwardID = newest }
        guard xp != me.xp || streak != me.currentStreak || coins != me.coins else { return }
        withAnimation(Motion.snappy) {
            if xp != me.xp { xp = me.xp }
            if streak != me.currentStreak { streak = me.currentStreak }
            if coins != me.coins { coins = me.coins }
        }
    }

    /// The default board's standing was read. A student with no XP has none; the last known
    /// place is kept then.
    func noteRank(_ rank: Int?) {
        if let rank, rank != self.rank { self.rank = rank }
    }
}

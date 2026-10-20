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
        guard xp != me.xp || streak != me.currentStreak || coins != me.coins else { return }
        withAnimation(Motion.snappy) {
            if xp != me.xp { xp = me.xp }
            if streak != me.currentStreak { streak = me.currentStreak }
            if coins != me.coins { coins = me.coins }
        }
    }
}

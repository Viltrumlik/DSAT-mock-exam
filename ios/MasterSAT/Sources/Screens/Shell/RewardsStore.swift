import SwiftUI
import MasterSATKit

/// The three numbers every tab header shows. A failed refresh keeps the last known values:
/// a header that blanks on a bad connection reads as "you lost your XP".
@MainActor
@Observable
final class RewardsStore {
    private(set) var xp: Int?
    /// The run of lessons attended — the streak, not the spendable strikes.
    private(set) var streak: Int?
    private(set) var coins: Int?

    func refresh(using api: RewardsAPI) async {
        guard let me = try? await api.me() else { return }
        apply(me)
    }

    /// Takes the numbers from a `/rewards/me/` answer someone else already fetched, so a page
    /// that loads it (the Rewards hub) and the header can never show two different totals.
    /// Guarded: every write to an `@Observable` property notifies, equal or not.
    func apply(_ me: MyRewards) {
        if xp != me.xp { xp = me.xp }
        if streak != me.currentStreak { streak = me.currentStreak }
        if coins != me.coins { coins = me.coins }
    }
}

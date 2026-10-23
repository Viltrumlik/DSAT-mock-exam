import Foundation

/// The numbers and the wording behind the two windows the header's pills open — the flame opens
/// Strikes, the XP pill opens XP and points.
///
/// They live in the kit, as values rather than as views, for one reason: every sentence here is a
/// promise to a student about what they have and what it is worth, and a sentence that only exists
/// inside a `body` can only be checked by looking at a screen. "4 lessons in a row · best 9",
/// "3 strikes to spend", "#4 in the centre" are all tested below instead.
///
/// Neither value reads anything. They are built from a `MyRewards` the caller already has and the
/// hero board it already asked for (Ruling W-R3), so the window can never show a total the pill
/// behind it disagrees with, and opening a window costs no request.

// MARK: - Strikes

/// What the Strikes window says.
///
/// **The distinction this type exists to keep straight (Ruling W-R2).** The server sends two
/// different runs and they are easy to confuse:
///
/// - `currentStreak` is the *run* — how many lessons in a row have been attended. It is what the
///   header's flame shows and what the strike leaderboard ranks. It does not go down when a strike
///   is spent.
/// - `strikes` is the *spendable* part of that run (`currentStreak − spentInStreak`). It is what a
///   student can actually hand over in the Shop.
///
/// The window's big number is `spendable`, exactly as the web's dashboard does it, and the run is
/// the quiet line underneath. Telling a student they have nine strikes when they have spent six is
/// not an off-by-six: it is an offer the Shop will refuse.
public struct StrikesWindow: Sendable, Equatable {
    /// `MyRewards.strikes`. What can be spent right now — never the run (W-R2).
    public let spendable: Int
    /// `MyRewards.currentStreak`. Lessons attended in a row, spent or not.
    public let run: Int
    /// `MyRewards.bestStreak`. The best run so far; 0 for a student who has not started one.
    public let best: Int

    public init(spendable: Int, run: Int, best: Int) {
        self.spendable = spendable
        self.run = run
        self.best = best
    }

    /// The only initialiser the app uses. Taking the whole payload rather than three loose
    /// integers is deliberate: a caller cannot then pass `currentStreak` where `strikes` belongs,
    /// which is the mistake W-R2 is about.
    public init(rewards: MyRewards) {
        self.init(spendable: rewards.strikes, run: rewards.currentStreak, best: rewards.bestStreak)
    }

    /// "4 lessons in a row · best 9".
    ///
    /// The best is appended whenever there is one to name, including when it equals the run — a
    /// student on their best-ever run should be told so, and "4 lessons in a row · best 4" is both
    /// honest and what the site prints. A run of nothing is not phrased as a zero: "0 lessons in a
    /// row" reads as a failure, and the student is one lesson away from a run.
    public var runLine: String {
        guard run > 0 else { return "No run yet — your next lesson starts one" }
        let lessons = RewardsFormat.count(run, "lesson") + " in a row"
        return best > 0 ? lessons + " · best \(best)" : lessons
    }

    /// "3 strikes to spend" — the big number read aloud with its unit, so VoiceOver gets one
    /// sentence instead of a bare numeral followed by a separate caption (W-R7).
    public var spokenSpendable: String { RewardsFormat.count(spendable, "strike") + " to spend" }
}

// MARK: - XP and points

/// What the XP window says: the total, the place on the board, and the points box under it.
///
/// **The same text as the hero.** `passLine` is `LeaderboardPass.text` and nothing else, and the
/// place comes from the same `LeaderboardQuery.heroBoard` standing the Rewards hero and the
/// welcome-back check read. Rewording either here would let one screen say "66 XP to pass Dilnoza"
/// while another says something slightly different about the same two rows.
public struct XPWindow: Sendable, Equatable {
    /// The XP the window shows. Usually `MyRewards.xp`, but see the initialiser.
    public let xp: Int
    /// The viewer's place on the hero board, or nil when the board does not rank them (or could
    /// not be read — the view distinguishes those two, this value does not pretend to).
    public let rank: Int?
    /// The row directly above, when the board can prove who it is.
    public let pass: LeaderboardPass?
    public let points: Int
    public let coins: Int
    /// What Convert would mint right now: whole coins only.
    public let convertibleCoins: Int
    /// `rate − points % rate`, so it equals the rate rather than 0 when the points divide evenly.
    public let pointsToNextCoin: Int

    public init(
        xp: Int,
        rank: Int?,
        pass: LeaderboardPass?,
        points: Int,
        coins: Int,
        convertibleCoins: Int,
        pointsToNextCoin: Int
    ) {
        self.xp = xp
        self.rank = rank
        self.pass = pass
        self.points = points
        self.coins = coins
        self.convertibleCoins = convertibleCoins
        self.pointsToNextCoin = pointsToNextCoin
    }

    /// Built from the payload the app already holds and the hero board it already asked for.
    ///
    /// `xp` is a separate parameter, defaulting to the payload's own total, because the app does
    /// not always show `MyRewards.xp`: while an XP flight is in the air the pill shows
    /// `RewardsStore.xp − heldXP`, so that the XP being flown to the pill is not also already
    /// counted in it. The window is drawn behind — and right next to — that pill, so it must be
    /// able to show the same held-back figure. Everything else has no such in-flight form, so it
    /// is read straight off the payload.
    public init(rewards: MyRewards, board: LeaderboardBoard?, xp: Int? = nil) {
        self.init(
            xp: xp ?? rewards.xp,
            rank: board?.standing?.rank,
            pass: board?.passTarget,
            points: rewards.points,
            coins: rewards.coins,
            convertibleCoins: rewards.convertibleCoins,
            pointsToNextCoin: rewards.pointsToNextCoin
        )
    }

    /// "#4 in the centre", or "Not on the board yet" for a student with no standing.
    ///
    /// A place is an identifier, not a quantity: it is interpolated plainly so that no locale can
    /// group it into "#1,204", which reads as a different number entirely.
    public var placeLine: String {
        guard let rank else { return "Not on the board yet" }
        return "#\(rank) in the centre"
    }

    /// "66 XP to pass Dilnoza" — `LeaderboardPass.text` verbatim, so this line and the Rewards
    /// hero can never disagree about the same gap.
    ///
    /// Nil when there is nobody to name: at #1 (`topLine` speaks instead), without a standing, and
    /// when the response does not carry the row directly above, where no honest number exists.
    public var passLine: String? { pass?.text }

    /// "You're top of the whole board", worded exactly as the hero's `RankHeroContent.line` words
    /// it, and only for the student standing at #1. Nil otherwise, so that exactly one of
    /// `passLine` and `topLine` is ever on screen.
    public var topLine: String? { rank == 1 ? "You're top of the whole board" : nil }

    /// "29 coins to spend".
    public var coinsLine: String { RewardsFormat.count(coins, "coin") + " to spend" }

    /// "7 points to your next coin" — the quiet line the points box shows in place of Convert when
    /// there is nothing whole to convert yet. Worded as `CoinsCard` words it today.
    public var nextCoinLine: String { RewardsFormat.count(pointsToNextCoin, "point") + " to your next coin" }
}

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
/// behind it disagrees with, and the *values* cost no request. The view that builds them does take
/// one read of its own — `/rewards/me/` for the fields the header's store does not carry, which
/// W-R4 sanctions — and these types know nothing of it.

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

    /// Three loose integers, for tests and for nothing else. The app builds the window from the
    /// payload (`init(rewards:)`), which is what stops `currentStreak` being handed to
    /// `spendable` — the one mistake W-R2 exists to prevent.
    init(spendable: Int, run: Int, best: Int) {
        self.spendable = spendable
        self.run = run
        self.best = best
    }

    /// The only initialiser the app uses. Taking the whole payload rather than three loose
    /// integers is deliberate: a caller cannot then pass `currentStreak` where `strikes` belongs,
    /// which is the mistake W-R2 is about.
    ///
    /// `shownRun` is the run the header's flame has actually rolled to. While a rise is held back
    /// for a celebration the flame still shows the older run, and a window drawn right under that
    /// flame must print the same number — so the caller passes it here instead of rebuilding a
    /// `MyRewards` with one field swapped (which would quietly default every other field).
    ///
    /// **`spendable` is clamped to the run being shown.** The two figures come from different
    /// moments — `strikes` from the newest answer, `shownRun` from the one the flame is still on —
    /// and left alone they can contradict each other: "4 strikes to spend / 3 lessons in a row",
    /// an offer of a strike the run on screen does not contain. Never offer more strikes than the
    /// run the flame is displaying; the true total arrives a moment later when the rise lands.
    /// With no held rise the clamp does nothing, since `strikes` is `currentStreak − spentInStreak`.
    public init(rewards: MyRewards, shownRun: Int? = nil) {
        let run = shownRun ?? rewards.currentStreak
        self.init(spendable: min(rewards.strikes, run), run: run, best: rewards.bestStreak)
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

    /// "strikes to spend" — the caption printed under the big numeral, singular at one. It lives
    /// here beside `spokenSpendable` so the seen and the spoken wording are one tested decision
    /// rather than a ternary in a `body` that nothing checks.
    public var spendableUnit: String { spendable == 1 ? "strike to spend" : "strikes to spend" }

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
    /// `MyRewards.points`. What has been earned and *not yet converted* this season — converting
    /// writes a negative row, so this number goes down when Convert is pressed. It is the figure
    /// the points box counts, and the one the Convert alert spends.
    public let points: Int
    /// `MyRewards.coins`. The spendable wallet: never reset by a season, never moved by XP.
    public let coins: Int
    /// What Convert would mint right now: whole coins only, so the change that does not add up to
    /// a coin stays as points. Zero is the signal that there is nothing to convert — the box then
    /// shows `nextCoinLine` in place of the button, rather than a Convert that would do nothing.
    public let convertibleCoins: Int
    /// `MyRewards.maxConvertiblePoints`. What Convert would actually spend: `points` minus the
    /// change that does not add up to a coin. The alert names both halves of the trade ("Convert
    /// N points into M coins?"), and N is this rather than `points` — a student with 27 points and
    /// a rate of 10 spends 20, and being asked to confirm 27 would be asking for the wrong thing.
    public let maxConvertiblePoints: Int
    /// `rate − points % rate`, so it equals the rate rather than 0 when the points divide evenly:
    /// a student who has just converted is a whole coin away from the next one, not zero away.
    public let pointsToNextCoin: Int

    /// Every field loose, for tests and for nothing else. It is deliberately not public: a caller
    /// outside the kit could otherwise build `rank: 1` together with a non-nil `pass`, and then
    /// both `topLine` and `passLine` would be on screen at once, which the doc above promises can
    /// never happen. The app builds the window from the payload and the board instead.
    init(
        xp: Int,
        rank: Int?,
        pass: LeaderboardPass?,
        points: Int,
        coins: Int,
        convertibleCoins: Int,
        maxConvertiblePoints: Int,
        pointsToNextCoin: Int
    ) {
        self.xp = xp
        self.rank = rank
        self.pass = pass
        self.points = points
        self.coins = coins
        self.convertibleCoins = convertibleCoins
        self.maxConvertiblePoints = maxConvertiblePoints
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
            maxConvertiblePoints: rewards.maxConvertiblePoints,
            pointsToNextCoin: rewards.pointsToNextCoin
        )
    }

    /// "#4 in the centre", or "Not on the board yet" for a student with no standing.
    ///
    /// A place is an identifier, not a quantity: it is interpolated plainly so that no locale can
    /// group it into "#1,204", which reads as a different number entirely.
    ///
    /// "in the centre" is hard-coded, so the caller owes it the truth: the board passed to
    /// `init(rewards:board:)` must be `LeaderboardQuery.heroBoard`'s — global, all time, XP
    /// (W-R3). A standing from a group or branch board would be a place among a handful of
    /// classmates printed as a place in the whole learning center.
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

    /// "You're top of the whole board" — `climbLine`'s #1 case on its own, and only for the
    /// student standing at #1. Nil otherwise, so that exactly one of `passLine` and `topLine` is
    /// ever on screen.
    public var topLine: String? { rank == 1 ? "You're top of the whole board" : nil }

    /// The one line a ranked student is owed about climbing — the Rewards hero's sentence and
    /// this window's, from the same place so the two cannot drift apart.
    ///
    /// Three cases, and the third is the one that is easy to forget: a student who is ranked but
    /// whose row above the response does not carry gets "Keep earning XP to climb" rather than
    /// nothing at all. A window that printed a blank under "#10 in the centre" would read as a
    /// line that failed to load.
    public static func climbLine(rank: Int, pass: LeaderboardPass?) -> String {
        if rank == 1 { return "You're top of the whole board" }
        return pass?.text ?? "Keep earning XP to climb"
    }

    /// `climbLine(rank:pass:)` for this window, and nil when there is no place to climb from —
    /// an unranked student is told that by `placeLine` and is owed nothing further.
    public var climbLine: String? { rank.map { Self.climbLine(rank: $0, pass: pass) } }

    /// "29 coins to spend".
    public var coinsLine: String { RewardsFormat.count(coins, "coin") + " to spend" }

    /// "7 points to your next coin" — the quiet line the points box shows in place of Convert when
    /// there is nothing whole to convert yet. Worded as `CoinsCard` words it today.
    public var nextCoinLine: String { RewardsFormat.count(pointsToNextCoin, "point") + " to your next coin" }
}

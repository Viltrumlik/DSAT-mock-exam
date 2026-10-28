import Foundation
import Testing
@testable import MasterSATKit

@Suite struct StrikesWindowTests {

    @Test("The big number is what can be spent, never the run (Ruling W-R2)")
    func spendableIsStrikesNotStreak() {
        let rewards = MyRewards(points: 0, coins: 0, currentStreak: 9, bestStreak: 12, strikes: 3, spentInStreak: 6)
        let window = StrikesWindow(rewards: rewards)
        #expect(window.spendable == 3, "six of the nine are already spent")
        #expect(window.run == 9)
        #expect(window.best == 12)
    }

    @Test("The run line counts lessons, singular at one and encouraging at none")
    func runLineCounts() {
        #expect(StrikesWindow(spendable: 0, run: 0, best: 0).runLine == "No run yet — your next lesson starts one")
        #expect(StrikesWindow(spendable: 1, run: 1, best: 0).runLine == "1 lesson in a row")
        #expect(StrikesWindow(spendable: 2, run: 2, best: 0).runLine == "2 lessons in a row")
    }

    @Test("A best is named whenever there is one — equal to or above the run")
    func runLineBest() {
        // A best BELOW the run is not asserted: the server's best is the high-water mark of the
        // run itself, so "4 lessons in a row · best 2" is a state that cannot reach the phone,
        // and pinning it down would only enshrine an impossible sentence.
        #expect(StrikesWindow(spendable: 4, run: 4, best: 0).runLine == "4 lessons in a row")
        #expect(StrikesWindow(spendable: 4, run: 4, best: 4).runLine == "4 lessons in a row · best 4")
        #expect(StrikesWindow(spendable: 4, run: 4, best: 9).runLine == "4 lessons in a row · best 9")
    }

    @Test("A run spent down to nothing still reads as a run (Ruling W-R2)")
    func wholeRunSpent() {
        let rewards = MyRewards(points: 0, coins: 0, currentStreak: 9, bestStreak: 12, strikes: 0, spentInStreak: 9)
        let window = StrikesWindow(rewards: rewards)
        #expect(window.spendable == 0, "all nine have been handed over in the Shop")
        #expect(window.spokenSpendable == "0 strikes to spend")
        #expect(window.runLine == "9 lessons in a row · best 12", "the run itself is untouched by spending")
    }

    @Test("A best is not dangled over a student with no run")
    func noRunNoBest() {
        #expect(StrikesWindow(spendable: 0, run: 0, best: 7).runLine == "No run yet — your next lesson starts one")
    }

    @Test("The spendable count is spoken with its unit, singular at one")
    func spokenSpendable() {
        #expect(StrikesWindow(spendable: 0, run: 0, best: 0).spokenSpendable == "0 strikes to spend")
        #expect(StrikesWindow(spendable: 1, run: 3, best: 3).spokenSpendable == "1 strike to spend")
        #expect(StrikesWindow(spendable: 2, run: 3, best: 3).spokenSpendable == "2 strikes to spend")
    }

    @Test("The printed unit agrees with the spoken one, singular at one")
    func spendableUnit() {
        #expect(StrikesWindow(spendable: 0, run: 0, best: 0).spendableUnit == "strikes to spend")
        #expect(StrikesWindow(spendable: 1, run: 3, best: 3).spendableUnit == "strike to spend")
        #expect(StrikesWindow(spendable: 2, run: 3, best: 3).spendableUnit == "strikes to spend")
    }

    @Test("With no run held back, the window shows the payload's own run")
    func noShownRun() {
        let rewards = MyRewards(points: 0, coins: 0, currentStreak: 4, bestStreak: 9, strikes: 4, spentInStreak: 0)
        let window = StrikesWindow(rewards: rewards, shownRun: nil)
        #expect(window.run == 4)
        #expect(window.spendable == 4, "nothing is held, so nothing is clamped")
        #expect(window.runLine == "4 lessons in a row · best 9")
    }

    @Test("A shown run equal to the real one changes nothing")
    func shownRunMatchesPayload() {
        let rewards = MyRewards(points: 0, coins: 0, currentStreak: 9, bestStreak: 12, strikes: 3, spentInStreak: 6)
        let window = StrikesWindow(rewards: rewards, shownRun: 9)
        #expect(window == StrikesWindow(rewards: rewards))
        #expect(window.spendable == 3)
        #expect(window.run == 9)
    }

    @Test("A held older run never has more strikes offered than it contains")
    func heldRunClampsSpendable() {
        // The flame is still on 3 while the newest answer already counts a run of 4 with four
        // strikes in hand. "4 strikes to spend / 3 lessons in a row" would offer a strike the run
        // on screen does not contain.
        let rewards = MyRewards(points: 0, coins: 0, currentStreak: 4, bestStreak: 9, strikes: 4, spentInStreak: 0)
        let window = StrikesWindow(rewards: rewards, shownRun: 3)
        #expect(window.run == 3)
        #expect(window.spendable == 3, "never more strikes than the run the flame is showing")
        #expect(window.runLine == "3 lessons in a row · best 9")
        #expect(window.best == 9, "the best is the payload's, not the held run's")
    }
}

@Suite struct XPWindowTests {

    private func row(_ rank: Int, _ id: Int, _ name: String, _ xp: Int, isMe: Bool = false) -> LeaderboardRow {
        LeaderboardRow(rank: rank, studentId: id, name: name, xp: xp, isMe: isMe)
    }

    /// A board where the viewer stands fourth, with every row above it present — the shape
    /// `passTarget` needs to be able to name who is directly ahead.
    private var boardWithMeFourth: LeaderboardBoard {
        let rows = [
            row(1, 1, "Aziz", 500),
            row(2, 2, "Dilnoza", 400),
            row(3, 3, "Jasur", 380),
            row(4, 9, "Madina", 300, isMe: true),
        ]
        return LeaderboardBoard(rows: rows, my: rows[3])
    }

    private let rewards = MyRewards(
        points: 27,
        coins: 29,
        xp: 300,
        pointsPerCoin: 10,
        convertibleCoins: 2,
        maxConvertiblePoints: 20
    )

    @Test("A place is an identifier, printed ungrouped, and absent when there is no standing")
    func placeLine() {
        let ranked = XPWindow(rewards: rewards, board: boardWithMeFourth)
        #expect(ranked.rank == 4)
        #expect(ranked.placeLine == "#4 in the centre")

        let unranked = XPWindow(rewards: rewards, board: LeaderboardBoard(rows: [row(1, 1, "Aziz", 500)], my: nil))
        #expect(unranked.rank == nil)
        #expect(unranked.placeLine == "Not on the board yet")
        #expect(unranked.passLine == nil)
        #expect(unranked.topLine == nil)

        let noBoard = XPWindow(rewards: rewards, board: nil)
        #expect(noBoard.placeLine == "Not on the board yet")
        #expect(noBoard.passLine == nil)

        let deep = XPWindow(
            xp: 10,
            rank: 1204,
            pass: nil,
            points: 0,
            coins: 0,
            convertibleCoins: 0,
            maxConvertiblePoints: 0,
            pointsToNextCoin: 10
        )
        #expect(deep.placeLine == "#1204 in the centre", "a place is never grouped into #1,204")
    }

    @Test("The pass line is the hero's sentence verbatim, so the two can never disagree")
    func passLineIsTheHerosText() throws {
        let window = XPWindow(rewards: rewards, board: boardWithMeFourth)
        let pass = try #require(window.pass)
        #expect(window.passLine == pass.text)
        #expect(window.passLine == "81 XP to pass Jasur")
        #expect(window.topLine == nil)
    }

    @Test("At the top there is nobody to pass; the top line speaks instead")
    func noPassAtRankOne() {
        let rows = [row(1, 9, "Madina", 500, isMe: true), row(2, 2, "Dilnoza", 400)]
        let window = XPWindow(rewards: rewards, board: LeaderboardBoard(rows: rows, my: rows[0]))
        #expect(window.rank == 1)
        #expect(window.pass == nil)
        #expect(window.passLine == nil)
        #expect(window.topLine == "You're top of the whole board")
    }

    @Test("Without the row directly above, no number is invented")
    func noPassWithoutTheRowAbove() {
        // The viewer is tenth but the response only carries the top three: nobody can be named.
        let rows = [row(1, 1, "Aziz", 500), row(2, 2, "Dilnoza", 400), row(3, 3, "Jasur", 380)]
        let window = XPWindow(rewards: rewards, board: LeaderboardBoard(rows: rows, my: row(10, 9, "Madina", 100, isMe: true)))
        #expect(window.rank == 10)
        #expect(window.passLine == nil)
        #expect(window.topLine == nil)
    }

    @Test("The XP shown can be the in-flight figure rather than the payload's own total")
    func xpCanBeOverridden() {
        #expect(XPWindow(rewards: rewards, board: nil).xp == 300, "the payload's total by default")
        #expect(XPWindow(rewards: rewards, board: nil, xp: 275).xp == 275, "25 XP still in the air")
    }

    @Test("Coins are counted with their unit, singular at one")
    func coinsLine() {
        func line(coins: Int) -> String {
            XPWindow(rewards: MyRewards(points: 0, coins: coins), board: nil).coinsLine
        }
        #expect(line(coins: 0) == "0 coins to spend")
        #expect(line(coins: 1) == "1 coin to spend")
        #expect(line(coins: 2) == "2 coins to spend")
        #expect(line(coins: 29) == "29 coins to spend")
    }

    @Test("The next-coin line is worded as the points card words it, singular at one point")
    func nextCoinLine() {
        #expect(XPWindow(rewards: rewards, board: nil).nextCoinLine == "3 points to your next coin")
        let one = MyRewards(points: 0, coins: 0, pointsToNextCoin: 1)
        #expect(XPWindow(rewards: one, board: nil).nextCoinLine == "1 point to your next coin")
    }

    @Test("The points box reads the payload, not the board")
    func pointsFields() {
        let window = XPWindow(rewards: rewards, board: nil)
        #expect(window.points == 27)
        #expect(window.coins == 29)
        #expect(window.convertibleCoins == 2)
        #expect(window.maxConvertiblePoints == 20, "Convert spends 20 of the 27, not all 27")
        #expect(window.pointsToNextCoin == 3)
    }

    @Test("The climb line is the hero's three-way wording, held in one place")
    func climbLine() {
        // No rank at all: the place line already says so, and nothing is added under it.
        #expect(XPWindow(rewards: rewards, board: nil).climbLine == nil)

        // #1: nobody to pass.
        let top = [row(1, 9, "Madina", 500, isMe: true), row(2, 2, "Dilnoza", 400)]
        let first = XPWindow(rewards: rewards, board: LeaderboardBoard(rows: top, my: top[0]))
        #expect(first.climbLine == "You're top of the whole board")

        // A known row above: the pass sentence verbatim.
        let fourth = XPWindow(rewards: rewards, board: boardWithMeFourth)
        #expect(fourth.climbLine == "81 XP to pass Jasur")
        #expect(fourth.climbLine == fourth.passLine)

        // Ranked, but the response does not carry the row above: never a blank line.
        let partial = [row(1, 1, "Aziz", 500), row(2, 2, "Dilnoza", 400), row(3, 3, "Jasur", 380)]
        let tenth = XPWindow(
            rewards: rewards,
            board: LeaderboardBoard(rows: partial, my: row(10, 9, "Madina", 100, isMe: true))
        )
        #expect(tenth.passLine == nil)
        #expect(tenth.climbLine == "Keep earning XP to climb")
    }
}

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

    @Test("A best is named whenever there is one — below, equal to, or above the run")
    func runLineBest() {
        #expect(StrikesWindow(spendable: 4, run: 4, best: 0).runLine == "4 lessons in a row")
        #expect(StrikesWindow(spendable: 4, run: 4, best: 2).runLine == "4 lessons in a row · best 2")
        #expect(StrikesWindow(spendable: 4, run: 4, best: 4).runLine == "4 lessons in a row · best 4")
        #expect(StrikesWindow(spendable: 4, run: 4, best: 9).runLine == "4 lessons in a row · best 9")
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

        let deep = XPWindow(xp: 10, rank: 1204, pass: nil, points: 0, coins: 0, convertibleCoins: 0, pointsToNextCoin: 10)
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
        #expect(window.pointsToNextCoin == 3)
    }
}

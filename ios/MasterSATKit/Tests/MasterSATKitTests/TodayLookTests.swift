import Foundation
import Testing
@testable import MasterSATKit

/// The new look's Today: stat card wording, compact Up next, the sheet's short board, the Shop
/// rail and the first sign-in step chip. Dates on `ProfileFixtures` (Tashkent, Monday
/// 14 September 2026, 15:30).
@Suite struct TodayLookTests {
    typealias F = ProfileFixtures
    typealias W = WorkFixtures

    private let english = Locale(identifier: "en_US")

    // MARK: Stat cards

    @Test("Unknown figures read as a dash and 'loading', never as zero")
    func unknownFigures() {
        #expect(TodayStats.coins(nil).value == "—")
        #expect(TodayStats.xp(nil).spoken == "XP, loading")
        #expect(TodayStats.strike(nil).value == "—")
        #expect(TodayStats.rank(nil, read: false).spoken == "Leaderboard place, loading")
    }

    @Test("Figures are plain integers, never grouped")
    func plainFigures() {
        #expect(TodayStats.coins(1204).value == "1204")
        #expect(TodayStats.coins(1).spoken == "1 coin")
        #expect(TodayStats.xp(455).value == "455")
        #expect(TodayStats.rank(1204, read: true).value == "#1204")
    }

    @Test("The Strike card says Strike, never streak or days; a zero run is an invitation")
    func strikeWording() {
        let four = TodayStats.strike(4)
        #expect(four.value == "4")
        #expect(four.caption == "Strike")
        #expect(four.spoken == "4 strikes, 4 lessons in a row")
        #expect(TodayStats.strike(1).spoken == "1 strike, 1 lesson in a row")
        let none = TodayStats.strike(0)
        #expect(none.spoken == "No strike run yet — your next lesson starts one")
        for figure in [four, none] {
            #expect(!figure.spoken.lowercased().contains("streak"))
            #expect(!figure.spoken.lowercased().contains("day"))
        }
    }

    @Test("A board read without the student says so; an unread one is loading")
    func rankStates() {
        #expect(TodayStats.rank(12, read: true).value == "#12")
        #expect(TodayStats.rank(nil, read: true).spoken == "Not on the leaderboard yet")
        #expect(TodayStats.rank(nil, read: true).value == "—")
    }

    // MARK: Up next, compact

    @Test("An unread figure is loading — the card draws a block; a read board without the student is not")
    func loadingFigures() {
        #expect(TodayStats.coins(nil).isLoading)
        #expect(TodayStats.xp(nil).isLoading)
        #expect(TodayStats.strike(nil).isLoading)
        #expect(TodayStats.rank(nil, read: false).isLoading)
        #expect(!TodayStats.rank(nil, read: true).isLoading)
        #expect(!TodayStats.coins(0).isLoading)
        #expect(!TodayStats.strike(0).isLoading)
        #expect(!TodayStats.rank(3, read: true).isLoading)
    }

    @Test("At most three rows across homework and lessons, and what is left over is counted")
    func compactLimit() throws {
        let homework = try (1...3).map { try W.homework($0, due: F.at(Double($0))) }
        let plan = TodayPlan(
            assignments: homework, events: [try F.lesson("2026-09-14", "18:00", classroom: 1)],
            homeworkXP: nil, now: F.now, calendar: F.calendar
        )
        let next = UpNextCompact.select(plan)
        #expect(next.items.count == 3)
        #expect(next.items.allSatisfy { $0.assignment != nil })
        #expect(next.more == 1)
    }

    @Test("Fewer than three: everything, nothing more")
    func compactFewer() throws {
        let plan = TodayPlan(
            assignments: [try W.homework(1, due: F.at(1))],
            events: [try F.lesson("2026-09-14", "18:00", classroom: 1)],
            homeworkXP: nil, now: F.now, calendar: F.calendar
        )
        let next = UpNextCompact.select(plan)
        #expect(next.items.count == 2)
        #expect(next.items.last?.look == .lesson)
        #expect(next.more == 0)
    }

    @Test("Due chips: the weekday within six days, the date beyond, catch-up when late")
    func dueChips() throws {
        let soon = WorkItem.homework(try W.homework(1, due: F.at(3)), homeworkXP: 15, now: F.now)
        let later = WorkItem.homework(try W.homework(2, due: F.at(10)), homeworkXP: 15, now: F.now)
        let late = WorkItem.homework(try W.homework(3, due: F.at(-1)), homeworkXP: 15, now: F.now)
        let undated = WorkItem.homework(try W.homework(4, due: nil), homeworkXP: 15, now: F.now)
        #expect(UpNextCompact.chip(for: soon, now: F.now, calendar: F.calendar, locale: english)
            == .init(text: "Due Thu", tone: .due))
        #expect(UpNextCompact.chip(for: later, now: F.now, calendar: F.calendar, locale: english)
            == .init(text: "Due Sep 24", tone: .due))
        let lateChip = UpNextCompact.chip(for: late, now: F.now, calendar: F.calendar, locale: english)
        #expect(lateChip == .init(text: "Sun", tone: .catchUp, spoken: "Catch up · Sun"))
        #expect(UpNextCompact.chip(for: undated, now: F.now, calendar: F.calendar, locale: english) == nil)
    }

    @Test("A lesson's chip is its start time, or the day when it has none — never 00:00")
    func lessonChips() throws {
        let plan = TodayPlan(assignments: [], events: [
            try F.lesson("2026-09-14", "16:00-17:30", classroom: 2),
            try F.lesson("2026-09-14", "", classroom: nil, type: "midterm"),
        ], homeworkXP: nil, now: F.now, calendar: F.calendar)
        let chips = plan.lessons.compactMap { UpNextCompact.chip(for: $0, now: F.now, calendar: F.calendar)?.text }
        #expect(Set(chips) == ["16:00", "Today"])
        let spoken = plan.lessons.compactMap { UpNextCompact.chip(for: $0, now: F.now, calendar: F.calendar)?.spoken }
        #expect(Set(spoken) == ["Today · 16:00", "Today"])
    }

    @Test("The XP chip shows only on homework that still pays")
    func xpChip() throws {
        let paying = WorkItem.homework(try W.homework(1, due: F.at(2)), homeworkXP: 15, now: F.now)
        let late = WorkItem.homework(try W.homework(2, due: F.at(-1)), homeworkXP: 15, now: F.now)
        let noRule = WorkItem.homework(try W.homework(3, due: F.at(2)), homeworkXP: nil, now: F.now)
        #expect(UpNextCompact.xpChip(for: paying) == "up to +15 XP")
        #expect(UpNextCompact.xpChip(for: late) == nil)
        #expect(UpNextCompact.xpChip(for: noRule) == nil)
    }

    // MARK: Leaderboard snippet

    private func row(_ rank: Int, _ id: Int, me: Bool = false) -> LeaderboardRow {
        LeaderboardRow(rank: rank, studentId: id, name: "S\(id)", xp: 1000 - rank, isMe: me)
    }

    private func ranks(_ lines: [LeaderboardSnippet.Line]) -> [String] {
        lines.map {
            switch $0 {
            case .row(let row): return String(row.rank)
            case .gap: return "…"
            }
        }
    }

    @Test("Deep in the board: the top three, a gap, then two places either side")
    func snippetDeep() {
        let rows = (1...20).map { row($0, $0, me: $0 == 12) }
        let board = LeaderboardBoard(rows: rows, my: rows[11])
        #expect(ranks(LeaderboardSnippet.lines(board)) == ["1", "2", "3", "…", "10", "11", "12", "13", "14"])
    }

    @Test("Near the top: one unbroken run, no gap")
    func snippetNearTop() {
        let rows = (1...20).map { row($0, $0, me: $0 == 5) }
        let board = LeaderboardBoard(rows: rows, my: rows[4])
        #expect(ranks(LeaderboardSnippet.lines(board)) == ["1", "2", "3", "4", "5", "6", "7"])
    }

    @Test("Below the page: the top three, a gap, the student's own row")
    func snippetBelowPage() {
        let rows = (1...10).map { row($0, $0) }
        let me = row(57, 99, me: true)
        let board = LeaderboardBoard(rows: rows, my: me)
        #expect(ranks(LeaderboardSnippet.lines(board)) == ["1", "2", "3", "…", "57"])
    }

    @Test("Not on the board: the first seven rows; an empty board: nothing")
    func snippetUnranked() {
        let rows = (1...20).map { row($0, $0) }
        #expect(ranks(LeaderboardSnippet.lines(LeaderboardBoard(rows: rows, my: nil))) == ["1", "2", "3", "4", "5", "6", "7"])
        #expect(LeaderboardSnippet.lines(LeaderboardBoard(rows: [], my: nil)).isEmpty)
    }

    @Test("At the bottom of the rows: the window stops at the last row")
    func snippetLastRow() {
        let rows = (1...10).map { row($0, $0, me: $0 == 10) }
        let board = LeaderboardBoard(rows: rows, my: rows[9])
        #expect(ranks(LeaderboardSnippet.lines(board)) == ["1", "2", "3", "…", "8", "9", "10"])
    }

    // MARK: Shop rail

    private func item(_ id: Int, currency: String = "COIN", sort: Int = 0, active: Bool = true, price: Int = 5) -> ShopItem {
        ShopItem(id: id, name: "Item \(id)", currency: currency, price: price, stock: 3, isActive: active, sortOrder: sort)
    }

    @Test("The rail: coin shelf first in its own order, then strikes, active only, capped")
    func shopRail() {
        let store = Storefront(
            coins: 0, strikes: 0,
            coinItems: [item(2, sort: 1), item(1, sort: 1), item(3, sort: 0), item(4, active: false)],
            strikeItems: [item(9, currency: "STRIKE")]
        )
        #expect(ShopRail.items(store).map(\.id) == [3, 1, 2, 9])
        #expect(ShopRail.items(store, limit: 2).map(\.id) == [3, 1])
        #expect(ShopRail.items(Storefront(coins: 0, strikes: 0)).isEmpty)
    }

    @Test("Prices: a bare number beside the coin, 'N strikes' on the strike shelf")
    func shopPrices() {
        #expect(ShopRail.priceText(item(1, price: 1200)) == "1200")
        #expect(ShopRail.priceText(item(2, currency: "STRIKE", price: 15)) == "15 strikes")
        #expect(ShopRail.priceText(item(3, currency: "STRIKE", price: 1)) == "1 strike")
    }

    // MARK: First sign-in

    @Test("Step chips count the steps owed when the gate opened, in the gate's order")
    func stepChip() {
        let owed = ["password", "lcup_phone", "email"]
        #expect(ProfileCompletion.position(of: .password, owedAtStart: owed)! == (1, 3))
        #expect(ProfileCompletion.position(of: .phone, owedAtStart: owed)! == (2, 3))
        #expect(ProfileCompletion.position(of: .email, owedAtStart: owed)! == (3, 3))
        #expect(ProfileCompletion.position(of: .names, owedAtStart: owed) == nil)
        #expect(ProfileCompletion.position(of: .email, owedAtStart: ["email"]) == nil)
        #expect(ProfileCompletion.position(of: .names, owedAtStart: ["first_name", "username", "email"])! == (1, 2))
    }
}

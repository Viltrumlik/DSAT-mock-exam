import Foundation
import Testing
@testable import MasterSATKit

@Suite struct LeaderboardMetricTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test("XP is the server's default, so it is not sent; the strike board sends only what it obeys")
    func queryItems() {
        let xp = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4)
        #expect(xp.metric == .xp)
        #expect(xp.queryItems.map(\.name) == ["scope", "window", "subject", "branch"])

        let strikes = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4, metric: .strikes)
        let sent = Dictionary(uniqueKeysWithValues: strikes.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(sent == ["scope": "GLOBAL", "metric": "STRIKES", "branch": "4"])
        #expect(strikes.activeFilterCount == 1, "only the branch narrows a strike board")

        let groupStrikes = LeaderboardQuery(scope: .group, metric: .strikes)
        #expect(groupStrikes.queryItems.map(\.name) == ["scope", "metric"])
        #expect(groupStrikes.activeFilterCount == 0)
    }

    @Test("A strike board decodes its metric and each row's run; it offers no XP goal")
    func strikeBoardDecodes() throws {
        let board = try decode(LeaderboardBoard.self, #"""
        {"metric":"STRIKES","scope":"GLOBAL","window":"ALL","count":2,
         "rows":[{"rank":1,"student_id":7,"name":"Aziz","xp":0,"awards":0,"strikes":12,"is_me":false},
                 {"rank":2,"student_id":9,"name":"Madina","xp":0,"awards":0,"strikes":9,"is_me":true}],
         "my":{"rank":2,"student_id":9,"name":"Madina","xp":0,"awards":0,"strikes":9,"is_me":true}}
        """#)
        #expect(board.metric == .strikes)
        #expect(board.rows.map(\.strikes) == [12, 9])
        #expect(board.rows[0].score(.strikes) == 12)
        #expect(board.rows[0].score(.xp) == 0)
        #expect(board.goal == nil)
        #expect(board.passTarget == nil)
    }

    @Test("An XP board without `metric` (older server) reads as XP, and its rows carry no run")
    func xpBoardDefaults() throws {
        let board = try decode(LeaderboardBoard.self, #"""
        {"rows":[{"rank":1,"student_id":7,"name":"Aziz","xp":40}],"my":null}
        """#)
        #expect(board.metric == .xp)
        #expect(board.rows[0].strikes == nil)
        #expect(board.rows[0].score(.strikes) == 0)
    }
}

@Suite struct LeaderboardLimitTests {

    @Test("No limit is the default and is never sent — the query items are what they always were")
    func nilLimitIsNotSent() {
        let xp = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4)
        #expect(xp.limit == nil)
        #expect(!xp.queryItems.map(\.name).contains("limit"))
        #expect(xp.queryItems.map(\.name) == ["scope", "window", "subject", "branch"])

        let strikes = LeaderboardQuery(scope: .global, metric: .strikes)
        #expect(strikes.limit == nil)
        #expect(!strikes.queryItems.map(\.name).contains("limit"))
        #expect(strikes.queryItems.map(\.name) == ["scope", "metric"])
    }

    @Test("A caller that asks for a page size sends it, on the XP board and on the strike board")
    func limitIsSentWhenAsked() {
        let xp = LeaderboardQuery(scope: .global, window: "MONTH", limit: 200)
        let xpSent = Dictionary(uniqueKeysWithValues: xp.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(xpSent == ["scope": "GLOBAL", "window": "MONTH", "limit": "200"])

        let strikes = LeaderboardQuery(scope: .global, branchId: 4, metric: .strikes, limit: 200)
        let strikeSent = Dictionary(uniqueKeysWithValues: strikes.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(strikeSent == ["scope": "GLOBAL", "metric": "STRIKES", "branch": "4", "limit": "200"])
    }

    @Test("The limit is sent as given — the server clamps it, the app does not")
    func limitIsNotClamped() {
        let query = LeaderboardQuery(limit: 9_999)
        #expect(query.queryItems.last == URLQueryItem(name: "limit", value: "9999"))
    }

    @Test("A page size is not a filter: it changes no badge, no summary, and survives a reset")
    func limitIsNotAFilter() {
        let plain = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4)
        var sized = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4, limit: 200)
        #expect(sized.activeFilterCount == plain.activeFilterCount)
        #expect(sized.summary(using: nil) == plain.summary(using: nil))

        let sizedStrikes = LeaderboardQuery(scope: .global, branchId: 4, metric: .strikes, limit: 200)
        #expect(sizedStrikes.activeFilterCount == 1)

        sized.resetFilters()
        #expect(sized.activeFilterCount == 0)
        #expect(sized.limit == 200, "resetting the filters does not shrink the page the caller asked for")
    }
}

@Suite struct LeaderboardPassTests {

    private func row(_ rank: Int, _ id: Int, _ xp: Int, name: String? = nil, me: Bool = false) -> LeaderboardRow {
        LeaderboardRow(rank: rank, studentId: id, name: name ?? "S\(id)", xp: xp, isMe: me)
    }

    @Test("The student directly above, by first name, to pass and not to tie")
    func directlyAbove() {
        let me = row(4, 4, 150, me: true)
        let board = LeaderboardBoard(rows: [row(1, 1, 400), row(2, 2, 300), row(3, 3, 270, name: "Malika Karimova"), me], my: me)
        let pass = board.passTarget
        #expect(pass == LeaderboardPass(name: "Malika", xp: 121, rank: 3))
        #expect(pass?.text == "121 XP to pass Malika")
    }

    @Test("Nobody to pass at #1, without a standing, or on a board that is not XP")
    func nothingToPass() {
        let top = row(1, 1, 400, me: true)
        #expect(LeaderboardBoard(rows: [top, row(2, 2, 300)], my: top).passTarget == nil)
        #expect(LeaderboardBoard(rows: [row(1, 1, 400)], my: nil).passTarget == nil)
        let me = row(2, 2, 300, me: true)
        #expect(LeaderboardBoard(metric: .strikes, rows: [row(1, 1, 0), me], my: me).passTarget == nil)
    }

    @Test("Below the page: named only when every student ahead is in the response")
    func belowThePage() {
        let page = (1...50).map { row($0, $0, 1000 - $0) }
        let next = row(51, 99, 900, me: true)
        let reachable = LeaderboardBoard(rows: page, my: next)
        #expect(reachable.passTarget == LeaderboardPass(name: "S50", xp: 51, rank: 50))

        let far = row(57, 99, 600, me: true)
        #expect(LeaderboardBoard(rows: page, my: far).passTarget == nil, "#51–#56 are not in the response")
    }

    @Test("Ties: a tie-mate printed above is not passed; a tie ahead is passed as one")
    func ties() {
        let me = row(2, 3, 300, me: true)
        let tiedWithMe = LeaderboardBoard(rows: [row(1, 1, 400), row(2, 2, 300), me], my: me)
        #expect(tiedWithMe.passTarget == LeaderboardPass(name: "S1", xp: 101, rank: 1))

        let behindATie = row(4, 4, 300, me: true)
        let tiedAhead = LeaderboardBoard(rows: [row(1, 1, 500), row(2, 2, 400), row(2, 3, 400), behindATie], my: behindATie)
        #expect(tiedAhead.passTarget == LeaderboardPass(name: "S3", xp: 101, rank: 2))

        // The page ends on a tie ahead of a student it does not show.
        let cut = LeaderboardBoard(rows: [row(1, 1, 500), row(2, 2, 400), row(2, 3, 400)], my: row(4, 9, 100, me: true))
        #expect(cut.passTarget == LeaderboardPass(name: "S3", xp: 301, rank: 2))
    }

    @Test("The student above is found by rank, not by the order the rows arrive in")
    func shuffledRows() {
        let me = row(4, 4, 150, me: true)
        let shuffled = [row(3, 3, 270, name: "Malika Karimova"), me, row(1, 1, 400), row(2, 2, 300)]
        let board = LeaderboardBoard(rows: shuffled, my: me)
        #expect(board.passTarget == LeaderboardPass(name: "Malika", xp: 121, rank: 3))
    }

    @Test("Level on XP but ranked below: one XP passes them")
    func levelXP() {
        let me = row(2, 2, 300, me: true)
        #expect(LeaderboardBoard(rows: [row(1, 1, 300), me], my: me).passTarget?.xp == 1)
    }

    @Test("A first name is the first word of the shown name — never an address")
    func firstName() {
        #expect(LeaderboardName.firstName("Malika Karimova") == "Malika")
        #expect(LeaderboardName.firstName("  Jasur  ") == "Jasur")
        #expect(LeaderboardName.firstName("") == "Student")
        #expect(LeaderboardName.firstName(LeaderboardName.display("malika@mail.uz")) == "malika")
    }
}

@Suite struct XPLedgerTests {

    private func award(_ id: Int, _ event: String, _ points: Int) -> PointAward {
        PointAward(id: id, event: event, label: event.capitalized, points: points, awardedAt: "2026-10-20T10:00:00Z")
    }

    @Test("Earnings that add XP, newest first, at most five; a conversion spends and is left out")
    func earningsOnly() {
        let history = [
            award(9, "COIN_CONVERSION", -30), award(8, "HOMEWORK", 15), award(7, "SURVEY", 10),
            award(6, "ATTENDANCE_PRESENT", 5), award(5, "ATTENDANCE_PRESENT", 5), award(4, "HOMEWORK", 12),
            award(3, "ATTENDANCE_LATE", 3), award(2, "ATTENDANCE_PRESENT", 5),
        ]
        let rules = [
            RewardRule(event: "HOMEWORK", label: "Homework", points: 15),
            RewardRule(event: "SURVEY", label: "Survey", points: 10, grantsXP: false),
        ]
        #expect(XPLedger.rows(history, rules: rules).map(\.id) == [8, 6, 5, 4, 3])
        #expect(XPLedger.rows(history, rules: rules, limit: 2).map(\.id) == [8, 6])
    }

    @Test("Without the rules an earning is kept — a missing rule adds XP on the server too — except SURVEY")
    func withoutRules() {
        let history = [award(3, "ATTENDANCE_PRESENT", 5), award(2, "SURVEY", 10), award(1, "HOMEWORK", 15)]
        #expect(XPLedger.rows(history, rules: nil).map(\.id) == [3, 1], "SURVEY has no XP fallback on the server")
        #expect(XPLedger.rows([], rules: nil).isEmpty)
    }

    @Test("SURVEY is out of XP even when the rules list has no SURVEY rule (an inactive rule is not served)")
    func surveyWithoutItsRule() {
        let history = [award(3, "SURVEY", 10), award(2, "HOMEWORK", 15), award(1, "ATTENDANCE_PRESENT", 5)]
        let rules = [RewardRule(event: "HOMEWORK", label: "Homework", points: 15)]
        #expect(XPLedger.rows(history, rules: rules).map(\.id) == [2, 1])
        #expect(XPLedger.rows(history, rules: []).map(\.id) == [2, 1])
    }

    @Test("A rule that exists decides — SURVEY paying XP again is kept, and a rule beats the fallback for any event")
    func theRuleDecides() {
        let history = [award(3, "SURVEY", 10), award(2, "HOMEWORK", 15), award(1, "QUIZ", 4)]
        let rules = [
            RewardRule(event: "SURVEY", label: "Survey", points: 10, grantsXP: true),
            RewardRule(event: "HOMEWORK", label: "Homework", points: 15, grantsXP: true),
            RewardRule(event: "QUIZ", label: "Quiz", points: 4, grantsXP: false),
        ]
        #expect(XPLedger.rows(history, rules: rules).map(\.id) == [3, 2])
    }

    @Test("A negative limit is an empty list, never a trap")
    func negativeLimit() {
        let history = [award(2, "HOMEWORK", 15), award(1, "HOMEWORK", 12)]
        #expect(XPLedger.rows(history, rules: nil, limit: -1).isEmpty)
        #expect(XPLedger.rows(history, rules: nil, limit: 0).isEmpty)
    }
}

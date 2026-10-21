import Foundation
import Testing
@testable import MasterSATKit

@Suite struct LastSeenBookTests {

    private func scratch() -> (UserDefaults, String) {
        let name = "lastseen-tests-\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test("Nothing stored reads as no baseline; what was written reads back, per student")
    func roundTrip() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let book = LastSeenBook(defaults: defaults)
        #expect(book.read(userID: 7) == nil)

        let seen = LastSeen(xp: 120, streak: 4, rank: 57, newestAwardID: 901)
        book.write(seen, userID: 7)
        #expect(book.read(userID: 7) == seen)
        #expect(book.read(userID: 8) == nil, "another account on the phone starts with no baseline")
        #expect(LastSeenBook.key(userID: 7) == "rewards.lastSeen.v1.7")
    }

    @Test("A value that will not decode is no baseline, not a crash")
    func corrupt() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set(Data("not json".utf8), forKey: LastSeenBook.key(userID: 3))
        #expect(LastSeenBook(defaults: defaults).read(userID: 3) == nil)
    }
}

@Suite struct WelcomeBackTests {

    private func award(_ id: Int, _ label: String, _ points: Int, event: String? = nil) -> PointAward {
        PointAward(id: id, event: event ?? "E\(id)", label: label, points: points, awardedAt: "2026-10-20T10:00:00Z")
    }

    @Test("The streak grew: from what was seen to now. Nothing without a baseline, or for a run that stayed or restarted")
    func streak() {
        let seen = LastSeen(xp: 100, streak: 4, rank: nil, newestAwardID: nil)
        #expect(WelcomeBack.streak(seen: seen, now: 6) == Rise(from: 4, to: 6))
        #expect(WelcomeBack.streak(seen: seen, now: 4) == nil)
        #expect(WelcomeBack.streak(seen: seen, now: 1) == nil)
        #expect(WelcomeBack.streak(seen: nil, now: 6) == nil)
    }

    @Test("A better place is a smaller number; unknown, the same or a lower place is not celebrated")
    func rank() {
        #expect(WelcomeBack.rank(seen: 60, now: 55) == Rise(from: 60, to: 55))
        #expect(WelcomeBack.rank(seen: 55, now: 55) == nil)
        #expect(WelcomeBack.rank(seen: 55, now: 61) == nil)
        #expect(WelcomeBack.rank(seen: nil, now: 3) == nil)
        #expect(WelcomeBack.rank(seen: 9, now: nil) == nil)
    }

    @Test("The board is read only when the place can have improved — XP rose — or was never read")
    func readsRank() {
        let seen = LastSeen(xp: 100, streak: 4, rank: 57, newestAwardID: nil)
        #expect(WelcomeBack.readsRank(seen: seen, xpNow: 130))
        #expect(!WelcomeBack.readsRank(seen: seen, xpNow: 100))
        #expect(!WelcomeBack.readsRank(seen: seen, xpNow: 90))
        #expect(WelcomeBack.readsRank(seen: nil, xpNow: 0), "the first launch records a baseline")
        let neverRanked = LastSeen(xp: 100, streak: 4, rank: nil, newestAwardID: nil)
        #expect(WelcomeBack.readsRank(seen: neverRanked, xpNow: 100))
        let noXP = LastSeen(xp: 0, streak: 0, rank: nil, newestAwardID: nil)
        #expect(!WelcomeBack.readsRank(seen: noXP, xpNow: 0), "no XP, no place on the board")
    }

    @Test("The flight names the newest earning since it was last seen, and counts the rest")
    func label() {
        let history = [award(9, "Homework", 15), award(8, "Converted to coins", -30), award(7, "Attendance", 5), award(5, "Attendance", 5)]
        #expect(WelcomeBack.label(history: history, since: 7) == "Homework")
        #expect(WelcomeBack.label(history: history, since: 6) == "Homework + 1 more")
        #expect(WelcomeBack.label(history: history, since: nil) == "Homework + 2 more")
        #expect(WelcomeBack.label(history: history, since: 9) == nil, "a rise on a row already seen has no new row to name")
        #expect(WelcomeBack.label(history: [award(4, "", 5)], since: nil) == "Earned while you were away")
    }

    @Test("A row that pays points but no XP is never named: the flight is for XP")
    func labelSkipsPointsOnlyRows() {
        let survey = award(9, "Survey", 5, event: "SURVEY")
        let attendance = award(8, "Attendance", 5, event: "ATTENDANCE")
        #expect(WelcomeBack.label(history: [survey, attendance], since: 7) == "Attendance",
                "the survey is newer, but only the attendance carried XP — and it is the only one counted")
        #expect(WelcomeBack.label(history: [survey], since: 7) == nil,
                "only a survey since the baseline: no caption rather than a wrong one")
        #expect(WelcomeBack.label(history: [survey, attendance], since: 7, rules: nil) == "Attendance")
    }

    @Test("When the rules are known, a rule's grants-XP flag decides, whatever the event")
    func labelFollowsTheRules() {
        let survey = award(9, "Survey", 5, event: "SURVEY")
        let attendance = award(8, "Attendance", 5, event: "ATTENDANCE")
        let homework = award(7, "Homework", 10, event: "HOMEWORK")
        let history = [survey, attendance, homework]

        let surveyPaysXP = [RewardRule(event: "SURVEY", label: "Survey", points: 5, grantsXP: true)]
        #expect(WelcomeBack.label(history: history, since: 6, rules: surveyPaysXP) == "Survey + 2 more",
                "the school ticked XP back on for surveys")

        let attendanceNoXP = [RewardRule(event: "ATTENDANCE", label: "Attendance", points: 5, grantsXP: false)]
        #expect(WelcomeBack.label(history: history, since: 6, rules: attendanceNoXP) == "Homework",
                "an event with a rule that grants no XP is skipped; SURVEY has no rule here, so the fallback skips it too")
    }

    @Test("The newest row is the highest id, not the first in the array")
    func labelPicksNewestById() {
        let history = [award(5, "Attendance", 5), award(9, "Homework", 15), award(7, "Event", 5)]
        #expect(WelcomeBack.label(history: history, since: 6) == "Homework + 1 more")
    }

    @Test("A full history window that no longer reaches the baseline names the newest and counts nothing")
    func labelDropsTheCountWhenTheBaselineScrolledOut() {
        // Ids 200 down to 151: fifty rows, all newer than the baseline row (100) that scrolled out.
        let full = (0..<WelcomeBack.historyWindow).map { award(200 - $0, "Attendance", 5) }
        #expect(full.count == WelcomeBack.historyWindow)
        #expect(WelcomeBack.label(history: full, since: 100) == "Attendance",
                "fifty rows are only the newest of what came in: no \"+ 49 more\"")
        #expect(WelcomeBack.label(history: full, since: nil) == "Attendance",
                "no baseline row to reach back to, and a full window: the same")

        // The same window, but the baseline row is still in it: the count is exact.
        #expect(WelcomeBack.label(history: full, since: 190) == "Attendance + 9 more")
        #expect(WelcomeBack.label(history: full, since: 151) == "Attendance + 48 more",
                "the oldest row in the window is the baseline's neighbour, still reached")
    }

    @Test("A window that is not full is the whole ledger, so its count stands")
    func labelKeepsTheCountForAShortWindow() {
        let short = (0..<(WelcomeBack.historyWindow - 1)).map { award(200 - $0, "Attendance", 5) }
        #expect(WelcomeBack.label(history: short, since: 100) == "Attendance + 48 more")
        #expect(WelcomeBack.label(history: short, since: nil) == "Attendance + 48 more")
    }
}

/// Every mutating call on its own line, never inside `#expect` (as `CelebrationQueueTests`).
@Suite struct AwayFlightTests {

    @Test("An away gain flies with its label and plays no check")
    func flies() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: 100)
        let efforts = queue.takeEfforts(stageVisible: true)
        #expect(efforts.isEmpty, "nothing was handed in, so there is no check")
        let gained = queue.resolve(away, xpAfter: 130, allowsFlights: true, label: "Attendance + 1 more")
        #expect(gained == 30)
        #expect(queue.held == 30)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 30)
        #expect(flight?.label == "Attendance + 1 more")
        if let flight { queue.land(flight.id) }
        #expect(queue.isEmpty)
    }

    @Test("A refresh that lands before the entry resolves is held at once — the pill never dips")
    func noDip() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: 100)
        #expect(queue.held(xpNow: nil) == 0)
        #expect(queue.held(xpNow: 130) == 30, "the launch refresh landed first: still shows 100")
        queue.resolve(away, xpAfter: 130, allowsFlights: true)
        #expect(queue.held(xpNow: 130) == 30, "resolving changes nothing on screen")
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        if let flight { queue.land(flight.id) }
        #expect(queue.held(xpNow: 130) == 0)

        let task = queue.record(.homework, xpBefore: 130, stageVisible: true).id
        #expect(queue.held(xpNow: 145) == 15, "a scene-active refresh beat the task's own")
        queue.resolve(task, xpAfter: 145, allowsFlights: true)
        #expect(queue.held(xpNow: 145) == 15)
    }

    @Test("First launch, entry still pending: no baseline, so nothing is held before the read resolves it")
    func firstLaunchPending() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: nil)
        #expect(queue.held(xpNow: 130) == 0, "no baseline: the whole total is the student's own, not a gain")
        #expect(queue.held == 0)
        queue.resolve(away, xpAfter: 130, allowsFlights: true)
        #expect(queue.held(xpNow: 130) == 0)
        #expect(queue.isEmpty)
    }

    @Test("An away entry and a task measured against the same total count the gain once")
    func noDoubleCount() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: 100)
        let task = queue.record(.homework, xpBefore: 100, stageVisible: true).id
        #expect(queue.held(xpNow: 115) == 15)
        queue.resolve(away, xpAfter: 115, allowsFlights: true, label: "Homework")
        queue.resolve(task, xpAfter: 115, allowsFlights: true)
        #expect(queue.held == 15)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 15)
        #expect(flight?.label == "Homework")

        var reversed = CelebrationQueue()
        let first = reversed.record(.homework, xpBefore: 100, stageVisible: true).id
        let second = reversed.recordAway(xpSeen: 100)
        reversed.resolve(first, xpAfter: 115, allowsFlights: true)
        reversed.resolve(second, xpAfter: 115, allowsFlights: true, label: "Homework")
        #expect(reversed.held == 15)
    }

    @Test("First launch, a drop, a failed read, Reduce Motion: nothing is held and nothing flies")
    func nothing() {
        let cases: [(Int?, Int?, Bool)] = [(nil, 130, true), (130, 120, true), (100, nil, true), (100, 130, false)]
        for (seen, after, flights) in cases {
            var queue = CelebrationQueue()
            let away = queue.recordAway(xpSeen: seen)
            let gained = queue.resolve(away, xpAfter: after, allowsFlights: flights)
            #expect(gained == (flights ? 0 : 30), "Reduce Motion still measures the gain, for VoiceOver")
            #expect(queue.held == 0)
            #expect(queue.held(xpNow: 130) == 0)
            #expect(queue.isEmpty)
        }
    }
}

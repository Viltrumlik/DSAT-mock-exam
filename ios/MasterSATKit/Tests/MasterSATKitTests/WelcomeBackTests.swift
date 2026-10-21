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

    private func award(_ id: Int, _ label: String, _ points: Int) -> PointAward {
        PointAward(id: id, event: "E\(id)", label: label, points: points, awardedAt: "2026-10-20T10:00:00Z")
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

import Testing
@testable import MasterSATKit

@Suite struct XPTruthTests {

    @Test("The gain is what the header will read minus what it read; never negative")
    func delta() {
        #expect(XPDelta.gain(before: 100, after: 115) == 15)
        #expect(XPDelta.gain(before: 100, after: 100) == 0)
        #expect(XPDelta.gain(before: 100, after: 90) == 0)
        #expect(XPDelta.gain(before: nil, after: 115) == 0)
        #expect(XPDelta.gain(before: 100, after: nil) == 0)
    }

    @Test("An answer to an older request never overwrites a newer one")
    func latestOnly() {
        var order = LatestOnly()
        let first = order.issue()
        let second = order.issue()
        // `accept` is mutating, so it is called outside `#expect`.
        let newerAccepted = order.accept(second)
        let olderAccepted = order.accept(first)
        let third = order.issue()
        let laterAccepted = order.accept(third)
        #expect(newerAccepted)
        #expect(!olderAccepted)
        #expect(laterAccepted)
    }

    @Test("What a finished task says to VoiceOver")
    func announcements() {
        #expect(FinishedWork.homework.announcement == "Homework handed in. Well done.")
        #expect(FinishedWork.assessment.announcement == "Assessment handed in. Well done.")
        #expect(FinishedWork.vocabSession.announcement == "Round finished. Well done.")
        #expect(FinishedWork.survey.announcement == "Survey sent. Thank you.")
    }
}

/// Every mutating call is made on its own line, never inside `#expect`, so the queue is changed
/// exactly once per call whatever the macro does with its operands.
@Suite struct CelebrationQueueTests {

    @Test("Finished on screen: the check plays at once; the XP waits for a pill, then lands")
    func onScreen() {
        var queue = CelebrationQueue()
        let entry = queue.record(.homework, xpBefore: 100, stageVisible: true)
        #expect(entry.playNow)
        queue.resolve(entry.id, xpAfter: 115, allowsFlights: true)
        #expect(queue.held == 15)
        let early = queue.takeFlight(stageVisible: true, pillVisible: false, allowsFlights: true)
        #expect(early == nil)
        #expect(queue.held == 15)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 15)
        #expect(queue.held == 15, "held until it lands, so the pill rolls on landing")
        if let flight { queue.land(flight.id) }
        #expect(queue.held == 0)
        #expect(queue.isEmpty)
    }

    @Test("Finished under a sheet or a cover: nothing plays until the stage can be seen")
    func covered() {
        var queue = CelebrationQueue()
        let entry = queue.record(.assessment, xpBefore: 100, stageVisible: false)
        #expect(!entry.playNow)
        let hidden = queue.takeEfforts(stageVisible: false)
        #expect(hidden.isEmpty)
        queue.resolve(entry.id, xpAfter: 110, allowsFlights: true)
        let underCover = queue.takeFlight(stageVisible: false, pillVisible: true, allowsFlights: true)
        #expect(underCover == nil)
        let beforeCheck = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(beforeCheck == nil, "not before its check has played")
        let shown = queue.takeEfforts(stageVisible: true)
        #expect(shown == [.assessment])
        let again = queue.takeEfforts(stageVisible: true)
        #expect(again.isEmpty, "each check is handed out once")
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 10)
    }

    @Test("Nothing earned, a failed refresh, or an unknown start: nothing flies")
    func noGain() {
        let cases: [(Int?, Int?)] = [(100, 100), (100, nil), (nil, 115)]
        for (before, after) in cases {
            var queue = CelebrationQueue()
            let entry = queue.record(.survey, xpBefore: before, stageVisible: true)
            queue.resolve(entry.id, xpAfter: after, allowsFlights: true)
            #expect(queue.held == 0)
            let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
            #expect(flight == nil)
            #expect(queue.isEmpty)
        }
    }

    @Test("Reduce Motion: nothing is held and nothing flies — the number just changes")
    func reduceMotion() {
        var queue = CelebrationQueue()
        let entry = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(entry.id, xpAfter: 115, allowsFlights: false)
        #expect(queue.held == 0)
        #expect(queue.isEmpty)
    }

    @Test("Reduce Motion switched on midway gives back everything held")
    func releaseHeld() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        _ = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        let b = queue.record(.assessment, xpBefore: 115, stageVisible: true)
        queue.resolve(b.id, xpAfter: 125, allowsFlights: true)
        #expect(queue.held == 25)
        queue.releaseHeld()
        #expect(queue.held == 0)
        #expect(queue.isEmpty)
    }

    @Test("Two tasks whose refreshes read the same total count the gain once")
    func noDoubleCount() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        let b = queue.record(.survey, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        queue.resolve(b.id, xpAfter: 115, allowsFlights: true)
        #expect(queue.held == 15)
    }

    @Test("Gains confirmed together fly together; one still out waits for its own")
    func together() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        let b = queue.record(.assessment, xpBefore: 110, stageVisible: true)
        let c = queue.record(.vocabSession, xpBefore: 125, stageVisible: true)
        queue.resolve(a.id, xpAfter: 110, allowsFlights: true)
        queue.resolve(b.id, xpAfter: 125, allowsFlights: true)
        let first = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(first?.amount == 25)
        #expect(!queue.hasConfirmedGain)
        queue.resolve(c.id, xpAfter: 130, allowsFlights: true)
        let second = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(second?.amount == 5)
    }

    @Test("Landing twice is harmless, and a landed flight is no longer flying")
    func landing() throws {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        let taken = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        let flight = try #require(taken)
        #expect(queue.isFlying(flight.id))
        queue.land(flight.id)
        queue.land(flight.id)
        #expect(!queue.isFlying(flight.id))
        #expect(queue.held == 0)
    }
}

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

    @Test("Only the newest request asked is the newest: an older answer is dropped even before the newer lands")
    func newestAsked() {
        var order = LatestOnly()
        let first = order.issue()
        #expect(order.isNewestAsked(first))
        let second = order.issue()
        #expect(!order.isNewestAsked(first))
        #expect(order.isNewestAsked(second))
        let third = order.issue()
        #expect(!order.isNewestAsked(second))
        #expect(order.isNewestAsked(third))
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

    @Test("A total that falls before the entry resolves holds nothing: the pill never shows less than the task started at")
    func decreaseBeforeResolve() {
        var queue = CelebrationQueue()
        let entry = queue.record(.homework, xpBefore: 100, stageVisible: true)
        #expect(queue.held(xpNow: 100) == 0)
        #expect(queue.held(xpNow: 90) == 0, "an adjustment took XP back: nothing is owed, and nothing negative is held")
        #expect(queue.held(xpNow: 0) == 0)
        let gained = queue.resolve(entry.id, xpAfter: 90, allowsFlights: true)
        #expect(gained == 0)
        #expect(queue.held == 0)
        #expect(queue.held(xpNow: 90) == 0)
        #expect(queue.isEmpty, "a task that earned nothing leaves nothing behind")
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight == nil)
    }

    @Test("A rise, then a fall, before the entry resolves: the hold follows the total, never below the start")
    func riseThenDecreaseBeforeResolve() {
        var queue = CelebrationQueue()
        let entry = queue.record(.assessment, xpBefore: 100, stageVisible: true)
        #expect(queue.held(xpNow: 130) == 30, "a refresh beat the task's own: held at once")
        #expect(queue.held(xpNow: 110) == 10, "then a correction landed: only what is still above the start is held")
        #expect(queue.held(xpNow: 95) == 0)
        let gained = queue.resolve(entry.id, xpAfter: 110, allowsFlights: true)
        #expect(gained == 10)
        #expect(queue.held == 10)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 10)
    }

    @Test("A fall a task's own read finds does not take the next task's gain away")
    func decreaseThenNextTask() {
        var queue = CelebrationQueue()
        let first = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(first.id, xpAfter: 90, allowsFlights: true)
        let next = queue.record(.survey, xpBefore: 90, stageVisible: true)
        let gained = queue.resolve(next.id, xpAfter: 105, allowsFlights: true)
        #expect(gained == 15, "measured from where the pill stood, not from the 100 it had been")
        #expect(queue.held == 15)
    }

    @Test("A take-back below the highest total measured: the next task's real gain is counted whole")
    func takeBackBelowHighWater() {
        var queue = CelebrationQueue()
        let first = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(first.id, xpAfter: 130, allowsFlights: true)
        let landed = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        if let landed { queue.land(landed.id) }
        // An adjustment took 10 back: the header reads 120, and the next task is handed in there.
        let next = queue.record(.survey, xpBefore: 120, stageVisible: true)
        #expect(queue.held(xpNow: 120) == 0)
        #expect(queue.held(xpNow: 135) == 15, "a refresh that beat the task's own holds the whole gain, so the pill never shows it early")
        let gained = queue.resolve(next.id, xpAfter: 135, allowsFlights: true)
        #expect(gained == 15, "not 5: XP above the total now is not there to be claimed")
        #expect(queue.held == 15)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 15)
    }

    @Test("A take-back one task's read finds lowers the floor of a task still waiting on its own")
    func takeBackSeenByAnotherRead() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        let b = queue.record(.assessment, xpBefore: 100, stageVisible: true)
        let c = queue.record(.survey, xpBefore: 100, stageVisible: true)
        let aGained = queue.resolve(a.id, xpAfter: 130, allowsFlights: true)
        let bGained = queue.resolve(b.id, xpAfter: 120, allowsFlights: true)
        #expect(aGained == 30)
        #expect(bGained == 0, "its read found the take-back: nothing new")
        #expect(queue.held(xpNow: 135) == 45, "the 30 still to fly, and the 15 above where the total fell to")
        let cGained = queue.resolve(c.id, xpAfter: 135, allowsFlights: true)
        #expect(cGained == 15)
        #expect(queue.held == 45)
    }

    @Test("After a take-back two tasks still never claim the same gain, and nothing is over-reported")
    func takeBackNoDoubleCount() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        // 5 taken back (the header reads 110), then two tasks handed in there.
        let b = queue.record(.survey, xpBefore: 110, stageVisible: true)
        let c = queue.record(.vocabSession, xpBefore: 110, stageVisible: true)
        let bGained = queue.resolve(b.id, xpAfter: 125, allowsFlights: true)
        let cGained = queue.resolve(c.id, xpAfter: 125, allowsFlights: true)
        #expect(bGained == 15)
        #expect(cGained == 0, "the same read: counted once")
        #expect(queue.held == 30, "+15 and +15 — exactly what the server paid, the take-back aside")
    }

    @Test("An away baseline under a gain still in the air lowers nothing: the gain is never flown twice")
    func awayBaselineDoesNotLowerTheFloor() {
        var queue = CelebrationQueue()
        let task = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(task.id, xpAfter: 130, allowsFlights: true)
        // The header still shows 100 — 30 are held for the flight — so that is the baseline the
        // welcome-back check measures from.
        let away = queue.recordAway(xpSeen: 100)
        #expect(queue.held(xpNow: 130) == 30)
        let gained = queue.resolve(away, xpAfter: 130, allowsFlights: true)
        #expect(gained == 0)
        #expect(queue.held == 30)
    }

    @Test("An entry waits on its read until it is resolved, whatever its check is doing")
    func awaitsRead() {
        var queue = CelebrationQueue()
        #expect(!queue.awaitsRead)
        let shown = queue.record(.homework, xpBefore: 100, stageVisible: true)
        #expect(queue.awaitsRead)
        queue.resolve(shown.id, xpAfter: 100, allowsFlights: true)
        #expect(!queue.awaitsRead)
        let hidden = queue.record(.assessment, xpBefore: 100, stageVisible: false)
        queue.resolve(hidden.id, xpAfter: 100, allowsFlights: true)
        #expect(!queue.awaitsRead, "its check still waits for the stage, but nothing is being measured")
        #expect(!queue.isEmpty)
        let away = queue.recordAway(xpSeen: 100)
        #expect(queue.awaitsRead)
        queue.resolve(away, xpAfter: nil, allowsFlights: true)
        #expect(!queue.awaitsRead, "a failed read resolves too")
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

/// A flight carries every confirmed gain whose check has played — an away gain with its caption
/// and a task's gain without one fly together, and the caption belongs to the one that has it.
/// Every mutating call is made on its own line, never inside `#expect`.
@Suite struct MergedFlightTests {

    @Test("An away gain and a task's gain fly as one, captioned by the away gain, in either order of resolve")
    func mergedLabel() {
        // The task is measured past what the away read already counted, so nothing is flown twice.
        var awayFirst = CelebrationQueue()
        let away = awayFirst.recordAway(xpSeen: 100)
        let task = awayFirst.record(.homework, xpBefore: 100, stageVisible: true).id
        awayFirst.resolve(away, xpAfter: 130, allowsFlights: true, label: "Attendance")
        awayFirst.resolve(task, xpAfter: 145, allowsFlights: true)
        let first = awayFirst.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(first?.amount == 45)
        #expect(first?.label == "Attendance")

        var taskFirst = CelebrationQueue()
        let sameAway = taskFirst.recordAway(xpSeen: 100)
        let sameTask = taskFirst.record(.homework, xpBefore: 100, stageVisible: true).id
        taskFirst.resolve(sameTask, xpAfter: 115, allowsFlights: true)
        taskFirst.resolve(sameAway, xpAfter: 145, allowsFlights: true, label: "Attendance")
        let second = taskFirst.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(second?.amount == 45)
        #expect(second?.label == "Attendance")
    }

    @Test("The caption does not depend on which gain was recorded first")
    func labelAnyOrder() {
        var queue = CelebrationQueue()
        let task = queue.record(.vocabSession, xpBefore: 100, stageVisible: true).id
        let away = queue.recordAway(xpSeen: 100)
        queue.resolve(task, xpAfter: 110, allowsFlights: true)
        queue.resolve(away, xpAfter: 140, allowsFlights: true, label: "Homework + 2 more")
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 40)
        #expect(flight?.label == "Homework + 2 more")
    }

    @Test("Gains with no caption between them fly uncaptioned")
    func noLabel() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true).id
        let b = queue.record(.survey, xpBefore: 110, stageVisible: true).id
        queue.resolve(a, xpAfter: 110, allowsFlights: true)
        queue.resolve(b, xpAfter: 120, allowsFlights: true)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 20)
        #expect(flight?.label == nil)
    }

    @Test("A task whose check has not played waits for its own flight; it does not borrow the away caption")
    func hiddenTaskStaysOut() {
        var queue = CelebrationQueue()
        let task = queue.record(.assessment, xpBefore: 100, stageVisible: false).id
        let away = queue.recordAway(xpSeen: 100)
        queue.resolve(away, xpAfter: 130, allowsFlights: true, label: "Attendance")
        queue.resolve(task, xpAfter: 145, allowsFlights: true)

        let awayFlight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(awayFlight?.amount == 30)
        #expect(awayFlight?.label == "Attendance")
        if let awayFlight { queue.land(awayFlight.id) }

        let shown = queue.takeEfforts(stageVisible: true)
        #expect(shown == [.assessment])
        let taskFlight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(taskFlight?.amount == 15)
        #expect(taskFlight?.label == nil, "the caption was said once, with the gain it named")
    }
}

import Foundation
import Testing
@testable import MasterSATKit

@Suite struct EventInviteRulesTests {

    let now = JSONCoding.parseServerDate("2026-09-25T12:00:00+05:00")!

    private func event(
        id: Int, startsIn hours: Double?, canSignUp: Bool = true, seatsLeft: Int = 5
    ) -> LearningEvent {
        let formatter = ISO8601DateFormatter()
        let startsAt = hours.map { formatter.string(from: now.addingTimeInterval($0 * 3600)) } ?? ""
        return LearningEvent(
            id: id, title: "Talk \(id)", startsAt: startsAt,
            endsAt: startsAt, seats: 40, seatsLeft: seatsLeft, canSignUp: canSignUp
        )
    }

    @Test("The soonest open event is the one worth interrupting for")
    func soonestWins() {
        let featured = EventInviteRules.featured([
            event(id: 1, startsIn: 72),
            event(id: 2, startsIn: 24),
            event(id: 3, startsIn: 48),
        ])
        #expect(featured?.id == 2)
    }

    @Test("A sooner event the server will not seat is skipped")
    func closedSkipped() {
        let featured = EventInviteRules.featured([
            event(id: 1, startsIn: 6, canSignUp: false),
            event(id: 2, startsIn: 48),
        ])
        #expect(featured?.id == 2)
    }

    @Test("A full event is closed, so the first open row need not be the first row")
    func fullSkipped() {
        // `can_sign_up` is the server's whole answer: a full event arrives with it false.
        let featured = EventInviteRules.featured([
            event(id: 1, startsIn: 12, canSignUp: false, seatsLeft: 0),
            event(id: 2, startsIn: 30),
        ])
        #expect(featured?.id == 2)
    }

    @Test("An event already shown this launch is not offered again")
    func shownSkipped() {
        let events = [event(id: 1, startsIn: 24), event(id: 2, startsIn: 48)]
        #expect(EventInviteRules.featured(events, shown: [1])?.id == 2)
        #expect(EventInviteRules.featured(events, shown: [1, 2]) == nil)
    }

    @Test("An empty list — a failed load among them — names nothing")
    func emptyList() {
        #expect(EventInviteRules.featured([]) == nil)
        #expect(EventInviteRules.featured([event(id: 1, startsIn: 24, canSignUp: false)]) == nil)
    }

    @Test("An event with no readable start never beats one that knows its date")
    func unreadableStartSortsLast() {
        #expect(EventInviteRules.featured([
            event(id: 1, startsIn: nil),
            event(id: 2, startsIn: 96),
        ])?.id == 2)
        // On its own it is still a seat worth offering.
        #expect(EventInviteRules.featured([event(id: 1, startsIn: nil)])?.id == 1)
    }

    @Test("Two events at the same minute are settled by id, not by chance")
    func sameStart() {
        #expect(EventInviteRules.featured([
            event(id: 7, startsIn: 24),
            event(id: 4, startsIn: 24),
        ])?.id == 4)
    }
}

@MainActor
@Suite struct EventInviteMemoryTests {

    @Test("Remembered per event id, so one prompt does not silence the next event")
    func perEvent() {
        let memory = EventInviteMemory()
        #expect(memory.wasShown(12) == false)
        memory.remember(12)
        #expect(memory.wasShown(12))
        #expect(memory.wasShown(13) == false)
        #expect(memory.shownIds == [12])
    }

    @Test("What the memory holds is what the rules skip")
    func feedsTheRules() {
        let memory = EventInviteMemory()
        let events = [
            LearningEvent(id: 1, title: "A", startsAt: "2026-09-26T10:00:00+05:00", endsAt: "", canSignUp: true),
            LearningEvent(id: 2, title: "B", startsAt: "2026-09-27T10:00:00+05:00", endsAt: "", canSignUp: true),
        ]
        let first = EventInviteRules.featured(events, shown: memory.shownIds)
        #expect(first?.id == 1)
        memory.remember(first!.id)
        #expect(EventInviteRules.featured(events, shown: memory.shownIds)?.id == 2)
    }
}

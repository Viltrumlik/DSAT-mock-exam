import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ReminderPlanTests {

    /// A fixed instant, so "tomorrow" means the same thing on every run.
    let now = Date(timeIntervalSince1970: 1_785_000_000)  // 2026-08-04T09:20:00Z

    private func iso(_ offset: TimeInterval) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: now.addingTimeInterval(offset))
    }

    private func assignment(id: Int, dueIn: TimeInterval?, status: String? = nil, title: String = "Reading set") throws -> AssignmentListing {
        var object: [String: Any] = ["id": id, "title": title, "classroom_name": "Senior A"]
        if let dueIn { object["due_at"] = iso(dueIn) }
        if let status { object["workflow_status"] = status }
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONCoding.decoder.decode(AssignmentListing.self, from: data)
    }

    private func midterm(
        id: Int,
        opensIn: TimeInterval?,
        submitted: Bool = false,
        resultsVisible: Bool = false,
        score: Int? = nil,
        attemptId: Int? = nil
    ) throws -> MidtermListing {
        var object: [String: Any] = [
            "midterm_id": id, "title": "Midterm \(id)", "subject": "READING_WRITING",
            "submitted": submitted, "results_visible": resultsVisible,
        ]
        if let opensIn { object["available_at"] = iso(opensIn) }
        if let score { object["score"] = score }
        if let attemptId { object["attempt_id"] = attemptId }
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONCoding.decoder.decode(MidtermListing.self, from: data)
    }

    @Test("A homework due in five days is warned about twice, the day before and hours before")
    func twoLeadTimes() throws {
        let plan = ReminderPlan.build(
            assignments: [try assignment(id: 7, dueIn: 5 * 24 * 3600)],
            midterms: [],
            now: now
        )

        #expect(plan.count == 2)
        #expect(plan.map(\.id) == ["homework-7-86400", "homework-7-10800"])
        // Soonest first — the order the device will keep them in.
        #expect(plan[0].fireAt < plan[1].fireAt)
        #expect(plan.allSatisfy { $0.kind == .homework })
        #expect(plan[0].body == "Reading set · Senior A")
    }

    @Test("Work already handed in is not chased")
    func submittedWorkIsSilent() throws {
        for status in ["submitted", "graded", "reviewed", "GRADED"] {
            let plan = ReminderPlan.build(
                assignments: [try assignment(id: 1, dueIn: 3 * 24 * 3600, status: status)],
                midterms: [],
                now: now
            )
            #expect(plan.isEmpty, "\(status) should not be reminded about")
        }
    }

    @Test("Lead times already in the past are dropped, not fired on sight")
    func pastLeadTimesAreDropped() throws {
        // Due in five hours: the 24h warning is long gone, the 3h one is still ahead.
        let plan = ReminderPlan.build(
            assignments: [try assignment(id: 3, dueIn: 5 * 3600)],
            midterms: [],
            now: now
        )
        #expect(plan.map(\.id) == ["homework-3-10800"])

        // Due within the hour: nothing left to warn about. Scheduling here would fire both
        // reminders the instant the list loaded.
        let imminent = ReminderPlan.build(
            assignments: [try assignment(id: 4, dueIn: 900)],
            midterms: [],
            now: now
        )
        #expect(imminent.isEmpty)
    }

    @Test("A homework with no due date is not invented one")
    func noDueDateNoReminder() throws {
        let plan = ReminderPlan.build(
            assignments: [try assignment(id: 9, dueIn: nil)],
            midterms: [],
            now: now
        )
        #expect(plan.isEmpty)
    }

    @Test("A midterm is warned about until it has been sat")
    func midtermLeadTimes() throws {
        let upcoming = try midterm(id: 2, opensIn: 4 * 24 * 3600)
        let plan = ReminderPlan.build(assignments: [], midterms: [upcoming], now: now)

        #expect(plan.map(\.id) == ["midterm-2-86400", "midterm-2-3600"])
        #expect(plan[0].body == "Midterm 2 · Reading Writing")

        let sat = try midterm(id: 2, opensIn: 4 * 24 * 3600, submitted: true)
        #expect(ReminderPlan.build(assignments: [], midterms: [sat], now: now).isEmpty)
    }

    @Test("Switching a kind off removes it and leaves the rest")
    func kindsCanBeTurnedOff() throws {
        let assignments = [try assignment(id: 1, dueIn: 3 * 24 * 3600)]
        let midterms = [try midterm(id: 1, opensIn: 3 * 24 * 3600)]

        let onlyMidterms = ReminderPlan.build(
            assignments: assignments, midterms: midterms, now: now, enabled: [.midterm]
        )
        #expect(onlyMidterms.allSatisfy { $0.kind == .midterm })
        #expect(onlyMidterms.count == 2)

        let none = ReminderPlan.build(
            assignments: assignments, midterms: midterms, now: now, enabled: []
        )
        #expect(none.isEmpty)
    }

    @Test("Past the device's 64-slot ceiling, the soonest survive")
    func deviceLimitKeepsTheSoonest() throws {
        // 50 homeworks, two reminders each — 100 requests for 64 slots. iOS drops the
        // overflow silently, so the choice of which to lose has to be ours.
        let assignments = try (1...50).map { try assignment(id: $0, dueIn: Double($0) * 24 * 3600) }
        let plan = ReminderPlan.build(assignments: assignments, midterms: [], now: now)

        #expect(plan.count == ReminderPlan.deviceLimit)
        #expect(plan == plan.sorted { $0.fireAt < $1.fireAt })
        // The first homework due is the first one warned about.
        #expect(plan.first?.id == "homework-1-10800")
        // Nothing beyond the cut-off leaked in.
        let latestKept = try #require(plan.last?.fireAt)
        #expect(latestKept < now.addingTimeInterval(50 * 24 * 3600))
    }

    @Test("The same input twice is the same plan — ids carry no timestamp")
    func planIsStableAcrossRebuilds() throws {
        let assignments = [try assignment(id: 5, dueIn: 2 * 24 * 3600)]
        let first = ReminderPlan.build(assignments: assignments, midterms: [], now: now)
        let second = ReminderPlan.build(assignments: assignments, midterms: [], now: now)

        // Rescheduling runs on every load. An id built from "now" would stack a fresh copy
        // of the same reminder each time until the student had forty of them.
        #expect(first == second)
    }

    // MARK: - Published scores

    @Test("A published score is announced once and never again")
    func publishedScoreAnnouncedOnce() throws {
        let published = try midterm(id: 1, opensIn: nil, submitted: true, resultsVisible: true, score: 640, attemptId: 88)

        let first = ReminderPlan.newlyPublished(midterms: [published], announced: [])
        #expect(first.count == 1)
        #expect(first[0].id == "results-88")
        #expect(first[0].kind == .results)

        let again = ReminderPlan.newlyPublished(midterms: [published], announced: [88])
        #expect(again.isEmpty)
    }

    @Test("A sealed result is not announced")
    func sealedResultStaysQuiet() throws {
        // Sat, scored, but the teacher has not published it. Announcing here would tell a
        // student their score exists before their class is allowed to know it.
        let sealed = try midterm(id: 1, opensIn: nil, submitted: true, resultsVisible: false, score: 640, attemptId: 88)
        #expect(ReminderPlan.newlyPublished(midterms: [sealed], announced: []).isEmpty)

        // Published, but nothing to say yet.
        let noScore = try midterm(id: 2, opensIn: nil, submitted: true, resultsVisible: true, attemptId: 89)
        #expect(ReminderPlan.newlyPublished(midterms: [noScore], announced: []).isEmpty)
    }
}

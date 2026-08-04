import Foundation

/// One thing the phone will say, and when.
///
/// Deliberately a value type with no UserNotifications import: what to remind a student
/// about is a rule, and a rule belongs where it can be tested without a device.
public struct StudentReminder: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable, CaseIterable, Codable {
        /// A homework due date coming up.
        case homework
        /// A scheduled midterm about to open.
        case midterm
        /// A score the teacher has just published.
        case results
    }

    /// Stable and derived from what it is about, never from when it was made. Rescheduling
    /// runs on every load, and an id containing a timestamp would stack a fresh copy of the
    /// same reminder each time until the student had forty of them.
    public let id: String
    public let kind: Kind
    public let title: String
    public let body: String
    public let fireAt: Date

    public init(id: String, kind: Kind, title: String, body: String, fireAt: Date) {
        self.id = id
        self.kind = kind
        self.title = title
        self.body = body
        self.fireAt = fireAt
    }
}

/// Turns what the student has been set into what the phone should say.
public enum ReminderPlan {
    /// iOS keeps only the **64 soonest** pending notifications per app and silently drops
    /// the rest. A busy student with a term of homework would sail past that, and the ones
    /// lost would be the far-future ones — which is the right order to lose them in, but
    /// only if we do the sorting ourselves rather than letting the system pick.
    public static let deviceLimit = 64

    /// How far ahead each kind warns. Two each: one the night before, when there is still
    /// time to do something about it, and one close enough to act on immediately.
    static let homeworkLeadTimes: [TimeInterval] = [24 * 3600, 3 * 3600]
    static let midtermLeadTimes: [TimeInterval] = [24 * 3600, 3600]

    /// Every reminder worth setting, soonest first, already capped to what the device keeps.
    ///
    /// `now` is a parameter rather than `Date()` so the rule can be tested at a fixed
    /// instant — the whole reason this lives in the kit.
    public static func build(
        assignments: [AssignmentListing],
        midterms: [MidtermListing],
        now: Date = Date(),
        enabled: Set<StudentReminder.Kind> = Set(StudentReminder.Kind.allCases),
        calendar: Calendar = .current
    ) -> [StudentReminder] {
        var out: [StudentReminder] = []

        if enabled.contains(.homework) {
            for assignment in assignments where needsDoing(assignment) {
                guard let raw = assignment.dueAt,
                      let due = JSONCoding.parseServerDate(raw) else { continue }
                for lead in homeworkLeadTimes {
                    let fireAt = due.addingTimeInterval(-lead)
                    // Nothing is scheduled in the past. A homework set the morning it is due
                    // would otherwise fire both of its reminders the instant it loaded.
                    guard fireAt > now else { continue }
                    out.append(StudentReminder(
                        id: "homework-\(assignment.id)-\(Int(lead))",
                        kind: .homework,
                        title: leadTitle(lead, subject: "Homework", calendar: calendar, fireAt: fireAt, target: due),
                        body: bodyLine(assignment.title, detail: assignment.classroomName),
                        fireAt: fireAt
                    ))
                }
            }
        }

        if enabled.contains(.midterm) {
            for midterm in midterms where !midterm.submitted {
                guard let raw = midterm.availableAt,
                      let opens = JSONCoding.parseServerDate(raw) else { continue }
                for lead in midtermLeadTimes {
                    let fireAt = opens.addingTimeInterval(-lead)
                    guard fireAt > now else { continue }
                    out.append(StudentReminder(
                        id: "midterm-\(midterm.midtermId)-\(Int(lead))",
                        kind: .midterm,
                        title: leadTitle(lead, subject: "Midterm", calendar: calendar, fireAt: fireAt, target: opens),
                        body: bodyLine(midterm.title, detail: midterm.subject.isEmpty ? nil : midterm.subject.humanised),
                        fireAt: fireAt
                    ))
                }
            }
        }

        // Sorted before the cap, so what survives is what happens next. The id tiebreak
        // keeps the output stable when two reminders share an instant — otherwise the same
        // input could produce two different plans and the reschedule would churn.
        out.sort { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
        return Array(out.prefix(deviceLimit))
    }

    /// Scores published since the last time the app looked.
    ///
    /// A local notification cannot detect a publication while the app is closed — there is
    /// no push transport on this platform yet. So this is what it honestly is: the app
    /// noticing, the moment it next runs, and saying so once. `announced` is what has
    /// already been said, and the caller persists it.
    public static func newlyPublished(
        midterms: [MidtermListing],
        announced: Set<Int>
    ) -> [StudentReminder] {
        midterms
            .filter { $0.submitted && $0.resultsVisible && $0.score != nil }
            .compactMap { midterm in
                guard let attemptId = midterm.attemptId, !announced.contains(attemptId) else { return nil }
                return StudentReminder(
                    id: "results-\(attemptId)",
                    kind: .results,
                    title: "Your midterm score is ready",
                    body: bodyLine(midterm.title, detail: "Tap to see which skills to work on"),
                    // Immediately: this is news, and there is nothing to count down to.
                    fireAt: Date()
                )
            }
            .sorted { $0.id < $1.id }
    }

    // MARK: - Wording

    /// Nothing here names the student as late or lacking. "Due tomorrow" is a fact; the
    /// student is never the subject of the sentence.
    private static func leadTitle(
        _ lead: TimeInterval,
        subject: String,
        calendar: Calendar,
        fireAt: Date,
        target: Date
    ) -> String {
        if lead >= 24 * 3600 {
            // "Tomorrow" only when it really is the next day where the student is standing.
            // A paper opening at 09:00 warned 24h earlier lands on the previous morning,
            // which is tomorrow — but one opening at 00:30 does not.
            let sameDay = calendar.isDate(
                target,
                inSameDayAs: calendar.date(byAdding: .day, value: 1, to: fireAt) ?? fireAt
            )
            return sameDay ? "\(subject) tomorrow" : "\(subject) in a day"
        }
        let hours = max(1, Int((lead / 3600).rounded()))
        return hours == 1 ? "\(subject) in an hour" : "\(subject) in \(hours) hours"
    }

    private static func bodyLine(_ title: String, detail: String?) -> String {
        let name = title.isEmpty ? "Untitled" : title
        guard let detail, !detail.isEmpty else { return name }
        return "\(name) · \(detail)"
    }
}

extension String {
    /// `READING_WRITING` → `Reading Writing`. The app has its own copy of this for display;
    /// the kit needs one too, because reminder text is built here.
    var humanised: String {
        replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}

private extension ReminderPlan {
    /// Work that is finished needs no reminder. `workflow_status` is the server's call, and
    /// the client must not recompute it — the rule lives with the grading pipeline.
    static func needsDoing(_ assignment: AssignmentListing) -> Bool {
        switch (assignment.workflowStatus ?? "").lowercased() {
        case "graded", "reviewed", "submitted": return false
        default: return true
        }
    }
}

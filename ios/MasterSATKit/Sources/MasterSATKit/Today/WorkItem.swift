import Foundation

// What Today's "Up next" and the Class tab's To do are made of. Pure, so the order a student
// meets their work in is tested rather than eyeballed (`TodayPlanTests`).

// MARK: - Done, or still owed

/// Whether a homework still asks anything of the student.
///
/// `workflow_status` alone cannot say. On a quiz homework it is the FIRST quiz's status, so a
/// second quiz can still be open under "graded"; and a homework of word sets is never handed in
/// at all — a word set is finished by playing it. So every quiz and word set on the row must be
/// finished, and then either the server says the work is in, or quizzes and word sets were all
/// there was. A paper sat on a computer, or a file to hand in, leaves no trace on the list row,
/// so for those the server's word is the only word.
public enum HomeworkProgress {
    /// Content sat on a computer, under exam conditions.
    static let paperKinds: Set<String> = ["PASTPAPER", "MOCK", "PRACTICE"]

    public static func isDone(_ homework: AssignmentListing) -> Bool {
        if homework.assessmentHomeworks.contains(where: { !AssessmentCardState.of($0.progress).isDone }) {
            return false
        }
        if homework.vocabHomeworks.contains(where: { $0.state.lowercased() != "completed" }) {
            return false
        }
        if ProfileHomework.isTurnedIn(homework.workflowStatus) { return true }
        let played = !homework.assessmentHomeworks.isEmpty || !homework.vocabHomeworks.isEmpty
        let leavesNoTrace = homework.offersFileUpload
            || homework.contents.contains { paperKinds.contains($0.kind) }
        return played && !leavesNoTrace
    }
}

// MARK: - One row

/// One thing to do: a homework still owed, or one of today's lessons.
public struct WorkItem: Identifiable, Sendable, Equatable {
    /// What the row looks like — the first thing a student reads off a list.
    public enum Look: String, Sendable, Equatable {
        case quiz, words, paper, handIn, lesson, exam
    }

    public enum Source: Sendable, Equatable {
        case homework(AssignmentListing)
        case lesson(ScheduleEvent)
    }

    public let source: Source
    public let look: Look
    public let title: String
    /// "Math ODD · 2 quizzes · 1 word set" — where it is from, and what is inside.
    public let detail: String
    /// Past its deadline and still owed. Drawn "Catch up · Tue" — never "Overdue". Classwork is
    /// never owed, so it is never a catch-up, whatever date it carries.
    public let catchUp: Bool
    /// The deadline as the server wrote it, for the app's `DueLabel`. Nil for a lesson.
    public let dueAt: String?
    /// When a lesson starts. Nil for homework.
    public let start: Date?
    /// "up to +N XP": the live HOMEWORK rule's maximum, only while the deadline is ahead — a
    /// homework is settled as of its deadline, so work finished after it earns nothing more.
    public let xpCap: Int?

    public var id: String {
        switch source {
        case .homework(let homework): return "homework-\(homework.id)"
        case .lesson(let event): return "lesson-\(event.id)"
        }
    }

    /// The homework behind the row; nil for a lesson.
    public var assignment: AssignmentListing? {
        if case .homework(let homework) = source { return homework }
        return nil
    }

    /// Classwork is a homework row that is done in class, not owed.
    public var isClasswork: Bool { assignment?.isClasswork ?? false }

    /// The time the schedule gave a lesson, as it wrote it ("18:00", "13:00-15:00") — nil for
    /// homework and for a lesson with no clock time. `start` of such a lesson is its day's
    /// midnight, and a row must say the day only, never "00:00".
    public var clockText: String? {
        guard case .lesson(let event) = source,
              !ProfileLessons.clockTimes(in: event.time).isEmpty else { return nil }
        return event.time.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func homework(_ homework: AssignmentListing, homeworkXP: Int?, now: Date = Date()) -> WorkItem {
        let due = homework.dueAt.flatMap(JSONCoding.parseServerDate)
        let catchUp = !homework.isClasswork && (due.map { $0 < now } ?? false)
        var cap: Int?
        if let homeworkXP, homeworkXP > 0, !catchUp, !homework.isClasswork { cap = homeworkXP }
        let detail = [homework.classroomName ?? "", contentsLine(homework)]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return WorkItem(
            source: .homework(homework),
            look: look(of: homework),
            title: homework.title.isEmpty ? "Homework" : homework.title,
            detail: detail,
            catchUp: catchUp,
            dueAt: homework.dueAt,
            start: nil,
            xpCap: cap
        )
    }

    public static func lesson(_ event: ScheduleEvent, start: Date) -> WorkItem {
        WorkItem(
            source: .lesson(event),
            look: event.type == .classMeeting ? .lesson : .exam,
            title: event.title.isEmpty ? "Lesson" : event.title,
            detail: event.sub,
            catchUp: false,
            dueAt: nil,
            start: start,
            xpCap: nil
        )
    }

    /// The homework list's own reading of a bundle: a quiz first, then a paper, then words.
    static func look(of homework: AssignmentListing) -> Look {
        if !homework.assessmentHomeworks.isEmpty { return .quiz }
        if homework.contents.contains(where: { HomeworkProgress.paperKinds.contains($0.kind) }) { return .paper }
        if !homework.vocabHomeworks.isEmpty { return .words }
        return .handIn
    }

    /// "2 quizzes · 1 paper on a computer · 3 word sets"; empty for a plain hand-in.
    public static func contentsLine(_ homework: AssignmentListing) -> String {
        var parts: [String] = []
        let quizzes = homework.assessmentHomeworks.count
        if quizzes > 0 { parts.append(quizzes == 1 ? "1 quiz" : "\(quizzes) quizzes") }
        let papers = homework.contents.filter { HomeworkProgress.paperKinds.contains($0.kind) }.count
        if papers > 0 { parts.append(papers == 1 ? "1 paper on a computer" : "\(papers) papers on a computer") }
        let sets = homework.vocabHomeworks.count
        if sets > 0 { parts.append(sets == 1 ? "1 word set" : "\(sets) word sets") }
        return parts.joined(separator: " · ")
    }

    /// Work to catch up on first, the longest-waiting first; then by deadline; undated last.
    public static func ordered(_ items: [WorkItem]) -> [WorkItem] {
        items.sorted { a, b in
            if a.catchUp != b.catchUp { return a.catchUp }
            let da = a.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
            let db = b.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
            if da != db { return da < db }
            return (a.assignment?.id ?? 0) < (b.assignment?.id ?? 0)
        }
    }
}

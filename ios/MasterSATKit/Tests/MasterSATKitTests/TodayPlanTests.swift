import Foundation
import Testing
@testable import MasterSATKit

/// Homework rows on top of `ProfileFixtures` (Tashkent, Monday 14 September 2026, 15:30).
enum WorkFixtures {
    typealias F = ProfileFixtures

    static func quiz(_ homeworkId: Int, _ workflow: String) -> [String: Any] {
        let state = ["graded": "completed", "submitted": "completed", "in_progress": "in_progress"][workflow] ?? "not_started"
        return [
            "homework_id": homeworkId,
            "set": ["id": homeworkId, "subject": "math", "title": "Quiz \(homeworkId)"],
            "progress": ["workflow_status": workflow, "state": state],
        ]
    }

    static func words(_ id: Int, _ state: String, count: Int = 10) -> [String: Any] {
        ["id": id, "set_id": id, "set_title": "Set \(id)", "section_title": "", "word_count": count, "state": state]
    }

    static func midterm(_ attempt: Int, released: Bool = true) throws -> MidtermListing {
        try F.decode(MidtermListing.self, [
            "midterm_id": attempt, "title": "Midterm \(attempt)", "subject": "MATH", "attempt_id": attempt,
            "submitted": true, "results_visible": released, "score": 640,
        ])
    }

    /// The classroom each lesson row belongs to, in the order the plan lists them.
    static func lessonRooms(_ plan: TodayPlan) -> [Int?] {
        plan.lessons.map { item in
            if case .lesson(let event) = item.source { return event.classroomId }
            return nil
        }
    }

    /// A homework in a class. `status` is the row's `workflow_status`.
    static func homework(
        _ id: Int, due: String?, status: String = "NOT_STARTED", classroom: Int = 1,
        className: String = "Math ODD", extra: [String: Any] = [:]
    ) throws -> AssignmentListing {
        var more: [String: Any] = ["classroom_id": classroom, "classroom_name": className]
        more.merge(extra) { _, new in new }
        return try F.homework(id, "Homework \(id)", due: due, status: status, extra: more)
    }
}

@Suite struct HomeworkProgressTests {
    typealias W = WorkFixtures

    @Test("A hand-in is done once it is with the teacher, and owed again when sent back")
    func handIn() throws {
        #expect(HomeworkProgress.isDone(try W.homework(1, due: nil, status: "SUBMITTED")))
        #expect(HomeworkProgress.isDone(try W.homework(2, due: nil, status: "GRADED")))
        #expect(!HomeworkProgress.isDone(try W.homework(3, due: nil, status: "RETURNED")))
        #expect(!HomeworkProgress.isDone(try W.homework(4, due: nil)))
    }

    @Test("A second quiz still open keeps the homework open, whatever the first one says")
    func quizzes() throws {
        let one = try W.homework(1, due: nil, status: "graded", extra: ["assessment_homeworks": [W.quiz(11, "graded")]])
        let two = try W.homework(2, due: nil, status: "graded", extra: [
            "assessment_homeworks": [W.quiz(21, "graded"), W.quiz(22, "not_started")],
        ])
        #expect(HomeworkProgress.isDone(one))
        #expect(!HomeworkProgress.isDone(two))
    }

    @Test("Word sets are finished by playing them, never by handing in")
    func words() throws {
        let finished = try W.homework(1, due: nil, extra: ["vocab_homeworks": [W.words(5, "completed"), W.words(6, "completed")]])
        let started = try W.homework(2, due: nil, extra: ["vocab_homeworks": [W.words(5, "completed"), W.words(6, "in_progress")]])
        #expect(HomeworkProgress.isDone(finished))
        #expect(!HomeworkProgress.isDone(started))
    }

    @Test("A quiz done does not finish a homework whose word set is still owed")
    func mixed() throws {
        let homework = try W.homework(1, due: nil, status: "graded", extra: [
            "assessment_homeworks": [W.quiz(11, "graded")],
            "vocab_homeworks": [W.words(5, "not_started")],
        ])
        #expect(!HomeworkProgress.isDone(homework))
    }

    @Test("A paper sat on a computer counts only once the server says so")
    func papers() throws {
        let paper: [String: Any] = ["contents": [["kind": "PASTPAPER", "title": "Paper"]]]
        #expect(!HomeworkProgress.isDone(try W.homework(1, due: nil, extra: paper)))
        #expect(HomeworkProgress.isDone(try W.homework(2, due: nil, status: "SUBMITTED", extra: paper)))
    }

    @Test("A word set with no words is never owed, whatever its state says")
    func emptyWordSetNeverOwed() throws {
        let quizDone: [[String: Any]] = [W.quiz(11, "graded")]
        // The quiz is graded; the teacher has not filled the set yet.
        let withEmpty = try W.homework(1, due: nil, status: "graded", extra: [
            "assessment_homeworks": quizDone, "vocab_homeworks": [W.words(5, "not_started", count: 0)],
        ])
        // A played set beside an empty one: the empty one holds nothing back.
        let playedBesideEmpty = try W.homework(2, due: nil, extra: [
            "vocab_homeworks": [W.words(5, "completed"), W.words(6, "not_started", count: 0)],
        ])
        // A set that can be played and is not finished still is owed, empty neighbour or not.
        let stillOwed = try W.homework(3, due: nil, extra: [
            "vocab_homeworks": [W.words(5, "not_started"), W.words(6, "not_started", count: 0)],
        ])
        #expect(HomeworkProgress.isDone(withEmpty))
        #expect(HomeworkProgress.isDone(playedBesideEmpty))
        #expect(!HomeworkProgress.isDone(stillOwed))
    }

    @Test("A homework of nothing but empty word sets is done: there is nothing to do")
    func onlyEmptyWordSetsIsDone() throws {
        let empty = [W.words(5, "not_started", count: 0), W.words(6, "not_started", count: 0)]
        #expect(HomeworkProgress.isDone(try W.homework(1, due: nil, extra: ["vocab_homeworks": empty])))
        // Not when the student is still asked for a file, or to sit a paper: the server's word is the only word.
        #expect(!HomeworkProgress.isDone(try W.homework(2, due: nil, extra: [
            "vocab_homeworks": empty, "allow_file_upload": true,
        ])))
        #expect(!HomeworkProgress.isDone(try W.homework(3, due: nil, extra: [
            "vocab_homeworks": empty, "contents": [["kind": "MOCK", "title": "Mock"]],
        ])))
    }

    @Test("Once the teacher fills the set, the homework is owed again")
    func filledSetOwedAgain() throws {
        func homework(words: Int) throws -> AssignmentListing {
            try W.homework(1, due: nil, extra: ["vocab_homeworks": [W.words(5, "not_started", count: words)]])
        }
        #expect(HomeworkProgress.isDone(try homework(words: 0)))
        #expect(!HomeworkProgress.isDone(try homework(words: 12)))
    }
}

@Suite struct WorkItemTests {
    typealias W = WorkFixtures
    typealias F = ProfileFixtures

    @Test("A row says what kind of work it is: quiz, paper, words, or a hand-in")
    func looks() throws {
        let quiz = try W.homework(1, due: nil, extra: [
            "assessment_homeworks": [W.quiz(11, "not_started")], "vocab_homeworks": [W.words(5, "not_started")],
        ])
        let paper = try W.homework(2, due: nil, extra: [
            "contents": [["kind": "MOCK", "title": "Mock"]], "vocab_homeworks": [W.words(5, "not_started")],
        ])
        let words = try W.homework(3, due: nil, extra: ["vocab_homeworks": [W.words(5, "not_started")]])
        let handIn = try W.homework(4, due: nil)
        #expect(WorkItem.homework(quiz, homeworkXP: nil, now: F.now).look == .quiz)
        #expect(WorkItem.homework(paper, homeworkXP: nil, now: F.now).look == .paper)
        #expect(WorkItem.homework(words, homeworkXP: nil, now: F.now).look == .words)
        #expect(WorkItem.homework(handIn, homeworkXP: nil, now: F.now).look == .handIn)
    }

    @Test("The detail line names the class and what is inside")
    func detail() throws {
        let bundle = try W.homework(1, due: nil, extra: [
            "assessment_homeworks": [W.quiz(11, "not_started"), W.quiz(12, "not_started")],
            "vocab_homeworks": [W.words(5, "not_started")],
        ])
        #expect(WorkItem.homework(bundle, homeworkXP: nil, now: F.now).detail == "Math ODD · 2 quizzes · 1 word set")
        #expect(WorkItem.homework(try W.homework(2, due: nil), homeworkXP: nil, now: F.now).detail == "Math ODD")
    }

    @Test("Up to +N XP only while the deadline is ahead — work finished late earns nothing more")
    func xpCap() throws {
        let ahead = try W.homework(1, due: F.at(2))
        let passed = try W.homework(2, due: F.at(-1))
        let undated = try W.homework(3, due: nil)
        #expect(WorkItem.homework(ahead, homeworkXP: 15, now: F.now).xpCap == 15)
        #expect(WorkItem.homework(undated, homeworkXP: 15, now: F.now).xpCap == 15)
        #expect(WorkItem.homework(passed, homeworkXP: 15, now: F.now).xpCap == nil)
        #expect(WorkItem.homework(passed, homeworkXP: 15, now: F.now).catchUp)
        #expect(WorkItem.homework(ahead, homeworkXP: nil, now: F.now).xpCap == nil)
    }

    @Test("Catching up comes first, the longest-waiting first; then by deadline; undated last")
    func order() throws {
        let rows = try [
            W.homework(1, due: nil),
            W.homework(2, due: F.at(3)),
            W.homework(3, due: F.at(-1)),
            W.homework(4, due: F.at(1)),
            W.homework(5, due: F.at(-4)),
        ].map { WorkItem.homework($0, homeworkXP: nil, now: F.now) }
        #expect(WorkItem.ordered(rows).compactMap { $0.assignment?.id } == [5, 3, 4, 2, 1])
    }
}

@Suite struct TodayPlanTests {
    typealias W = WorkFixtures
    typealias F = ProfileFixtures

    @Test("Up next holds every homework still owed; done work is not on it")
    func homeworkOwed() throws {
        let plan = TodayPlan(assignments: [
            try W.homework(1, due: F.at(1)),
            try W.homework(2, due: F.at(2), status: "SUBMITTED"),
            try W.homework(3, due: F.at(-1)),
        ], events: [], homeworkXP: 15, now: F.now, calendar: F.calendar)
        #expect(plan.homework.compactMap { $0.assignment?.id } == [3, 1])
    }

    @Test("Today's lessons still to come, by time; one that has ended and tomorrow's are not")
    func lessons() throws {
        let plan = TodayPlan(assignments: [], events: [
            try F.lesson("2026-09-14", "18:00", classroom: 1),
            try F.lesson("2026-09-14", "09:00-11:00", classroom: 2),
            try F.lesson("2026-09-15", "18:00", classroom: 1),
            try F.lesson("2026-09-14", "", classroom: nil, type: "midterm"),
        ], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(plan.lessons.map(\.look) == [.exam, .lesson])
        #expect(plan.lessons.last?.start == F.local(14, 18))
    }

    @Test("A lesson the schedule gave no clock time has none to show: the day only, never 00:00")
    func untimedLesson() throws {
        let plan = TodayPlan(assignments: [], events: [
            try F.lesson("2026-09-14", "", classroom: nil, type: "midterm"),
            try F.lesson("2026-09-14", "Evening", classroom: nil, type: "mock"),
            try F.lesson("2026-09-14", "16:00-17:30", classroom: 2),
            try F.lesson("2026-09-14", " 18:00 ", classroom: 1),
        ], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(plan.lessons.count == 4)
        #expect(plan.lessons.filter { $0.clockText == nil }.count == 2)
        #expect(plan.lessons.compactMap(\.clockText) == ["16:00-17:30", "18:00"])
        #expect(WorkItem.homework(try W.homework(1, due: nil), homeworkXP: nil, now: F.now).clockText == nil)
    }

    @Test("A class's own lesson length decides when its lesson is over: three hours, started 2.5 hours ago, is still on")
    func lessonLengthPerClass() throws {
        // Both began at 13:00; it is 15:30. Class 1 meets for three hours, class 2 for two.
        let events = [
            try F.lesson("2026-09-14", "13:00", classroom: 1),
            try F.lesson("2026-09-14", "13:00", classroom: 2),
        ]
        let plan = TodayPlan(
            assignments: [], events: events, homeworkXP: nil, lessonHours: [1: 3, 2: 2],
            now: F.now, calendar: F.calendar
        )
        #expect(W.lessonRooms(plan) == [1])
    }

    @Test("A class with no lesson length gets two hours, as its next-lesson card does")
    func classWithoutLengthGetsTwoHours() throws {
        let events = [
            try F.lesson("2026-09-14", "14:00", classroom: 1),   // 14:00-16:00 by default: still on
            try F.lesson("2026-09-14", "13:00", classroom: 2),   // 13:00-15:00: over
            try F.lesson("2026-09-14", "13:00", classroom: 3),   // a length of 0 is no length
            try F.lesson("2026-09-14", "13:00", classroom: nil, type: "mock"),
        ]
        let plan = TodayPlan(
            assignments: [], events: events, homeworkXP: nil, lessonHours: [3: 0, 9: 4],
            now: F.now, calendar: F.calendar
        )
        #expect(W.lessonRooms(plan) == [1])
    }

    @Test("The lesson lengths come off the classes: one entry per class that states a length")
    func lessonHoursByClass() throws {
        let rooms = [
            try F.room(["id": 1, "lesson_hours": 3]),
            try F.room(["id": 2]),
            try F.room(["id": 3, "lesson_hours": 2]),
        ]
        #expect(TodayPlan.lessonHours(of: rooms) == [1: 3, 3: 2])
        #expect(TodayPlan.lessonHours(of: []).isEmpty)
    }

    @Test("Lessons follow the homework, and only the homework is cut to the limit")
    func upNextLimit() throws {
        let homework = try (1...8).map { try W.homework($0, due: F.at(Double($0))) }
        let plan = TodayPlan(
            assignments: homework, events: [try F.lesson("2026-09-14", "18:00", classroom: 1)],
            homeworkXP: nil, now: F.now, calendar: F.calendar
        )
        let next = plan.upNext(limit: 6)
        #expect(next.items.count == 7)
        #expect(next.items.last?.look == .lesson)
        #expect(next.more == 2)
    }

    @Test("The week's ring counts homework due Monday to Sunday, done against all of it")
    func week() throws {
        let plan = TodayPlan(assignments: [
            try W.homework(1, due: F.at(2)),                      // Wednesday
            try W.homework(2, due: F.at(4), status: "SUBMITTED"),  // Friday, handed in
            try W.homework(3, due: F.at(-0.5)),                   // this morning, to catch up
            try W.homework(4, due: F.at(-1)),                     // last Sunday
            try W.homework(5, due: F.at(7)),                      // next Monday
            try W.homework(6, due: nil),
        ], events: [], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(plan.week == TodayPlan.Progress(done: 1, total: 3))
        #expect(!plan.week.isComplete)
    }

    @Test("Nothing owed and no lesson left: all clear, and the week is complete")
    func allClear() throws {
        let plan = TodayPlan(
            assignments: [try W.homework(1, due: F.at(1), status: "GRADED")], events: [],
            homeworkXP: nil, now: F.now, calendar: F.calendar
        )
        #expect(plan.isAllClear)
        #expect(plan.week.isComplete)
    }

    @Test("Classwork is done in class: never owed, never on Up next, never in the week's ring")
    func classwork() throws {
        let classwork: [String: Any] = ["category": "CLASSWORK"]
        let onlyClasswork = TodayPlan(assignments: [
            try W.homework(1, due: nil, extra: classwork),
            try W.homework(2, due: F.at(2), extra: classwork),
        ], events: [], homeworkXP: 15, now: F.now, calendar: F.calendar)
        #expect(onlyClasswork.upNext(limit: 6).items.isEmpty)
        #expect(onlyClasswork.upNext(limit: 6).more == 0)
        #expect(onlyClasswork.isAllClear)
        #expect(onlyClasswork.week == TodayPlan.Progress(done: 0, total: 0))

        let mixed = TodayPlan(assignments: [
            try W.homework(3, due: F.at(2), extra: classwork),
            try W.homework(4, due: F.at(3)),
            try W.homework(5, due: F.at(4), status: "SUBMITTED"),
        ], events: [], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(mixed.homework.compactMap { $0.assignment?.id } == [4])
        #expect(!mixed.isAllClear)
        #expect(mixed.week == TodayPlan.Progress(done: 1, total: 2))
    }

    @Test("A homework of only empty word sets is neither done nor counted in the week's ring")
    func emptyWordSetsOutOfTheRing() throws {
        let empty: [String: Any] = ["vocab_homeworks": [W.words(5, "not_started", count: 0)]]
        // A week whose only due homework has nothing in it yet: nothing due, never "1 of 1".
        let onlyEmpty = TodayPlan(assignments: [try W.homework(1, due: F.at(2), extra: empty)],
                                  events: [], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(onlyEmpty.week == TodayPlan.Progress(done: 0, total: 0))
        #expect(!onlyEmpty.week.isComplete)
        // So the all-done moment can never fire for it.
        #expect(!TodayPlan.justFinished(previous: TodayPlan.Progress(done: 0, total: 0), current: onlyEmpty.week))

        // A filled set beside it still counts, and finishing it completes the week.
        let filled: [String: Any] = ["vocab_homeworks": [W.words(6, "not_started")]]
        let played: [String: Any] = ["vocab_homeworks": [W.words(6, "completed")]]
        let before = TodayPlan(assignments: [
            try W.homework(1, due: F.at(2), extra: empty),
            try W.homework(2, due: F.at(3), extra: filled),
        ], events: [], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(before.week == TodayPlan.Progress(done: 0, total: 1))
        let after = TodayPlan(assignments: [
            try W.homework(1, due: F.at(2), extra: empty),
            try W.homework(2, due: F.at(3), extra: played),
        ], events: [], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(after.week == TodayPlan.Progress(done: 1, total: 1))
        #expect(TodayPlan.justFinished(previous: before.week, current: after.week))
    }

    @Test("Up to +N comes from the live HOMEWORK rule, and only when it pays XP")
    func homeworkXP() {
        #expect(TodayPlan.homeworkXP([RewardRule(event: "HOMEWORK", label: "Homework", points: 15)]) == 15)
        #expect(TodayPlan.homeworkXP([RewardRule(event: "HOMEWORK", label: "Homework", points: 15, grantsXP: false)]) == nil)
        #expect(TodayPlan.homeworkXP([RewardRule(event: "HOMEWORK_FULL", label: "Old", points: 15)]) == nil)
        #expect(TodayPlan.homeworkXP([]) == nil)
    }

    @Test("The fresh result is the newest released score not yet looked at")
    func freshResult() throws {
        let list = [try W.midterm(3), try W.midterm(7), try W.midterm(9, released: false)]
        #expect(TodayPlan.freshResult(list, seen: [], firstRun: false)?.attemptId == 7)
        #expect(TodayPlan.freshResult(list, seen: [7], firstRun: false)?.attemptId == 3)
        #expect(TodayPlan.freshResult(list, seen: [3, 7], firstRun: false) == nil)
    }

    @Test("The first time Today ever loads, results already out are old news: no card, all marked seen")
    func firstRunMarksEverythingSeen() throws {
        let list = [try W.midterm(3), try W.midterm(7), try W.midterm(9, released: false)]
        #expect(TodayPlan.freshResult(list, seen: [], firstRun: true) == nil)
        let seen = TodayPlan.releasedAttempts(list)
        #expect(seen == [3, 7])
        // A result released afterwards is the one that surfaces, the unreleased one included.
        let later = list + [try W.midterm(11)]
        #expect(TodayPlan.freshResult(later, seen: seen, firstRun: false)?.attemptId == 11)
        let nowReleased = [try W.midterm(3), try W.midterm(7), try W.midterm(9)]
        #expect(TodayPlan.freshResult(nowReleased, seen: seen, firstRun: false)?.attemptId == 9)
    }

    @Test("The week counts as just finished only on the step from not done to done")
    func justFinished() {
        let p = TodayPlan.Progress.init(done:total:)
        #expect(TodayPlan.justFinished(previous: p(2, 3), current: p(3, 3)))
        #expect(TodayPlan.justFinished(previous: p(2, 3), current: p(4, 4)))
        #expect(!TodayPlan.justFinished(previous: nil, current: p(3, 3)))
        #expect(!TodayPlan.justFinished(previous: p(3, 3), current: p(3, 3)))
        #expect(!TodayPlan.justFinished(previous: p(0, 0), current: p(0, 0)))
        #expect(!TodayPlan.justFinished(previous: p(1, 3), current: p(2, 3)))
    }
}

import Foundation

/// The Today tab, worked out: the homework still owed across every class, today's lessons
/// still to come, and how much of this week's homework is done.
///
/// Classwork is not homework. It is done in class and has no deadline by rule, so it is never
/// owed: it is left out of everything here — Up next, "all clear", and the week's ring.
public struct TodayPlan: Sendable, Equatable {
    /// Homework due this week, done against all of it — the hero ring. Classwork is not counted.
    public struct Progress: Sendable, Equatable {
        public let done: Int
        public let total: Int

        public init(done: Int, total: Int) {
            self.done = done
            self.total = total
        }

        public var fraction: Double { total > 0 ? Double(done) / Double(total) : 0 }
        /// Something was due, and all of it is in. Nothing due is not "done".
        public var isComplete: Bool { total > 0 && done == total }
    }

    /// Every homework still owed (never classwork), in `WorkItem.ordered` order.
    public let homework: [WorkItem]
    /// Today's lessons (and papers sat in the centre) not yet over, by start time.
    public let lessons: [WorkItem]
    public let week: Progress

    public init(
        assignments: [AssignmentListing],
        events: [ScheduleEvent],
        homeworkXP: Int?,
        lessonHours: [Int: Int] = [:],
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        let assigned = assignments.filter { !$0.isClasswork }
        homework = WorkItem.ordered(
            assigned
                .filter { !HomeworkProgress.isDone($0) }
                .map { WorkItem.homework($0, homeworkXP: homeworkXP, now: now) }
        )
        lessons = Self.todaysLessons(events, lessonHours: lessonHours, now: now, calendar: calendar)
        week = Self.week(assigned, now: now, calendar: calendar)
    }

    /// Nothing owed and nothing left today.
    public var isAllClear: Bool { homework.isEmpty && lessons.isEmpty }

    /// Up next: at most `limit` homework, then every lesson left today — and how many homework
    /// rows did not fit.
    public func upNext(limit: Int) -> (items: [WorkItem], more: Int) {
        let shown = Array(homework.prefix(max(0, limit)))
        return (shown + lessons, homework.count - shown.count)
    }

    /// The most a homework pays, read off the live rules — nil when the rule is missing, pays
    /// nothing, or pays points but no XP.
    public static func homeworkXP(_ rules: [RewardRule]) -> Int? {
        guard let rule = rules.first(where: { $0.event == "HOMEWORK" }), rule.grantsXP, rule.points > 0 else {
            return nil
        }
        return rule.points
    }

    /// Each class's lesson length, by classroom id, for `init(lessonHours:)`. A class with no
    /// length is left out — absent means the default two hours, the same as a length of 0.
    public static func lessonHours(of classes: [Classroom]) -> [Int: Int] {
        Dictionary(classes.compactMap { room in room.lessonHours.map { (room.id, $0) } }, uniquingKeysWith: { first, _ in first })
    }

    /// The newest released midterm score the student has not opened from Today.
    ///
    /// On the very first load (`firstRun`: nothing is stored for this student yet) nothing is
    /// fresh. Every score already out was released before the student ever opened Today, and a
    /// card for a score from last month reads as news that is not; the caller marks
    /// `releasedAttempts` seen instead, so only a result released later surfaces.
    public static func freshResult(_ midterms: [MidtermListing], seen: Set<Int>, firstRun: Bool) -> MidtermListing? {
        guard !firstRun else { return nil }
        return released(midterms)
            .filter { $0.attemptId.map { !seen.contains($0) } ?? false }
            .max { ($0.attemptId ?? 0) < ($1.attemptId ?? 0) }
    }

    /// Every released midterm score, by attempt — what the first load marks seen.
    public static func releasedAttempts(_ midterms: [MidtermListing]) -> Set<Int> {
        Set(released(midterms).compactMap(\.attemptId))
    }

    private static func released(_ midterms: [MidtermListing]) -> [MidtermListing] {
        midterms.filter { $0.submitted && $0.resultsVisible && $0.score != nil }
    }

    /// The step from "not all done" to "all done" — the moment the hero celebrates. Never on
    /// the first look, and never for a week with nothing due.
    public static func justFinished(previous: Progress?, current: Progress) -> Bool {
        guard let previous, previous.total > 0, !previous.isComplete else { return false }
        return current.isComplete
    }

    /// `lessonHours` is each class's lesson length (classroom id → hours). A lesson whose class
    /// has no entry, and a mock or midterm (no class), lasts the default two hours.
    static func todaysLessons(_ events: [ScheduleEvent], lessonHours: [Int: Int], now: Date, calendar: Calendar) -> [WorkItem] {
        let kinds: Set<ScheduleEvent.Kind> = [.classMeeting, .mock, .midterm]
        return events
            .filter { kinds.contains($0.type) }
            .compactMap { event -> (event: ScheduleEvent, start: Date)? in
                guard let day = ProfileCalendar.date(fromDay: event.date, calendar: calendar),
                      calendar.isDate(day, inSameDayAs: now),
                      let window = ProfileLessons.window(
                          of: event,
                          hours: ProfileLessons.lessonLength(hours: event.classroomId.flatMap { lessonHours[$0] }),
                          calendar: calendar
                      ),
                      window.end > now else { return nil }
                return (event, window.start)
            }
            .sorted { $0.start != $1.start ? $0.start < $1.start : $0.event.id < $1.event.id }
            .map { WorkItem.lesson($0.event, start: $0.start) }
    }

    /// Monday to Sunday — the learning center's week (ODD classes meet Mon, Wed, Fri). The
    /// caller passes homework only; classwork has no place in the ring. Nor has a homework of
    /// only empty word sets (`HomeworkProgress.asksNothingYet`): `isDone` lets it through, and
    /// counted, a week holding nothing else would read "1 of 1" — all done, and celebrated — for
    /// work nobody did. The Me sheet's Homework figure leaves it out the same way.
    static func week(_ assignments: [AssignmentListing], now: Date, calendar: Calendar) -> Progress {
        var weekCalendar = calendar
        weekCalendar.firstWeekday = 2
        guard let week = weekCalendar.dateInterval(of: .weekOfYear, for: now) else {
            return Progress(done: 0, total: 0)
        }
        let due = assignments.filter { homework in
            guard !HomeworkProgress.asksNothingYet(homework) else { return false }
            guard let date = homework.dueAt.flatMap(JSONCoding.parseServerDate) else { return false }
            return date >= week.start && date < week.end
        }
        return Progress(done: due.filter(HomeworkProgress.isDone).count, total: due.count)
    }
}

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
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        let assigned = assignments.filter { !$0.isClasswork }
        homework = WorkItem.ordered(
            assigned
                .filter { !HomeworkProgress.isDone($0) }
                .map { WorkItem.homework($0, homeworkXP: homeworkXP, now: now) }
        )
        lessons = Self.todaysLessons(events, now: now, calendar: calendar)
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

    /// The newest released midterm score the student has not opened from Today.
    public static func freshResult(_ midterms: [MidtermListing], seen: Set<Int>) -> MidtermListing? {
        midterms
            .filter { $0.submitted && $0.resultsVisible && $0.score != nil }
            .filter { $0.attemptId.map { !seen.contains($0) } ?? false }
            .max { ($0.attemptId ?? 0) < ($1.attemptId ?? 0) }
    }

    /// The step from "not all done" to "all done" — the moment the hero celebrates. Never on
    /// the first look, and never for a week with nothing due.
    public static func justFinished(previous: Progress?, current: Progress) -> Bool {
        guard let previous, previous.total > 0, !previous.isComplete else { return false }
        return current.isComplete
    }

    static func todaysLessons(_ events: [ScheduleEvent], now: Date, calendar: Calendar) -> [WorkItem] {
        let kinds: Set<ScheduleEvent.Kind> = [.classMeeting, .mock, .midterm]
        return events
            .filter { kinds.contains($0.type) }
            .compactMap { event -> (event: ScheduleEvent, start: Date)? in
                guard let day = ProfileCalendar.date(fromDay: event.date, calendar: calendar),
                      calendar.isDate(day, inSameDayAs: now),
                      let window = ProfileLessons.window(of: event, hours: 2, calendar: calendar),
                      window.end > now else { return nil }
                return (event, window.start)
            }
            .sorted { $0.start != $1.start ? $0.start < $1.start : $0.event.id < $1.event.id }
            .map { WorkItem.lesson($0.event, start: $0.start) }
    }

    /// Monday to Sunday — the learning center's week (ODD classes meet Mon, Wed, Fri). The
    /// caller passes homework only; classwork has no place in the ring.
    static func week(_ assignments: [AssignmentListing], now: Date, calendar: Calendar) -> Progress {
        var weekCalendar = calendar
        weekCalendar.firstWeekday = 2
        guard let week = weekCalendar.dateInterval(of: .weekOfYear, for: now) else {
            return Progress(done: 0, total: 0)
        }
        let due = assignments.filter { homework in
            guard let date = homework.dueAt.flatMap(JSONCoding.parseServerDate) else { return false }
            return date >= week.start && date < week.end
        }
        return Progress(done: due.filter(HomeworkProgress.isDone).count, total: due.count)
    }
}

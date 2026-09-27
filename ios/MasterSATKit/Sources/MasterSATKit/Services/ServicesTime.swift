import Foundation

/// Time on the learning center's clock.
///
/// The support desk keeps Tashkent hours: the server builds the calendar in Asia/Tashkent,
/// its `YYYY-MM-DD` dates are Tashkent dates, and "one session a day" is a Tashkent day. So
/// every label here is written in Tashkent time, whatever timezone the phone is set to. A
/// student abroad for a week reading "Today, 15:00" must be reading the hour the teacher
/// will actually be at the desk — the phone's own zone would move it.
///
/// English and 24-hour on purpose, like the rest of the site's copy: "Today, 15:00",
/// "Tue, Sep 15, 15:00". The desk is open 08:00–18:00, and "3:00 PM" would disagree with the
/// hero tile that says so.
public enum ServicesTime {
    /// Asia/Tashkent is UTC+5 all year round (no daylight saving since 1992), so the
    /// fixed-offset fallback is exact should the tz database ever lack the name.
    public static let tashkent: TimeZone = TimeZone(identifier: "Asia/Tashkent")
        ?? TimeZone(secondsFromGMT: 5 * 3600)!

    /// A Gregorian calendar pinned to Tashkent — the one every day comparison here uses.
    public static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = tashkent
        c.locale = Locale(identifier: "en_US_POSIX")
        return c
    }()

    /// One day as a strip label: "Today" / "Tomorrow" / "Wed", over "Sep 25".
    public struct DayLabel: Equatable, Sendable {
        public let title: String
        public let sub: String

        public init(title: String, sub: String) {
            self.title = title
            self.sub = sub
        }
    }

    // MARK: - Reading

    /// A server calendar date (`"2026-09-25"`, Tashkent) as the Tashkent midnight that
    /// begins it. Split by hand rather than handed to a formatter: a date-only string read as
    /// an instant lands on UTC midnight, which is the previous day west of Greenwich.
    public static func date(fromDay key: String) -> Date? {
        let parts = key.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
            return nil
        }
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        guard let date = calendar.date(from: components) else { return nil }
        // "2026-02-31" would silently roll into March; a date that does not round-trip is
        // not a date the server sent.
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return date
    }

    /// Whole Tashkent days from `now` to `date`: 0 is today, 1 tomorrow, -1 yesterday.
    public static func dayOffset(of date: Date, from now: Date) -> Int {
        let from = calendar.startOfDay(for: now)
        let to = calendar.startOfDay(for: date)
        return calendar.dateComponents([.day], from: from, to: to).day ?? 0
    }

    // MARK: - Writing

    /// "15:00".
    public static func clock(_ date: Date) -> String {
        clockFormatter.string(from: date)
    }

    /// "15:00" for a server timestamp; the raw string if it does not parse.
    public static func clock(iso: String) -> String {
        guard let date = JSONCoding.parseServerDate(iso) else { return iso }
        return clock(date)
    }

    /// "Today, 15:00" and "Tomorrow, 15:00" earn their names; after that, "Tue, Sep 15, 15:00".
    /// The Services card's "Your next hour".
    public static func hourLabel(_ iso: String, now: Date = Date()) -> String {
        guard let date = JSONCoding.parseServerDate(iso) else { return iso }
        switch dayOffset(of: date, from: now) {
        case 0: return "Today, \(clock(date))"
        case 1: return "Tomorrow, \(clock(date))"
        default: return fullFormatter.string(from: date)
        }
    }

    /// "Tue, Sep 25, 10:00" — a session in the student's list, where "Today" would go stale
    /// in a list that also holds last month.
    public static func sessionWhen(_ iso: String) -> String {
        guard let date = JSONCoding.parseServerDate(iso) else { return iso }
        return fullFormatter.string(from: date)
    }

    /// The day strip's label for a calendar date.
    public static func dayLabel(day key: String, now: Date = Date()) -> DayLabel {
        guard let date = date(fromDay: key) else { return DayLabel(title: key, sub: "") }
        return dayLabel(date, now: now)
    }

    /// The same label for an instant — flattened to its Tashkent day first, so a 15:00 pick
    /// made this morning reads "Today", not "Tomorrow".
    public static func dayLabel(instant iso: String, now: Date = Date()) -> DayLabel {
        guard let date = JSONCoding.parseServerDate(iso) else { return DayLabel(title: iso, sub: "") }
        return dayLabel(date, now: now)
    }

    private static func dayLabel(_ date: Date, now: Date) -> DayLabel {
        let sub = monthDayFormatter.string(from: date)
        switch dayOffset(of: date, from: now) {
        case 0: return DayLabel(title: "Today", sub: sub)
        case 1: return DayLabel(title: "Tomorrow", sub: sub)
        default: return DayLabel(title: weekdayFormatter.string(from: date), sub: sub)
        }
    }

    // MARK: - Formatters

    // Shared, and never mutated after setup. `DateFormatter` is `Sendable` in this SDK —
    // formatting from several threads is safe as long as nobody reconfigures it — so these
    // need no `nonisolated(unsafe)` (the compiler warns that it is unnecessary).
    private static let clockFormatter = formatter("HH:mm")
    private static let fullFormatter = formatter("EEE, MMM d, HH:mm")
    private static let monthDayFormatter = formatter("MMM d")
    private static let weekdayFormatter = formatter("EEE")
    static let longDayFormatter = formatter("MMMM d")
    static let longDayYearFormatter = formatter("MMMM d, yyyy")

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = calendar
        f.timeZone = tashkent
        f.dateFormat = format
        return f
    }
}

/// The SAT dates the learning center is offering — `GET /api/users/exam-dates/`, the same
/// admin-managed list the profile and the countdown read.
public enum ServicesExamDates {
    /// The soonest sitting on offer. The endpoint sorts by the admin's `sort_order`, which is
    /// a display order and not a promise about time, so the earliest is picked here.
    public static func earliest(_ options: [ExamDateOption]) -> ExamDateOption? {
        let dated = options.filter { ServicesTime.date(fromDay: $0.examDate) != nil }
        // `YYYY-MM-DD` compares correctly as a string.
        if let soonest = dated.min(by: { $0.examDate < $1.examDate }) { return soonest }
        // Nothing with a readable date, yet something is on offer: say its label rather than
        // claiming none are open.
        return options.first
    }

    /// How a date is written: its `label` when the admin gave one, otherwise "March 14" —
    /// or "March 14, 2027" when it is not this year. Month first, as the registrar and the
    /// College Board write it. The year is left off the common case because that is how a
    /// student says it, and put back when leaving it off would mislead.
    public static func label(for option: ExamDateOption, now: Date = Date()) -> String {
        let label = option.label.trimmingCharacters(in: .whitespacesAndNewlines)
        if !label.isEmpty { return label }
        guard let date = ServicesTime.date(fromDay: option.examDate) else { return option.examDate }
        let year = ServicesTime.calendar.component(.year, from: date)
        let thisYear = ServicesTime.calendar.component(.year, from: now)
        return year == thisYear
            ? ServicesTime.longDayFormatter.string(from: date)
            : ServicesTime.longDayYearFormatter.string(from: date)
    }
}

import Foundation

/// How one day of a teacher's calendar reads in the day strip.
///
/// Five different reasons for a day, five different words — a student who reads "Full" on
/// a Sunday keeps checking back for a cancellation that is never coming, and one who reads
/// "Full" on a day they have already booked goes looking for a seat that would not help them.
public enum SupportDaySummary: Equatable, Sendable {
    /// Hours still open to this student.
    case free(Int)
    /// The student already has their one session this day.
    case booked
    /// The teacher does not work this day.
    case notWorking
    /// Nothing left because the clock ran out, not because anyone took it.
    case dayOver
    /// Every working hour is taken or withdrawn.
    case full

    /// "3 free" / "Booked" / "Not working" / "Day over" / "Full".
    public var label: String {
        switch self {
        case .free(let count): return "\(count) free"
        case .booked: return "Booked"
        case .notWorking: return "Not working"
        case .dayOver: return "Day over"
        case .full: return "Full"
        }
    }

    public var freeCount: Int {
        if case .free(let count) = self { return count }
        return 0
    }
}

/// One cell of the hour grid, already worded.
public struct SupportHourCell: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        /// The student's own hour.
        case mine
        /// Bookable — the only kind that is a button.
        case open
        /// Shown struck through with its reason. Hiding these would make the week look
        /// sparse for no stated reason.
        case unavailable
    }

    public let kind: Kind
    /// "15:00", Tashkent.
    public let time: String
    /// "Booked" / "Free" / "3 left" / the reason it cannot be taken.
    public let caption: String
    /// An open hour widened for a group: show the seats, not "Free".
    public let isGroup: Bool
    /// The teacher left a note on this open hour; it is read in the confirm sheet.
    public let hasNote: Bool
    public let accessibilityLabel: String

    public var isBookable: Bool { kind == .open }
}

/// The next support hour, worded for a card: "Today, 15:00" with "Dilafruz Karimova".
public struct SupportNextHour: Equatable, Sendable {
    public let booking: SupportBooking
    /// "Today, 15:00" / "Tomorrow, 15:00" / "Tue, Sep 15, 15:00".
    public let when: String
    public let teacher: String

    /// "Today, 15:00 with Dilafruz Karimova" — one line for Home.
    public var sentence: String { teacher.isEmpty ? when : "\(when) with \(teacher)" }
}

/// The support page's rules and wording, kept out of the views so they can be tested.
///
/// Everything here mirrors `frontend/src/features/support` and `…/services`; the server
/// (`backend/classes/support.py`) stays the authority on every limit — nothing in this
/// file refuses a booking, it only says what the calendar already shows.
public enum SupportSchedule {

    // MARK: - Your next hour

    /// The student's next support hour: BOOKED, on an hour the teacher has not withdrawn,
    /// and not over yet — an hour already under way still counts, since the student may be
    /// on their way to it. Earliest first, whatever order the list came in.
    public static func nextHour(in bookings: [SupportBooking], now: Date = Date()) -> SupportBooking? {
        var next: (booking: SupportBooking, starts: Date)?
        for booking in bookings {
            guard booking.status == .booked, !booking.slot.isCancelled,
                  let ends = JSONCoding.parseServerDate(booking.slot.endsAt), ends > now,
                  let starts = JSONCoding.parseServerDate(booking.slot.startsAt) else { continue }
            if next == nil || starts < next!.starts { next = (booking, starts) }
        }
        return next?.booking
    }

    /// `nextHour`, worded. Nil when nothing is booked ahead.
    public static func nextHourSummary(in bookings: [SupportBooking], now: Date = Date()) -> SupportNextHour? {
        guard let booking = nextHour(in: bookings, now: now) else { return nil }
        return SupportNextHour(
            booking: booking,
            when: ServicesTime.hourLabel(booking.slot.startsAt, now: now),
            teacher: booking.slot.supportTeacher
        )
    }

    // MARK: - The day strip

    /// Hours still open to this student on one day.
    public static func openCount(_ day: SupportCalendarDay) -> Int {
        day.hours.filter { $0.state == .open }.count
    }

    /// The student has spent this day: one session a day, so every hour on it carries the
    /// same answer, and the strip says so once instead of ten times.
    public static func isDayTaken(_ day: SupportCalendarDay) -> Bool {
        day.hours.contains { $0.state == .dayTaken || $0.state == .mine }
    }

    public static func summary(for day: SupportCalendarDay) -> SupportDaySummary {
        let free = openCount(day)
        if free > 0 { return .free(free) }
        // Ahead of the other three: a student who has booked Wednesday needs the strip to
        // say so on Wednesday, not "Full".
        if isDayTaken(day) { return .booked }
        let working = day.hours.filter { $0.state != .off }
        if working.isEmpty { return .notWorking }
        // A day with nothing left is usually today running out hour by hour — calling that
        // "Full" would blame the other students for what is just the clock. Judged on the
        // WORKING hours: the web weighed "off" hours too, so a part-time teacher's finished
        // morning read "Full" all afternoon.
        if working.allSatisfy({ $0.state == .past }) { return .dayOver }
        return .full
    }

    /// Open on the first day that still has an hour left (or the student's own), so a student
    /// arriving at 17:30 is not shown a day of greyed-out cells and left to find tomorrow.
    public static func firstLiveDayIndex(_ days: [SupportCalendarDay]) -> Int {
        days.firstIndex { day in day.hours.contains { $0.state == .open || $0.state == .mine } } ?? 0
    }

    /// The hours worth drawing: everything inside the weekly schedule. "He doesn't work
    /// Sunday mornings" is the shape of the timetable, not a fact to strike through eight
    /// times — while "fully booked" and "withdrawn" are facts the student plans around.
    public static func visibleHours(_ day: SupportCalendarDay) -> [SupportHour] {
        day.hours.filter { $0.state != .off }
    }

    // MARK: - The hour grid

    /// Why an hour cannot be taken, in the student's words. Silence would read as a broken button.
    public static func unavailableReason(_ state: SupportHour.State) -> String {
        switch state {
        case .full: return "Fully booked"
        case .closed: return "Not available"
        case .past: return "Already gone"
        // Its own wording: "he isn't in then" is something to plan around; a flat refusal isn't.
        case .off: return "Not working"
        // The one reason about the student rather than the desk — so it says what they have.
        case .dayTaken: return "You have a session today"
        case .unknown: return "Not available"
        case .open, .mine: return ""
        }
    }

    public static func cell(for hour: SupportHour) -> SupportHourCell {
        let time = ServicesTime.clock(iso: hour.startsAt)
        switch hour.state {
        case .mine:
            return SupportHourCell(
                kind: .mine, time: time, caption: "Booked", isGroup: false, hasNote: false,
                accessibilityLabel: "\(time), booked by you"
            )
        case .open:
            let group = hour.capacity > 1
            return SupportHourCell(
                kind: .open,
                time: time,
                caption: group ? "\(hour.seatsLeft) left" : "Free",
                isGroup: group,
                hasNote: !hour.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                accessibilityLabel: group ? "Book \(time), \(hour.seatsLeft) seats left" : "Book \(time)"
            )
        default:
            let reason = unavailableReason(hour.state)
            return SupportHourCell(
                kind: .unavailable, time: time, caption: reason, isGroup: false, hasNote: false,
                accessibilityLabel: "\(time), \(reason)"
            )
        }
    }

    // MARK: - Wording

    /// "Support teacher · Maths A, English B".
    public static func teacherSubtitle(_ teacher: SupportCalendarTeacher) -> String {
        let classes = teacher.classrooms.map(\.name).filter { !$0.isEmpty }
        return classes.isEmpty ? "Support teacher" : "Support teacher · \(classes.joined(separator: ", "))"
    }

    /// The header pill for the chosen day: "3 free" / "Nothing free".
    public static func freePill(_ day: SupportCalendarDay?) -> String {
        let free = day.map(openCount) ?? 0
        return free > 0 ? "\(free) free" : "Nothing free"
    }

    /// The confirm sheet's title: "Today · 10:00 with Dilafruz Karimova". Named off the
    /// picked hour itself, never off whichever day happens to be on screen.
    public static func confirmTitle(startsAt: String, teacher: String, now: Date = Date()) -> String {
        let day = ServicesTime.dayLabel(instant: startsAt, now: now).title
        return "\(day) · \(ServicesTime.clock(iso: startsAt)) with \(teacher)"
    }

    /// "Tue, Sep 25, 10:00 · Maths A".
    public static func sessionLine(_ booking: SupportBooking) -> String {
        let when = ServicesTime.sessionWhen(booking.slot.startsAt)
        guard let classroom = booking.classroomName, !classroom.isEmpty else { return when }
        return "\(when) · \(classroom)"
    }

    /// Growth-oriented on purpose: a missed session is recorded, not named a failure.
    public static func statusLabel(_ booking: SupportBooking) -> String {
        switch booking.status {
        case .booked: return "Booked"
        case .held: return "Attended"
        case .noShow: return "Missed"
        case .cancelled: return "Cancelled"
        case .unknown:
            let raw = booking.statusRaw.replacingOccurrences(of: "_", with: " ").lowercased()
            return raw.isEmpty ? "Booked" : raw.prefix(1).uppercased() + raw.dropFirst()
        }
    }

    /// The hero's first tile: "08:00–18:00".
    public static func openHoursLabel(open: Int, close: Int) -> String {
        "\(twoDigits(open)):00–\(twoDigits(close)):00"
    }

    /// The hero's third tile: "1 of 2 booked". Before the calendar answers, the student's own
    /// list stands in ("1 upcoming"); before either, nothing is claimed.
    public static func sessionsTile(allowance: SupportAllowance?, bookings: [SupportBooking]?) -> String? {
        if let allowance { return "\(allowance.upcoming) of \(allowance.maxUpcoming) booked" }
        if let bookings { return "\(bookings.filter { $0.status == .booked }.count) upcoming" }
        return nil
    }

    /// Said once, up front, when the student is at their limit — rather than letting them
    /// pick an hour, type a topic, press Confirm and only then be refused.
    public static func limitBanner(_ allowance: SupportAllowance?) -> (title: String, message: String)? {
        guard let allowance, !allowance.canBook else { return nil }
        let n = allowance.upcoming
        return (
            "You have \(n) session\(n == 1 ? "" : "s") booked already",
            "Attend one — or cancel it if you can't make it — and you can book another."
        )
    }

    // MARK: - Limits the server enforces on text

    /// `SupportBooking.topic` is a 240-character column and the view does not trim it.
    public static let topicLimit = 240
    /// `cancel_reason`, 280.
    public static let cancelReasonLimit = 280
    /// `rating_comment`, 500.
    public static let ratingCommentLimit = 500

    // MARK: - Cancelling

    /// The reasons that actually come up, so most cancellations are one tap.
    public static let cancelPresets = [
        "I have a lesson clash",
        "I'm unwell",
        "I sorted it out myself",
        "I need a different time",
    ]
    /// Last, and it always opens the box — a list that cannot be escaped collects the
    /// nearest wrong answer.
    public static let cancelOther = "Something else"

    /// The reason to send, or nil while there is none. The server requires one from a
    /// student and shows it to the teacher, who held the hour for them.
    public static func cancelReason(picked: String?, detail: String) -> String? {
        guard let picked else { return nil }
        let reason = picked == cancelOther
            ? detail.trimmingCharacters(in: .whitespacesAndNewlines)
            : picked
        guard !reason.isEmpty else { return nil }
        return String(reason.prefix(cancelReasonLimit))
    }

    // MARK: - Rating

    /// What each star means, said out loud — one student's 3 is another's 5.
    public static func ratingMeaning(_ stars: Int) -> String? {
        switch stars {
        case 1: return "Didn't help"
        case 2: return "A little help"
        case 3: return "Helped"
        case 4: return "Really helped"
        case 5: return "Exactly what I needed"
        default: return nil
        }
    }

    private static func twoDigits(_ n: Int) -> String {
        n < 10 && n >= 0 ? "0\(n)" : String(n)
    }
}

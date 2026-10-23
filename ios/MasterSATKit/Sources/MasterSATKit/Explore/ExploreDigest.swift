import Foundation

// What each Explore card says about its feature right now: "Open now: Quadratics" under the
// roadmap, "Your ticket: SAT strategy talk" under events. The words live here, not in the
// view, so the copy is tested and a card is never a bare title.
//
// Each digest is a pure function of data the feature's own screen already loads. A card
// whose request FAILED is the app's to draw (an error is not an empty state); these only
// word what arrived, and the one place a part may be missing — `services` — says so in
// its signature.

/// One card's live line.
public struct ExploreLine: Equatable, Sendable {
    /// The headline sentence.
    public let text: String
    /// A second, quieter line, when there is one worth reading.
    public let detail: String?
    /// A count for the card's corner, or nil. Never zero: a zero badge is a pill that says
    /// nothing, so the card draws none.
    public let badge: Int?

    public init(text: String, detail: String? = nil, badge: Int? = nil) {
        self.text = text
        self.detail = detail
        self.badge = badge.flatMap { $0 > 0 ? $0 : nil }
    }
}

public enum ExploreDigest {

    // MARK: - Roadmap

    /// One entry per subject the student studies at a level, Math first, and no more than two
    /// — the card is a line, not the ladder. A subject with no own level is left out rather
    /// than drawn as a placeholder (Home's level chips follow the same rule).
    ///
    /// `when` words a lesson's planned day. It stays the app's: a day is written on the
    /// phone's clock, and the kit has no formatter for that.
    public static func roadmap(_ response: RoadmapResponse, when: (Date) -> String) -> ExploreLine {
        guard !response.tracks.isEmpty else {
            return ExploreLine(text: "Join a class to start your roadmap")
        }
        let studied = response.tracks.compactMap { track -> (track: RoadmapTrack, level: String)? in
            guard let level = track.ownLevelLabel, !level.isEmpty else { return nil }
            return (track, level)
        }.prefix(2)
        guard let first = studied.first else {
            return ExploreLine(text: "Your level opens when your class starts")
        }
        return ExploreLine(
            text: studied.map { entry in
                let head = "\(entry.track.subjectLabel) · \(entry.level)"
                // A level with nothing published counts "0 of 0" lessons, which reads as
                // no progress rather than no lessons.
                guard entry.track.totalLessons > 0 else { return head }
                return "\(head) · \(entry.track.completedLessons) of \(entry.track.totalLessons)"
            }.joined(separator: "  ·  "),
            // The first subject's alone: two next-lesson lines would not fit under one card.
            detail: RoadmapRules.nextLesson(in: first.track).map { next in
                switch next {
                case .open(let lesson):
                    return "Open now: \(lesson.title)"
                case .upcoming(let lesson):
                    guard let date = lesson.scheduledDate else { return "Next: \(lesson.title)" }
                    return "Next: \(lesson.title) · \(when(date))"
                case .levelDone(let nextLevel):
                    guard let nextLevel else { return "Top level — every lesson done" }
                    return "Level done — next: \(nextLevel)"
                }
            }
        )
    }

    // MARK: - Services

    /// The support desk and the SAT date, in one card.
    ///
    /// The three parts load on their own and any may have failed, so a missing part is
    /// skipped, never read as "none": bookings that failed do not mean nothing is booked, and
    /// a calendar that failed does not mean no hour is free. Nil only when all three are
    /// missing — then there is nothing to say, and the card keeps its plain subtitle.
    ///
    /// Hours are written on Tashkent's clock, as the booking page shows them.
    public static func services(
        bookings: [SupportBooking]?,
        calendar: SupportCalendar?,
        examDates: [ExamDateOption]?,
        now: Date
    ) -> ExploreLine? {
        guard bookings != nil || calendar != nil || examDates != nil else { return nil }
        let sat = examDates.flatMap(ServicesExamDates.earliest).map {
            "Next SAT: \(ServicesExamDates.dateFirst(for: $0, now: now))"
        }
        // The student's own hour is the news; what the calendar offers only matters without it.
        if let next = bookings.flatMap({ SupportSchedule.nextHourSummary(in: $0, now: now) }) {
            return ExploreLine(text: "Your next hour: \(next.sentence)", detail: sat)
        }
        guard let calendar else {
            return ExploreLine(text: "Book an hour with a teacher", detail: sat)
        }
        return ExploreLine(text: calendarText(calendar, now: now), detail: sat)
    }

    /// Why nothing is bookable comes before what is: a paused or full-up student reads the
    /// reason, not an hour they cannot take. The pause goes first because the server keeps it
    /// out of `canBook` — a paused student reads `canBook == true`.
    private static func calendarText(_ calendar: SupportCalendar, now: Date) -> String {
        if let allowance = calendar.allowance {
            if let until = allowance.pausedUntil {
                // A pause whose date cannot be read is still a pause: say so without the date.
                guard let date = ServicesTime.date(fromDay: until) else { return "Booking is paused for now" }
                return "Booking is paused until \(dayMonthFormatter.string(from: date))"
            }
            if !allowance.canBook { return "You've booked all the hours you can for now" }
        }
        guard !calendar.teachers.isEmpty else { return "No support teacher on your classes yet" }
        // Only hours still ahead: a calendar kept from an earlier read can call an hour open
        // that has started since, and "next" would then name the past.
        let soonest = calendar.teachers.flatMap(\.days).flatMap(\.hours)
            .filter { $0.state == .open }
            .compactMap { hour in hour.startDate.map { (hour: hour, starts: $0) } }
            .filter { $0.starts > now }
            .min { $0.starts < $1.starts }
        guard let soonest else { return "No free hours in the next few days" }
        return "Next free hour: \(ServicesTime.hourLabel(soonest.hour.startsAt, now: now))"
    }

    /// "3 Oct" — a calendar day on the desk's clock, which `pausedUntil` is written in, so a
    /// phone abroad does not slide the date by a day.
    private static let dayMonthFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = ServicesTime.calendar
        f.timeZone = ServicesTime.tashkent
        f.dateFormat = "d MMM"
        return f
    }()

    // MARK: - Events

    /// The one event worth a glance: the student's own ticket first, then something they can
    /// still sign up for, then whatever comes next. The list is the server's, soonest first,
    /// and its order is kept — "first" means soonest.
    ///
    /// A cancelled event is nothing to buy a ticket to or look forward to, so it is dropped
    /// from the line and from the badge alike.
    ///
    /// `when` words the start (the app's formatter, on the phone's clock). `now` is not read:
    /// the server's list is already upcoming-only and `canSignUp` is the server's own verdict,
    /// so no rule here needs a clock; it is in the signature so the call reads like `services`.
    public static func events(_ events: [LearningEvent], now: Date, when: (Date) -> String) -> ExploreLine {
        let live = events.filter { !$0.isCancelled }
        let badge = EventRules.openForSignUp(live)

        func line(_ text: String, _ event: LearningEvent, then extra: String? = nil) -> ExploreLine {
            let parts = [event.startDate.map(when), extra].compactMap { $0 }
            return ExploreLine(
                text: text,
                detail: parts.isEmpty ? nil : parts.joined(separator: " · "),
                badge: badge
            )
        }

        if let held = live.first(where: \.holdsSeat) {
            // Seats minted before tickets existed carry no code; "Ticket " alone is noise.
            let code = (held.myRegistration?.ticketCode ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return line("Your ticket: \(held.title)", held, then: code.isEmpty ? nil : "Ticket \(code)")
        }
        if let open = live.first(where: \.canSignUp) {
            // `seats_left` decodes to 0 when the server did not send it, and an open event with
            // "0 seats left" would contradict its own button; no count is better than that.
            let seats = open.seatsLeft > 0 ? "\(open.seatsLeft) \(open.seatsLeft == 1 ? "seat" : "seats") left" : nil
            return line(open.title, open, then: seats)
        }
        if let soonest = live.first { return line(soonest.title, soonest) }
        return ExploreLine(text: "Nothing coming up right now")
    }

    // MARK: - Surveys

    /// What is waiting, and what finishing it is worth. The points are named because the
    /// survey pays real ones, but only when there are some: a survey worth 0 is legitimate,
    /// and promising a reward it does not pay would be untrue.
    public static func surveys(_ open: [SurveyBrief]) -> ExploreLine {
        guard !open.isEmpty else { return ExploreLine(text: "Nothing waiting for you") }
        let count = open.count
        let points = open.reduce(0) { $0 + $1.pointsAward }
        return ExploreLine(
            text: count == 1 ? "1 survey waiting" : "\(count) surveys waiting",
            detail: points > 0
                ? "Finishing \(count == 1 ? "it" : "them") earns you \(points) \(points == 1 ? "point" : "points")"
                : nil,
            badge: count
        )
    }
}

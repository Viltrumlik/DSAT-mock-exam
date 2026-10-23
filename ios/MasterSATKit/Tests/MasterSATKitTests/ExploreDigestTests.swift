import Foundation
import Testing
@testable import MasterSATKit

// Fixed instants, written in Tashkent time (+05:00), as ServicesTests does.
private func at(_ iso: String) -> Date { JSONCoding.parseServerDate(iso)! }

/// Friday 25 September 2026, 10:00 in Tashkent.
private let now = at("2026-09-25T10:00:00+05:00")

/// Stands in for the app's `CommunityFormat`. It names the Tashkent clock rather than
/// returning a constant, so a test can tell WHICH date was handed over, not just that one was.
private func stamp(_ date: Date) -> String { "WHEN \(ServicesTime.clock(date))" }

// MARK: - Roadmap fixtures

private func lesson(
    _ number: Int, _ title: String, _ state: RoadmapLessonState?,
    scheduled: String? = nil, midterm: Bool = false
) -> RoadmapLesson {
    RoadmapLesson(
        lessonNumber: number, title: title, lessonType: midterm ? "MIDTERM" : "HOMEWORK",
        isMidterm: midterm, state: state, scheduledFor: scheduled
    )
}

/// A subject whose own level is `level` (nil: the student has none there). The own level sits
/// SECOND on the ladder, behind a bare Junior rung, so nothing here works by reading `levels[0]`.
private func track(
    _ subject: String, _ label: String, level: String? = "Middle",
    completed: Int = 0, total: Int = 0, next: String? = nil, lessons: [RoadmapLesson] = []
) -> RoadmapTrack {
    let levels = level.map { name in
        [
            RoadmapLevel(level: "junior", levelLabel: "Junior", lessons: [lesson(1, "Outline only", nil)]),
            RoadmapLevel(level: name.lowercased(), levelLabel: name, isOwnLevel: true, lessons: lessons),
        ]
    } ?? []
    return RoadmapTrack(
        subject: subject, subjectLabel: label,
        ownLevel: level?.lowercased(), ownLevelLabel: level,
        completedLessons: completed, totalLessons: total,
        nextLevel: next?.lowercased(), nextLevelLabel: next,
        levels: levels
    )
}

private func math(
    completed: Int = 2, total: Int = 4, next: String? = "Senior", lessons: [RoadmapLesson]
) -> RoadmapTrack {
    track("math", "Math", level: "Middle", completed: completed, total: total, next: next, lessons: lessons)
}

private func roadmap(_ tracks: RoadmapTrack...) -> RoadmapResponse { RoadmapResponse(tracks: tracks) }

// MARK: - Services fixtures

private func booking(
    teacher: String = "Dilafruz Karimova",
    starts: String = "2026-09-25T10:00:00Z", ends: String = "2026-09-25T11:00:00Z"
) -> SupportBooking {
    SupportBooking(
        id: 1, status: .booked,
        slot: SupportSlot(id: 1, supportTeacher: teacher, startsAt: starts, endsAt: ends)
    )
}

/// One day of hours, each given as its Tashkent clock time and state.
private func day(_ date: String, _ hours: [(String, SupportHour.State)]) -> SupportCalendarDay {
    SupportCalendarDay(
        date: date,
        hours: hours.map { clock, state in
            SupportHour(
                startsAt: "\(date)T\(clock):00+05:00", endsAt: "\(date)T\(clock.prefix(2)):59:59+05:00",
                state: state
            )
        }
    )
}

private func teacher(_ id: Int, _ name: String, _ days: [SupportCalendarDay]) -> SupportCalendarTeacher {
    SupportCalendarTeacher(id: id, name: name, days: days)
}

private func calendar(
    _ teachers: [SupportCalendarTeacher],
    allowance: SupportAllowance? = SupportAllowance(upcoming: 0, canBook: true)
) -> SupportCalendar {
    SupportCalendar(allowance: allowance, teachers: teachers)
}

private func examDate(_ id: Int, _ date: String, _ label: String = "") throws -> ExamDateOption {
    let object: [String: Any] = ["id": id, "exam_date": date, "label": label]
    return try JSONCoding.decoder.decode(ExamDateOption.self, from: JSONSerialization.data(withJSONObject: object))
}

// MARK: - Events and surveys fixtures

private func event(
    _ id: Int, _ title: String = "SAT strategy talk", starts: String = "2026-09-29T15:00:00+05:00",
    seatsLeft: Int = 0, canSignUp: Bool = false, status: String = "PUBLISHED", seat: EventSeat? = nil
) -> LearningEvent {
    LearningEvent(
        id: id, title: title, startsAt: starts, endsAt: "2026-09-29T17:00:00+05:00",
        seatsLeft: seatsLeft, status: status, myRegistration: seat, canSignUp: canSignUp
    )
}

private func ticket(_ code: String, status: String = "REGISTERED") -> EventSeat {
    EventSeat(id: 91, status: status, ticketCode: code)
}

private func survey(_ id: Int, points: Int = 0) -> SurveyBrief {
    SurveyBrief(id: id, title: "Survey \(id)", pointsAward: points)
}

// MARK: - Tests

@Suite struct ExploreDigestTests {

    // MARK: ExploreLine

    @Test("A badge is nil or positive: zero and below never reach a card")
    func lineBadgeIsNilOrPositive() {
        #expect(ExploreLine(text: "x", badge: 0).badge == nil)
        #expect(ExploreLine(text: "x", badge: -2).badge == nil)
        #expect(ExploreLine(text: "x", badge: 3).badge == 3)
    }

    // MARK: Roadmap

    @Test("In no class, the card invites rather than showing an empty ladder")
    func roadmapNoTracks() {
        #expect(ExploreDigest.roadmap(RoadmapResponse(tracks: []), when: stamp)
            == ExploreLine(text: "Join a class to start your roadmap"))
    }

    @Test("Tracks without an own level wait for the class to start")
    func roadmapNoOwnLevel() {
        let line = ExploreDigest.roadmap(roadmap(track("english", "English", level: nil)), when: stamp)
        #expect(line == ExploreLine(text: "Your level opens when your class starts"))
    }

    @Test("One track: its level and progress, and the lesson that is open now")
    func roadmapOneTrackOpenLesson() {
        let lessons = [
            lesson(1, "Linear equations", .completed), lesson(2, "Systems", .completed),
            lesson(3, "Quadratics", .available), lesson(4, "Midterm 4", .upcoming, midterm: true),
        ]
        let line = ExploreDigest.roadmap(roadmap(math(lessons: lessons)), when: stamp)
        #expect(line == ExploreLine(text: "Math · Middle · 2 of 4", detail: "Open now: Quadratics"))
    }

    @Test("A lesson not yet released says when, in the app's own words for the date")
    func roadmapUpcomingWithDate() {
        let lessons = [
            lesson(1, "Linear equations", .completed),
            lesson(2, "Systems", .upcoming, scheduled: "2026-09-29T16:00:00+05:00"),
        ]
        let line = ExploreDigest.roadmap(roadmap(math(lessons: lessons)), when: stamp)
        #expect(line.detail == "Next: Systems · WHEN 16:00")
    }

    @Test("A lesson with no planned date is named without one")
    func roadmapUpcomingNoDate() {
        let lessons = [lesson(1, "Linear equations", .completed), lesson(2, "Systems", .upcoming)]
        let line = ExploreDigest.roadmap(roadmap(math(lessons: lessons)), when: stamp)
        #expect(line.detail == "Next: Systems")
    }

    @Test("A finished level points at the next one")
    func roadmapLevelDoneNext() {
        let lessons = [lesson(1, "Linear equations", .completed), lesson(2, "Systems", .completed)]
        let line = ExploreDigest.roadmap(roadmap(math(completed: 2, total: 2, lessons: lessons)), when: stamp)
        #expect(line == ExploreLine(text: "Math · Middle · 2 of 2", detail: "Level done — next: Senior"))
    }

    @Test("The top level has no next one, and says every lesson is done")
    func roadmapTopLevel() {
        let lessons = [lesson(1, "Linear equations", .completed)]
        let line = ExploreDigest.roadmap(
            roadmap(math(completed: 1, total: 1, next: nil, lessons: lessons)), when: stamp
        )
        #expect(line.detail == "Top level — every lesson done")
    }

    @Test("Two tracks are joined in server order; the detail follows the first")
    func roadmapTwoTracksJoined() {
        let english = track(
            "english", "English", level: "Junior", completed: 1, total: 6,
            lessons: [lesson(1, "Reading", .available)]
        )
        let lessons = [lesson(1, "Linear equations", .completed), lesson(2, "Systems", .available)]
        let line = ExploreDigest.roadmap(roadmap(math(lessons: lessons), english), when: stamp)
        #expect(line.text == "Math · Middle · 2 of 4  ·  English · Junior · 1 of 6")
        #expect(line.detail == "Open now: Systems")
    }

    @Test("A track with no own level is skipped, and the detail comes from the first one left")
    func roadmapSkipsTrackWithoutOwnLevel() {
        let english = track(
            "english", "English", level: "Junior", completed: 1, total: 6,
            lessons: [lesson(1, "Reading", .available)]
        )
        let line = ExploreDigest.roadmap(roadmap(track("math", "Math", level: nil), english), when: stamp)
        #expect(line == ExploreLine(text: "English · Junior · 1 of 6", detail: "Open now: Reading"))
    }

    @Test("A level with nothing published has no count to show")
    func roadmapZeroTotalOmitsCount() {
        let line = ExploreDigest.roadmap(roadmap(math(completed: 0, total: 0, lessons: [])), when: stamp)
        #expect(line.text == "Math · Middle")
    }

    @Test("A level with nothing published is not 'done'")
    func roadmapEmptyLevelIsNotDone() {
        let line = ExploreDigest.roadmap(roadmap(math(completed: 0, total: 0, lessons: [])), when: stamp)
        #expect(line.detail == nil)
    }

    // MARK: nextLesson

    @Test("A lesson open now beats one still to come, wherever it sits; a midterm counts like any lesson")
    func nextLessonPrefersAvailableOverUpcoming() {
        let lessons = [
            lesson(1, "Linear equations", .completed),
            lesson(2, "Systems", .upcoming),
            lesson(3, "Midterm 3", .available, midterm: true),
            lesson(4, "Quadratics", .available),
        ]
        let next = RoadmapRules.nextLesson(in: math(lessons: lessons))
        #expect(next == .open(lessons[2]))
    }

    @Test("With nothing open, the first lesson to come")
    func nextLessonUpcomingWhenNoneOpen() {
        let lessons = [
            lesson(1, "Linear equations", .completed),
            lesson(2, "Systems", .upcoming),
            lesson(3, "Midterm 3", .upcoming, midterm: true),
        ]
        #expect(RoadmapRules.nextLesson(in: math(lessons: lessons)) == .upcoming(lessons[1]))
    }

    @Test("With everything finished, the level is done and names the next one")
    func nextLessonLevelDone() {
        let lessons = [lesson(1, "Linear equations", .completed)]
        #expect(RoadmapRules.nextLesson(in: math(next: "Senior", lessons: lessons)) == .levelDone(nextLevel: "Senior"))
        #expect(RoadmapRules.nextLesson(in: math(next: nil, lessons: lessons)) == .levelDone(nextLevel: nil))
        // A blank label is no label: "next: " must never be drawn.
        #expect(RoadmapRules.nextLesson(in: math(next: "", lessons: lessons)) == .levelDone(nextLevel: nil))
    }

    @Test("No own level, nothing to point at")
    func nextLessonNilWithoutOwnLevel() {
        #expect(RoadmapRules.nextLesson(in: track("english", "English", level: nil)) == nil)
    }

    @Test("An own level with no lessons published yet is not finished, so there is nothing to point at")
    func nextLessonNilWhenOwnLevelHasNoLessons() {
        #expect(RoadmapRules.nextLesson(in: math(lessons: [])) == nil)
    }

    @Test("Only the own level is read: another rung's lessons never become 'next'")
    func nextLessonIgnoresOtherLevels() {
        // A hydrated lesson on a non-own rung cannot come from the server, but the rule should
        // not depend on that.
        let elsewhere = RoadmapLevel(
            level: "senior", levelLabel: "Senior", lessons: [lesson(1, "Advanced", .available)]
        )
        let own = RoadmapLevel(
            level: "middle", levelLabel: "Middle", isOwnLevel: true,
            lessons: [lesson(1, "Linear equations", .completed)]
        )
        let stacked = RoadmapTrack(
            subject: "math", subjectLabel: "Math", ownLevel: "middle", ownLevelLabel: "Middle",
            nextLevelLabel: "Senior", levels: [own, elsewhere]
        )
        #expect(RoadmapRules.nextLesson(in: stacked) == .levelDone(nextLevel: "Senior"))
    }

    @Test("A lesson in a state this build does not know blocks 'done'")
    func nextLessonUnknownStateIsNotDone() {
        let lessons = [lesson(1, "Linear equations", .completed), lesson(2, "Systems", nil)]
        #expect(RoadmapRules.nextLesson(in: math(lessons: lessons)) == nil)
    }

    // MARK: Services

    @Test("Nothing answered, nothing to say: the card shows no line at all")
    func servicesAllNilIsNil() {
        #expect(ExploreDigest.services(bookings: nil, calendar: nil, examDates: nil, now: now) == nil)
    }

    @Test("The student's own next hour wins over everything the calendar could say")
    func servicesBookedHourWins() throws {
        let paused = SupportAllowance(upcoming: 1, canBook: false, pausedUntil: "2026-10-03")
        let line = ExploreDigest.services(
            bookings: [booking()], calendar: calendar([], allowance: paused),
            examDates: [try examDate(1, "2026-10-03")], now: now
        )
        #expect(line == ExploreLine(
            text: "Your next hour: Today, 15:00 with Dilafruz Karimova", detail: "Next SAT: October 3"
        ))
    }

    @Test("A paused student is told until when, as 'd MMM' on Tashkent's calendar")
    func servicesPaused() {
        let paused = SupportAllowance(upcoming: 0, canBook: true, pausedFrom: "2026-09-26", pausedUntil: "2026-10-03")
        let line = ExploreDigest.services(bookings: [], calendar: calendar([], allowance: paused), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "Booking is paused until 3 Oct"))
    }

    @Test("A pause with a date this build cannot read still says it is paused")
    func servicesPausedNoDate() {
        let paused = SupportAllowance(upcoming: 0, canBook: true, pausedUntil: "someday")
        let line = ExploreDigest.services(bookings: [], calendar: calendar([], allowance: paused), examDates: nil, now: now)
        #expect(line?.text == "Booking is paused for now")
    }

    @Test("The pause outranks the limit: it is the reason nothing is bookable")
    func servicesPausedOutranksLimit() {
        let both = SupportAllowance(upcoming: 2, canBook: false, pausedUntil: "2026-10-03")
        let line = ExploreDigest.services(bookings: [], calendar: calendar([], allowance: both), examDates: nil, now: now)
        #expect(line?.text == "Booking is paused until 3 Oct")
    }

    @Test("At the limit, the student is told they have booked all they can")
    func servicesAtLimit() {
        let atLimit = SupportAllowance(upcoming: 2, canBook: false)
        let open = teacher(9, "Dilafruz Karimova", [day("2026-09-25", [("14:00", .open)])])
        let line = ExploreDigest.services(bookings: [], calendar: calendar([open], allowance: atLimit), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "You've booked all the hours you can for now"))
    }

    @Test("No support teacher on the student's classes")
    func servicesNoTeachers() {
        let line = ExploreDigest.services(bookings: [], calendar: calendar([]), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "No support teacher on your classes yet"))
    }

    @Test("The earliest open hour across every teacher and day, skipping hours that are not open")
    func servicesEarliestOpenAcrossTeachers() {
        let first = teacher(9, "Dilafruz Karimova", [
            day("2026-09-25", [("09:00", .past), ("16:00", .open)]),
            day("2026-09-26", [("09:00", .open)]),
        ])
        let second = teacher(10, "Jasur Aliyev", [
            day("2026-09-25", [("11:00", .full), ("12:00", .closed), ("14:00", .open)]),
        ])
        let line = ExploreDigest.services(bookings: [], calendar: calendar([first, second]), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "Next free hour: Today, 14:00"))
    }

    @Test("An open hour tomorrow reads as tomorrow")
    func servicesOpenHourTomorrow() {
        let only = teacher(9, "Dilafruz Karimova", [day("2026-09-26", [("09:00", .open)])])
        let line = ExploreDigest.services(bookings: [], calendar: calendar([only]), examDates: nil, now: now)
        #expect(line?.text == "Next free hour: Tomorrow, 09:00")
    }

    // `ExploreModel` keeps the last calendar when a read fails, so an hour the calendar
    // called open may have started since; "next" never names one that has.
    @Test("An open hour that has already started is not the next free hour")
    func servicesOpenHourBeforeNowSkipped() {
        let stale = teacher(9, "Dilafruz Karimova", [day("2026-09-25", [("08:00", .open), ("10:00", .open), ("15:00", .open)])])
        let line = ExploreDigest.services(bookings: [], calendar: calendar([stale]), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "Next free hour: Today, 15:00"))
    }

    @Test("Every open hour already started: nothing free is offered")
    func servicesOnlyPastOpenHours() {
        let stale = teacher(9, "Dilafruz Karimova", [day("2026-09-25", [("08:00", .open), ("09:00", .open)])])
        let line = ExploreDigest.services(bookings: [], calendar: calendar([stale]), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "No free hours in the next few days"))
    }

    @Test("Teachers with nothing open in the window")
    func servicesNoOpenHours() {
        let full = teacher(9, "Dilafruz Karimova", [day("2026-09-25", [("11:00", .full), ("12:00", .closed), ("13:00", .off)])])
        let line = ExploreDigest.services(bookings: [], calendar: calendar([full]), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "No free hours in the next few days"))
    }

    @Test("The detail is the soonest SAT date on offer, not the admin's first")
    func servicesExamDateDetail() throws {
        let dates = [try examDate(3, "2026-12-05"), try examDate(1, "2026-10-03"), try examDate(2, "2026-11-07", "Nov sitting")]
        let line = ExploreDigest.services(bookings: [], calendar: calendar([]), examDates: dates, now: now)
        #expect(line?.detail == "Next SAT: October 3")
    }

    // The admin labels the options "SAT" — "Next SAT: SAT" said the word twice and hid the
    // date, which is what the line is for (device finding D1).
    @Test("The detail names the date even when the admin labelled the sitting")
    func servicesExamDateDetailIgnoresLabel() throws {
        let dates = [try examDate(3, "2026-12-05", "SAT"), try examDate(1, "2026-10-03", "SAT"), try examDate(2, "2026-11-07", "SAT")]
        let line = ExploreDigest.services(bookings: [], calendar: calendar([]), examDates: dates, now: now)
        #expect(line?.detail == "Next SAT: October 3")
    }

    @Test("A sitting next year carries its year")
    func servicesExamDateDetailNextYear() throws {
        let line = ExploreDigest.services(
            bookings: [], calendar: calendar([]), examDates: [try examDate(1, "2027-03-13", "SAT")], now: now
        )
        #expect(line?.detail == "Next SAT: March 13, 2027")
    }

    @Test("The admin's label stands in only when the date cannot be read")
    func servicesExamDateDetailUnreadableDate() throws {
        let labelled = ExploreDigest.services(
            bookings: [], calendar: calendar([]), examDates: [try examDate(1, "someday", " December sitting ")], now: now
        )
        #expect(labelled?.detail == "Next SAT: December sitting")
        let bare = ExploreDigest.services(bookings: [], calendar: calendar([]), examDates: [try examDate(1, "someday")], now: now)
        #expect(bare?.detail == "Next SAT: someday")
    }

    @Test("No SAT date on offer, no detail")
    func servicesNoExamDates() {
        #expect(ExploreDigest.services(bookings: [], calendar: calendar([]), examDates: [], now: now)?.detail == nil)
    }

    @Test("When only the SAT dates answered, the line invites a booking and the date is the detail")
    func servicesOnlyExamDates() throws {
        let line = ExploreDigest.services(bookings: nil, calendar: nil, examDates: [try examDate(1, "2026-10-03")], now: now)
        #expect(line == ExploreLine(text: "Book an hour with a teacher", detail: "Next SAT: October 3"))
    }

    @Test("Bookings failed but the calendar answered: the calendar still speaks")
    func servicesBookingsFailedCalendarAnswers() {
        let open = teacher(9, "Dilafruz Karimova", [day("2026-09-25", [("14:00", .open)])])
        let line = ExploreDigest.services(bookings: nil, calendar: calendar([open]), examDates: nil, now: now)
        #expect(line == ExploreLine(text: "Next free hour: Today, 14:00"))
    }

    @Test("Bookings answered with nothing ahead and the calendar failed: invite, never 'no free hours'")
    func servicesCalendarFailedNothingBooked() {
        let line = ExploreDigest.services(bookings: [], calendar: nil, examDates: nil, now: now)
        #expect(line == ExploreLine(text: "Book an hour with a teacher"))
    }

    // MARK: Events

    @Test("A seat held comes first, with its ticket code")
    func eventsTicketWithCode() {
        let events = [
            event(1, "Open day", starts: "2026-09-27T11:00:00+05:00", seatsLeft: 5, canSignUp: true),
            event(2, seat: ticket("4K29-7XPD")),
        ]
        let line = ExploreDigest.events(events, now: now, when: stamp)
        #expect(line == ExploreLine(
            text: "Your ticket: SAT strategy talk", detail: "WHEN 15:00 · Ticket 4K29-7XPD", badge: 1
        ))
    }

    @Test("A seat minted before tickets existed has no code to show")
    func eventsTicketWithoutCode() {
        let line = ExploreDigest.events([event(2, seat: ticket(""))], now: now, when: stamp)
        #expect(line == ExploreLine(text: "Your ticket: SAT strategy talk", detail: "WHEN 15:00"))
    }

    @Test("A seat given back is not a ticket")
    func eventsGivenBackSeatIsNotATicket() {
        let given = event(2, "Given back", seat: ticket("4K29-7XPD", status: "CANCELLED"))
        let open = event(3, "Open day", seatsLeft: 5, canSignUp: true)
        let line = ExploreDigest.events([given, open], now: now, when: stamp)
        #expect(line.text == "Open day")
    }

    @Test("With no ticket, the first event that can be signed up for, and its seats")
    func eventsOpenWithSeats() {
        let events = [
            event(1, "Sold out", seatsLeft: 0),
            event(2, "Open day", seatsLeft: 12, canSignUp: true),
            event(3, "Later talk", seatsLeft: 30, canSignUp: true),
        ]
        let line = ExploreDigest.events(events, now: now, when: stamp)
        #expect(line == ExploreLine(text: "Open day", detail: "WHEN 15:00 · 12 seats left", badge: 2))
    }

    @Test("The last seat is a seat, not 'seats'")
    func eventsLastSeat() {
        let line = ExploreDigest.events([event(1, seatsLeft: 1, canSignUp: true)], now: now, when: stamp)
        #expect(line.detail == "WHEN 15:00 · 1 seat left")
    }

    @Test("An open event whose seat count did not arrive shows only when")
    func eventsOpenNoSeatCount() {
        let line = ExploreDigest.events([event(1, seatsLeft: 0, canSignUp: true)], now: now, when: stamp)
        #expect(line == ExploreLine(text: "SAT strategy talk", detail: "WHEN 15:00", badge: 1))
    }

    @Test("Nothing to sign up for: the first event, plainly, and no badge")
    func eventsOnlyFull() {
        let events = [event(1, "Full talk", seatsLeft: 0), event(2, "Later talk", starts: "2026-10-02T12:00:00+05:00")]
        let line = ExploreDigest.events(events, now: now, when: stamp)
        #expect(line == ExploreLine(text: "Full talk", detail: "WHEN 15:00"))
    }

    @Test("Cancelled events are ignored, in the line and in the badge")
    func eventsCancelledIgnored() {
        // A cancelled event cannot really be signed up for or ticketed; the fixture makes it
        // both so the test fails if the rule leans on the server for that.
        let cancelled = event(1, "Called off", seatsLeft: 9, canSignUp: true, status: "CANCELLED", seat: ticket("DEAD-0000"))
        let live = event(2, "Open day", seatsLeft: 4, canSignUp: true)
        let line = ExploreDigest.events([cancelled, live], now: now, when: stamp)
        #expect(line == ExploreLine(text: "Open day", detail: "WHEN 15:00 · 4 seats left", badge: 1))
    }

    @Test("No events, or only cancelled ones, is the quiet line")
    func eventsNone() {
        #expect(ExploreDigest.events([], now: now, when: stamp) == ExploreLine(text: "Nothing coming up right now"))
        let cancelled = event(1, status: "CANCELLED")
        #expect(ExploreDigest.events([cancelled], now: now, when: stamp) == ExploreLine(text: "Nothing coming up right now"))
    }

    @Test("No event open for sign-up, no badge, and never a zero")
    func eventsBadgeZeroIsNil() {
        let line = ExploreDigest.events([event(1, seat: ticket("4K29-7XPD"))], now: now, when: stamp)
        #expect(line.badge == nil)
    }

    // MARK: Surveys

    @Test("No survey waiting")
    func surveysNone() {
        #expect(ExploreDigest.surveys([]) == ExploreLine(text: "Nothing waiting for you"))
    }

    @Test("One survey, singular, with what it pays")
    func surveysOneWithPoints() {
        #expect(ExploreDigest.surveys([survey(1, points: 40)])
            == ExploreLine(text: "1 survey waiting", detail: "Finishing it earns you 40 points", badge: 1))
    }

    @Test("One point is a point")
    func surveysOnePoint() {
        #expect(ExploreDigest.surveys([survey(1, points: 1)]).detail == "Finishing it earns you 1 point")
    }

    @Test("Several surveys: plural, and the points added up")
    func surveysManySummed() {
        let line = ExploreDigest.surveys([survey(1, points: 40), survey(2, points: 0), survey(3, points: 25)])
        #expect(line == ExploreLine(text: "3 surveys waiting", detail: "Finishing them earns you 65 points", badge: 3))
    }

    @Test("Surveys that pay nothing promise nothing")
    func surveysZeroPointsNoDetail() {
        let line = ExploreDigest.surveys([survey(1), survey(2)])
        #expect(line == ExploreLine(text: "2 surveys waiting", detail: nil, badge: 2))
        #expect(ExploreDigest.surveys([survey(1)]).detail == nil)
    }
}

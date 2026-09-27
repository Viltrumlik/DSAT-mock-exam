import Foundation
import Testing
@testable import MasterSATKit

// Fixed instants, written in Tashkent time (+05:00) so each test reads the way the desk does.
private func at(_ iso: String) -> Date { JSONCoding.parseServerDate(iso)! }

private func hourJSON(
    _ startsAt: String,
    state: String,
    capacity: Int = 1,
    seatsLeft: Int = 1,
    note: String = "",
    bookingId: Int? = nil
) -> [String: Any] {
    [
        "starts_at": startsAt,
        "ends_at": startsAt.replacingOccurrences(of: ":00:00+", with: ":59:59+"),
        "state": state,
        "capacity": capacity,
        "seats_left": seatsLeft,
        "note": note,
        "availability_id": NSNull(),
        "booking_id": bookingId.map { $0 as Any } ?? NSNull(),
    ]
}

private func bookingJSON(
    id: Int,
    status: String = "BOOKED",
    startsAt: String = "2026-09-26T05:00:00Z",
    endsAt: String = "2026-09-26T06:00:00Z",
    teacher: String = "Dilafruz Karimova",
    withdrawn: Bool = false,
    extra: [String: Any] = [:]
) -> [String: Any] {
    var body: [String: Any] = [
        "id": id,
        "status": status,
        "topic": "Reading inference questions",
        "booked_at": "2026-09-24T09:12:44.123456Z",
        "settled_at": NSNull(),
        "classroom_id": 3,
        "classroom_name": "Maths A",
        "student_id": 7,
        "student": "Aziza",
        "invited_by_id": NSNull(),
        "invited_by": NSNull(),
        "cancel_reason": "",
        "cancelled_at": NSNull(),
        "rating": NSNull(),
        "rating_comment": "",
        "rated_at": NSNull(),
        "teacher_note": "",
        "slot": [
            "id": 100 + id,
            "support_teacher_id": 9,
            "support_teacher": teacher,
            "starts_at": startsAt,
            "ends_at": endsAt,
            "capacity": 1,
            "note": "",
            "is_cancelled": withdrawn,
        ],
    ]
    for (key, value) in extra { body[key] = value }
    return body
}

private func booking(
    _ id: Int,
    _ status: SupportBooking.Status,
    starts: String,
    ends: String,
    teacher: String = "T",
    withdrawn: Bool = false
) -> SupportBooking {
    SupportBooking(
        id: id,
        status: status,
        slot: SupportSlot(id: id, supportTeacher: teacher, startsAt: starts, endsAt: ends, isCancelled: withdrawn)
    )
}

private func day(_ date: String, _ states: [SupportHour.State]) -> SupportCalendarDay {
    SupportCalendarDay(
        date: date,
        hours: states.enumerated().map { index, state in
            let hour = String(format: "%02d", 8 + index)
            return SupportHour(
                startsAt: "\(date)T\(hour):00:00+05:00",
                endsAt: "\(date)T\(hour):59:59+05:00",
                state: state
            )
        }
    )
}

// MARK: - The API, on the wire

@Suite struct SupportAPITests {
    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> SupportAPI {
        SupportAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    private func body(_ request: URLRequest?) -> [String: Any] {
        guard let data = request?.httpBody,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    @Test("The calendar decodes every hour state, the allowance and the teachers")
    func calendarDecodes() async throws {
        server.handler = { _ in
            .json([
                "days": 4, "open_hour": 8, "close_hour": 18,
                "dates": ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"],
                "allowance": [
                    "upcoming": 1, "max_upcoming": 2, "max_per_day": 1,
                    "taken_days": ["2026-09-26"], "can_book": true,
                ],
                "teachers": [[
                    "id": 9, "name": "Dilafruz Karimova", "photo_url": NSNull(),
                    "classrooms": [["id": 3, "name": "Maths A"]],
                    "days": [[
                        "date": "2026-09-25",
                        "hours": [
                            hourJSON("2026-09-25T08:00:00+05:00", state: "past"),
                            hourJSON("2026-09-25T09:00:00+05:00", state: "open", note: "Bring your answer sheet"),
                            hourJSON("2026-09-25T10:00:00+05:00", state: "open", capacity: 4, seatsLeft: 3),
                            hourJSON("2026-09-25T11:00:00+05:00", state: "full", seatsLeft: 0),
                            hourJSON("2026-09-25T12:00:00+05:00", state: "closed"),
                            hourJSON("2026-09-25T13:00:00+05:00", state: "off"),
                            hourJSON("2026-09-25T14:00:00+05:00", state: "day_taken"),
                            hourJSON("2026-09-25T15:00:00+05:00", state: "mine", bookingId: 55),
                            hourJSON("2026-09-25T16:00:00+05:00", state: "waitlist"),
                        ],
                    ]],
                ]],
            ])
        }
        let calendar = try await api().calendar()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/support/calendar/")
        #expect(calendar.days == 4)
        #expect(calendar.openHour == 8 && calendar.closeHour == 18)
        #expect(calendar.dates.count == 4)
        #expect(calendar.allowance?.upcoming == 1)
        #expect(calendar.allowance?.takenDays == ["2026-09-26"])
        #expect(calendar.allowance?.canBook == true)

        let teacher = try #require(calendar.teachers.first)
        #expect(teacher.name == "Dilafruz Karimova")
        #expect(teacher.photoURL == nil)
        #expect(teacher.classrooms.map(\.name) == ["Maths A"])
        let states = teacher.days.first?.hours.map(\.state)
        #expect(states == [.past, .open, .open, .full, .closed, .off, .dayTaken, .mine, .unknown])
        #expect(teacher.days.first?.hours[1].note == "Bring your answer sheet")
        #expect(teacher.days.first?.hours[2].capacity == 4)
        #expect(teacher.days.first?.hours[2].seatsLeft == 3)
        #expect(teacher.days.first?.hours[7].bookingId == 55)
        // The calendar's own offset form parses, and lands on the Tashkent hour.
        #expect(teacher.days.first?.hours[1].startDate == at("2026-09-25T04:00:00Z"))
    }

    @Test("A server from before the limits sends no allowance; that is not a refusal")
    func calendarWithoutAllowance() async throws {
        server.handler = { _ in .json(["days": 4, "teachers": []]) }
        let calendar = try await api().calendar()
        #expect(calendar.allowance == nil)
        #expect(calendar.teachers.isEmpty)
        #expect(calendar.openHour == 8 && calendar.closeHour == 18)
    }

    @Test("A malformed teacher fails the calendar loudly instead of reading as 'no teacher'")
    func malformedCalendarThrows() async {
        server.handler = { _ in .json(["teachers": [["name": "No id"]]]) }
        await #expect(throws: APIError.self) { try await api().calendar() }
    }

    @Test("Bookings decode from their envelope — timestamps, invitations, cancellations, ratings")
    func bookingsDecode() async throws {
        server.handler = { _ in
            .json(["bookings": [
                bookingJSON(id: 1, status: "HELD", extra: [
                    "rating": 4, "rating_comment": "Clear", "rated_at": "2026-09-24T10:00:00Z",
                    "teacher_note": "We covered transitions.", "settled_at": "2026-09-24T09:00:00.5Z",
                ]),
                bookingJSON(id: 2, status: "BOOKED", extra: [
                    "invited_by_id": 12, "invited_by": "Madina Yusupova", "classroom_name": NSNull(),
                ]),
                bookingJSON(id: 3, status: "CANCELLED", extra: [
                    "cancel_reason": "I'm unwell", "cancelled_at": "2026-09-24T11:00:00Z",
                ]),
                bookingJSON(id: 4, status: "no_show"),
                bookingJSON(id: 5, status: "EXPIRED"),
            ]])
        }
        let list = try await api().bookings()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/support/bookings/")
        #expect(list.map(\.status) == [.held, .booked, .cancelled, .noShow, .unknown])
        #expect(list[0].rating == 4)
        #expect(list[0].ratingComment == "Clear")
        #expect(list[0].teacherNote == "We covered transitions.")
        #expect(list[1].invitedBy == "Madina Yusupova")
        #expect(list[1].classroomName == nil)
        #expect(list[2].cancelReason == "I'm unwell")
        #expect(list[4].statusRaw == "EXPIRED")
        #expect(list[0].slot.supportTeacher == "Dilafruz Karimova")
        #expect(JSONCoding.parseServerDate(list[0].bookedAt) != nil)
    }

    @Test("A bookings list that cannot be read is an error, never 'No sessions yet'")
    func malformedBookingsThrow() async {
        server.handler = { _ in .json(["bookings": [["id": 1, "status": "BOOKED"]]]) }  // no slot
        await #expect(throws: APIError.self) { try await api().bookings() }
    }

    @Test("Booking sends the teacher, the hour verbatim and a trimmed topic — and nothing unasked")
    func bookSendsTheHour() async throws {
        server.handler = { _ in .json(bookingJSON(id: 8), status: 201) }
        let made = try await api().book(
            supportTeacherId: 9,
            startsAt: "2026-09-26T10:00:00+05:00",
            topic: "  Reading inference questions \n"
        )
        #expect(made.id == 8)
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/classes/support/bookings/")
        let sent = body(request)
        #expect(sent["support_teacher_id"] as? Int == 9)
        #expect(sent["starts_at"] as? String == "2026-09-26T10:00:00+05:00")
        #expect(sent["topic"] as? String == "Reading inference questions")
        #expect(sent["classroom_id"] == nil)
    }

    @Test("A blank topic is left out; a long one is cut to the column's 240 characters")
    func bookTopicLimits() async throws {
        server.handler = { _ in .json(bookingJSON(id: 8), status: 201) }
        _ = try await api().book(supportTeacherId: 9, startsAt: "2026-09-26T10:00:00+05:00", topic: "   ")
        #expect(body(server.requests.last)["topic"] == nil)

        _ = try await api().book(
            supportTeacherId: 9, startsAt: "2026-09-26T10:00:00+05:00",
            topic: String(repeating: "a", count: 300), classroomId: 3
        )
        #expect((body(server.requests.last)["topic"] as? String)?.count == 240)
        #expect(body(server.requests.last)["classroom_id"] as? Int == 3)
    }

    @Test("A refused booking carries the server's own sentence")
    func refusalCarriesDetail() async {
        let sentence = "You already have a support session that day. You can book one session a day — pick another day, or cancel the one you have."
        server.handler = { _ in .json(["detail": sentence], status: 400) }
        do {
            _ = try await api().book(supportTeacherId: 9, startsAt: "2026-09-26T10:00:00+05:00")
            Issue.record("A 400 must throw")
        } catch let error as APIError {
            #expect(error.errorDescription == sentence)
            #expect(error.isRetryable == false)
        } catch {
            Issue.record("Unexpected error \(error)")
        }
        // Exactly one request: a refused booking is never re-sent on its own.
        #expect(server.requests.count == 1)
    }

    @Test("Cancelling is a DELETE that carries the reason as a JSON body")
    func cancelSendsReasonInBody() async throws {
        server.handler = { _ in .json(["detail": "Booking cancelled.", "id": 5]) }
        let detail = try await api().cancel(bookingId: 5, reason: "I'm unwell")
        #expect(detail == "Booking cancelled.")
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/classes/support/bookings/5/")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(body(request)["reason"] as? String == "I'm unwell")
    }

    @Test("The classmate picker reads the server's list; inviting sends the student id")
    func inviteFlow() async throws {
        server.handler = { request in
            if request.httpMethod == "GET" {
                return .json(["students": [["id": 12, "name": "Madina Yusupova"], ["id": 13, "name": "Bekzod"]]])
            }
            return .json([
                "detail": "Madina Yusupova has been added and told.",
                "booking": bookingJSON(id: 21, extra: ["invited_by_id": 7, "invited_by": "Aziza"]),
            ], status: 201)
        }
        let candidates = try await api().invitableClassmates(bookingId: 5)
        #expect(candidates.map(\.name) == ["Madina Yusupova", "Bekzod"])
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/support/bookings/5/invite/")

        let result = try await api().invite(bookingId: 5, studentId: 12)
        #expect(result.detail == "Madina Yusupova has been added and told.")
        #expect(result.booking?.invitedBy == "Aziza")
        let post = try #require(server.requests.last)
        #expect(post.httpMethod == "POST")
        #expect(body(post)["student_id"] as? Int == 12)
    }

    @Test("An invite that succeeded is not reported as failed because its booking body is odd")
    func inviteLenientBooking() async throws {
        server.handler = { _ in .json(["detail": "Madina has been added and told.", "booking": ["id": "x"]], status: 201) }
        let result = try await api().invite(bookingId: 5, studentId: 12)
        #expect(result.detail == "Madina has been added and told.")
        #expect(result.booking == nil)
    }

    @Test("Rating sends the stars and a trimmed comment, and returns the updated session")
    func rateSends() async throws {
        server.handler = { _ in .json(bookingJSON(id: 1, status: "HELD", extra: ["rating": 5, "rating_comment": "Great"])) }
        let rated = try await api().rate(bookingId: 1, rating: 5, comment: "  Great  ")
        #expect(rated.rating == 5)
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/classes/support/bookings/1/rate/")
        #expect(body(request)["rating"] as? Int == 5)
        #expect(body(request)["comment"] as? String == "Great")
    }

    @Test("The next hour for Home comes worded, in Tashkent time")
    func nextHourForHome() async throws {
        server.handler = { _ in
            .json(["bookings": [
                bookingJSON(id: 1, status: "BOOKED", startsAt: "2026-09-25T10:00:00Z", endsAt: "2026-09-25T11:00:00Z"),
            ]])
        }
        let next = try await api().nextHour(now: at("2026-09-25T09:00:00+05:00"))
        #expect(next?.when == "Today, 15:00")
        #expect(next?.sentence == "Today, 15:00 with Dilafruz Karimova")
    }
}

// MARK: - Your next hour

@Suite struct SupportNextHourTests {
    let now = at("2026-09-25T12:00:00+05:00")

    @Test("An hour already under way still counts; one that has ended does not")
    func underWayCounts() {
        let ended = booking(1, .booked, starts: "2026-09-25T09:00:00+05:00", ends: "2026-09-25T10:00:00+05:00")
        let underWay = booking(2, .booked, starts: "2026-09-25T11:30:00+05:00", ends: "2026-09-25T12:30:00+05:00")
        let later = booking(3, .booked, starts: "2026-09-25T17:00:00+05:00", ends: "2026-09-25T18:00:00+05:00")
        #expect(SupportSchedule.nextHour(in: [ended, later, underWay], now: now)?.id == 2)
    }

    @Test("Withdrawn, cancelled, missed and attended hours are never the next one")
    func skipsNonBooked() {
        let list = [
            booking(1, .booked, starts: "2026-09-25T13:00:00+05:00", ends: "2026-09-25T14:00:00+05:00", withdrawn: true),
            booking(2, .cancelled, starts: "2026-09-25T14:00:00+05:00", ends: "2026-09-25T15:00:00+05:00"),
            booking(3, .noShow, starts: "2026-09-25T15:00:00+05:00", ends: "2026-09-25T16:00:00+05:00"),
            booking(4, .held, starts: "2026-09-25T16:00:00+05:00", ends: "2026-09-25T17:00:00+05:00"),
            booking(5, .booked, starts: "2026-09-27T09:00:00+05:00", ends: "2026-09-27T10:00:00+05:00"),
        ]
        #expect(SupportSchedule.nextHour(in: list, now: now)?.id == 5)
    }

    @Test("The earliest wins, whatever order the list came in — the API lists newest booked first")
    func earliestWins() {
        let list = [
            booking(1, .booked, starts: "2026-09-28T09:00:00+05:00", ends: "2026-09-28T10:00:00+05:00", teacher: "Later"),
            booking(2, .booked, starts: "2026-09-26T04:00:00Z", ends: "2026-09-26T05:00:00Z", teacher: "Sooner"),
        ]
        let next = SupportSchedule.nextHourSummary(in: list, now: now)
        #expect(next?.booking.id == 2)
        #expect(next?.when == "Tomorrow, 09:00")
        #expect(next?.teacher == "Sooner")
    }

    @Test("Nothing ahead is nil, not a guess")
    func nothingAhead() {
        #expect(SupportSchedule.nextHour(in: [], now: now) == nil)
        let past = booking(1, .booked, starts: "2026-09-20T09:00:00+05:00", ends: "2026-09-20T10:00:00+05:00")
        #expect(SupportSchedule.nextHourSummary(in: [past], now: now) == nil)
        let unreadable = booking(2, .booked, starts: "soon", ends: "later")
        #expect(SupportSchedule.nextHour(in: [unreadable], now: now) == nil)
    }
}

// MARK: - The calendar's words

@Suite struct SupportCalendarWordingTests {

    @Test("The day strip says why a day is empty, in five different words")
    func daySummaries() {
        #expect(SupportSchedule.summary(for: day("2026-09-25", [.past, .open, .open, .full])) == .free(2))
        #expect(SupportSchedule.summary(for: day("2026-09-25", [.past, .open, .open, .full])).label == "2 free")
        // One session a day: the student's own hour, or the day marked as spent.
        #expect(SupportSchedule.summary(for: day("2026-09-26", [.dayTaken, .mine, .dayTaken])) == .booked)
        #expect(SupportSchedule.summary(for: day("2026-09-26", [.dayTaken, .dayTaken])).label == "Booked")
        #expect(SupportSchedule.summary(for: day("2026-09-27", [.off, .off, .off])).label == "Not working")
        #expect(SupportSchedule.summary(for: day("2026-09-27", [])).label == "Not working")
        #expect(SupportSchedule.summary(for: day("2026-09-25", [.past, .past, .past])).label == "Day over")
        #expect(SupportSchedule.summary(for: day("2026-09-26", [.full, .closed, .full])).label == "Full")
        #expect(SupportSchedule.summary(for: day("2026-09-25", [.past, .full])).label == "Full")
    }

    @Test("A part-time teacher's finished day is over, not full")
    func partTimeDayOver() {
        // The web counted the unworked afternoon too and said "Full" all afternoon.
        #expect(SupportSchedule.summary(for: day("2026-09-25", [.past, .past, .off, .off])) == .dayOver)
    }

    @Test("The calendar opens on the first day with something left")
    func firstLiveDay() {
        let days = [
            day("2026-09-25", [.past, .past]),
            day("2026-09-26", [.off, .full]),
            day("2026-09-27", [.off, .open]),
        ]
        #expect(SupportSchedule.firstLiveDayIndex(days) == 2)
        #expect(SupportSchedule.firstLiveDayIndex([day("2026-09-25", [.past]), day("2026-09-26", [.mine])]) == 1)
        #expect(SupportSchedule.firstLiveDayIndex([day("2026-09-25", [.past])]) == 0)
        #expect(SupportSchedule.firstLiveDayIndex([]) == 0)
    }

    @Test("Hours outside the weekly schedule are dropped, everything else stays with its reason")
    func visibleHoursDropOff() {
        let visible = SupportSchedule.visibleHours(day("2026-09-25", [.off, .open, .closed, .off, .full]))
        #expect(visible.map(\.state) == [.open, .closed, .full])
    }

    @Test("Each hour cell is worded for its state, and only an open hour is a button")
    func cells() {
        func cell(_ state: SupportHour.State, capacity: Int = 1, seats: Int = 1, note: String = "") -> SupportHourCell {
            SupportSchedule.cell(for: SupportHour(
                startsAt: "2026-09-25T15:00:00+05:00", endsAt: "2026-09-25T16:00:00+05:00",
                state: state, capacity: capacity, seatsLeft: seats, note: note
            ))
        }
        #expect(cell(.open).time == "15:00")
        #expect(cell(.open).caption == "Free")
        #expect(cell(.open).isBookable)
        #expect(cell(.open).accessibilityLabel == "Book 15:00")
        #expect(cell(.open, capacity: 4, seats: 3).caption == "3 left")
        #expect(cell(.open, capacity: 4, seats: 3).isGroup)
        #expect(cell(.open, note: "Bring your answer sheet").hasNote)
        #expect(!cell(.open, note: "  ").hasNote)
        #expect(cell(.mine).caption == "Booked")
        #expect(cell(.mine).kind == .mine)
        #expect(cell(.full).caption == "Fully booked")
        #expect(cell(.closed).caption == "Not available")
        #expect(cell(.past).caption == "Already gone")
        #expect(cell(.off).caption == "Not working")
        #expect(cell(.dayTaken).caption == "You have a session today")
        #expect(cell(.unknown).caption == "Not available")
        for state: SupportHour.State in [.mine, .full, .closed, .past, .off, .dayTaken, .unknown] {
            #expect(!cell(state).isBookable)
        }
    }

    @Test("The teacher's line, the free pill and the confirm title")
    func teacherWording() {
        let teacher = SupportCalendarTeacher(
            id: 9, name: "Dilafruz Karimova",
            classrooms: [SupportClassroomRef(id: 3, name: "Maths A"), SupportClassroomRef(id: 4, name: "English B")],
            days: []
        )
        #expect(SupportSchedule.teacherSubtitle(teacher) == "Support teacher · Maths A, English B")
        #expect(SupportSchedule.teacherSubtitle(SupportCalendarTeacher(id: 1, name: "X", days: [])) == "Support teacher")
        #expect(SupportSchedule.freePill(day("2026-09-25", [.open, .open, .full])) == "2 free")
        #expect(SupportSchedule.freePill(day("2026-09-25", [.full])) == "Nothing free")
        #expect(SupportSchedule.freePill(nil) == "Nothing free")
        #expect(SupportSchedule.confirmTitle(
            startsAt: "2026-09-25T10:00:00+05:00", teacher: "Dilafruz Karimova",
            now: at("2026-09-25T08:30:00+05:00")
        ) == "Today · 10:00 with Dilafruz Karimova")
    }

    @Test("The hero's tiles and the at-the-limit banner")
    func heroWording() {
        #expect(SupportSchedule.openHoursLabel(open: 8, close: 18) == "08:00–18:00")
        let allowance = SupportAllowance(upcoming: 1, maxUpcoming: 2, canBook: true)
        #expect(SupportSchedule.sessionsTile(allowance: allowance, bookings: nil) == "1 of 2 booked")
        let list = [
            booking(1, .booked, starts: "2026-09-26T09:00:00+05:00", ends: "2026-09-26T10:00:00+05:00"),
            booking(2, .held, starts: "2026-09-20T09:00:00+05:00", ends: "2026-09-20T10:00:00+05:00"),
        ]
        #expect(SupportSchedule.sessionsTile(allowance: nil, bookings: list) == "1 upcoming")
        #expect(SupportSchedule.sessionsTile(allowance: nil, bookings: nil) == nil)

        #expect(SupportSchedule.limitBanner(allowance) == nil)
        #expect(SupportSchedule.limitBanner(nil) == nil)
        let full = SupportSchedule.limitBanner(SupportAllowance(upcoming: 2, maxUpcoming: 2, canBook: false))
        #expect(full?.title == "You have 2 sessions booked already")
        #expect(full?.message == "Attend one — or cancel it if you can't make it — and you can book another.")
        let one = SupportSchedule.limitBanner(SupportAllowance(upcoming: 1, maxUpcoming: 1, canBook: false))
        #expect(one?.title == "You have 1 session booked already")
    }

    @Test("Session statuses read as growth, never as failure")
    func statuses() {
        func label(_ status: SupportBooking.Status) -> String {
            SupportSchedule.statusLabel(booking(1, status, starts: "", ends: ""))
        }
        #expect(label(.booked) == "Booked")
        #expect(label(.held) == "Attended")
        #expect(label(.noShow) == "Missed")
        #expect(label(.cancelled) == "Cancelled")
    }

    @Test("A cancellation needs a reason; 'Something else' needs words, capped at 280")
    func cancelReasons() {
        #expect(SupportSchedule.cancelPresets.count == 4)
        #expect(SupportSchedule.cancelReason(picked: nil, detail: "anything") == nil)
        #expect(SupportSchedule.cancelReason(picked: "I'm unwell", detail: "") == "I'm unwell")
        #expect(SupportSchedule.cancelReason(picked: SupportSchedule.cancelOther, detail: "   ") == nil)
        #expect(SupportSchedule.cancelReason(picked: SupportSchedule.cancelOther, detail: "  Bus broke down ") == "Bus broke down")
        let long = SupportSchedule.cancelReason(picked: SupportSchedule.cancelOther, detail: String(repeating: "x", count: 400))
        #expect(long?.count == 280)
    }

    @Test("Every star says what it means")
    func ratingMeanings() {
        #expect((1...5).compactMap(SupportSchedule.ratingMeaning) == [
            "Didn't help", "A little help", "Helped", "Really helped", "Exactly what I needed",
        ])
        #expect(SupportSchedule.ratingMeaning(0) == nil)
        #expect(SupportSchedule.ratingMeaning(6) == nil)
    }
}

// MARK: - Tashkent time

@Suite struct ServicesTimeTests {

    @Test("Today and tomorrow earn their names; after that, weekday and date")
    func hourLabels() {
        let now = at("2026-09-25T10:00:00+05:00")  // Friday
        #expect(ServicesTime.hourLabel("2026-09-25T15:00:00+05:00", now: now) == "Today, 15:00")
        #expect(ServicesTime.hourLabel("2026-09-26T15:00:00+05:00", now: now) == "Tomorrow, 15:00")
        #expect(ServicesTime.hourLabel("2026-09-29T15:00:00+05:00", now: now) == "Tue, Sep 29, 15:00")
        #expect(ServicesTime.hourLabel("not a date", now: now) == "not a date")
    }

    @Test("A UTC timestamp is read on the desk's clock, not the phone's or Greenwich's")
    func utcIsReadInTashkent() {
        // 10:00Z is 15:00 in Tashkent.
        #expect(ServicesTime.clock(iso: "2026-09-25T10:00:00Z") == "15:00")
        #expect(ServicesTime.sessionWhen("2026-09-15T05:00:00.123456Z") == "Tue, Sep 15, 10:00")
        // 20:30Z on the 24th is already 01:30 on the 25th in Tashkent, so a 10:00 hour on the
        // 25th is TODAY — a UTC reading would call it tomorrow.
        let justAfterMidnight = at("2026-09-24T20:30:00Z")
        #expect(ServicesTime.hourLabel("2026-09-25T05:00:00Z", now: justAfterMidnight) == "Today, 10:00")
        // And 18:30Z is still the 24th in Tashkent (23:30), so the same hour is tomorrow.
        let lateEvening = at("2026-09-24T18:30:00Z")
        #expect(ServicesTime.hourLabel("2026-09-25T05:00:00Z", now: lateEvening) == "Tomorrow, 10:00")
    }

    @Test("The day strip labels calendar dates as Tashkent days")
    func dayStrip() {
        let now = at("2026-09-25T00:30:00+05:00")
        #expect(ServicesTime.dayLabel(day: "2026-09-25", now: now) == .init(title: "Today", sub: "Sep 25"))
        #expect(ServicesTime.dayLabel(day: "2026-09-26", now: now) == .init(title: "Tomorrow", sub: "Sep 26"))
        #expect(ServicesTime.dayLabel(day: "2026-09-27", now: now) == .init(title: "Sun", sub: "Sep 27"))
        #expect(ServicesTime.dayLabel(day: "2026-09-28", now: now).title == "Mon")
        #expect(ServicesTime.dayLabel(day: "junk", now: now).title == "junk")
        // An instant is flattened to its day first: a 15:00 pick made this morning is today.
        #expect(ServicesTime.dayLabel(instant: "2026-09-25T15:00:00+05:00", now: now).title == "Today")
    }

    @Test("Date-only strings are read by hand, and impossible dates are refused")
    func dateOnly() {
        #expect(ServicesTime.date(fromDay: "2026-09-25") == at("2026-09-25T00:00:00+05:00"))
        #expect(ServicesTime.date(fromDay: "2026-02-31") == nil)
        #expect(ServicesTime.date(fromDay: "2026-09") == nil)
        #expect(ServicesTime.date(fromDay: "") == nil)
    }
}

// MARK: - SAT dates

@Suite struct ServicesExamDateTests {
    private func option(_ id: Int, _ date: String, _ label: String = "") throws -> ExamDateOption {
        let object: [String: Any] = ["id": id, "exam_date": date, "label": label]
        return try JSONCoding.decoder.decode(ExamDateOption.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test("The soonest sitting, not the admin's first")
    func earliest() throws {
        let list = [try option(3, "2027-12-04"), try option(1, "2027-10-02"), try option(2, "2027-11-06")]
        #expect(ServicesExamDates.earliest(list)?.id == 1)
        #expect(ServicesExamDates.earliest([]) == nil)
    }

    @Test("Written as the registrar writes it: the label, or 'March 14', with the year only when it differs")
    func labels() throws {
        let now = at("2026-09-25T10:00:00+05:00")
        #expect(ServicesExamDates.label(for: try option(1, "2026-10-03"), now: now) == "October 3")
        #expect(ServicesExamDates.label(for: try option(2, "2027-03-14"), now: now) == "March 14, 2027")
        #expect(ServicesExamDates.label(for: try option(3, "2026-12-05", " December SAT "), now: now) == "December SAT")
        #expect(ServicesExamDates.label(for: try option(4, "someday"), now: now) == "someday")
    }
}

import Foundation
import Testing
@testable import MasterSATKit

@Suite struct EventsAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> EventsAPI {
        EventsAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    static func event(
        id: Int = 3, startsAt: String = "2026-09-29T15:00:00+05:00", endsAt: String = "2026-09-29T17:00:00+05:00",
        seatsLeft: Int = 12, canSignUp: Bool = true, canCancel: Bool = false, seat: Any = NSNull(),
        status: String = "PUBLISHED"
    ) -> [String: Any] {
        [
            "id": id, "title": "SAT strategy talk", "description": "Bring questions.",
            "cover_image_url": NSNull(), "starts_at": startsAt, "ends_at": endsAt,
            "location": "Room 204", "seats": 40, "seats_left": seatsLeft, "status": status,
            "my_registration": seat, "can_sign_up": canSignUp, "can_cancel": canCancel,
        ]
    }

    static var seat: [String: Any] { [
        "id": 91, "status": "REGISTERED", "attendance": NSNull(),
        "registered_at": "2026-09-20T10:11:12.345678+05:00", "points_awarded": 0, "ticket_code": "4K29-7XPD",
    ] }

    @Test("The list decodes, microsecond +05:00 timestamps and all")
    func upcomingDecodes() async throws {
        server.handler = { _ in
            .json(["events": [
                Self.event(),
                Self.event(id: 4, canSignUp: false, canCancel: true, seat: Self.seat),
                ["title": "no id"],
            ]])
        }
        let events = try await api().upcoming()
        #expect(events.map(\.id) == [3, 4])
        #expect(events[0].startDate != nil && events[0].endDate != nil)
        #expect(events[0].coverImageURL == nil)
        #expect(events[0].description == "Bring questions.")
        #expect(events[0].myRegistration == nil && !events[0].holdsSeat)
        #expect(events[1].holdsSeat)
        #expect(events[1].myRegistration?.ticketCode == "4K29-7XPD")
        #expect(events[1].myRegistration?.registeredAt.flatMap(JSONCoding.parseServerDate) != nil)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/events/")
    }

    @Test("My events come from their own endpoint")
    func mineHitsMine() async throws {
        server.handler = { _ in .json(["events": [Self.event(seat: Self.seat)]]) }
        _ = try await api().mine()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/events/mine/")
    }

    @Test("Signing up posts to the event and returns the seat")
    func signUpReturnsSeat() async throws {
        server.handler = { _ in .json(Self.seat, status: 201) }
        let seat = try await api().signUp(eventId: 3)
        #expect(seat.isRegistered)
        #expect(seat.ticketCode == "4K29-7XPD")
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/events/3/sign-up/")
    }

    @Test("A full event is a 409 whose code says full")
    func fullIsTyped() async throws {
        server.handler = { _ in
            .json(["code": "full", "detail": "That event is full. A seat opens if somebody cancels."], status: 409)
        }
        do {
            _ = try await api().signUp(eventId: 3)
            Issue.record("expected a refusal")
        } catch let refusal as EventRefusal {
            #expect(refusal.reason == .full)
            #expect(refusal.status == 409)
            #expect(refusal.errorDescription == "That event is full. A seat opens if somebody cancels.")
        }
    }

    @Test("Every 400 refusal keeps its code: not_open, started, not_registered, cancel_window_closed")
    func codesAreTyped() async throws {
        let cases: [(String, EventRefusal.Reason)] = [
            ("not_open", .notOpen), ("started", .started), ("not_registered", .notRegistered),
            ("cancel_window_closed", .cancelWindowClosed), ("brand_new", .other("brand_new")),
        ]
        for (code, reason) in cases {
            server.handler = { _ in .json(["code": code, "detail": "Sentence for \(code)."], status: 400) }
            do {
                _ = try await api().cancel(eventId: 3)
                Issue.record("expected a refusal for \(code)")
            } catch let refusal as EventRefusal {
                #expect(refusal.reason == reason)
                #expect(refusal.detail == "Sentence for \(code).")
            }
        }
    }

    @Test("A refusal with no sentence still reads as the server would put it")
    func fallbackSentence() {
        let refusal = EventRefusal(reason: .cancelWindowClosed, detail: "", status: 400)
        #expect(refusal.errorDescription == "It's too late to cancel — the event starts in less than two hours.")
    }

    @Test("Cancelling a seat never held is a plain 404, not a refusal")
    func cancelWithoutRow() async throws {
        server.handler = { _ in .json(["detail": "Not found."], status: 404) }
        do {
            _ = try await api().cancel(eventId: 3)
            Issue.record("expected a 404")
        } catch APIError.http(let status, _) {
            #expect(status == 404)
        }
    }

    @Test("The ticket comes back as PNG bytes, fetched with the student's token")
    func ticketIsPNG() async throws {
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01])
        server.handler = { _ in StubResponse(status: 200, body: png, headers: ["Content-Type": "image/png"]) }
        let data = try await api().ticketPNG(eventId: 3)
        #expect(data == png)
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/events/3/ticket.png")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer A")
    }

    @Test("An HTML page served as the ticket is an error, not a blank image")
    func ticketThatIsNotPNG() async throws {
        server.handler = { _ in StubResponse(status: 200, body: Data("<html>oops</html>".utf8)) }
        await #expect(throws: APIError.self) { _ = try await api().ticketPNG(eventId: 3) }
    }

    @Test("No seat, no ticket: a 404")
    func ticketWithoutSeat() async throws {
        server.handler = { _ in .json(["detail": "Not found."], status: 404) }
        do {
            _ = try await api().ticketPNG(eventId: 3)
            Issue.record("expected a 404")
        } catch APIError.http(let status, _) {
            #expect(status == 404)
        }
    }

    @Test("The Home badge counts what the server says can be signed up for")
    func openCount() async throws {
        server.handler = { _ in
            .json(["events": [Self.event(id: 1), Self.event(id: 2, seatsLeft: 0, canSignUp: false), Self.event(id: 3)]])
        }
        #expect(try await api().openForSignUpCount() == 2)
    }
}

@Suite struct EventRulesTests {

    let now = JSONCoding.parseServerDate("2026-09-25T12:00:00+05:00")!

    private func event(
        id: Int = 1, startsIn hours: Double, lasting: Double = 2, seatsLeft: Int = 5, canSignUp: Bool = false,
        canCancel: Bool = false, seat: EventSeat? = nil, status: String = "PUBLISHED"
    ) -> LearningEvent {
        let formatter = ISO8601DateFormatter()
        let start = now.addingTimeInterval(hours * 3600)
        return LearningEvent(
            id: id, title: "Talk",
            startsAt: formatter.string(from: start),
            endsAt: formatter.string(from: start.addingTimeInterval(lasting * 3600)),
            seats: 40, seatsLeft: seatsLeft, status: status, myRegistration: seat,
            canSignUp: canSignUp, canCancel: canCancel
        )
    }

    @Test("The server's can_sign_up is used as-is")
    func openState() {
        #expect(EventRules.state(of: event(startsIn: 48, seatsLeft: 7, canSignUp: true), now: now) == .open(seatsLeft: 7))
    }

    @Test("Holding a seat says so, with the server's cancel answer")
    func signedUpState() {
        let held = EventSeat(id: 9, status: "REGISTERED")
        #expect(EventRules.state(of: event(startsIn: 48, canCancel: true, seat: held), now: now) == .signedUp(canCancel: true))
        #expect(EventRules.state(of: event(startsIn: 1, canCancel: false, seat: held), now: now) == .signedUp(canCancel: false))
    }

    @Test("Full only when no seats are left and it has not started")
    func fullState() {
        #expect(EventRules.state(of: event(startsIn: 48, seatsLeft: 0), now: now) == .full)
    }

    @Test("A started event says Started — the web's \"Full\" there is defect #11")
    func startedState() {
        #expect(EventRules.state(of: event(startsIn: -0.5, seatsLeft: 9), now: now) == .started)
        #expect(EventRules.state(of: event(startsIn: -0.5, seatsLeft: 0), now: now) == .started)
        // Seats left, yet the server refuses: it has started by the SERVER's clock, which wins
        // over a phone whose clock runs slow.
        #expect(EventRules.state(of: event(startsIn: 0.1, seatsLeft: 9), now: now) == .started)
    }

    @Test("A seat given back does not count as held")
    func cancelledSeatIsNotHeld() {
        let gaveBack = EventSeat(id: 9, status: "CANCELLED")
        #expect(EventRules.state(of: event(startsIn: 48, seatsLeft: 3, canSignUp: true, seat: gaveBack), now: now)
            == .open(seatsLeft: 3))
    }

    @Test("A sign-up inside the last two hours cannot be undone, and is flagged")
    func finalSignUps() {
        #expect(EventRules.signUpIsFinal(event(startsIn: 1.5), now: now))
        #expect(!EventRules.signUpIsFinal(event(startsIn: 3), now: now))
    }

    @Test("Past events: finished, with a seat still held")
    func pastEvents() {
        let held = EventSeat(id: 9, status: "REGISTERED")
        let gaveBack = EventSeat(id: 10, status: "CANCELLED")
        let finished = event(id: 2, startsIn: -30, seat: held)
        let ongoing = event(id: 3, startsIn: -1, lasting: 3, seat: held)
        let returned = event(id: 4, startsIn: -30, seat: gaveBack)
        let unreadable = LearningEvent(id: 5, title: "?", startsAt: "", endsAt: "not a date", myRegistration: held)
        #expect(EventRules.pastEvents([finished, ongoing, returned, unreadable], now: now).map(\.id) == [2])
    }

    @Test("Outcomes: attended pays points, missed, not marked yet, and called off")
    func outcomes() {
        let attended = EventSeat(id: 1, attendance: "ATTENDED", pointsAwarded: 10)
        let missed = EventSeat(id: 2, attendance: "MISSED")
        let unmarked = EventSeat(id: 3)
        #expect(EventRules.outcome(of: event(startsIn: -30, seat: attended)) == .attended(points: 10))
        #expect(EventRules.outcome(of: event(startsIn: -30, seat: missed)) == .missed)
        #expect(EventRules.outcome(of: event(startsIn: -30, seat: unmarked)) == .notMarked)
        #expect(EventRules.outcome(of: event(startsIn: -30, seat: unmarked, status: "CANCELLED")) == .eventCancelled)
    }
}

/// `sendCoded` is opt-in, and narrow. Everything else keeps the mapping it was written against.
@Suite struct APIRefusalTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func client(_ storage: InMemoryTokenStorage = InMemoryTokenStorage(TokenPair(access: "A", refresh: "R"))) -> APIClient {
        APIClient(config: config, storage: storage, session: server.session())
    }

    @Test("Plain send still maps a coded 409 to .conflict and a coded 400 to .http")
    func sendIsUnchanged() async throws {
        server.handler = { _ in .json(["code": "full", "detail": "Full."], status: 409) }
        do {
            try await client().send(.post("/events/1/sign-up/"))
            Issue.record("expected a conflict")
        } catch APIError.conflict(let detail) {
            #expect(detail == "Full.")
        }

        server.handler = { _ in .json(["code": "started", "detail": "Started."], status: 400) }
        do {
            try await client().send(.post("/events/1/sign-up/"))
            Issue.record("expected an http error")
        } catch APIError.http(let status, let detail) {
            #expect(status == 400 && detail == "Started.")
        }
    }

    @Test("A 403 keeps its own slot for the code")
    func forbiddenIsNotARefusal() async throws {
        server.handler = { _ in .json(["code": "frozen", "detail": "Frozen."], status: 403) }
        do {
            _ = try await client().sendCoded(.get("/events/"), as: Empty.self)
            Issue.record("expected forbidden")
        } catch APIError.forbidden(let detail, let reason) {
            #expect(detail == "Frozen." && reason == "frozen")
        }
    }

    @Test("A serializer's field map is still a validation error")
    func fieldMapIsValidation() async throws {
        server.handler = { _ in .json(["code": ["duplicate"], "email": ["Taken."]], status: 400) }
        do {
            _ = try await client().sendCoded(.get("/x/"), as: Empty.self)
            Issue.record("expected validation")
        } catch APIError.validation(_, let code, let fields) {
            #expect(code == "duplicate")
            #expect(fields["email"] == ["Taken."])
        }
    }

    @Test("A 400 with no code is an ordinary .http failure")
    func uncodedIsHTTP() async throws {
        server.handler = { _ in .json(["detail": "Nope."], status: 400) }
        do {
            _ = try await client().sendCoded(.get("/x/"), as: Empty.self)
            Issue.record("expected http")
        } catch APIError.http(let status, let detail) {
            #expect(status == 400 && detail == "Nope.")
        }
    }

    @Test("The code survives the one refresh-and-retry")
    func refusalAfterRefresh() async throws {
        let storage = InMemoryTokenStorage(TokenPair(access: "old", refresh: "R"))
        server.handler = { request in
            if request.url?.absoluteString == "https://mastersat.uz/api/auth/refresh/" {
                return .json(["access": "new", "refresh": "R2"])
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer old" {
                return .json(["detail": "expired"], status: 401)
            }
            return .json(["code": "full", "detail": "Full."], status: 409)
        }
        do {
            _ = try await client(storage).sendCoded(.post("/events/1/sign-up/"), as: Empty.self)
            Issue.record("expected a refusal")
        } catch let refusal as APIRefusal {
            #expect(refusal == APIRefusal(status: 409, code: "full", detail: "Full."))
        }
        #expect(storage.load()?.access == "new")
    }
}

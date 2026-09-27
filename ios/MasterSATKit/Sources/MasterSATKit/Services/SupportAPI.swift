import Foundation

/// Booking an hour with a support teacher — the student side of `/api/classes/support/`.
///
/// **Nothing here is idempotent, and nothing here retries.** A booking takes a seat, an
/// invitation widens an hour and tells a classmate by email, a cancellation hands the seat
/// back with a reason the teacher reads. The client's one automatic re-send is after a 401,
/// which the server refused before doing anything. Callers confirm first, disable the button
/// while a request is in flight, and after ANY failure re-read the calendar and the bookings
/// rather than guessing whether the write landed — a refusal ("That slot is full.") is the
/// server saying the grid is out of date, and a dropped connection leaves only the server
/// knowing whether the seat was taken.
///
/// Refusals arrive as HTTP 400 `{"detail": "…"}`, a sentence written for the student;
/// `APIError.errorDescription` carries it unchanged.
public struct SupportAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// The next four days, 08:00–18:00, for every support teacher on the student's classes —
    /// with the allowance, so a limit is visible before an hour is picked.
    public func calendar() async throws -> SupportCalendar {
        try await client.send(.get("/classes/support/calendar/"), as: SupportCalendar.self)
    }

    /// All of the student's own sessions, newest booked first. Unpaginated.
    public func bookings() async throws -> [SupportBooking] {
        try await client.send(.get("/classes/support/bookings/"), as: BookingsEnvelope.self).bookings
    }

    /// The next hour the student holds, worded for a card. For Home and Services.
    public func nextHour(now: Date = Date()) async throws -> SupportNextHour? {
        SupportSchedule.nextHourSummary(in: try await bookings(), now: now)
    }

    /// Take an hour off the calendar. `startsAt` must be the hour's own `starts_at`, passed
    /// back verbatim — the server materialises the slot from it and refuses anything not on
    /// the hour. A blank topic is left out rather than sent empty.
    public func book(
        supportTeacherId: Int,
        startsAt: String,
        topic: String? = nil,
        classroomId: Int? = nil
    ) async throws -> SupportBooking {
        let trimmed = (topic ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let body = BookRequest(
            supportTeacherId: supportTeacherId,
            startsAt: startsAt,
            // The column is 240 characters and the server does not cut it to fit — a longer
            // topic would be a database error, not a refusal.
            topic: trimmed.isEmpty ? nil : String(trimmed.prefix(SupportSchedule.topicLimit)),
            classroomId: classroomId
        )
        return try await client.send(try .post("/classes/support/bookings/", json: body), as: SupportBooking.self)
    }

    /// Give the seat back. The reason is REQUIRED of a student and shown to the teacher.
    ///
    /// A DELETE with a JSON body: `Endpoint.delete` carries none, so the endpoint is built by
    /// hand. The body is what the server reads the reason from — without it every student
    /// cancellation is refused with "Tell your teacher why you can't make it".
    /// Returns the server's sentence ("Booking cancelled.").
    @discardableResult
    public func cancel(bookingId: Int, reason: String) async throws -> String {
        let endpoint = Endpoint(
            path: "/classes/support/bookings/\(bookingId)/",
            method: .delete,
            body: try JSONCoding.encoder.encode(CancelRequest(reason: reason)),
            contentType: "application/json"
        )
        return try await client.send(endpoint, as: DetailEnvelope.self).detail
    }

    /// Who the student may add to a session they booked — the server's answer, never a
    /// roster the app filters, so the picker cannot offer a name the invite would refuse.
    public func invitableClassmates(bookingId: Int) async throws -> [SupportClassmate] {
        try await client.send(
            .get("/classes/support/bookings/\(bookingId)/invite/"),
            as: StudentsEnvelope.self
        ).students
    }

    /// Bring a classmate in. They get their own seat (the hour widens if it has to), their
    /// own booking, and a notification and an email.
    public func invite(bookingId: Int, studentId: Int) async throws -> SupportInviteResult {
        try await client.send(
            try .post("/classes/support/bookings/\(bookingId)/invite/", json: InviteRequest(studentId: studentId)),
            as: SupportInviteResult.self
        )
    }

    /// Rate an attended (HELD) session, 1–5. Re-rating overwrites. Never touches points.
    public func rate(bookingId: Int, rating: Int, comment: String = "") async throws -> SupportBooking {
        let body = RateRequest(
            rating: rating,
            comment: String(
                comment.trimmingCharacters(in: .whitespacesAndNewlines).prefix(SupportSchedule.ratingCommentLimit)
            )
        )
        return try await client.send(
            try .post("/classes/support/bookings/\(bookingId)/rate/", json: body),
            as: SupportBooking.self
        )
    }
}

// MARK: - Wire shapes

private struct BookRequest: Encodable, Sendable {
    let supportTeacherId: Int
    let startsAt: String
    let topic: String?
    let classroomId: Int?

    // Synthesised `Encodable` writes nil optionals with `encodeIfPresent`, so an absent
    // topic or class is left out of the body rather than sent as null.
    enum CodingKeys: String, CodingKey {
        case topic
        case supportTeacherId = "support_teacher_id"
        case startsAt = "starts_at"
        case classroomId = "classroom_id"
    }
}

private struct CancelRequest: Encodable, Sendable {
    let reason: String
}

private struct InviteRequest: Encodable, Sendable {
    let studentId: Int

    enum CodingKeys: String, CodingKey {
        case studentId = "student_id"
    }
}

private struct RateRequest: Encodable, Sendable {
    let rating: Int
    let comment: String
}

private struct BookingsEnvelope: Decodable, Sendable {
    let bookings: [SupportBooking]

    private enum CodingKeys: String, CodingKey { case bookings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // `try`, not `try?`: a list that fails to decode must surface as an error, never as
        // "No sessions yet".
        bookings = try c.decodeIfPresent([SupportBooking].self, forKey: .bookings) ?? []
    }
}

private struct StudentsEnvelope: Decodable, Sendable {
    let students: [SupportClassmate]

    private enum CodingKeys: String, CodingKey { case students }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        students = try c.decodeIfPresent([SupportClassmate].self, forKey: .students) ?? []
    }
}

private struct DetailEnvelope: Decodable, Sendable {
    let detail: String

    private enum CodingKeys: String, CodingKey { case detail }

    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        detail = (try? c?.decodeIfPresent(String.self, forKey: .detail)) ?? ""
    }
}

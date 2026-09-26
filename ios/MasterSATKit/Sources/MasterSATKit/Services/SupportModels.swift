import Foundation

// The support desk, from `/api/classes/support/…` (backend `classes/views_support.py`).
//
// Every hour of a support teacher's working day is open by default; a published row only
// ever records an exception — a bigger group (`capacity`) or an hour withdrawn. So the
// calendar is not a list of slots someone published: it is the whole four-day window,
// every hour of it, each carrying a `state` that says why it can or cannot be taken.
//
// Timestamps stay `String`, like everywhere else in this kit, and are read with
// `JSONCoding.parseServerDate`. They arrive in two styles — calendar hours as
// `2026-09-25T15:00:00+05:00`, bookings as `2026-09-25T10:00:00Z` — and both parse.
// Calendar DATES (`dates`, `days[].date`, `taken_days`) are plain `YYYY-MM-DD` in Tashkent
// time; `ServicesTime.date(fromDay:)` reads them.
//
// Scalars decode leniently, with defaults. Collections decode with `try`, not `try?`: one
// malformed teacher must fail the calendar loudly, because swallowing it would render as
// "no support teacher on your classes" — an error shown as an empty state.

/// One hour on the open calendar.
public struct SupportHour: Decodable, Sendable, Equatable, Identifiable {
    /// Why an hour can or cannot be taken.
    public enum State: String, Sendable, Equatable {
        /// Free to book.
        case open
        /// This student's own booked hour.
        case mine
        /// Every seat is taken.
        case full
        /// The teacher withdrew this hour — "he cancelled".
        case closed
        /// Already started or over.
        case past
        /// Outside the teacher's standing weekly schedule — "he's not in then". The web
        /// hides these rather than striking them through.
        case off
        /// The student already holds a session that day (one a day). The only state about
        /// the STUDENT rather than the teacher, which is why the server ranks it above the
        /// teacher-side ones.
        case dayTaken = "day_taken"
        /// A state this build does not know yet. Never bookable.
        case unknown

        init(raw: String?) {
            self = State(rawValue: (raw ?? "").lowercased()) ?? .unknown
        }
    }

    /// `2026-09-25T15:00:00+05:00` — pass it back VERBATIM when booking.
    public let startsAt: String
    public let endsAt: String
    public let state: State
    public let capacity: Int
    public let seatsLeft: Int
    /// The teacher's note for this hour, addressed to the student ("bring your answer sheet").
    public let note: String
    public let availabilityId: Int?
    public let bookingId: Int?

    public var id: String { startsAt }
    public var startDate: Date? { JSONCoding.parseServerDate(startsAt) }

    public init(
        startsAt: String,
        endsAt: String,
        state: State,
        capacity: Int = 1,
        seatsLeft: Int = 1,
        note: String = "",
        availabilityId: Int? = nil,
        bookingId: Int? = nil
    ) {
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.state = state
        self.capacity = capacity
        self.seatsLeft = seatsLeft
        self.note = note
        self.availabilityId = availabilityId
        self.bookingId = bookingId
    }

    private enum CodingKeys: String, CodingKey {
        case state, capacity, note
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case seatsLeft = "seats_left"
        case availabilityId = "availability_id"
        case bookingId = "booking_id"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The hour's identity: without it there is nothing to book.
        startsAt = try c.decode(String.self, forKey: .startsAt)
        endsAt = (try? c.decodeIfPresent(String.self, forKey: .endsAt)) ?? ""
        state = State(raw: try? c.decodeIfPresent(String.self, forKey: .state))
        let capacity = max(1, (try? c.decodeIfPresent(Int.self, forKey: .capacity)) ?? 1)
        self.capacity = capacity
        seatsLeft = max(0, (try? c.decodeIfPresent(Int.self, forKey: .seatsLeft)) ?? capacity)
        note = (try? c.decodeIfPresent(String.self, forKey: .note)) ?? ""
        availabilityId = try? c.decodeIfPresent(Int.self, forKey: .availabilityId)
        bookingId = try? c.decodeIfPresent(Int.self, forKey: .bookingId)
    }
}

/// One day of one teacher's calendar.
public struct SupportCalendarDay: Decodable, Sendable, Equatable, Identifiable {
    /// `YYYY-MM-DD`, Tashkent time.
    public let date: String
    public let hours: [SupportHour]

    public var id: String { date }

    public init(date: String, hours: [SupportHour]) {
        self.date = date
        self.hours = hours
    }

    private enum CodingKeys: String, CodingKey { case date, hours }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        hours = try c.decodeIfPresent([SupportHour].self, forKey: .hours) ?? []
    }
}

/// A class the student and a support teacher share.
public struct SupportClassroomRef: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String

    public init(id: Int, name: String) {
        self.id = id
        self.name = name
    }

    private enum CodingKeys: String, CodingKey { case id, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
    }
}

/// A support teacher the student may book — assigned to one of their classes.
public struct SupportCalendarTeacher: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let photoURL: String?
    public let classrooms: [SupportClassroomRef]
    public let days: [SupportCalendarDay]

    public init(
        id: Int,
        name: String,
        photoURL: String? = nil,
        classrooms: [SupportClassroomRef] = [],
        days: [SupportCalendarDay]
    ) {
        self.id = id
        self.name = name
        self.photoURL = photoURL
        self.classrooms = classrooms
        self.days = days
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, classrooms, days
        case photoURL = "photo_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        let photo = (try? c.decodeIfPresent(String.self, forKey: .photoURL))
        photoURL = (photo?.isEmpty ?? true) ? nil : photo
        classrooms = try c.decodeIfPresent([SupportClassroomRef].self, forKey: .classrooms) ?? []
        days = try c.decodeIfPresent([SupportCalendarDay].self, forKey: .days) ?? []
    }
}

/// How much of the booking allowance the student has left. Sent WITH the calendar so the
/// limit can be shown before an hour is picked, not discovered when the server refuses.
public struct SupportAllowance: Decodable, Sendable, Equatable {
    /// BOOKED sessions still ahead.
    public let upcoming: Int
    public let maxUpcoming: Int
    public let maxPerDay: Int
    /// `YYYY-MM-DD` dates inside the calendar window the student already has a session on.
    public let takenDays: [String]
    /// The standing question only — "may this student book at all right now". The per-day
    /// limit is not folded in; `day_taken` hours carry that.
    public let canBook: Bool

    public init(upcoming: Int, maxUpcoming: Int = 2, maxPerDay: Int = 1, takenDays: [String] = [], canBook: Bool) {
        self.upcoming = upcoming
        self.maxUpcoming = maxUpcoming
        self.maxPerDay = maxPerDay
        self.takenDays = takenDays
        self.canBook = canBook
    }

    private enum CodingKeys: String, CodingKey {
        case upcoming
        case maxUpcoming = "max_upcoming"
        case maxPerDay = "max_per_day"
        case takenDays = "taken_days"
        case canBook = "can_book"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        upcoming = (try? c.decodeIfPresent(Int.self, forKey: .upcoming)) ?? 0
        maxUpcoming = (try? c.decodeIfPresent(Int.self, forKey: .maxUpcoming)) ?? 2
        maxPerDay = (try? c.decodeIfPresent(Int.self, forKey: .maxPerDay)) ?? 1
        takenDays = (try? c.decodeIfPresent([String].self, forKey: .takenDays)) ?? []
        // Absent means "the server did not say" — do not invent a refusal the server will not make.
        canBook = (try? c.decodeIfPresent(Bool.self, forKey: .canBook)) ?? true
    }
}

/// `GET /api/classes/support/calendar/`.
public struct SupportCalendar: Decodable, Sendable, Equatable {
    /// How many days ahead, today included. 4.
    public let days: Int
    public let openHour: Int
    public let closeHour: Int
    public let dates: [String]
    /// Nil only against a server that predates the limits.
    public let allowance: SupportAllowance?
    public let teachers: [SupportCalendarTeacher]

    public init(
        days: Int = 4,
        openHour: Int = 8,
        closeHour: Int = 18,
        dates: [String] = [],
        allowance: SupportAllowance?,
        teachers: [SupportCalendarTeacher]
    ) {
        self.days = days
        self.openHour = openHour
        self.closeHour = closeHour
        self.dates = dates
        self.allowance = allowance
        self.teachers = teachers
    }

    private enum CodingKeys: String, CodingKey {
        case days, dates, allowance, teachers
        case openHour = "open_hour"
        case closeHour = "close_hour"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        days = (try? c.decodeIfPresent(Int.self, forKey: .days)) ?? 4
        openHour = (try? c.decodeIfPresent(Int.self, forKey: .openHour)) ?? 8
        closeHour = (try? c.decodeIfPresent(Int.self, forKey: .closeHour)) ?? 18
        dates = (try? c.decodeIfPresent([String].self, forKey: .dates)) ?? []
        allowance = try? c.decodeIfPresent(SupportAllowance.self, forKey: .allowance)
        teachers = try c.decodeIfPresent([SupportCalendarTeacher].self, forKey: .teachers) ?? []
    }
}

/// The hour a booking holds. `seatsLeft` is only sent by the legacy `slots/` list.
public struct SupportSlot: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let supportTeacherId: Int
    public let supportTeacher: String
    public let startsAt: String
    public let endsAt: String
    public let capacity: Int
    public let note: String
    /// The teacher withdrew the hour. Its bookings are cancelled with it, but a withdrawn
    /// hour must never be offered as "your next hour" even for a moment.
    public let isCancelled: Bool
    public let seatsLeft: Int?

    public init(
        id: Int,
        supportTeacherId: Int = 0,
        supportTeacher: String,
        startsAt: String,
        endsAt: String,
        capacity: Int = 1,
        note: String = "",
        isCancelled: Bool = false,
        seatsLeft: Int? = nil
    ) {
        self.id = id
        self.supportTeacherId = supportTeacherId
        self.supportTeacher = supportTeacher
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.capacity = capacity
        self.note = note
        self.isCancelled = isCancelled
        self.seatsLeft = seatsLeft
    }

    private enum CodingKeys: String, CodingKey {
        case id, capacity, note
        case supportTeacherId = "support_teacher_id"
        case supportTeacher = "support_teacher"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case isCancelled = "is_cancelled"
        case seatsLeft = "seats_left"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        supportTeacherId = (try? c.decodeIfPresent(Int.self, forKey: .supportTeacherId)) ?? 0
        supportTeacher = (try? c.decodeIfPresent(String.self, forKey: .supportTeacher)) ?? ""
        startsAt = (try? c.decodeIfPresent(String.self, forKey: .startsAt)) ?? ""
        endsAt = (try? c.decodeIfPresent(String.self, forKey: .endsAt)) ?? ""
        capacity = max(1, (try? c.decodeIfPresent(Int.self, forKey: .capacity)) ?? 1)
        note = (try? c.decodeIfPresent(String.self, forKey: .note)) ?? ""
        isCancelled = (try? c.decodeIfPresent(Bool.self, forKey: .isCancelled)) ?? false
        seatsLeft = try? c.decodeIfPresent(Int.self, forKey: .seatsLeft)
    }
}

/// One of the student's own support sessions.
public struct SupportBooking: Decodable, Sendable, Equatable, Identifiable {
    public enum Status: String, Sendable, Equatable {
        case booked = "BOOKED"
        /// The teacher marked it attended — this is what pays the points.
        case held = "HELD"
        case noShow = "NO_SHOW"
        case cancelled = "CANCELLED"
        case unknown

        init(raw: String?) {
            // Status casing differs between apps on this platform; compare upper-cased.
            self = Status(rawValue: (raw ?? "").uppercased()) ?? .unknown
        }
    }

    public let id: Int
    public let status: Status
    /// The wire value, kept for a status this build does not know.
    public let statusRaw: String
    public let topic: String
    public let bookedAt: String
    public let settledAt: String?
    public let classroomId: Int?
    public let classroomName: String?
    public let studentId: Int
    public let student: String
    /// The classmate who brought this student in; nil when they booked it themselves.
    public let invitedById: Int?
    public let invitedBy: String?
    /// Why the seat came back. Shown to the teacher, who held the hour.
    public let cancelReason: String
    public let cancelledAt: String?
    /// The student's own 1–5 verdict on the hour. Never touches points.
    public let rating: Int?
    public let ratingComment: String
    public let ratedAt: String?
    /// What the teacher says the hour covered, written when they settle it.
    public let teacherNote: String
    public let slot: SupportSlot

    public init(
        id: Int,
        status: Status,
        topic: String = "",
        bookedAt: String = "",
        settledAt: String? = nil,
        classroomId: Int? = nil,
        classroomName: String? = nil,
        studentId: Int = 0,
        student: String = "",
        invitedById: Int? = nil,
        invitedBy: String? = nil,
        cancelReason: String = "",
        cancelledAt: String? = nil,
        rating: Int? = nil,
        ratingComment: String = "",
        ratedAt: String? = nil,
        teacherNote: String = "",
        slot: SupportSlot
    ) {
        self.id = id
        self.status = status
        self.statusRaw = status.rawValue
        self.topic = topic
        self.bookedAt = bookedAt
        self.settledAt = settledAt
        self.classroomId = classroomId
        self.classroomName = classroomName
        self.studentId = studentId
        self.student = student
        self.invitedById = invitedById
        self.invitedBy = invitedBy
        self.cancelReason = cancelReason
        self.cancelledAt = cancelledAt
        self.rating = rating
        self.ratingComment = ratingComment
        self.ratedAt = ratedAt
        self.teacherNote = teacherNote
        self.slot = slot
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, topic, student, rating, slot
        case bookedAt = "booked_at"
        case settledAt = "settled_at"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
        case studentId = "student_id"
        case invitedById = "invited_by_id"
        case invitedBy = "invited_by"
        case cancelReason = "cancel_reason"
        case cancelledAt = "cancelled_at"
        case ratingComment = "rating_comment"
        case ratedAt = "rated_at"
        case teacherNote = "teacher_note"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        let raw = (try? c.decodeIfPresent(String.self, forKey: .status))
        status = Status(raw: raw)
        statusRaw = raw ?? ""
        topic = (try? c.decodeIfPresent(String.self, forKey: .topic)) ?? ""
        bookedAt = (try? c.decodeIfPresent(String.self, forKey: .bookedAt)) ?? ""
        settledAt = try? c.decodeIfPresent(String.self, forKey: .settledAt)
        classroomId = try? c.decodeIfPresent(Int.self, forKey: .classroomId)
        let classroom = (try? c.decodeIfPresent(String.self, forKey: .classroomName))
        classroomName = (classroom?.isEmpty ?? true) ? nil : classroom
        studentId = (try? c.decodeIfPresent(Int.self, forKey: .studentId)) ?? 0
        student = (try? c.decodeIfPresent(String.self, forKey: .student)) ?? ""
        invitedById = try? c.decodeIfPresent(Int.self, forKey: .invitedById)
        let inviter = (try? c.decodeIfPresent(String.self, forKey: .invitedBy))
        invitedBy = (inviter?.isEmpty ?? true) ? nil : inviter
        cancelReason = (try? c.decodeIfPresent(String.self, forKey: .cancelReason)) ?? ""
        cancelledAt = try? c.decodeIfPresent(String.self, forKey: .cancelledAt)
        let rating = (try? c.decodeIfPresent(Int.self, forKey: .rating))
        self.rating = rating.flatMap { (1...5).contains($0) ? $0 : nil }
        ratingComment = (try? c.decodeIfPresent(String.self, forKey: .ratingComment)) ?? ""
        ratedAt = try? c.decodeIfPresent(String.self, forKey: .ratedAt)
        teacherNote = (try? c.decodeIfPresent(String.self, forKey: .teacherNote)) ?? ""
        // The hour itself. A booking without one has no teacher and no time — nothing to show.
        slot = try c.decode(SupportSlot.self, forKey: .slot)
    }
}

/// A classmate the student may add to a session — the server's own answer to "who can go
/// in this seat?", never a roster the app filters itself.
public struct SupportClassmate: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String

    public init(id: Int, name: String) {
        self.id = id
        self.name = name
    }

    private enum CodingKeys: String, CodingKey { case id, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
    }
}

/// `POST …/invite/` → `{"detail": "{Name} has been added and told.", "booking": {…}}`.
public struct SupportInviteResult: Decodable, Sendable, Equatable {
    /// The server's sentence, written for the inviter.
    public let detail: String
    /// The invitee's own new booking. Read leniently: the seat exists once the server said
    /// 201, and a body this build cannot parse must not read as "the invite failed".
    public let booking: SupportBooking?

    private enum CodingKeys: String, CodingKey { case detail, booking }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        detail = (try? c.decodeIfPresent(String.self, forKey: .detail)) ?? ""
        booking = (try? c.decodeIfPresent(SupportBooking.self, forKey: .booking))
    }
}

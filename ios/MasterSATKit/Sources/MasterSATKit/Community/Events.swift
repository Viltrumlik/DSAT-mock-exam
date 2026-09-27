import Foundation

// Learning-center events — `/api/events/`. Named `LearningEvent`, as the web names it: an
// `Event` type would collide with every other thing in an app that is called an event.

/// The student's own seat at one event.
public struct EventSeat: Decodable, Sendable, Equatable, Hashable {
    public let id: Int
    /// "REGISTERED" | "CANCELLED".
    public let status: String
    /// "ATTENDED" | "MISSED" | nil (not marked yet).
    public let attendance: String?
    public let registeredAt: String?
    /// What this seat has actually paid, read from the ledger — 0 until somebody is marked,
    /// and back to 0 if a mark is corrected.
    public let pointsAwarded: Int
    /// Shown as "4K29-7XPD". Empty on a row minted before tickets existed.
    public let ticketCode: String

    public var isRegistered: Bool { status.uppercased() == "REGISTERED" }

    public init(
        id: Int, status: String = "REGISTERED", attendance: String? = nil,
        registeredAt: String? = nil, pointsAwarded: Int = 0, ticketCode: String = ""
    ) {
        self.id = id
        self.status = status
        self.attendance = attendance
        self.registeredAt = registeredAt
        self.pointsAwarded = pointsAwarded
        self.ticketCode = ticketCode
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, attendance
        case registeredAt = "registered_at"
        case pointsAwarded = "points_awarded"
        case ticketCode = "ticket_code"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? ""
        attendance = (try? c.decodeIfPresent(String.self, forKey: .attendance)) ?? nil
        registeredAt = (try? c.decodeIfPresent(String.self, forKey: .registeredAt)) ?? nil
        pointsAwarded = (try? c.decodeIfPresent(Int.self, forKey: .pointsAwarded)) ?? 0
        ticketCode = (try? c.decodeIfPresent(String.self, forKey: .ticketCode)) ?? ""
    }
}

/// A workshop, talk or open day.
public struct LearningEvent: Decodable, Identifiable, Sendable, Equatable, Hashable {
    public let id: Int
    public let title: String
    public let description: String
    /// Signed and expiring (~1h). Nil when the event was saved without a picture.
    public let coverImageURL: String?
    public let startsAt: String
    public let endsAt: String
    public let location: String
    public let seats: Int
    public let seatsLeft: Int
    /// "DRAFT" | "PUBLISHED" | "CANCELLED".
    public let status: String
    public let myRegistration: EventSeat?
    /// Decided by the server, and used as-is. A second copy of the seat rules here would be a
    /// second place for them to drift.
    public let canSignUp: Bool
    public let canCancel: Bool

    public var startDate: Date? { JSONCoding.parseServerDate(startsAt) }
    public var endDate: Date? { JSONCoding.parseServerDate(endsAt) }
    /// A seat the student still holds — the one that gets a ticket.
    public var holdsSeat: Bool { myRegistration?.isRegistered ?? false }
    /// Called off by the learning center.
    public var isCancelled: Bool { status.uppercased() == "CANCELLED" }

    public init(
        id: Int, title: String, description: String = "", coverImageURL: String? = nil,
        startsAt: String, endsAt: String, location: String = "", seats: Int = 0,
        seatsLeft: Int = 0, status: String = "PUBLISHED", myRegistration: EventSeat? = nil,
        canSignUp: Bool = false, canCancel: Bool = false
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.coverImageURL = coverImageURL
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.location = location
        self.seats = seats
        self.seatsLeft = seatsLeft
        self.status = status
        self.myRegistration = myRegistration
        self.canSignUp = canSignUp
        self.canCancel = canCancel
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, location, seats, status
        case coverImageURL = "cover_image_url"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case seatsLeft = "seats_left"
        case myRegistration = "my_registration"
        case canSignUp = "can_sign_up"
        case canCancel = "can_cancel"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        coverImageURL = (try? c.decodeIfPresent(String.self, forKey: .coverImageURL)).flatMap {
            $0.isEmpty ? nil : $0
        }
        startsAt = (try? c.decodeIfPresent(String.self, forKey: .startsAt)) ?? ""
        endsAt = (try? c.decodeIfPresent(String.self, forKey: .endsAt)) ?? ""
        location = (try? c.decodeIfPresent(String.self, forKey: .location)) ?? ""
        seats = (try? c.decodeIfPresent(Int.self, forKey: .seats)) ?? 0
        seatsLeft = (try? c.decodeIfPresent(Int.self, forKey: .seatsLeft)) ?? 0
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? ""
        myRegistration = (try? c.decodeIfPresent(EventSeat.self, forKey: .myRegistration)) ?? nil
        canSignUp = (try? c.decodeIfPresent(Bool.self, forKey: .canSignUp)) ?? false
        canCancel = (try? c.decodeIfPresent(Bool.self, forKey: .canCancel)) ?? false
    }
}

// MARK: - Rules

/// Where an upcoming event stands for this student — the one thing its row's action says.
public enum EventRowState: Sendable, Equatable {
    /// The server says a seat can be taken.
    case open(seatsLeft: Int)
    /// The student holds a seat. `canCancel` is the server's answer, not a clock sum.
    case signedUp(canCancel: Bool)
    /// No seats left, and it has not started.
    case full
    /// Already under way. The web calls this "Full" too, which is wrong when seats are left.
    case started
}

/// How a past event went for the student.
public enum EventOutcome: Sendable, Equatable {
    case attended(points: Int)
    case missed
    case notMarked
    /// Called off by the learning center, so it can never be marked.
    case eventCancelled
}

public enum EventRules {
    /// How long before the start a seat can no longer be given back —
    /// `events.services.CANCEL_CUTOFF`. Used only to WARN before a sign-up that could not be
    /// undone; whether a cancel is allowed is always the server's `can_cancel`.
    public static let cancelCutoff: TimeInterval = 2 * 60 * 60

    public static func state(of event: LearningEvent, now: Date = Date()) -> EventRowState {
        if event.canSignUp { return .open(seatsLeft: event.seatsLeft) }
        if event.holdsSeat { return .signedUp(canCancel: event.canCancel) }
        // The server refuses a seat for exactly two reasons on a published event: it has
        // started, or it is full. Seats still left therefore means it has started — by the
        // server's clock, which wins over this device's.
        if hasStarted(event, now: now) || event.seatsLeft > 0 { return .started }
        return .full
    }

    public static func hasStarted(_ event: LearningEvent, now: Date = Date()) -> Bool {
        guard let start = event.startDate else { return false }
        return start <= now
    }

    /// Whether a seat taken now would already be past the point of giving it back.
    public static func signUpIsFinal(_ event: LearningEvent, now: Date = Date()) -> Bool {
        guard let start = event.startDate else { return false }
        return start.timeIntervalSince(now) < cancelCutoff
    }

    /// The events a student has been to: from `/events/mine/`, finished, with a seat still
    /// held. A seat given back is not an event they went to, and listing it as
    /// "Not marked yet" (as the web does) would be untrue forever.
    public static func pastEvents(_ mine: [LearningEvent], now: Date = Date()) -> [LearningEvent] {
        mine.filter { event in
            guard let end = event.endDate, end < now else { return false }
            return event.holdsSeat
        }
    }

    public static func outcome(of event: LearningEvent) -> EventOutcome {
        if event.isCancelled { return .eventCancelled }
        switch (event.myRegistration?.attendance ?? "").uppercased() {
        case "ATTENDED": return .attended(points: event.myRegistration?.pointsAwarded ?? 0)
        case "MISSED": return .missed
        default: return .notMarked
        }
    }

    /// What the "Open for sign-up" tile and a Home badge count.
    public static func openForSignUp(_ events: [LearningEvent]) -> Int {
        events.filter(\.canSignUp).count
    }
}

// MARK: - Refusals

/// Why the server would not take or give back a seat.
///
/// The server sends a code beside its sentence (`{"code": "full", "detail": "…"}`) precisely
/// so a client never has to read the English. `detail` is what to show; `reason` is what to
/// branch on.
public struct EventRefusal: Error, Sendable, Equatable {
    public enum Reason: Sendable, Equatable {
        /// Not a published event, or this account cannot hold seats.
        case notOpen
        case started
        /// 409 — the last seat went. One opens if somebody cancels.
        case full
        case notRegistered
        /// Less than two hours to go: the seat is theirs whether they come or not.
        case cancelWindowClosed
        case other(String)

        public init(code: String) {
            switch code {
            case "not_open": self = .notOpen
            case "started": self = .started
            case "full": self = .full
            case "not_registered": self = .notRegistered
            case "cancel_window_closed": self = .cancelWindowClosed
            default: self = .other(code)
            }
        }
    }

    public let reason: Reason
    public let detail: String
    public let status: Int

    public init(reason: Reason, detail: String, status: Int) {
        self.reason = reason
        self.detail = detail
        self.status = status
    }

    init(_ refusal: APIRefusal) {
        self.init(reason: Reason(code: refusal.code), detail: refusal.detail, status: refusal.status)
    }
}

extension EventRefusal: LocalizedError {
    /// The server's own sentence; its wording from `events/services.py` when it sent none.
    public var errorDescription: String? {
        if !detail.isEmpty { return detail }
        switch reason {
        case .notOpen: return "That event isn't open for sign-ups."
        case .started: return "That event has already started."
        case .full: return "That event is full. A seat opens if somebody cancels."
        case .notRegistered: return "You don't hold a seat at that event."
        case .cancelWindowClosed: return "It's too late to cancel — the event starts in less than two hours."
        case .other: return "Couldn't do that. Try again."
        }
    }
}

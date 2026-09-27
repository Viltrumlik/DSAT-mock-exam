import Foundation

/// The student's side of `/api/events/`.
public struct EventsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Published events that have not finished yet, soonest first.
    public func upcoming() async throws -> [LearningEvent] {
        try await client.send(.get("/events/"), as: Envelope.self).events
    }

    /// Every event the student ever took a seat at — any status, past ones included — newest
    /// first.
    public func mine() async throws -> [LearningEvent] {
        try await client.send(.get("/events/mine/"), as: Envelope.self).events
    }

    /// How many events are open for sign-up right now — what a badge on Home needs.
    public func openForSignUpCount() async throws -> Int {
        EventRules.openForSignUp(try await upcoming())
    }

    /// Take a seat. Idempotent on the server: holding one already answers 201 with it.
    ///
    /// - Throws: `EventRefusal` (`notOpen`, `started`, `full`) when the seat cannot be had;
    ///   `APIError` for everything else.
    public func signUp(eventId: Int) async throws -> EventSeat {
        do {
            return try await client.sendCoded(.post("/events/\(eventId)/sign-up/"), as: EventSeat.self)
        } catch let refusal as APIRefusal {
            throw EventRefusal(refusal)
        }
    }

    /// Give the seat back — allowed until two hours before the start.
    ///
    /// - Throws: `EventRefusal` (`notRegistered`, `cancelWindowClosed`); `APIError.http(404)`
    ///   when the student never had a seat there at all.
    public func cancel(eventId: Int) async throws -> EventSeat {
        do {
            return try await client.sendCoded(.post("/events/\(eventId)/cancel/"), as: EventSeat.self)
        } catch let refusal as APIRefusal {
            throw EventRefusal(refusal)
        }
    }

    /// The ticket, as the PNG the server renders (headless Chromium — it takes seconds).
    /// 404 unless the student holds a seat at a published event.
    ///
    /// Checked for the PNG signature: a proxy's HTML error page arriving as a 200 must fail
    /// here, loudly, rather than as an image that silently never draws.
    public func ticketPNG(eventId: Int) async throws -> Data {
        let path = "/events/\(eventId)/ticket.png"
        let data = try await client.send(.get(path))
        guard Self.isPNG(data) else {
            throw APIError.decoding(context: path, underlying: "the ticket is not a PNG image")
        }
        return data
    }

    static func isPNG(_ data: Data) -> Bool {
        data.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    }

    private struct Envelope: Decodable, Sendable {
        let events: [LearningEvent]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            events = (try? c.decodeIfPresent(CommunityLossyList<LearningEvent>.self, forKey: .events))?
                .elements ?? []
        }

        enum CodingKeys: String, CodingKey { case events }
    }
}

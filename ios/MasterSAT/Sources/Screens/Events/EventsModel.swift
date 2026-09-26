import SwiftUI
import MasterSATKit

/// The events page's state: what is coming up, the student's own seats, and whatever is in
/// flight. Every "may I" is the server's (`can_sign_up`, `can_cancel`); the rules for turning
/// those into a row are `EventRules` in the kit, tested there.
@MainActor
@Observable
final class EventsModel {
    enum Load: Equatable { case loading, loaded, failed }

    private let api: EventsAPI

    private(set) var upcoming: [LearningEvent] = []
    private(set) var upcomingState: Load = .loading
    private(set) var mine: [LearningEvent] = []
    private(set) var mineState: Load = .loading

    /// Events with a sign-up or cancel in flight. Their buttons stay disabled until the list
    /// has been re-read, so a second tap can never land on a row that is about to change.
    private(set) var busy: Set<Int> = []
    /// The last refusal per row, in the server's own words.
    private(set) var rowErrors: [Int: String] = [:]
    private(set) var ticketLoading: Int?
    private(set) var ticketFailed: Set<Int> = []
    /// The ticket on screen, full-size.
    var presentedTicket: EventTicket?

    init(api: EventsAPI) {
        self.api = api
    }

    /// Finished events the student held a seat at.
    var past: [LearningEvent] { EventRules.pastEvents(mine) }

    var openForSignUp: Int { EventRules.openForSignUp(upcoming) }

    // MARK: - Loading

    /// Both lists, side by side. Each keeps what it last showed if a later re-read fails:
    /// the page never trades a real list for an error because a refresh blinked.
    func load() async {
        // A retry after a failure shows the placeholders again, so "Try again" visibly does
        // something; a list already on screen stays put while it is re-read.
        if upcomingState == .failed { upcomingState = .loading }
        if mineState == .failed { mineState = .loading }
        let api = self.api
        async let upcomingResult = api.upcoming()
        async let mineResult = api.mine()
        do {
            upcoming = try await upcomingResult
            upcomingState = .loaded
        } catch {
            if upcomingState != .loaded { upcomingState = .failed }
        }
        do {
            mine = try await mineResult
            mineState = .loaded
        } catch {
            if mineState != .loaded { mineState = .failed }
        }
    }

    // MARK: - Seats

    /// Take a seat. Never retried on its own.
    func signUp(_ event: LearningEvent) async {
        await change(event) { api, id in _ = try await api.signUp(eventId: id) }
    }

    /// Give the seat back — the view confirms first.
    func cancel(_ event: LearningEvent) async {
        await change(event) { api, id in _ = try await api.cancel(eventId: id) }
    }

    private func change(
        _ event: LearningEvent,
        _ action: @escaping @Sendable (EventsAPI, Int) async throws -> Void
    ) async {
        guard !busy.contains(event.id) else { return }
        busy.insert(event.id)
        rowErrors[event.id] = nil
        do {
            try await action(api, event.id)
        } catch {
            // `EventRefusal` carries the server's sentence ("That event is full. A seat opens
            // if somebody cancels.") — shown as written.
            rowErrors[event.id] = CommunityErrorText.message(error, fallback: "Couldn't do that. Try again.")
        }
        // Re-read either way. A refusal is usually the world moving between render and tap —
        // the last seat went, the two-hour window closed — and the row should now say so.
        await load()
        busy.remove(event.id)
    }

    // MARK: - Tickets

    /// Fetch the ticket (the server renders it; it takes seconds) and show it full-screen.
    func openTicket(_ event: LearningEvent) async {
        guard ticketLoading == nil else { return }
        ticketFailed.remove(event.id)
        let key = EventTicketCache.key(for: event)
        if let data = EventTicketCache.shared.data(for: key), let ticket = EventTicket(event: event, data: data) {
            presentedTicket = ticket
            return
        }
        ticketLoading = event.id
        defer { ticketLoading = nil }
        do {
            let data = try await api.ticketPNG(eventId: event.id)
            guard let ticket = EventTicket(event: event, data: data) else {
                ticketFailed.insert(event.id)
                return
            }
            EventTicketCache.shared.store(data, for: key)
            presentedTicket = ticket
        } catch {
            ticketFailed.insert(event.id)
        }
    }
}

/// One rendered ticket, ready to show.
struct EventTicket: Identifiable {
    let id: Int
    let title: String
    /// "4K29-7XPD", or "" on a seat minted before tickets existed.
    let code: String
    let image: UIImage
    let data: Data

    init?(event: LearningEvent, data: Data) {
        guard let image = UIImage(data: data) else { return nil }
        id = event.id
        title = event.title
        code = event.myRegistration?.ticketCode ?? ""
        self.image = image
        self.data = data
    }

    /// The server's own attachment name: `mastersat-event-<CODE>.png`, the code undashed.
    var fileName: String {
        let stem = code.isEmpty ? String(id) : code.replacingOccurrences(of: "-", with: "")
        return "mastersat-event-\(stem).png"
    }
}

/// Tickets already fetched this session. A ticket takes the server seconds to render and
/// does not change unless the event does, so asking twice is waste.
@MainActor
final class EventTicketCache {
    static let shared = EventTicketCache()

    private var store: [String: Data] = [:]

    /// Everything printed on the ticket that could change: a moved start time or room is a
    /// different picture, and a stale one would send a student to the wrong door.
    static func key(for event: LearningEvent) -> String {
        [
            String(event.id), event.myRegistration?.ticketCode ?? "", event.title,
            event.startsAt, event.endsAt, event.location,
        ].joined(separator: "|")
    }

    func data(for key: String) -> Data? { store[key] }

    func store(_ data: Data, for key: String) { store[key] = data }
}

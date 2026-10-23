import SwiftUI
import MasterSATKit

/// What Explore's four cards say: the six reads behind them, and the line each card gets from
/// `ExploreDigest`.
///
/// Every read stands alone. One that fails keeps the last answer it had, so a blink never trades
/// a line the student was reading for the card's fixed description; one that has never answered
/// leaves its card on that description. A failure is never worded as "nothing here" — only an
/// answer that really is empty ("Nothing waiting for you") is.
///
/// The slots are `ProfileLoad`s, but `isLoading` stays unused: no card draws a spinner, and a
/// write nobody reads would redraw the page for nothing.
@MainActor
@Observable
final class ExploreModel {
    private(set) var roadmap = ProfileLoad<RoadmapResponse>()
    private(set) var bookings = ProfileLoad<[SupportBooking]>()
    private(set) var calendar = ProfileLoad<SupportCalendar>()
    private(set) var examDates = ProfileLoad<[ExamDateOption]>()
    private(set) var events = ProfileLoad<[LearningEvent]>()
    private(set) var surveys = ProfileLoad<[SurveyBrief]>()

    /// The newest read asked of each slot, and the read whose answer the slot holds. An answer
    /// older than the one held is dropped, so a slow read from the tab appearing never lands
    /// over the fresher one a pull started after it — but any newer one is taken, even when a
    /// read after it is still out or has failed: a real answer beats keeping an older one.
    /// Only the newest read's failure is recorded; an older one's says nothing.
    @ObservationIgnored private var tickets: [AnyKeyPath: Int] = [:]
    @ObservationIgnored private var applied: [AnyKeyPath: Int] = [:]

    // MARK: - The lines

    // Read at draw time: the page redraws when a slot changes, and "today" and "in 2 hours" are
    // worded against the clock of that moment.

    var roadmapLine: ExploreLine? {
        roadmap.value.map { ExploreDigest.roadmap($0, when: CommunityFormat.dayMonth) }
    }

    /// Nil until the bookings and the calendar have each answered or failed; then the line words
    /// the parts that arrived (`ExploreDigest.services`). Worded from whichever landed first,
    /// a cold open read "Book an hour…", then the calendar's line, then "Your next hour…".
    var servicesLine: ExploreLine? {
        guard !bookings.isPending, !calendar.isPending else { return nil }
        return ExploreDigest.services(
            bookings: bookings.value,
            calendar: calendar.value,
            examDates: examDates.value,
            now: Date()
        )
    }

    var eventsLine: ExploreLine? {
        events.value.map { ExploreDigest.events($0, now: Date(), when: CommunityFormat.when) }
    }

    var surveysLine: ExploreLine? {
        surveys.value.map(ExploreDigest.surveys)
    }

    // MARK: - Loading

    /// All six reads at once, each landing on its own as it arrives. The tab calls it every time
    /// it comes back to the front, and a pull calls it again.
    func load(_ session: Session) async {
        async let road: Void = loadRoadmap(session)
        async let booked: Void = loadBookings(session)
        async let hours: Void = loadCalendar(session)
        async let sat: Void = loadExamDates(session)
        async let upcoming: Void = loadEvents(session)
        async let waiting: Void = loadSurveys(session)
        _ = await (road, booked, hours, sat, upcoming, waiting)
    }

    private func loadRoadmap(_ session: Session) async {
        let api = RoadmapAPI(client: session.client)
        await read(\.roadmap) { try await api.roadmap() }
    }

    private func loadBookings(_ session: Session) async {
        let api = SupportAPI(client: session.client)
        await read(\.bookings) { try await api.bookings() }
    }

    private func loadCalendar(_ session: Session) async {
        let api = SupportAPI(client: session.client)
        await read(\.calendar) { try await api.calendar() }
    }

    private func loadExamDates(_ session: Session) async {
        let api = session.student
        await read(\.examDates) { try await api.examDates() }
    }

    private func loadEvents(_ session: Session) async {
        let api = EventsAPI(client: session.client)
        await read(\.events) { try await api.upcoming() }
    }

    private func loadSurveys(_ session: Session) async {
        let api = SurveysAPI(client: session.client)
        await read(\.surveys) { try await api.open() }
    }

    /// One request, finished whatever becomes of the task that asked. A pull re-renders the page
    /// and a tab change leaves it, either of which can cancel that task mid-request — and
    /// `APIClient` words a cancellation as a transport failure, which would be stored as one.
    /// On a task of its own the request always lands with its real result.
    ///
    /// Every write is guarded: each one notifies the page whether or not the value changed, and
    /// a tab that comes back to an unchanged answer should not redraw four cards for it.
    private func read<Value: Equatable & Sendable>(
        _ slot: ReferenceWritableKeyPath<ExploreModel, ProfileLoad<Value>>,
        _ fetch: @escaping @Sendable () async throws -> Value
    ) async {
        let ticket = (tickets[slot] ?? 0) + 1
        tickets[slot] = ticket
        let request = Task { try await fetch() }
        do {
            let value = try await request.value
            guard ticket > (applied[slot] ?? 0) else { return }
            applied[slot] = ticket
            if self[keyPath: slot].value != value { self[keyPath: slot].value = value }
            if self[keyPath: slot].failed { self[keyPath: slot].failed = false }
        } catch {
            // A failure nobody is waiting for any more says nothing; neither does a stale one.
            guard tickets[slot] == ticket, !Task.isCancelled else { return }
            if !self[keyPath: slot].failed { self[keyPath: slot].failed = true }
        }
    }
}

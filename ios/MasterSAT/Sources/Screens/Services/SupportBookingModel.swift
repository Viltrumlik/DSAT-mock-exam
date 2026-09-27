import SwiftUI
import MasterSATKit

/// The support page's state: the calendar, the student's sessions, and every write.
///
/// **Kept fresh on purpose.** This is the one screen where a stale copy tells a student
/// something wrong rather than merely old: seats are contended, and the learning center
/// reported exactly the failure that follows from never re-reading — one student books and
/// the hour still shows free to the next, who picks it and is refused. So the calendar is
/// re-read every 30 seconds while the page is on screen, whenever the app comes back to the
/// foreground, and after every write, refused or not.
///
/// **Newest request wins.** A poll, a pull-to-refresh and the re-read after a booking can
/// all be in flight at once and answer in any order; each read is numbered, and an answer
/// to anything but the latest is dropped rather than painting an older grid over a newer one.
///
/// **No write is ever retried.** Booking, cancelling and inviting are not idempotent; each
/// runs once per tap, and what happened is learned by re-reading, not by sending again.
@MainActor
@Observable
final class SupportBookingModel {
    private(set) var calendar: ServicesLoadState<SupportCalendar> = .loading
    private(set) var bookings: ServicesLoadState<[SupportBooking]> = .loading
    /// A background re-read failed while an older calendar is on screen. It stays up — a
    /// transient failure must not blank a working grid — but it is flagged as possibly stale.
    private(set) var calendarIsStale = false
    /// A sentence the server wrote after something worked ("Madina has been added and told."),
    /// shown briefly above the sessions list.
    var notice: String?

    /// Per teacher, the date whose hours are on screen. Pinned on first load so a poll never
    /// moves the strip under the student's eyes.
    private var selectedDay: [Int: String] = [:]

    private var api: SupportAPI?
    private var calendarRead = 0
    private var bookingsRead = 0

    func attach(_ client: APIClient) {
        if api == nil { api = SupportAPI(client: client) }
    }

    // MARK: - Reading

    func refreshAll() async {
        async let hours: Void = refreshCalendar()
        async let sessions: Void = refreshBookings()
        _ = await (hours, sessions)
    }

    /// `quiet`: a background poll. It never swaps an error for a spinner every 30 seconds —
    /// it only replaces the error if the calendar comes back.
    func refreshCalendar(quiet: Bool = false) async {
        guard let api else { return }
        calendarRead += 1
        let read = calendarRead
        if !quiet, calendar.isFailed { calendar = .loading }
        do {
            let fresh = try await api.calendar()
            guard read == calendarRead else { return }
            for teacher in fresh.teachers where selectedDay[teacher.id] == nil {
                let first = SupportSchedule.firstLiveDayIndex(teacher.days)
                if teacher.days.indices.contains(first) { selectedDay[teacher.id] = teacher.days[first].date }
            }
            calendar = .loaded(fresh)
            calendarIsStale = false
        } catch {
            // A read cancelled because the page left says nothing; the next appearance re-reads.
            guard read == calendarRead, !Task.isCancelled else { return }
            if calendar.value != nil {
                calendarIsStale = true
            } else {
                calendar = .failed(ServicesError.message(error))
            }
        }
    }

    func refreshBookings() async {
        guard let api else { return }
        bookingsRead += 1
        let read = bookingsRead
        if bookings.isFailed { bookings = .loading }
        do {
            let fresh = try await api.bookings()
            guard read == bookingsRead else { return }
            bookings = .loaded(fresh)
        } catch {
            guard read == bookingsRead, !Task.isCancelled else { return }
            // Keep a list already on screen; say so only when there is nothing to show.
            if bookings.value == nil { bookings = .failed(ServicesError.message(error)) }
        }
    }

    // MARK: - The day strip

    func selectedIndex(for teacher: SupportCalendarTeacher) -> Int {
        if let date = selectedDay[teacher.id],
           let index = teacher.days.firstIndex(where: { $0.date == date }) {
            return index
        }
        // The chosen date rolled out of the window (midnight passed): back to the first day
        // with something left.
        return SupportSchedule.firstLiveDayIndex(teacher.days)
    }

    func select(_ day: SupportCalendarDay, for teacher: SupportCalendarTeacher) {
        selectedDay[teacher.id] = day.date
    }

    // MARK: - Writing
    //
    // Each returns nil when it worked, or the sentence to show when it did not — and on BOTH
    // paths re-reads the calendar and the sessions: a refusal ("That slot is full.") is the
    // server saying the grid is out of date, and a dropped connection leaves only the server
    // knowing whether the seat was taken.
    //
    // The re-read is started, not awaited, exactly as the site invalidates its queries: the
    // sheet closes (or shows the refusal) the moment the write answers, and the page corrects
    // itself underneath. Awaiting it held the sheet on a spinner it cannot be swiped away from
    // for as long as a slow read took — up to the request timeout, after a booking that had
    // already succeeded.

    func book(teacherId: Int, startsAt: String, topic: String) async -> String? {
        guard let api else { return Self.notReady }
        defer { rereadAfterWrite() }
        do {
            _ = try await api.book(supportTeacherId: teacherId, startsAt: startsAt, topic: topic)
            return nil
        } catch {
            return ServicesError.message(error)
        }
    }

    func cancel(_ booking: SupportBooking, reason: String) async -> String? {
        guard let api else { return Self.notReady }
        defer { rereadAfterWrite() }
        do {
            try await api.cancel(bookingId: booking.id, reason: reason)
            return nil
        } catch {
            return ServicesError.message(error)
        }
    }

    func classmates(for booking: SupportBooking) async throws -> [SupportClassmate] {
        guard let api else { throw APIError.notAuthenticated }
        return try await api.invitableClassmates(bookingId: booking.id)
    }

    func invite(_ student: SupportClassmate, to booking: SupportBooking) async -> String? {
        guard let api else { return Self.notReady }
        // An invitation widens the hour, so what is bookable moves too.
        defer { rereadAfterWrite() }
        do {
            let result = try await api.invite(bookingId: booking.id, studentId: student.id)
            // The inviter's own list does not change — the classmate gets their own booking —
            // so the server's sentence is the only sign it worked.
            notice = result.detail.isEmpty ? "\(student.name) has been added and told." : result.detail
            return nil
        } catch {
            return ServicesError.message(error)
        }
    }

    func rate(_ booking: SupportBooking, stars: Int, comment: String) async -> String? {
        guard let api else { return Self.notReady }
        do {
            let updated = try await api.rate(bookingId: booking.id, rating: stars, comment: comment)
            // Any read already in flight predates the rating; let it land nowhere.
            bookingsRead += 1
            if var list = bookings.value, let index = list.firstIndex(where: { $0.id == updated.id }) {
                list[index] = updated
                bookings = .loaded(list)
            } else {
                Task { await refreshBookings() }
            }
            return nil
        } catch {
            Task { await refreshBookings() }
            return ServicesError.message(error)
        }
    }

    /// Re-read both lists without holding up whoever wrote. See "Writing" above.
    private func rereadAfterWrite() {
        Task { await refreshAll() }
    }

    private static let notReady = "The page is still loading. Try again in a moment."
}

/// An open hour the student has tapped, waiting for them to confirm.
struct SupportPick: Identifiable {
    let teacherId: Int
    let teacherName: String
    let hour: SupportHour

    var id: String { "\(teacherId)|\(hour.startsAt)" }
}

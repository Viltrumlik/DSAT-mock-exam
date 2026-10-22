import SwiftUI
import MasterSATKit

/// The lesson calendar — moved here from Today — for the classes under the chip.
struct ClassScheduleSegment: View {
    /// The classes to show; nil under All, which also shows events tied to no class (mocks).
    let classIds: Set<Int>?
    /// The student's homework, so a homework day opens that homework.
    let assignments: [AssignmentListing]
    /// Bumped by the Class tab's pull-to-refresh.
    let refreshID: Int
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @State private var events: [ScheduleEvent] = []
    @State private var viewYear = Calendar(identifier: .gregorian).component(.year, from: Date())
    @State private var viewMonth = Calendar(identifier: .gregorian).component(.month, from: Date())
    @State private var selectedDay: String?
    @State private var isLoading = true
    @State private var failed = false

    private var month: ScheduleMonth {
        ScheduleMonth.build(from: events.filter { event in
            guard let classIds else { return true }
            return event.classroomId.map(classIds.contains) ?? false
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LessonCalendarCard(month: month, year: $viewYear, monthIndex: $viewMonth, selected: $selectedDay)
                .overlay(alignment: .topTrailing) {
                    if isLoading { ProgressView().padding(18) }
                }
            if failed {
                Label("The calendar didn't load just now. Pull down to try again.", systemImage: "exclamationmark.triangle")
                    .appFont(12, weight: .semibold)
                    .foregroundStyle(Theme.textSecondary)
            }
            SelectedDayCard(dayKey: selectedDay, events: month.byDate[selectedDay ?? ""] ?? [], onOpen: open)
        }
        .task(id: "\(viewYear)-\(viewMonth)-\(refreshID)") { await load() }
    }

    /// A homework day opens that homework. Pushed from the Class root, so a second tap while the
    /// first push is in flight must not stack a second page.
    private func open(_ event: ScheduleEvent) {
        guard path.isEmpty,
              let id = event.assignmentId,
              let assignment = assignments.first(where: { $0.id == id }) else { return }
        path.append(assignment)
    }

    @MainActor
    private func load() async {
        isLoading = true
        let (start, end) = ScheduleMonth.gridRange(year: viewYear, month: viewMonth)
        do {
            let fresh = try await session.student.schedule(from: start, to: end)
            // A month change, a refresh or leaving the segment cancels this load while the next
            // one (if any) is starting. That is not a result and not a failure — and the next
            // load owns the spinner, so a stale one must not clear it.
            if Task.isCancelled { return }
            events = fresh
            failed = false
            // Land on the next lesson the first time, so the day card is never empty on arrival.
            if selectedDay == nil { selectedDay = month.nextLessonDate ?? DayKey.string(Date()) }
        } catch {
            // `APIClient` wraps a cancellation as a transport error, so ask the task, not the error.
            if Task.isCancelled { return }
            failed = true
        }
        isLoading = false
    }
}

import SwiftUI
import MasterSATKit

/// What is happening today, and what is due next.
struct DashboardView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session
    @State private var events: [ScheduleEvent] = []
    @State private var assignments: [AssignmentListing] = []
    @State private var loadError: String?
    @State private var isLoading = true

    private var today: [ScheduleEvent] {
        let key = Self.dayKey(Date())
        return events.filter { $0.date == key }
    }

    private var upcoming: [ScheduleEvent] {
        let key = Self.dayKey(Date())
        return events.filter { $0.date > key }.prefix(5).map { $0 }
    }

    private var dueSoon: [AssignmentListing] {
        assignments
            .filter { ($0.workflowStatus ?? "").lowercased() != "graded" }
            .sorted { ($0.dueAt ?? "9999") < ($1.dueAt ?? "9999") }
            .prefix(3)
            .map { $0 }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    greeting

                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else if let loadError {
                        RetryNotice(message: loadError) { await load() }
                    } else {
                        section("Today", events: today, emptyText: "No classes today.")
                        if !dueSoon.isEmpty { dueSection }
                        section("Coming up", events: upcoming, emptyText: "Nothing scheduled yet.")
                    }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Home")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Salom, \(user.firstName ?? user.displayName)")
                .font(.title2.bold())
            if let target = user.targetScore {
                Text("Target \(target)").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private func section(_ title: String, events: [ScheduleEvent], emptyText: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            if events.isEmpty {
                Text(emptyText).font(.subheadline).foregroundStyle(.secondary).cardStyle()
            } else {
                ForEach(events) { event in
                    ScheduleRow(event: event)
                }
            }
        }
    }

    private var dueSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Homework").font(.headline)
            ForEach(dueSoon) { assignment in
                HomeworkRow(assignment: assignment)
            }
        }
    }

    private func load() async {
        isLoading = events.isEmpty && assignments.isEmpty
        loadError = nil
        let start = Date()
        let end = Calendar.current.date(byAdding: .day, value: 30, to: start) ?? start
        do {
            async let schedule = session.student.schedule(from: start, to: end)
            async let homework = session.student.assignments()
            events = try await schedule
            assignments = try await homework
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    static func dayKey(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

struct ScheduleRow: View {
    let event: ScheduleEvent

    private var icon: String {
        switch event.type {
        case .classMeeting: return "person.2"
        case .mock: return "doc.text.fill"
        case .midterm: return "flag.checkered"
        case .assignment: return "checklist"
        case .unknown: return "calendar"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Theme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).font(.subheadline.weight(.medium))
                if !event.sub.isEmpty {
                    Text(event.sub).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if !event.time.isEmpty {
                Text(event.time).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }
}

struct RetryNotice: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

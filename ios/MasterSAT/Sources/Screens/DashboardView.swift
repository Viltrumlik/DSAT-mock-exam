import SwiftUI
import MasterSATKit

/// What is happening today, what is due next, and how the last midterm went.
struct DashboardView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session
    @State private var events: [ScheduleEvent] = []
    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
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

    /// Midterms the student has actually sat. Papers are sat elsewhere; only the result
    /// comes back to the phone.
    private var results: [MidtermListing] {
        midterms.filter(\.submitted)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    greeting

                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else if let loadError {
                        RetryNotice(message: loadError) { await load() }
                    } else {
                        if !dueSoon.isEmpty { dueSection }
                        section("Today", events: today, emptyText: "No classes today.")
                        if !results.isEmpty { resultsSection }
                        section("Coming up", events: upcoming, emptyText: "Nothing scheduled yet.")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Home")
            .refreshable { await load() }
            .onAppear { Task { await load() } }
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Salom, \(user.firstName ?? user.displayName)")
                .font(.system(size: 26, weight: .bold))
            if let target = user.targetScore {
                Chip(text: "Target \(ScoreText.string(target))", icon: "target", tone: .accent)
            }
        }
    }

    private func section(_ title: String, events: [ScheduleEvent], emptyText: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Overline(title)
            if events.isEmpty {
                Text(emptyText)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .cardStyle()
            } else {
                ForEach(events) { ScheduleRow(event: $0) }
            }
        }
    }

    private var dueSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Overline("Homework")
            ForEach(dueSoon) { assignment in
                NavigationLink {
                    HomeworkDetailView(assignment: assignment)
                } label: {
                    HomeworkRow(assignment: assignment).cardStyle()
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Midterm scores.
    ///
    /// A classroom midterm is scored the moment it is submitted but stays sealed until the
    /// teacher publishes it, so an absent score is named rather than left blank — a blank
    /// reads as a zero.
    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Overline("Your results")
            ForEach(results) { midterm in
                NavigationLink {
                    MidtermResultView(attemptId: midterm.attemptId ?? 0, title: midterm.title)
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(midterm.title)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.primary)
                            if !midterm.subject.isEmpty {
                                Text(midterm.subject.humanisedSubject)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        Spacer()
                        if midterm.resultsVisible, let score = midterm.score {
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(ScoreText.string(score))
                                    .font(.system(size: 22, weight: .bold).monospacedDigit())
                                    .foregroundStyle(Theme.accent)
                                if let ceiling = midterm.scoreCeiling {
                                    Text("of \(ScoreText.string(ceiling))")
                                        .font(.system(size: 11))
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                        } else {
                            Chip(text: "Not released", icon: "hourglass", tone: .warning)
                        }
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)
                .disabled(midterm.attemptId == nil)
            }
        }
    }

    // Explicitly main-actor: it touches `session`, which is @MainActor, and a plain async
    // method on a View is not isolated to anything.
    @MainActor
    private func load() async {
        isLoading = events.isEmpty && assignments.isEmpty
        loadError = nil
        let start = Date()
        let end = Calendar.current.date(byAdding: .day, value: 30, to: start) ?? start
        // Read the API surface out of `session` HERE, on the main actor. Referring to
        // `session.student` inside an `async let` would reach a main-actor property from
        // the child task instead.
        let student = session.student
        do {
            async let schedule = student.schedule(from: start, to: end)
            async let homework = student.assignments()
            async let papers = student.midterms()
            events = try await schedule
            assignments = try await homework
            midterms = try await papers
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
        case .classMeeting: return "person.2.fill"
        case .mock: return "doc.text.fill"
        case .midterm: return "flag.checkered"
        case .assignment: return "checklist"
        case .unknown: return "calendar"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.accentSoft)
                .frame(width: 38, height: 38)
                .overlay(
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).font(.system(size: 15, weight: .semibold))
                if !event.sub.isEmpty {
                    Text(event.sub).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer()
            if !event.time.isEmpty {
                Text(event.time)
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .cardStyle()
    }
}

struct RetryNotice: View {
    let message: String
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Theme.warning)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

/// A midterm result. Reachable from Home once the paper has been sat.
struct MidtermResultView: View {
    let attemptId: Int
    let title: String

    @Environment(Session.self) private var session
    @State private var result: MidtermResult?
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let result {
                    if result.released, let score = result.totalScore {
                        VStack(spacing: 6) {
                            Overline("Your score")
                            Text(ScoreText.string(score))
                                .font(.system(size: 64, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(Theme.accent)
                            if let ceiling = result.scoreCeiling {
                                Text("out of \(ScoreText.string(ceiling))")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            if let subject = result.subject, !subject.isEmpty {
                                Chip(text: subject.humanisedSubject, tone: .accent)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .cardStyle(padding: 28)
                    } else {
                        VStack(spacing: 10) {
                            Image(systemName: "hourglass")
                                .font(.system(size: 34))
                                .foregroundStyle(Theme.warning)
                            Text("Not released yet").font(.system(size: 17, weight: .bold))
                            // Scored on submit, sealed until the teacher publishes.
                            // Saying so stops an absent score reading as a bad one.
                            Text("Your teacher will publish the results for this midterm.")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .cardStyle(padding: 28)
                    }

                    if let cert = result.certificate, cert.available {
                        VStack(alignment: .leading, spacing: 10) {
                            Label("Certificate", systemImage: "rosette")
                                .font(.system(size: 15, weight: .bold))
                            if let rank = cert.rank, let cohort = cert.cohortSize {
                                Text("Ranked \(ScoreText.string(rank)) of \(ScoreText.string(cohort))")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            if let raw = cert.downloadURL, let url = URL(string: raw) {
                                Link(destination: url) {
                                    Label("Open certificate", systemImage: "arrow.up.right.square")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                            }
                        }
                        .cardStyle()
                    }
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else {
                    ProgressView().padding(.vertical, 60)
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            result = try await session.results.midtermResult(attemptId: attemptId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

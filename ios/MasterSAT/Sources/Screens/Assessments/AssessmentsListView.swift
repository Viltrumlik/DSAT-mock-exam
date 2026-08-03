import SwiftUI
import MasterSATKit

/// Every assessment set for this student, in the three states the web board uses:
/// to do, in progress, done.
///
/// One card per ASSESSMENT, not per homework — a homework can bundle several, and showing
/// one card for a bundle hides everything after the first.
struct AssessmentsListView: View {
    struct Entry: Identifiable {
        let assignment: AssignmentListing
        let link: AssessmentHomeworkLink

        var id: Int { link.homeworkId }
        var state: String { link.progress?.state ?? "not_started" }
        var title: String { link.assessmentSet?.title ?? assignment.title }
        var subject: String { link.assessmentSet?.subject ?? assignment.subject ?? "" }
    }

    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var startingId: Int?
    @State private var runnerAttemptId: Int?
    @State private var reviewAttemptId: Int?

    private var entries: [Entry] {
        assignments.flatMap { assignment in
            assignment.assessmentHomeworks.map { Entry(assignment: assignment, link: $0) }
        }
    }

    private var todo: [Entry] { entries.filter { $0.state == "not_started" } }
    private var inProgress: [Entry] { entries.filter { $0.state == "in_progress" } }
    private var done: [Entry] { entries.filter { $0.state == "completed" } }

    var body: some View {
        Group {
            if isLoading && assignments.isEmpty {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else if entries.isEmpty {
                ContentUnavailableView(
                    "No assessments yet",
                    systemImage: "square.and.pencil",
                    description: Text("Quizzes your teacher assigns will appear here.")
                )
            } else {
                List {
                    section("To do", todo, hint: "New work from your teachers shows up here.")
                    section("In progress", inProgress, hint: "Anything you've started appears here.")
                    section("Completed", done, hint: "Finished work lands here.")
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Assessments")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $reviewAttemptId) { id in
            AssessmentReviewView(attemptId: id)
        }
        .fullScreenCover(item: $runnerAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                runnerAttemptId = nil
                Task { await load() }
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [Entry], hint: String) -> some View {
        Section {
            if rows.isEmpty {
                Text(hint).font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(rows) { entry in
                    AssessmentCard(
                        entry: entry,
                        isStarting: startingId == entry.link.homeworkId,
                        onOpen: { open(entry) },
                        onReview: {
                            if let attemptId = entry.link.progress?.attemptId { reviewAttemptId = attemptId }
                        }
                    )
                }
            }
        } header: {
            Text(title)
        }
    }

    @MainActor
    private func open(_ entry: Entry) {
        startingId = entry.link.homeworkId
        Task {
            defer { startingId = nil }
            do {
                // Resumes the live attempt rather than opening a second one, so tapping
                // Continue twice cannot restart a half-finished quiz from scratch.
                let attempt = try await session.assessments.start(homeworkId: entry.link.homeworkId)
                runnerAttemptId = attempt.id
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = assignments.isEmpty
        loadError = nil
        do {
            assignments = try await session.student.assignments()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct AssessmentCard: View {
    let entry: AssessmentsListView.Entry
    let isStarting: Bool
    let onOpen: @MainActor () -> Void
    let onReview: @MainActor () -> Void

    private var progress: AssessmentProgress? { entry.link.progress }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.title).font(.subheadline.weight(.medium))

            HStack(spacing: 6) {
                if !entry.subject.isEmpty {
                    Text(entry.subject.humanisedSubject).font(.caption).foregroundStyle(.secondary)
                }
                if entry.link.questionCount > 0 {
                    Text("· \(entry.link.questionCount) questions").font(.caption).foregroundStyle(.secondary)
                }
                if let classroom = entry.assignment.classroomName, !classroom.isEmpty {
                    Text("· \(classroom)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }

            if let due = entry.assignment.dueAt, let date = JSONCoding.parseServerDate(due) {
                // A passed deadline reads as an invitation to catch up, never as a failure.
                Text(
                    entry.assignment.isOverdue
                        ? "Catch up · \(date.formatted(date: .abbreviated, time: .omitted))"
                        : "Due \(date.formatted(date: .abbreviated, time: .shortened))"
                )
                .font(.caption)
                .foregroundStyle(entry.assignment.isOverdue ? .orange : .secondary)
            }

            if let progress, progress.isCompleted {
                completedFooter(progress)
            } else {
                HStack(spacing: 10) {
                    Button(action: onOpen) {
                        if isStarting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text(progress?.isInProgress == true ? "Continue" : "Start").bold()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(isStarting)

                    if let progress, progress.isInProgress,
                       let answered = progress.answeredCount, let total = progress.totalQuestions, total > 0 {
                        Text("\(answered) of \(total) answered")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func completedFooter(_ progress: AssessmentProgress) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if progress.graded == true, let percent = progress.percent {
                HStack(spacing: 8) {
                    Text("\(ScoreText.string(percent))%")
                        .font(.title3.bold().monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    if let correct = progress.correctCount, let total = progress.totalQuestions {
                        Text("\(correct) / \(total) correct").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else {
                // Submitted but not yet graded. Naming that beats an absent score, which
                // reads as a zero.
                Label("Handed in · waiting to be marked", systemImage: "checkmark.circle")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.accent)
            }

            if progress.attemptId != nil {
                Button(action: onReview) {
                    Label(
                        (progress.missedCount ?? 0) > 0
                            ? "Review \(progress.missedCount!) missed"
                            : "Review answers",
                        systemImage: "text.magnifyingglass"
                    )
                    .font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

/// `Int` is not `Identifiable`, and both the runner and the review sheet key off an
/// attempt id. Rather than wrapping each one in its own box, make the id itself usable.
extension Int: @retroactive Identifiable {
    public var id: Int { self }
}

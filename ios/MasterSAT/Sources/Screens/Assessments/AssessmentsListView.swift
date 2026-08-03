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
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        section("In progress", inProgress, tone: Theme.warning)
                        section("To do", todo, tone: Theme.accent)
                        section("Completed", done, tone: Theme.success)
                    }
                    .padding(16)
                }
                .refreshable { await load() }
            }
        }
        .background(Theme.background)
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
    private func section(_ title: String, _ rows: [Entry], tone: Color) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Circle().fill(tone).frame(width: 8, height: 8)
                    Overline(title)
                    Text("\(rows.count)")
                        .font(.system(size: 11, weight: .bold).monospacedDigit())
                        .foregroundStyle(Theme.textLabel)
                }
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

    private var subjectTone: Color {
        entry.subject.uppercased().contains("MATH") ? Theme.accent : Theme.info
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(subjectTone.opacity(0.12))
                    .frame(width: 44, height: 44)
                    .overlay(
                        Image(systemName: entry.subject.uppercased().contains("MATH")
                              ? "function" : "text.book.closed.fill")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(subjectTone)
                    )
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.title).font(.system(size: 16, weight: .bold))
                    HStack(spacing: 6) {
                        if !entry.subject.isEmpty {
                            Text(entry.subject.humanisedSubject)
                                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                        if entry.link.questionCount > 0 {
                            Text("· \(entry.link.questionCount) questions")
                                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    if let classroom = entry.assignment.classroomName, !classroom.isEmpty {
                        Text(classroom).font(.system(size: 11)).foregroundStyle(Theme.textLabel).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }

            if let due = entry.assignment.dueAt, let date = JSONCoding.parseServerDate(due) {
                // A passed deadline reads as an invitation to catch up, never as a failure.
                Chip(
                    text: entry.assignment.isOverdue
                        ? "Catch up · \(date.formatted(date: .abbreviated, time: .omitted))"
                        : "Due \(date.formatted(date: .abbreviated, time: .shortened))",
                    icon: "calendar",
                    tone: entry.assignment.isOverdue ? .warning : .neutral
                )
            }

            if let progress, progress.isCompleted {
                completedFooter(progress)
            } else {
                if let progress, progress.isInProgress,
                   let answered = progress.answeredCount, let total = progress.totalQuestions, total > 0 {
                    VStack(alignment: .leading, spacing: 5) {
                        Bar(fraction: Double(answered) / Double(total), tone: Theme.warning)
                        Text("\(answered) of \(total) answered")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                }
                Button(action: onOpen) {
                    if isStarting {
                        ProgressView().tint(.white).frame(maxWidth: .infinity)
                    } else {
                        Text(progress?.isInProgress == true ? "Continue" : "Start").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(isStarting)
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private func completedFooter(_ progress: AssessmentProgress) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if progress.graded == true, let percent = progress.percent {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(ScoreText.string(percent))%")
                        .font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.success)
                    if let correct = progress.correctCount, let total = progress.totalQuestions {
                        Text("\(correct) / \(total) correct")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                }
                Bar(fraction: Double(percent) / 100, tone: Theme.success)
            } else {
                // Submitted but not yet graded. Naming that beats an absent score, which
                // reads as a zero.
                Chip(text: "Handed in · waiting to be marked", icon: "checkmark.circle", tone: .accent)
            }

            if progress.attemptId != nil {
                Button(action: onReview) {
                    Label(
                        (progress.missedCount ?? 0) > 0
                            ? "Review \(progress.missedCount!) missed"
                            : "Review answers",
                        systemImage: "text.magnifyingglass"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            }
        }
    }
}

/// `Int` is not `Identifiable`, and both the runner and the review sheet key off an
/// attempt id. Rather than wrapping each one in its own box, make the id itself usable.
extension Int: @retroactive Identifiable {
    public var id: Int { self }
}

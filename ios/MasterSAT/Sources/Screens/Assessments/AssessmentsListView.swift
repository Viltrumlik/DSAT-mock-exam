import SwiftUI
import MasterSATKit

/// The site's assessment board, on a phone.
///
/// `/assessments` is three columns — To do, In progress, Completed — with a search field
/// over them. Three columns do not fit a phone, so the columns become the tabs and the
/// counts move onto them: the same information, the same order, one column at a time.
///
/// One card per ASSESSMENT, not per homework — a homework can bundle several, and one card
/// for a bundle hides everything after the first.
struct AssessmentsListView: View {
    struct Entry: Identifiable {
        let assignment: AssignmentListing
        let link: AssessmentHomeworkLink

        var id: Int { link.homeworkId }
        var state: String { link.progress?.state ?? "not_started" }
        var title: String { link.assessmentSet?.title ?? assignment.title }
        var subject: String { link.assessmentSet?.subject ?? assignment.subject ?? "" }
        var classroom: String { assignment.classroomName ?? "" }

        /// Everything a search should match — the site searches title, class, subject and
        /// category together rather than making a student pick a field.
        var haystack: String {
            [title, classroom, SubjectStyle.of(subject).label, link.assessmentSet?.category ?? ""]
                .joined(separator: " ")
                .lowercased()
        }
    }

    enum Column: Hashable { case todo, inProgress, done }

    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var startingId: Int?
    @State private var runnerAttemptId: Int?
    @State private var reviewAttemptId: Int?
    @State private var column: Column = .todo
    @State private var query = ""
    /// The landing column is chosen once, on the first load. After that the student's own
    /// choice stands — a refresh must not yank them back to another tab.
    @State private var didPickColumn = false

    private var entries: [Entry] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return assignments
            .flatMap { assignment in assignment.assessmentHomeworks.map { Entry(assignment: assignment, link: $0) } }
            .filter { needle.isEmpty || $0.haystack.contains(needle) }
    }

    private func rows(_ column: Column) -> [Entry] {
        entries.filter { entry in
            switch column {
            case .inProgress: return entry.state == "in_progress"
            case .done: return entry.state == "completed"
            case .todo: return entry.state != "in_progress" && entry.state != "completed"
            }
        }
    }

    private var tabs: [PillTabs<Column>.Item] {
        [
            .init(tab: .todo, title: "To do", icon: "tray", count: rows(.todo).count),
            .init(tab: .inProgress, title: "In progress", icon: "hourglass", count: rows(.inProgress).count),
            .init(tab: .done, title: "Completed", icon: "checkmark.circle", count: rows(.done).count),
        ]
    }

    private var emptyHint: String {
        switch column {
        case .todo: return "New work from your teachers shows up here."
        case .inProgress: return "Anything you've started appears here."
        case .done: return "Finished work lands here."
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageTitle("My assessments")
                SearchField(text: $query, placeholder: "Search assessments…")
                PillTabs(items: tabs, selection: $column)

                if isLoading && assignments.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else if rows(column).isEmpty {
                    DashedEmpty(
                        title: query.isEmpty ? "Nothing here" : "Nothing matches “\(query)”",
                        hint: query.isEmpty ? emptyHint : nil
                    )
                } else {
                    ForEach(rows(column)) { entry in
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
            .padding(16)
        }
        .background(Theme.background)
        .refreshable { await load() }
        .navigationTitle("")
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
        // Land where the work is, and only once the work is known — a student with two
        // sets in flight and nothing new should not open onto an empty "To do". Doing this
        // in `onAppear` looked right and did nothing: the lists are still empty there.
        if !didPickColumn, rows(.todo).isEmpty, !rows(.inProgress).isEmpty {
            column = .inProgress
        }
        didPickColumn = true
    }
}

/// Maths blue, English purple — the board's own rule, so two pieces of work are told apart
/// before either title is read.
enum SubjectStyle {
    struct Style {
        let label: String
        let icon: String
        let tone: Color
    }

    static func of(_ subject: String?) -> Style {
        switch (subject ?? "").uppercased() {
        case "MATH":
            return Style(label: "Math", icon: "function", tone: Theme.accent)
        case "ENGLISH", "READING_WRITING", "READING", "RW":
            return Style(label: "English", icon: "text.book.closed.fill", tone: Theme.subjectEnglish)
        default:
            let raw = subject ?? ""
            return Style(
                label: raw.isEmpty ? "General" : raw.humanisedSubject,
                icon: "square.and.pencil",
                tone: Theme.accent
            )
        }
    }
}

/// The site's search input: a rounded field with the glyph inside it.
struct SearchField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
            TextField(placeholder, text: $text)
                .font(.system(size: 14, weight: .semibold))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textLabel)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.card))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }
}

struct AssessmentCard: View {
    let entry: AssessmentsListView.Entry
    let isStarting: Bool
    let onOpen: @MainActor () -> Void
    let onReview: @MainActor () -> Void

    private var progress: AssessmentProgress? { entry.link.progress }
    private var style: SubjectStyle.Style { SubjectStyle.of(entry.subject) }

    /// A set carries one category; the site splits it on commas or slashes so a set tagged
    /// "Algebra, Linear equations" reads as two tags rather than one long one.
    private var tags: [String] {
        (entry.link.assessmentSet?.category ?? "")
            .split(whereSeparator: { $0 == "," || $0 == "/" || $0 == "·" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .prefix(3)
            .map { $0 }
    }

    /// The SAT's own rough pace, and the site's: about a minute and a quarter a question.
    private var estimatedMinutes: Int {
        max(1, Int((Double(entry.link.questionCount) * 1.25).rounded()))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Text(entry.title)
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
                .padding(.top, 12)
            if !entry.classroom.isEmpty || !style.label.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "book").font(.system(size: 11, weight: .semibold))
                    Text([entry.classroom, style.label].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 6)
            }

            stateBody(for: progress)

            action.padding(.top, 14)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        // The 3pt subject-coloured edge is the card's whole identity on the board — it is
        // what makes a wall of cards scannable without reading a word.
        .overlay(alignment: .top) { Rectangle().fill(style.tone).frame(height: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    private var header: some View {
        HStack(spacing: 9) {
            IconTile(systemName: style.icon, tone: style.tone, size: 36)
            HStack(spacing: 5) {
                Image(systemName: style.icon).font(.system(size: 10, weight: .bold))
                Text(style.label).font(.system(size: 11, weight: .heavy))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(style.tone))
            Spacer(minLength: 0)
            statusGlyph
        }
    }

    @ViewBuilder
    private var statusGlyph: some View {
        if progress?.isCompleted == true {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 19))
                .foregroundStyle(Theme.success)
        } else if progress?.isInProgress == true {
            Image(systemName: "hourglass")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.amber)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.amberSoft))
        }
    }

    @ViewBuilder
    private func stateBody(for progress: AssessmentProgress?) -> some View {
        if progress?.isCompleted == true, let progress {
            doneBody(progress)
        } else if progress?.isInProgress == true, let progress {
            progressBody(progress)
        } else {
            todoBody
        }
    }

    @ViewBuilder
    private var todoBody: some View {
        if entry.link.questionCount > 0 {
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11, weight: .semibold))
                Text("\(ScoreText.string(entry.link.questionCount)) questions · ~\(ScoreText.string(estimatedMinutes)) min")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.top, 12)
        }
        if let due = DueLabel.text(entry.assignment.dueAt) {
            Chip(text: due.text, icon: "calendar", tone: due.late ? .danger : .neutral)
                .padding(.top, 12)
        }
        if !tags.isEmpty {
            HStack(spacing: 7) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Theme.background))
                }
            }
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private func progressBody(_ progress: AssessmentProgress) -> some View {
        let total = progress.totalQuestions ?? entry.link.questionCount
        let answered = progress.answeredCount ?? 0
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Progress").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(ScoreText.string(answered)) / \(ScoreText.string(total))")
                    .font(.system(size: 13, weight: .heavy).monospacedDigit())
            }
            Bar(fraction: total > 0 ? Double(answered) / Double(total) : 0, tone: Theme.amber, height: 8)
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11, weight: .semibold))
                Text("Last opened \(RelativeTime.short(progress.lastActivityAt))")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Theme.textSecondary)
        }
        .padding(.top, 12)
    }

    @ViewBuilder
    private func doneBody(_ progress: AssessmentProgress) -> some View {
        if progress.graded == true, let percent = progress.percent {
            let correct = progress.correctCount ?? 0
            let total = progress.totalQuestions ?? entry.link.questionCount
            let missed = progress.missedCount ?? max(total - correct, 0)
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(ScoreText.string(percent))%")
                        .font(.system(size: 32, weight: .heavy).monospacedDigit())
                        .tracking(-1)
                    Text("\(ScoreText.string(correct)) / \(ScoreText.string(total)) correct")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
                Bar(fraction: Double(percent) / 100, tone: Theme.success, height: 8)
                HStack(spacing: 6) {
                    Image(systemName: missed > 0 ? "flag.fill" : "checkmark.circle.fill")
                        .font(.system(size: 11, weight: .bold))
                    Text(missed > 0 ? "Review \(ScoreText.string(missed)) missed" : "Perfect score")
                        .font(.system(size: 13, weight: .heavy))
                }
                .foregroundStyle(missed > 0 ? Theme.accent : Theme.success)
            }
            .padding(.top, 12)
        } else {
            // Handed in but not yet marked. Naming that beats an absent score, which reads
            // as a zero.
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11, weight: .semibold))
                Text("Handed in — waiting to be marked").font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private var action: some View {
        if progress?.isCompleted == true {
            if progress?.attemptId != nil {
                Button(action: onReview) {
                    Label(progress?.graded == true ? "Review" : "View", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(OutlineButtonStyle())
            }
        } else {
            Button(action: onOpen) {
                if isStarting {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Label(progress?.isInProgress == true ? "Continue" : "Start", systemImage: "play.circle")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(PrimaryButtonStyle(
                tone: progress?.isInProgress == true ? Theme.amber : Theme.accent,
                fullWidth: true
            ))
            .disabled(isStarting)
        }
    }
}

/// The board's third button: outlined, not filled, because reviewing finished work is not
/// the action a student came for.
struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .heavy))
            .foregroundStyle(Theme.accent)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(configuration.isPressed ? Theme.accentSoft : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Theme.accent, lineWidth: 1.5)
            )
    }
}

/// `Int` is not `Identifiable`, and both the runner and the review sheet key off an
/// attempt id. Rather than wrapping each one in its own box, make the id itself usable.
extension Int: @retroactive Identifiable {
    public var id: Int { self }
}

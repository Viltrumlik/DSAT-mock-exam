import SwiftUI
import MasterSATKit

// The levels of the assessments board and the pieces they share. `AssessmentsListView` is the
// landing; a subject and a domain are pages pushed on top of it, all reading one model, so a
// refresh anywhere repaints every level.

// MARK: - Model

/// The board's data, shared by the landing and every page pushed from it.
@MainActor
@Observable
final class AssessmentBoardModel {
    enum Phase { case loading, loaded, failed }

    /// How a tap on Start / Continue ended.
    enum StartResult {
        case opened(attemptId: Int)
        /// The server's own sentence. `stale` is the 403 "This homework is not available." —
        /// the homework was withdrawn after this board loaded, so the board reloads.
        case refused(message: String, stale: Bool)
    }

    private(set) var assignments: [AssignmentListing] = []
    private(set) var board = AssessmentBoard(assignments: [])
    private(set) var phase: Phase = .loading
    /// The card whose Start is in flight. One at a time: a second tap waits for nothing.
    private(set) var startingId: Int?

    func load(_ student: StudentAPI) async {
        if assignments.isEmpty { phase = .loading }
        do {
            let fresh = try await student.assignments()
            assignments = fresh
            board = AssessmentBoard(assignments: fresh)
            phase = .loaded
        } catch {
            phase = .failed
        }
    }

    func start(_ entry: AssessmentBoardEntry, api: AssessmentAPI) async -> StartResult? {
        guard startingId == nil else { return nil }
        // Work already in flight is opened by its attempt, with no round trip — as the web
        // opens it. The start call would resume the same attempt; this just skips the wait.
        if entry.state == .inProgress, let attemptId = entry.progress?.attemptId {
            return .opened(attemptId: attemptId)
        }
        startingId = entry.id
        defer { startingId = nil }
        do {
            // Resumes a live attempt rather than opening a second one, so tapping twice
            // cannot restart a half-finished quiz from scratch.
            let attempt = try await api.start(homeworkId: entry.link.homeworkId)
            return .opened(attemptId: attempt.id)
        } catch let error as APIError {
            if case .forbidden = error {
                return .refused(message: error.errorDescription ?? "This homework is not available.", stale: true)
            }
            return .refused(message: error.errorDescription ?? "Couldn't start this assessment.", stale: false)
        } catch {
            return .refused(message: error.localizedDescription, stale: false)
        }
    }
}

/// What a card can do, handed down from the page that owns the runner and the review.
struct AssessmentCardActions {
    let startingId: Int?
    let open: @MainActor (AssessmentBoardEntry) -> Void
    let review: @MainActor (AssessmentBoardEntry) -> Void
}

/// One step of "My assessments › English › Algebra". The last one is where the student is.
struct AssessmentCrumb: Identifiable {
    let label: String
    var action: (@MainActor () -> Void)?

    var id: String { label }

    init(label: String, action: (@MainActor () -> Void)? = nil) {
        self.label = label
        self.action = action
    }
}

private struct AssessmentStartRefusal: Identifiable {
    let id = UUID()
    let message: String
    let stale: Bool
}

/// A finished card's review, with the homework it belongs to so the review can offer a retry.
private struct AssessmentReviewTarget: Hashable {
    let attemptId: Int
    let homeworkId: Int
}

// MARK: - The page every level shares

/// The board's frame: the headline, the search that spans everything, the breadcrumb, and
/// the four states every level has — loading, failed, empty, and the level's own content.
struct AssessmentBoardScaffold<Content: View>: View {
    let model: AssessmentBoardModel
    var trail: [AssessmentCrumb] = []
    /// Only the landing loads; pushed levels read what it loaded.
    var loadsOnAppear = false
    @ViewBuilder let content: (AssessmentCardActions) -> Content

    @Environment(Session.self) private var session
    @State private var query = ""
    @State private var runnerAttemptId: Int?
    @State private var reviewTarget: AssessmentReviewTarget?
    @State private var refusal: AssessmentStartRefusal?

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageTitle("My assessments")
                SearchField(text: $query, placeholder: "Search all assessments…")
                if trimmedQuery.isEmpty, trail.count > 1, model.phase != .failed {
                    AssessmentCrumbs(trail: trail)
                }
                main
            }
            .padding(16)
        }
        .background(Theme.background)
        .refreshable { await model.load(session.student) }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { if loadsOnAppear { await model.load(session.student) } }
        .navigationDestination(item: $reviewTarget) { target in
            AssessmentReviewView(
                attemptId: target.attemptId,
                homeworkId: target.homeworkId,
                onRetryClosed: { Task { await model.load(session.student) } }
            )
        }
        .fullScreenCover(item: $runnerAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                runnerAttemptId = nil
                Task { await model.load(session.student) }
            }
        }
        .alert(
            "Couldn't start this assessment",
            isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } }),
            presenting: refusal
        ) { refused in
            Button("OK", role: .cancel) {
                refusal = nil
                // Withdrawn since the board loaded: reload, and the card goes with it.
                if refused.stale { Task { await model.load(session.student) } }
            }
        } message: { refused in
            Text(verbatim: refused.message)
        }
    }

    @ViewBuilder
    private var main: some View {
        switch model.phase {
        case .failed:
            AssessmentLoadError { await model.load(session.student) }
        case .loading where model.assignments.isEmpty:
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
        default:
            if !trimmedQuery.isEmpty {
                // Search is the other way to locate something, so it looks across every
                // subject and domain, not only the one the student is standing in.
                let matches = model.board.search(trimmedQuery)
                if matches.isEmpty {
                    AssessmentNotice(text: "No assessments match “\(trimmedQuery)”.")
                } else {
                    AssessmentColumns(entries: matches, actions: actions)
                }
            } else if model.board.entries.isEmpty {
                AssessmentNotice(
                    title: "No assessments yet",
                    text: "When a teacher gives you an assessment, it shows up here."
                )
            } else {
                content(actions)
            }
        }
    }

    private var actions: AssessmentCardActions {
        AssessmentCardActions(
            startingId: model.startingId,
            open: { entry in open(entry) },
            review: { entry in
                if let attemptId = entry.progress?.attemptId {
                    reviewTarget = AssessmentReviewTarget(attemptId: attemptId, homeworkId: entry.link.homeworkId)
                }
            }
        )
    }

    @MainActor
    private func open(_ entry: AssessmentBoardEntry) {
        Task {
            guard let result = await model.start(entry, api: session.assessments) else { return }
            switch result {
            case .opened(let attemptId):
                runnerAttemptId = attemptId
            case .refused(let message, let stale):
                refusal = AssessmentStartRefusal(message: message, stale: stale)
            }
        }
    }
}

// MARK: - Levels

/// A subject's SAT domains — "English domains".
struct AssessmentsSubjectView: View {
    let model: AssessmentBoardModel
    let subject: AssessmentSubjectKey
    let toBoard: @MainActor () -> Void

    @State private var pushedDomain: String?

    var body: some View {
        AssessmentBoardScaffold(
            model: model,
            trail: [
                AssessmentCrumb(label: "My assessments", action: toBoard),
                AssessmentCrumb(label: SubjectStyle.of(subject).label),
            ]
        ) { _ in
            if let group = model.board.subject(subject) {
                AssessmentDomainGrid(subject: group) { pushedDomain = $0 }
            } else {
                // The subject is gone since this page opened — a class left, work withdrawn.
                AssessmentNotice(text: "Nothing in \(SubjectStyle.of(subject).label) right now.")
            }
        }
        .navigationDestination(item: $pushedDomain) { name in
            AssessmentsDomainView(
                model: model,
                subject: subject,
                domain: name,
                trail: [
                    AssessmentCrumb(label: "My assessments", action: toBoard),
                    AssessmentCrumb(label: SubjectStyle.of(subject).label) { pushedDomain = nil },
                    AssessmentCrumb(label: name),
                ]
            )
        }
    }
}

/// One domain's board: To do / In progress / Completed, for just that domain.
struct AssessmentsDomainView: View {
    let model: AssessmentBoardModel
    let subject: AssessmentSubjectKey
    let domain: String
    let trail: [AssessmentCrumb]

    var body: some View {
        AssessmentBoardScaffold(model: model, trail: trail) { actions in
            if let group = model.board.subject(subject)?.domain(named: domain) {
                AssessmentColumns(entries: group.entries, actions: actions)
            } else {
                AssessmentNotice(text: "Nothing in \(domain) right now.")
            }
        }
    }
}

// MARK: - Landing sections

/// Homework still open, nearest deadline first — the work a student opens the page to find.
struct AssessmentTodoSection: View {
    let entries: [AssessmentBoardEntry]
    @Binding var showAll: Bool
    let actions: AssessmentCardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            AssessmentSectionHead(
                icon: "list.clipboard",
                title: "To-do",
                count: entries.count,
                hint: "Homework that is still open, nearest deadline first"
            )
            if entries.isEmpty {
                AssessmentNotice(text: "Nothing due right now. New homework from your teachers shows up here.")
            } else {
                let shown = showAll ? entries : Array(entries.prefix(AssessmentBoard.todoPreview))
                ForEach(shown) { entry in
                    AssessmentCard(
                        entry: entry,
                        isStarting: actions.startingId == entry.id,
                        onOpen: { actions.open(entry) },
                        onReview: { actions.review(entry) }
                    )
                }
                if entries.count > AssessmentBoard.todoPreview {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { showAll.toggle() }
                    } label: {
                        Text(showAll ? "Show fewer" : "Show all \(ScoreText.string(entries.count))")
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundStyle(Theme.accent)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 9)
                            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.card))
                            .overlay(
                                RoundedRectangle(cornerRadius: 11, style: .continuous)
                                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

struct AssessmentSubjectGrid: View {
    let subjects: [AssessmentBoard.SubjectGroup]
    let onOpen: @MainActor (AssessmentSubjectKey) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            AssessmentSectionHead(icon: "square.stack.3d.up", title: "Subjects", hint: "Choose a subject to see its domains")
            ForEach(subjects) { subject in
                let style = SubjectStyle.of(subject.key)
                let counts = AssessmentBoard.counts(subject.entries)
                AssessmentNavCard(
                    title: style.label,
                    icon: style.icon,
                    tone: style.tone,
                    line: "\(counts.total) \(counts.total == 1 ? "assessment" : "assessments") · \(subject.domains.count) \(subject.domains.count == 1 ? "domain" : "domains")",
                    todo: counts.todo,
                    done: counts.done,
                    big: true
                ) { onOpen(subject.key) }
            }
        }
    }
}

struct AssessmentDomainGrid: View {
    let subject: AssessmentBoard.SubjectGroup
    let onOpen: @MainActor (String) -> Void

    var body: some View {
        let style = SubjectStyle.of(subject.key)
        VStack(alignment: .leading, spacing: 14) {
            AssessmentSectionHead(icon: style.icon, title: "\(style.label) domains", hint: "Choose a domain to see its assessments")
            ForEach(subject.domains) { domain in
                let counts = AssessmentBoard.counts(domain.entries)
                AssessmentNavCard(
                    title: domain.name,
                    icon: "square.stack.3d.up",
                    tone: style.tone,
                    line: "\(counts.total) \(counts.total == 1 ? "assessment" : "assessments")",
                    todo: counts.todo,
                    done: counts.done
                ) { onOpen(domain.name) }
            }
        }
    }
}

/// One subject or domain to open: what it is, how much is in it, how much of that is done.
struct AssessmentNavCard: View {
    let title: String
    let icon: String
    let tone: Color
    let line: String
    let todo: Int
    let done: Int
    var big = false
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(tone.opacity(0.14))
                        .frame(width: big ? 48 : 40, height: big ? 48 : 40)
                        .overlay(
                            Image(systemName: icon)
                                .font(.system(size: big ? 22 : 18, weight: .semibold))
                                .foregroundStyle(tone)
                        )
                    Text(title)
                        .font(.system(size: big ? 21 : 16, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textLabel)
                }
                Text(line)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                if todo > 0 || done > 0 {
                    HStack(spacing: 7) {
                        if todo > 0 {
                            countChip("\(ScoreText.string(todo)) to do", ink: tone, fill: tone.opacity(0.14))
                        }
                        if done > 0 {
                            countChip("\(ScoreText.string(done)) done", ink: Theme.success, fill: Theme.success.opacity(0.12))
                        }
                    }
                }
            }
            .padding(big ? 20 : 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            .overlay(alignment: .top) { Rectangle().fill(tone).frame(height: 3) }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func countChip(_ text: String, ink: Color, fill: Color) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .heavy).monospacedDigit())
            .foregroundStyle(ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(fill))
    }
}

struct AssessmentSectionHead: View {
    let icon: String
    let title: String
    var count: Int?
    var hint: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                Text(title)
                    .font(.system(size: 19, weight: .heavy))
                    .tracking(-0.2)
                if let count {
                    Text(ScoreText.string(count))
                        .font(.system(size: 12, weight: .heavy).monospacedDigit())
                        .foregroundStyle(Theme.textLabel)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.card))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
                        )
                }
                Spacer(minLength: 0)
            }
            if let hint {
                Text(hint)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// "My assessments › English › Algebra" — each level above the current one is a way back up.
struct AssessmentCrumbs: View {
    let trail: [AssessmentCrumb]

    var body: some View {
        FlowLayout(spacing: 4) {
            ForEach(Array(trail.enumerated()), id: \.offset) { index, crumb in
                HStack(spacing: 4) {
                    if index > 0 {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textLabel)
                    }
                    if let action = crumb.action {
                        Button(action: action) {
                            Text(crumb.label)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.accent)
                                .padding(.vertical, 4)
                                .padding(.horizontal, 4)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text(crumb.label)
                            .font(.system(size: 14, weight: .heavy))
                            .padding(.vertical, 4)
                            .padding(.horizontal, 4)
                            .accessibilityAddTraits(.isHeader)
                    }
                }
            }
        }
    }
}

/// A dashed slot saying what is not here — a successful empty answer, never a failure.
struct AssessmentNotice: View {
    var title: String?
    let text: String

    var body: some View {
        VStack(spacing: 6) {
            if let title {
                Text(title).font(.system(size: 16, weight: .heavy))
            }
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, title == nil ? 22 : 40)
        .padding(.horizontal, 16)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .strokeBorder(Theme.separator.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
        )
    }
}

/// The board failed to load — said as a failure, with a way to try again.
struct AssessmentLoadError: View {
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 30))
                .foregroundStyle(Theme.danger)
                .frame(width: 72, height: 72)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.dangerSoft))
            Text("Couldn't load your assessments")
                .font(.system(size: 20, weight: .heavy))
                .multilineTextAlignment(.center)
            Text("Something went wrong on our end. Check your connection and try again.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button { Task { await retry() } } label: {
                Label("Try again", systemImage: "arrow.clockwise")
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 20)
    }
}

// MARK: - The board

/// To do / In progress / Completed for whatever slice it is handed. Three columns do not fit
/// a phone, so they are tabs with their counts on them; the board lands where the work is.
struct AssessmentColumns: View {
    typealias Column = AssessmentCardState.Column

    let entries: [AssessmentBoardEntry]
    let actions: AssessmentCardActions

    /// The student's own pick. Until they make one, the board opens on the first column
    /// with work in it — a student with two sets in flight and nothing new should not land
    /// on an empty "To do".
    @State private var picked: Column?

    private var columns: [Column: [AssessmentBoardEntry]] { AssessmentBoard.columns(entries) }

    private var column: Column {
        if let picked { return picked }
        let byColumn = columns
        return Column.allCases.first { !(byColumn[$0] ?? []).isEmpty } ?? .todo
    }

    var body: some View {
        let byColumn = columns
        VStack(alignment: .leading, spacing: 14) {
            PillTabs(
                items: Column.allCases.map { col in
                    PillTabs<Column>.Item(tab: col, title: col.title, icon: icon(col), count: byColumn[col]?.count ?? 0)
                },
                selection: Binding(get: { column }, set: { picked = $0 })
            )
            let rows = byColumn[column] ?? []
            if rows.isEmpty {
                DashedEmpty(title: "Nothing here", hint: column.emptyHint)
            } else {
                ForEach(rows) { entry in
                    AssessmentCard(
                        entry: entry,
                        isStarting: actions.startingId == entry.id,
                        onOpen: { actions.open(entry) },
                        onReview: { actions.review(entry) }
                    )
                }
            }
        }
    }

    private func icon(_ column: Column) -> String {
        switch column {
        case .todo: return "tray"
        case .inProgress: return "hourglass"
        case .done: return "checkmark.circle"
        }
    }
}

/// One assessment on the board: a subject-coloured top edge, icon tile, solid subject badge,
/// title, class · subject, a body per state, and one full-width action.
struct AssessmentCard: View {
    let entry: AssessmentBoardEntry
    let isStarting: Bool
    let onOpen: @MainActor () -> Void
    let onReview: @MainActor () -> Void

    private var state: AssessmentCardState { entry.state }
    private var progress: AssessmentProgress? { entry.progress }
    private var style: SubjectStyle.Style { SubjectStyle.of(entry.subject) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Text(entry.title)
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
                .padding(.top, 12)
            HStack(spacing: 6) {
                Image(systemName: "book").font(.system(size: 11, weight: .semibold))
                Text([entry.classroomName, style.label].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.top, 6)

            switch state.column {
            case .todo: todoBody
            case .inProgress: progressBody
            case .done: doneBody
            }

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
            switch state.column {
            case .done:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 19))
                    .foregroundStyle(Theme.success)
            case .inProgress:
                Image(systemName: "hourglass")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.amber)
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.amberSoft))
            case .todo:
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private var todoBody: some View {
        let count = entry.questionCount
        if count > 0 {
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11, weight: .semibold))
                Text("\(ScoreText.string(count)) question\(count == 1 ? "" : "s") · ~\(ScoreText.string(entry.estimatedMinutes)) min")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.top, 12)
        }
        if let due = DueLabel.text(entry.dueAt) {
            AssessmentDueChip(text: due.text, catchUp: due.late)
                .padding(.top, 12)
        }
        if !entry.tags.isEmpty {
            FlowLayout(spacing: 7) {
                ForEach(entry.tags, id: \.self) { tag in
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
    private var progressBody: some View {
        let total = entry.questionCount
        let answered = progress?.answeredCount ?? 0
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
                Text("Last opened \(RelativeTime.short(progress?.lastActivityAt))")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Theme.textSecondary)
        }
        .padding(.top, 12)
    }

    @ViewBuilder
    private var doneBody: some View {
        if state == .completed, let progress, progress.graded == true {
            let percent = progress.percent ?? 0
            let correct = progress.correctCount ?? 0
            let total = progress.totalQuestions ?? 0
            let toImprove = progress.missedCount ?? max(total - correct, 0)
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
                // "To improve", never "missed": it names the next thing to do, not a verdict,
                // and it is the filter the review opens on.
                HStack(spacing: 6) {
                    Image(systemName: toImprove > 0 ? "flag.fill" : "checkmark.circle.fill")
                        .font(.system(size: 11, weight: .bold))
                    Text(toImprove > 0 ? "\(ScoreText.string(toImprove)) to improve" : "Perfect score")
                        .font(.system(size: 13, weight: .heavy))
                }
                .foregroundStyle(toImprove > 0 ? Theme.accent : Theme.success)
            }
            .padding(.top, 12)
        } else {
            // Handed in but not yet marked. Naming that beats an absent score, which reads
            // as a zero.
            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11, weight: .semibold))
                Text("Submitted — grading in progress").font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private var action: some View {
        switch state.column {
        case .done:
            if progress?.attemptId != nil {
                Button(action: onReview) {
                    Label(state == .submitted ? "View" : "Review", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(OutlineButtonStyle())
            }
        case .inProgress:
            Button(action: onOpen) {
                Label("Continue", systemImage: "play.circle").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(tone: Theme.amber, fullWidth: true))
        case .todo:
            Button(action: onOpen) {
                HStack(spacing: 8) {
                    if isStarting {
                        ProgressView().tint(.white)
                        Text("Starting…")
                    } else {
                        Image(systemName: "play.circle")
                        Text("Start")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(tone: Theme.accent, fullWidth: true))
            .disabled(isStarting)
        }
    }
}

/// Work still to come is quiet; work to catch up on is amber. Never red — nothing here has
/// failed.
struct AssessmentDueChip: View {
    let text: String
    let catchUp: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "calendar").font(.system(size: 11, weight: .semibold))
            Text(text).font(.system(size: 12, weight: catchUp ? .heavy : .bold))
        }
        .foregroundStyle(catchUp ? Theme.amber : Theme.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(catchUp ? Theme.amber.opacity(0.14) : Theme.background)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(catchUp ? Theme.amber.opacity(0.32) : Theme.separator.opacity(0.5), lineWidth: 1)
        )
    }
}

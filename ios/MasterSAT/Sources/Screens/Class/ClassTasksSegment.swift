import SwiftUI
import MasterSATKit

/// Which list the Tasks segment shows.
enum ClassTaskFilter: Hashable { case toDo, done, results }

/// To do · Done · Results for the classes under the chip. Every row pushes a value resolved at
/// the Class root.
struct ClassTasksSegment: View {
    let tasks: ClassTasks
    /// Homework feeds To do, Done and the assessment results; midterms feed the midterm results.
    let homework: ClassSourceState
    let midterms: ClassSourceState
    @Binding var filter: ClassTaskFilter
    let zoom: Namespace.ID
    /// Reloads both sources — what a failed list's "Try again" runs.
    let retry: @MainActor () async -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var motion: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    private var items: [PillTabs<ClassTaskFilter>.Item] {
        // Classwork is listed under To do but never owed, so the badge counts homework only.
        // A badge needs its source loaded: an unloaded list is not a count of zero.
        let owed = homework == .loaded ? tasks.owedCount : 0
        let doneCount = homework == .loaded ? tasks.done.count : 0
        let resultsCount = homework == .loaded && midterms == .loaded ? tasks.resultsCount : 0
        return [
            .init(tab: .toDo, title: "To do", icon: "tray",
                  count: owed == 0 ? nil : owed, highlighted: owed > 0),
            .init(tab: .done, title: "Done", icon: "checkmark.circle",
                  count: doneCount == 0 ? nil : doneCount),
            .init(tab: .results, title: "Results", icon: "chart.bar.fill",
                  count: resultsCount == 0 ? nil : resultsCount),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PillTabs(items: items, selection: $filter)
            switch filter {
            case .toDo: toDo
            case .done: done
            case .results: results
            }
            // The board and the midterm page keep what the merged tab does not repeat: search by
            // subject and domain, the dates of papers still to come, and certificates.
            VStack(spacing: 10) {
                HubCard(title: "Assessment board", subtitle: "Every quiz, by subject and SAT domain, with search",
                        icon: "square.and.pencil", tone: Theme.success, route: AppLink.assessments)
                HubCard(title: "Midterms", subtitle: "When the next one is, your scores and certificates",
                        icon: "calendar.badge.clock", tone: Theme.amber, route: AppLink.midterms)
            }
            .padding(.top, 6)
        }
    }

    /// What stands in for a list that has not arrived: rows' worth of shape while it is on its way,
    /// a retry when it failed.
    @ViewBuilder
    private func unavailable(_ state: ClassSourceState, message: String, rows: Int = 3) -> some View {
        if state == .failed {
            RetryNotice(message: message, retry: retry)
        } else {
            LoadingSkeleton(rows: rows, height: 80, style: .cards)
        }
    }

    @ViewBuilder
    private var toDo: some View {
        if homework != .loaded {
            unavailable(homework, message: "Your homework didn't load. Check your connection and try again.")
        } else if tasks.toDo.isEmpty {
            // The tab's one piece of art: Done and Results are second lists, and keep their dashes.
            EmptyState(
                art: .noTasks,
                title: "Nothing to do here",
                message: "New work from your teachers shows up here."
            )
        } else {
            VStack(spacing: 10) {
                ForEach(tasks.toDo) { item in
                    if let assignment = item.assignment {
                        NavigationLink(value: assignment) { WorkRow(item: item) }
                            .buttonStyle(PressBounce())
                            .zoomSource(id: assignment.id, in: zoom)
                            .transition(rowTransition)
                    }
                }
            }
            .animation(motion, value: tasks.toDo.map(\.id))
        }
    }

    @ViewBuilder
    private var done: some View {
        if homework != .loaded {
            unavailable(homework, message: "Your homework didn't load. Check your connection and try again.")
        } else if tasks.done.isEmpty {
            DashedEmpty(title: "Nothing handed in yet", hint: "Work you hand in lands here.")
        } else {
            VStack(spacing: 10) {
                ForEach(tasks.done) { assignment in
                    NavigationLink(value: assignment) { HomeworkRow(assignment: assignment).cardStyle() }
                        .buttonStyle(PressBounce())
                        .zoomSource(id: assignment.id, in: zoom)
                        .transition(rowTransition)
                }
            }
            .animation(motion, value: tasks.done.map(\.id))
        }
    }

    /// Quizzes follow the homework fetch, midterms their own. Each part shows once its source is
    /// in; what is still on its way is a skeleton and what failed is a retry, so "No results yet"
    /// is said only when both sources have answered.
    @ViewBuilder
    private var results: some View {
        let assessmentsIn = homework == .loaded
        let midtermsIn = midterms == .loaded
        if assessmentsIn && midtermsIn && tasks.resultsCount == 0 {
            DashedEmpty(title: "No results yet", hint: "Marked quizzes and midterm scores land here.")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if assessmentsIn && !tasks.assessmentResults.isEmpty {
                    DotHeading(title: "Assessments", count: tasks.assessmentResults.count, tone: Theme.success)
                    ForEach(tasks.assessmentResults) { entry in
                        if let attemptId = entry.progress?.attemptId {
                            NavigationLink(value: ClassView.Route.assessmentReview(attemptId: attemptId, homeworkId: entry.link.homeworkId)) {
                                AssessmentResultRow(entry: entry, opens: true)
                            }
                            .buttonStyle(PressBounce())
                        } else {
                            AssessmentResultRow(entry: entry, opens: false)
                        }
                    }
                }
                if midtermsIn && !tasks.midtermResults.isEmpty {
                    DotHeading(title: "Midterms", count: tasks.midtermResults.count, tone: Theme.amber)
                        .padding(.top, assessmentsIn && !tasks.assessmentResults.isEmpty ? 8 : 0)
                    ForEach(tasks.midtermResults) { midterm in
                        if let attemptId = midterm.attemptId {
                            // The report carries the score, the certificate and the skills to work on.
                            NavigationLink(value: ClassView.Route.midtermReport(attemptId: attemptId, title: midterm.title)) {
                                MidtermResultRow(midterm: midterm, opens: true)
                            }
                            .buttonStyle(PressBounce())
                        } else {
                            MidtermResultRow(midterm: midterm, opens: false)
                        }
                    }
                }
                if !(assessmentsIn && midtermsIn) {
                    let shownAny = (assessmentsIn && !tasks.assessmentResults.isEmpty)
                        || (midtermsIn && !tasks.midtermResults.isEmpty)
                    let failed = homework == .failed || midterms == .failed
                    unavailable(failed ? .failed : .pending, message: shownAny
                        ? "Some of your results didn't load. Check your connection and try again."
                        : "Your results didn't load. Check your connection and try again.",
                        // Under rows that are already in, one more is enough to say "still coming".
                        rows: shownAny ? 1 : 3)
                }
            }
        }
    }
}

/// A quiz handed in: its percent once marked, "Being marked" until then.
struct AssessmentResultRow: View {
    let entry: AssessmentBoardEntry
    let opens: Bool

    private var style: SubjectStyle.Style { SubjectStyle.of(entry.subject) }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: style.icon, tone: style.tone, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Text([entry.classroomName, style.label].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            if entry.state == .completed, entry.progress?.graded == true, let percent = entry.progress?.percent {
                Text("\(percent)%")
                    .font(.system(size: 20, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundStyle(Theme.success)
            } else {
                Chip(text: "Being marked", icon: "clock", tone: .neutral)
            }
            if opens {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
        // One element: what it is, how it went, when — not the tile, the class line, the percent
        // and the chevron as four stops.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// "Linear equations, 80 percent, Tue 21 Oct" — the day is the last time anything happened on
    /// the attempt, in the learning center's time, like every date in the app.
    private var spoken: String {
        var parts = [entry.title]
        if entry.state == .completed, entry.progress?.graded == true, let percent = entry.progress?.percent {
            parts.append("\(percent) percent")
        } else {
            parts.append("being marked")
        }
        if let iso = entry.progress?.lastActivityAt, let date = JSONCoding.parseServerDate(iso) {
            parts.append(Self.spokenDay.string(from: date))
        }
        return parts.joined(separator: ", ")
    }

    /// Built once: every result row asks for its day on every render.
    private static let spokenDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = ServicesTime.calendar
        f.timeZone = ServicesTime.tashkent
        f.dateFormat = "EEE d MMM"
        return f
    }()
}

/// A midterm sat: its score once the teacher has released it — named, never blank, until then.
struct MidtermResultRow: View {
    let midterm: MidtermListing
    let opens: Bool

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: "calendar.badge.clock", tone: Theme.amber, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(midterm.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                let subject = MidtermWording.subjectLabel(midterm.subject)
                if !subject.isEmpty {
                    Text(subject)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if let score = midterm.releasedScore {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(ScoreText.string(score))
                        .font(.system(size: 20, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    if let ceiling = midterm.scoreCeiling {
                        Text("of \(ScoreText.string(ceiling))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            } else {
                Chip(text: "Not released", icon: "hourglass", tone: .warning)
            }
            if opens {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// "Midterm 2, 640 of 800" — or that the score is not out, which is not a score of nothing.
    private var spoken: String {
        guard let score = midterm.releasedScore else { return "\(midterm.title), not released" }
        guard let ceiling = midterm.scoreCeiling else { return "\(midterm.title), \(ScoreText.string(score))" }
        return "\(midterm.title), \(ScoreText.string(score)) of \(ScoreText.string(ceiling))"
    }
}

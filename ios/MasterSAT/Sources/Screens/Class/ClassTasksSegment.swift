import SwiftUI
import MasterSATKit

/// Which list the Tasks segment shows.
enum ClassTaskFilter: Hashable { case toDo, done, results }

/// To do · Done · Results for the classes under the chip. Every row pushes a value resolved at
/// the Class root.
struct ClassTasksSegment: View {
    let tasks: ClassTasks
    @Binding var filter: ClassTaskFilter
    let zoom: Namespace.ID

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var motion: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    private var items: [PillTabs<ClassTaskFilter>.Item] {
        // Classwork is listed under To do but never owed, so the badge counts homework only.
        let owed = tasks.owedCount
        return [
            .init(tab: .toDo, title: "To do", icon: "tray",
                  count: owed == 0 ? nil : owed, highlighted: owed > 0),
            .init(tab: .done, title: "Done", icon: "checkmark.circle",
                  count: tasks.done.isEmpty ? nil : tasks.done.count),
            .init(tab: .results, title: "Results", icon: "chart.bar.fill",
                  count: tasks.resultsCount == 0 ? nil : tasks.resultsCount),
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

    @ViewBuilder
    private var toDo: some View {
        if tasks.toDo.isEmpty {
            DashedEmpty(title: "Nothing to do here", hint: "New work from your teachers shows up here.")
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
        if tasks.done.isEmpty {
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

    @ViewBuilder
    private var results: some View {
        if tasks.resultsCount == 0 {
            DashedEmpty(title: "No results yet", hint: "Marked quizzes and midterm scores land here.")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if !tasks.assessmentResults.isEmpty {
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
                if !tasks.midtermResults.isEmpty {
                    DotHeading(title: "Midterms", count: tasks.midtermResults.count, tone: Theme.amber)
                        .padding(.top, tasks.assessmentResults.isEmpty ? 0 : 8)
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
    }
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
    }
}

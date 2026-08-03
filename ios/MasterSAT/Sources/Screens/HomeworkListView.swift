import SwiftUI
import MasterSATKit

/// Everything set, grouped by class — the site's assignment list.
///
/// Filtered by state rather than sorted into columns: on a phone a student almost always
/// wants "what is still open", and the other two answers are one tap away.
struct HomeworkListView: View {
    enum Filter: Hashable { case open, handedIn, all }

    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var filter: Filter = .open
    @State private var query = ""

    private func matches(_ assignment: AssignmentListing, _ filter: Filter) -> Bool {
        let status = (assignment.workflowStatus ?? "").lowercased()
        switch filter {
        case .all: return true
        case .handedIn: return status == "submitted" || status == "graded" || status == "reviewed"
        case .open: return !(status == "submitted" || status == "graded" || status == "reviewed")
        }
    }

    private func filtered(_ filter: Filter) -> [AssignmentListing] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return assignments.filter { assignment in
            guard matches(assignment, filter) else { return false }
            guard !needle.isEmpty else { return true }
            return [assignment.title, assignment.classroomName ?? ""]
                .joined(separator: " ")
                .lowercased()
                .contains(needle)
        }
    }

    /// Grouped by class, and inside a class by what is due first.
    private var grouped: [(String, [AssignmentListing])] {
        Dictionary(grouping: filtered(filter)) { $0.classroomName ?? "Homework" }
            .sorted { $0.key < $1.key }
            .map { ($0.key, $0.value.sorted { ($0.dueAt ?? "9999") < ($1.dueAt ?? "9999") }) }
    }

    private var tabs: [PillTabs<Filter>.Item] {
        [
            .init(tab: .open, title: "To do", icon: "tray", count: filtered(.open).count),
            .init(tab: .handedIn, title: "Handed in", icon: "checkmark.circle", count: filtered(.handedIn).count),
            .init(tab: .all, title: "All", icon: "square.stack", count: assignments.count),
        ]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageTitle("Homework")
                SearchField(text: $query, placeholder: "Search homework…")
                PillTabs(items: tabs, selection: $filter)

                if isLoading && assignments.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                } else if let loadError {
                    RetryNotice(message: loadError) { await load() }
                } else if grouped.isEmpty {
                    DashedEmpty(
                        title: query.isEmpty ? "Nothing here" : "Nothing matches “\(query)”",
                        hint: query.isEmpty ? "New homework from your teacher appears here." : nil
                    )
                } else {
                    ForEach(grouped, id: \.0) { classroom, items in
                        VStack(alignment: .leading, spacing: 10) {
                            DotHeading(title: classroom, count: items.count)
                            ForEach(items) { assignment in
                                NavigationLink(value: assignment) {
                                    HomeworkRow(assignment: assignment).cardStyle()
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationDestination(for: AssignmentListing.self) { assignment in
            HomeworkDetailView(assignment: assignment)
        }
        .refreshable { await load() }
        // Title left blank on purpose: the page draws its own headline, and the bar is
        // here only for the Back button — which a pushed screen must never lose.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
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

struct HomeworkRow: View {
    let assignment: AssignmentListing

    /// The icon says what KIND of work it is at a glance — a quiz, words, a video, or
    /// something to hand in — which is the first thing a student wants from a list.
    private var icon: String {
        if !assignment.assessmentHomeworks.isEmpty { return "square.and.pencil" }
        if !assignment.vocabHomeworks.isEmpty { return "character.book.closed.fill" }
        if assignment.videoURL?.isEmpty == false || assignment.videoFileURL?.isEmpty == false {
            return "play.rectangle.fill"
        }
        return "tray.and.arrow.up.fill"
    }

    /// What is actually inside, so a bundle does not read as an empty title.
    private var contents: [String] {
        var parts: [String] = []
        if !assignment.assessmentHomeworks.isEmpty {
            parts.append("\(ScoreText.string(assignment.assessmentHomeworks.count)) quiz\(assignment.assessmentHomeworks.count == 1 ? "" : "zes")")
        }
        if !assignment.vocabHomeworks.isEmpty {
            parts.append("\(ScoreText.string(assignment.vocabHomeworks.count)) word set\(assignment.vocabHomeworks.count == 1 ? "" : "s")")
        }
        if assignment.videoURL?.isEmpty == false || assignment.videoFileURL?.isEmpty == false {
            parts.append("Video")
        }
        return parts
    }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: icon, tone: StatusLabel.color(assignment.workflowStatus), size: 40)

            VStack(alignment: .leading, spacing: 5) {
                Text(assignment.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)

                HStack(spacing: 6) {
                    Text(StatusLabel.homework(assignment.workflowStatus))
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(StatusLabel.color(assignment.workflowStatus))

                    if let due = DueLabel.text(assignment.dueAt) {
                        Text("·").foregroundStyle(Theme.textLabel)
                        // States a fact. Even a passed deadline is phrased as information,
                        // never as an accusation.
                        Text(due.text)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(due.late ? Theme.warning : Theme.textSecondary)
                    }
                }

                if !contents.isEmpty {
                    Text(contents.joined(separator: " · "))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
    }
}


/// Navigation needs identity; the server id is it.
extension AssignmentListing: @retroactive Hashable {
    public static func == (lhs: AssignmentListing, rhs: AssignmentListing) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

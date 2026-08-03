import SwiftUI
import MasterSATKit

struct HomeworkListView: View {
    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var loadError: String?
    @State private var isLoading = true

    private var grouped: [(String, [AssignmentListing])] {
        Dictionary(grouping: assignments) { $0.classroomName ?? "Homework" }
            .sorted { $0.key < $1.key }
            .map { ($0.key, $0.value.sorted { ($0.dueAt ?? "9999") < ($1.dueAt ?? "9999") }) }
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else if assignments.isEmpty {
                ContentUnavailableView(
                    "Nothing assigned yet",
                    systemImage: "checklist",
                    description: Text("New homework from your teacher will appear here.")
                )
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        ForEach(grouped, id: \.0) { classroom, items in
                            VStack(alignment: .leading, spacing: 10) {
                                Overline(classroom)
                                ForEach(items) { assignment in
                                    NavigationLink(value: assignment) {
                                        HomeworkRow(assignment: assignment).cardStyle()
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(16)
                }
                .navigationDestination(for: AssignmentListing.self) { assignment in
                    HomeworkDetailView(assignment: assignment)
                }
                .refreshable { await load() }
            }
        }
        .background(Theme.background)
        .navigationTitle("Homework")
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

    /// The icon says what KIND of work it is at a glance — a quiz, words, or something to
    /// hand in — which is the first thing a student wants to know from a list.
    private var icon: String {
        if !assignment.assessmentHomeworks.isEmpty { return "square.and.pencil" }
        if !assignment.vocabHomeworks.isEmpty { return "character.book.closed.fill" }
        if assignment.videoURL?.isEmpty == false || assignment.videoFileURL?.isEmpty == false {
            return "play.rectangle.fill"
        }
        return "tray.and.arrow.up.fill"
    }

    var body: some View {
        HStack(spacing: 13) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(StatusLabel.color(assignment.workflowStatus).opacity(0.12))
                .frame(width: 40, height: 40)
                .overlay(
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(StatusLabel.color(assignment.workflowStatus))
                )

            VStack(alignment: .leading, spacing: 5) {
                Text(assignment.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)

                HStack(spacing: 6) {
                    Text(StatusLabel.homework(assignment.workflowStatus))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(StatusLabel.color(assignment.workflowStatus))

                    if let due = assignment.dueAt, let date = JSONCoding.parseServerDate(due) {
                        Text("·").foregroundStyle(Theme.textLabel)
                        // States a fact. Even a passed deadline is phrased as information,
                        // never as an accusation.
                        Text(assignment.isOverdue
                             ? "Catch up · \(date.formatted(date: .abbreviated, time: .omitted))"
                             : "Due \(date.formatted(date: .abbreviated, time: .shortened))")
                            .font(.system(size: 12))
                            .foregroundStyle(assignment.isOverdue ? Theme.warning : Theme.textSecondary)
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
        }
    }
}


/// Navigation needs identity; the server id is it.
extension AssignmentListing: @retroactive Hashable {
    public static func == (lhs: AssignmentListing, rhs: AssignmentListing) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

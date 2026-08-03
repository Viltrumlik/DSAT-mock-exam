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
        NavigationStack {
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
                    List {
                        ForEach(grouped, id: \.0) { classroom, items in
                            Section(classroom) {
                                ForEach(items) { assignment in
                                    NavigationLink(value: assignment) {
                                        HomeworkRow(assignment: assignment)
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .navigationDestination(for: AssignmentListing.self) { assignment in
                        HomeworkDetailView(assignment: assignment)
                    }
                }
            }
            .navigationTitle("Homework")
            .refreshable { await load() }
            .task { await load() }
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

struct HomeworkRow: View {
    let assignment: AssignmentListing

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(assignment.title).font(.subheadline.weight(.medium))

            HStack(spacing: 8) {
                Text(StatusLabel.homework(assignment.workflowStatus))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(StatusLabel.color(assignment.workflowStatus))

                if let due = assignment.dueAt, let date = JSONCoding.parseServerDate(due) {
                    Text("·").foregroundStyle(.secondary)
                    // "Due" states a fact. Even a passed deadline is phrased as
                    // information, never as an accusation.
                    Text("Due \(date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(assignment.isOverdue ? .orange : .secondary)
                }

                if let count = assignment.itemCount, count > 0 {
                    Text("·").foregroundStyle(.secondary)
                    Text("\(count) item\(count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}


/// Navigation needs identity; the server id is it.
extension AssignmentListing: @retroactive Hashable {
    public static func == (lhs: AssignmentListing, rhs: AssignmentListing) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

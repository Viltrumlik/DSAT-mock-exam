import SwiftUI
import MasterSATKit

// Pieces shared by the Roadmap and My Progress screens. Prefixed `LearnMore`/`Roadmap` so they
// cannot collide with anything another screen adds in parallel.

// MARK: - States

/// A failed load, said as one: what failed, that nothing is lost, and a way to try again.
///
/// Never used for "nothing here". A failed request shown as an empty state tells a student
/// their classes or their term did not happen, when all that failed was the network.
///
/// The compact `ErrorState`, on a card. Most of its callers stand for a whole page, but My
/// Progress shows two at once (the comparison and the ladder fail together when the phone is
/// offline), and a page never shows two animations.
struct LearnMoreErrorCard: View {
    let title: String
    var message: String?
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    var body: some View {
        ErrorState(title: title, message: message ?? ErrorState.nothingLost, style: .inline, retry: retry)
            .cardStyle(padding: 8)
    }
}

/// A successful answer with nothing in it: the house's dashed "nothing yet" material, a sentence
/// of why, and — where there is one — the way forward.
///
/// `EmptyState`'s compact form, without art: it also stands inside loaded pages (a lesson with no
/// reading yet).
struct LearnMoreEmptyCard<Action: View>: View {
    let title: String
    let message: String
    @ViewBuilder var action: () -> Action

    var body: some View {
        EmptyState(title: title, message: message, accessory: action)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .strokeBorder(Theme.separator.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
            )
    }
}

extension LearnMoreEmptyCard where Action == EmptyView {
    init(title: String, message: String) {
        self.init(title: title, message: message) { EmptyView() }
    }
}

/// A grey block standing where a card will be: one card-shaped `LoadingSkeleton`.
struct LearnMoreSkeleton: View {
    var height: CGFloat

    var body: some View {
        LoadingSkeleton(rows: 1, height: height, style: .cards)
    }
}

/// A section's title and the one sentence under it.
struct LearnMoreSectionHeading: View {
    let title: String
    let description: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 20, weight: .heavy))
                .tracking(-0.3)
            Text(description)
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// What to say when a request fails.
func learnMoreMessage(_ error: Error) -> String {
    (error as? APIError)?.errorDescription ?? error.localizedDescription
}

// MARK: - Dates

/// Dates as the rest of the app writes them: in the student's own locale.
@MainActor
enum LearnMoreDateText {
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return f
    }()

    private static let month: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMM")
        return f
    }()

    /// "Sep 7" from a moment in time.
    static func shortDay(_ date: Date) -> String { day.string(from: date) }

    /// "Sep 7" from a plain `YYYY-MM-DD`, read as the local calendar day.
    static func shortDay(_ iso: String) -> String {
        LearnDates.day(iso).map(day.string(from:)) ?? iso
    }

    /// "Sep" from `YYYY-MM`.
    static func shortMonth(_ iso: String) -> String {
        LearnDates.month(iso).map(month.string(from:)) ?? iso
    }
}

// MARK: - Opening a homework

/// A homework to push, hashable by its id so it can drive `navigationDestination(item:)`.
struct RoadmapHomeworkTarget: Hashable, Identifiable {
    let assignment: AssignmentListing

    var id: Int { assignment.id }

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.assignment.id == rhs.assignment.id }
    func hash(into hasher: inout Hasher) { hasher.combine(assignment.id) }
}

/// The homework a roadmap lesson points at, as `HomeworkDetailView` needs it.
///
/// It must be the student's OWN row from `my-assignments`, not the assignment detail
/// endpoint: the detail is the teacher's view of the assignment and carries no
/// `classroom_id`, no `workflow_status` and no per-student progress, so the homework page
/// opened from it says "This homework has no classroom" (see `AssignmentListing.merging`).
enum RoadmapHomework {
    struct NotInYourList: LocalizedError {
        var errorDescription: String? {
            "This homework isn’t in your list right now. If you think it should be, ask your teacher."
        }
    }

    static func listing(assignmentId: Int, student: StudentAPI) async throws -> AssignmentListing {
        let rows = try await student.assignments()
        guard let row = rows.first(where: { $0.id == assignmentId }) else { throw NotInYourList() }
        return row
    }
}

// MARK: - Opening a class

/// A classroom by id, loaded and then shown as the classroom page itself.
///
/// My Progress knows a group only by its id; `ClassroomDetailView` needs the whole class.
struct LearnMoreClassroomView: View {
    let classroomId: Int

    @Environment(Session.self) private var session
    @State private var classroom: Classroom?
    @State private var loadError: String?

    var body: some View {
        Group {
            if let classroom {
                ClassroomDetailView(classroom: classroom)
            } else if let loadError {
                ScrollView {
                    LearnMoreErrorCard(title: "That class didn’t open", message: loadError) { await load() }
                        .padding(16)
                }
            } else {
                LoadingSkeleton(rows: 2, height: 130, style: .cards, label: "Opening class").skeletonPage()
            }
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { if classroom == nil { await load() } }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            classroom = try await session.classrooms.classroom(id: classroomId)
        } catch {
            if Task.isCancelled { return }
            loadError = learnMoreMessage(error)
        }
    }
}

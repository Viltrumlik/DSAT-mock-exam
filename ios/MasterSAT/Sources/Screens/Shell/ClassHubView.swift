import SwiftUI
import MasterSATKit

/// The Class tab until phase 2: the old Learn hub's class cards, on the new shell.
struct ClassHubView: View {
    enum Route: Hashable { case classrooms, homework }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var classroomCount: Int?
    @State private var midtermResults: Int?
    /// Rooms running in the student's classes — nil while live quizzes are off, which hides the card.
    @State private var liveRooms: [LiveQuizSummary]?
    @State private var shown = false

    /// The homework list's own "To do" rule — handed-in work is not waiting on the student.
    private var openHomework: Int {
        assignments.filter {
            !["submitted", "graded", "reviewed"].contains(($0.workflowStatus ?? "").lowercased())
        }.count
    }

    private var openAssessments: Int { AssessmentBoard(assignments: assignments).todo().count }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    AppHeader(title: "Class").stagger(0, shown: shown)
                    HubCard(title: "Classroom", subtitle: "Your class, classmates and shared files",
                            icon: "person.3.fill", tone: Theme.accent, count: classroomCount, route: Route.classrooms)
                        .stagger(1, shown: shown)
                    HubCard(title: "Homework", subtitle: "Everything your teachers have set",
                            icon: "checklist", tone: Theme.info, count: openHomework, route: Route.homework)
                        .stagger(2, shown: shown)
                    HubCard(title: "Assessments", subtitle: "Quizzes to work through",
                            icon: "square.and.pencil", tone: Theme.success, count: openAssessments, route: AppLink.assessments)
                        .stagger(3, shown: shown)
                    HubCard(title: "Midterms", subtitle: "When the next one is, and how the last went",
                            icon: "calendar.badge.clock", tone: Theme.amber, count: midtermResults, route: AppLink.midterms)
                        .stagger(4, shown: shown)
                    if let liveRooms {
                        HubCard(title: "Live quiz", subtitle: "Join your class's quiz with the code on the board",
                                icon: "dot.radiowaves.left.and.right", tone: Theme.warning, count: liveRooms.count,
                                route: AppLink.liveQuiz(sessionId: nil))
                            .stagger(5, shown: shown)
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear {
                shown = true
                Task { await load() }
            }
            .onDisappear { shown = false }
            .refreshable { await load() }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .classrooms: ClassesListView()
                case .homework: HomeworkListView()
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .navigationDestination(for: AssignmentListing.self) { HomeworkDetailView(assignment: $0) }
        }
    }

    private func load() async {
        // Counts only — a failure leaves a card without its badge, never a hub that cannot draw.
        assignments = (try? await session.student.assignments()) ?? []
        classroomCount = (try? await session.classrooms.classrooms())?.count
        midtermResults = (try? await session.student.midterms())?.filter(\.submitted).count
        liveRooms = (try? await LiveQuizAPI(client: session.client).mine())?
            .filter { $0.status != .finished && $0.status != .terminated }
    }
}

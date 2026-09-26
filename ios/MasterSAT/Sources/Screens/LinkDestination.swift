import SwiftUI
import MasterSATKit

/// A link the app was asked to open — a tapped push, a reminder, a row in the inbox.
struct PresentedLink: Identifiable {
    let link: AppLink
    var id: AppLink { link }
}

/// Where a link lands: the page it names, in a sheet over whichever tab is open.
///
/// A sheet rather than a push into one of the tabs: a notification can name any page in the
/// app, and a sheet with its own stack reaches all of them without taking the student's place
/// in the tabs away — "Done" puts them back exactly where they were.
struct LinkDestinationSheet: View {
    let link: AppLink

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            destination
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }

    @ViewBuilder private var destination: some View {
        switch link {
        case .classes: ClassesListView()
        case .classroom(let id): LearnMoreClassroomView(classroomId: id)
        case .homework(_, let assignmentId): HomeworkLinkView(assignmentId: assignmentId)
        case .midterms, .examReview: MidtermsView()
        case .midtermResult(let attemptId): MidtermReportView(attemptId: attemptId, title: "Midterm result")
        case .support: SupportBookingView()
        case .services: ServicesView()
        case .events: EventsView()
        case .points: PointsView()
        case .shop: ShopView()
        case .leaderboard: LeaderboardView()
        case .surveys: SurveysListView()
        case .survey(let id): SurveyFillView(surveyId: id)
        case .roadmap: RoadmapView()
        case .roadmapDelivery(let id): RoadmapReadingView(deliveryId: id)
        case .progress: MyProgressView()
        case .assessments: AssessmentsListView()
        // Tabs and web-only pages never reach a sheet — RootTabView handles them — but a
        // switch over a public enum has to say something for them.
        case .home, .vocabulary, .vocabularySection, .vocabularySet, .profile,
             .certificate, .liveQuiz, .unknown:
            ContentUnavailableView("Nothing to open", systemImage: "link")
        }
    }
}

extension AppLink {
    /// Links that are a tab rather than a page.
    var tab: RootTab? {
        switch self {
        case .home: return .home
        case .vocabulary, .vocabularySection, .vocabularySet: return .words
        case .profile: return .profile
        default: return nil
        }
    }

    /// Pages the app does not have, which the site does — opened in the browser, and only on
    /// our own host (`webURL` refuses anything else).
    var opensOnTheWeb: Bool {
        switch self {
        case .certificate, .liveQuiz, .unknown: return true
        default: return false
        }
    }
}

/// A homework by id, as `HomeworkDetailView` needs it: the student's OWN row from their list,
/// which carries the classroom and their progress (the detail endpoint carries neither).
private struct HomeworkLinkView: View {
    let assignmentId: Int

    @Environment(Session.self) private var session
    @State private var assignment: AssignmentListing?
    @State private var loadError: String?

    var body: some View {
        Group {
            if let assignment {
                HomeworkDetailView(assignment: assignment)
            } else if let loadError {
                ScrollView {
                    LearnMoreErrorCard(title: "That homework didn't open", message: loadError) { await load() }
                        .padding(16)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .task { if assignment == nil { await load() } }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            assignment = try await RoadmapHomework.listing(assignmentId: assignmentId, student: session.student)
        } catch {
            loadError = error.localizedDescription
        }
    }
}

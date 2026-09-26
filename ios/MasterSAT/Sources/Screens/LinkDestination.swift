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
        if case .certificate(let code) = link {
            // Brings its own stack, Done and Share; nesting it in another stack would double them.
            MidtermCertificateSheet(code: code)
        } else {
            NavigationStack {
                destination
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { dismiss() }
                        }
                    }
            }
        }
    }

    @ViewBuilder private var destination: some View {
        switch link {
        case .classes: ClassesListView()
        case .classroom(let id): LearnMoreClassroomView(classroomId: id)
        case .homework(let classroomId, let assignmentId):
            HomeworkDetailView(classroomId: classroomId, assignmentId: assignmentId)
        case .midterms, .examReview: MidtermsView()
        case .midtermResult(let attemptId): MidtermReportView(attemptId: attemptId)
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
        // No join by room id exists on the server: the join screen lists the rooms running in
        // the student's classes and takes the code.
        case .liveQuiz: LiveQuizJoinView()
        // The pages read their titles from what they load; the link carries only the id.
        case .vocabularySet(let id): VocabSetView(setId: id, title: "")
        case .vocabularySection(let id): VocabSectionView(sectionId: id, title: "")
        // Tabs and web-only pages never reach a sheet — RootTabView handles them — but a
        // switch over a public enum has to say something for them.
        case .home, .vocabulary, .profile, .certificate, .unknown:
            ContentUnavailableView("Nothing to open", systemImage: "link")
        }
    }
}

extension AppLink {
    /// Links that are a tab rather than a page.
    var tab: RootTab? {
        switch self {
        case .home: return .home
        case .vocabulary: return .words
        case .profile: return .profile
        default: return nil
        }
    }

    /// Pages the app does not have, which the site does — opened in the browser, and only on
    /// our own host (`webURL` refuses anything else).
    var opensOnTheWeb: Bool {
        switch self {
        case .unknown: return true
        default: return false
        }
    }
}

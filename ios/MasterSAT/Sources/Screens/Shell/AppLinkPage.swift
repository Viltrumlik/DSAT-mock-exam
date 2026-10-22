import SwiftUI
import MasterSATKit

/// The page an `AppLink` names, pushed onto whichever stack it belongs to (see
/// `AppLink.placement`). Tabs, the Me sheet, the certificate and web pages never reach
/// here — `AppRouter.open` handles them — but a switch over a public enum must say something.
struct AppLinkPage: View {
    let link: AppLink

    var body: some View {
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
        // No join by room id exists on the server: the join screen lists the rooms running
        // in the student's classes and takes the code.
        case .liveQuiz: LiveQuizJoinView()
        case .vocabularySet(let id): VocabSetView(setId: id, title: "")
        case .vocabularySection(let id): VocabSectionView(sectionId: id, title: "")
        case .home, .vocabulary, .profile, .certificate, .unknown:
            ContentUnavailableView("Nothing to open", systemImage: "link")
        }
    }
}

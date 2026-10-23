import SwiftUI
import MasterSATKit

/// Roadmap, Services, Events, Surveys — the learning center around the class.
///
/// Each card says what is behind it right now (`ExploreModel`): the level and the next lesson,
/// the next support hour, the student's ticket, the surveys waiting. A card whose reads have not
/// answered keeps the fixed description it always had.
struct ExploreView: View {
    @Binding var path: NavigationPath
    @Environment(Session.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    @State private var model = ExploreModel()

    /// What each card says without a live line: before its reads answer, and if they never do.
    private enum Fixed {
        static let roadmap = "Your level, lesson by lesson, and what comes next"
        static let services = "Support hours with a teacher, and registering for the SAT"
        static let events = "What's coming up, and your tickets"
        static let surveys = "Tell the learning center how it's going"
    }

    var body: some View {
        let roadmap = model.roadmapLine
        let services = model.servicesLine
        let events = model.eventsLine
        let surveys = model.surveysLine

        NavigationStack(path: $path) {
            TabRootScroll(tab: .explore, onRefresh: { await model.load(session) }) {
                VStack(alignment: .leading, spacing: 14) {
                    AppHeader(title: "Explore").stagger(0, shown: shown)
                    HubCard(title: "Roadmap", subtitle: roadmap?.text ?? Fixed.roadmap, detail: roadmap?.detail,
                            icon: "map.fill", tone: Theme.accentDeep, route: AppLink.roadmap)
                        .stagger(1, shown: shown)
                    HubCard(title: "Services", subtitle: services?.text ?? Fixed.services, detail: services?.detail,
                            icon: "lifepreserver", tone: Theme.subjectEnglish, route: AppLink.services)
                        .stagger(2, shown: shown)
                    HubCard(title: "Events", subtitle: events?.text ?? Fixed.events, detail: events?.detail,
                            icon: "calendar", tone: Theme.amber,
                            count: events?.badge, countMeaning: "open for sign-up", route: AppLink.events)
                        .stagger(3, shown: shown)
                    HubCard(title: "Surveys", subtitle: surveys?.text ?? Fixed.surveys, detail: surveys?.detail,
                            icon: "list.clipboard", tone: Theme.success,
                            count: surveys?.badge, countMeaning: "waiting", route: AppLink.surveys)
                        .stagger(4, shown: shown)
                }
                .padding(16)
                // One animation for the lot: a card grows or shrinks as its line arrives, the
                // cards below it make way, and the words and the badge change inside it. Only
                // the container holding all four can move them together.
                .animation(
                    reduceMotion ? Motion.focus : Motion.snappy,
                    value: [roadmap, services, events, surveys]
                )
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            // Not `.task`: a TabView never tears its tabs down, so a task would load once per
            // launch. This runs on every return to the tab and every pop back to the root.
            .onAppear {
                if !shown { shown = true }
                Task { await model.load(session) }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
        }
    }
}

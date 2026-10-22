import SwiftUI
import MasterSATKit

/// Roadmap, Services, Events, Surveys — the learning center around the class.
/// Phase 5 gives each card its live state; until then each says what is behind it.
struct ExploreView: View {
    @Binding var path: NavigationPath
    @State private var shown = false

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .explore) {
                VStack(alignment: .leading, spacing: 14) {
                    AppHeader(title: "Explore").stagger(0, shown: shown)
                    HubCard(title: "Roadmap", subtitle: "Your level, lesson by lesson, and what comes next",
                            icon: "map.fill", tone: Theme.accentDeep, route: AppLink.roadmap)
                        .stagger(1, shown: shown)
                    HubCard(title: "Services", subtitle: "Support hours with a teacher, and registering for the SAT",
                            icon: "lifepreserver", tone: Theme.subjectEnglish, route: AppLink.services)
                        .stagger(2, shown: shown)
                    HubCard(title: "Events", subtitle: "What's coming up, and your tickets",
                            icon: "calendar", tone: Theme.amber, route: AppLink.events)
                        .stagger(3, shown: shown)
                    HubCard(title: "Surveys", subtitle: "Tell the learning center how it's going",
                            icon: "list.clipboard", tone: Theme.success, route: AppLink.surveys)
                        .stagger(4, shown: shown)
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { shown = true }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
        }
    }
}

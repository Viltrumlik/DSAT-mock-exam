import SwiftUI
import MasterSATKit

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        content
            // Both overlays read their own state in their own bodies. If this body read
            // connectivity or the release gate, every change to either would rebuild the tab
            // view below — and with it the navigation stacks, popping open screens.
            .overlay(alignment: .top) { OfflineOverlay() }
            // Above everything, including the sign-in form: a build below the minimum can do
            // nothing useful, and signing in to it would only meet a refusal.
            .overlay { UpdateGateOverlay() }
    }

    @ViewBuilder
    private var content: some View {
        switch session.phase {
        case .launching:
            ProgressView().controlSize(.large)
        case .signedOut(let message):
            AuthView(notice: message)
        case .unreachable:
            UnreachableView()
        case .signedIn(let user):
            if user.isFrozen {
                FrozenAccountView()
            } else {
                RootTabView(user: user)
            }
        }
    }
}

/// Offline is said once, here, rather than by every screen failing on its own.
private struct OfflineOverlay: View {
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            if !session.connectivity.isOnline {
                OfflineBanner().allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.connectivity.isOnline)
    }
}

private struct UpdateGateOverlay: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.releaseGate.isBlocked {
            UpdateRequiredView(config: session.releaseGate.config) {
                await session.recheckRelease()
            }
            .transition(.opacity)
        }
    }
}

/// Four tabs.
///
/// The app deliberately does not host the timed sittings — mocks, midterms, past papers,
/// practice packs and the question bank are sat on a laptop, under exam conditions, and a
/// phone is the wrong instrument for a three-hour paper. What the phone IS good for is the
/// daily loop: what was set, working through it, and learning words. Midterm *results*
/// still land here, on Home, because a score is worth checking anywhere.
struct RootTabView: View {
    let user: CurrentUser

    var body: some View {
        TabView {
            DashboardView(user: user)
                .tabItem { Label("Home", systemImage: "house") }
            LearnHubView()
                .tabItem { Label("Learn", systemImage: "graduationcap") }
            VocabularyView()
                .tabItem { Label("Words", systemImage: "character.book.closed") }
            RewardsHubView()
                .tabItem { Label("Rewards", systemImage: "trophy") }
            ProfileView(user: user)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(Theme.accent)
    }
}

/// Classwork: the class itself, what was set, and the quizzes inside it.
///
/// The site's sidebar splits Learn from Simulation; the app has no simulation, so Learn is
/// the whole of it and gets a page rather than a menu — each card says what is behind it
/// and how much of it there is.
struct LearnHubView: View {
    /// Every screen the hub opens, as a value.
    ///
    /// Value-based on purpose. The cards used to be `NavigationLink(destination:)`, and a
    /// screen pushed that way that itself pushes by value (the homework list does) was
    /// rebuilt the moment its row was tapped: the push was dropped, the list reset to its
    /// first tab, and the homework never opened. With every destination declared here, at
    /// the root of the stack, a push is only ever a value appended to the path.
    enum Route: Hashable {
        case classrooms, homework, assessments, midterms, roadmap, progress, services
    }

    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var classroomCount: Int?
    @State private var midtermResults: Int?

    /// The same rule as the homework list's "To do" tab — handed-in work is not waiting on
    /// the student, so it is not counted as open here either.
    private var openHomework: Int {
        assignments.filter {
            !["submitted", "graded", "reviewed"].contains(($0.workflowStatus ?? "").lowercased())
        }.count
    }

    private var openAssessments: Int {
        assignments
            .flatMap(\.assessmentHomeworks)
            .filter { ($0.progress?.state ?? "not_started") != "completed" }
            .count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PageTitle("Learn")

                    HubCard(
                        title: "Classroom",
                        subtitle: "Your class, classmates and shared files",
                        icon: "person.3.fill",
                        tone: Theme.accent,
                        count: classroomCount,
                        route: Route.classrooms
                    )
                    HubCard(
                        title: "Homework",
                        subtitle: "Everything your teachers have set",
                        icon: "checklist",
                        tone: Theme.info,
                        count: openHomework,
                        route: Route.homework
                    )
                    HubCard(
                        title: "Assessments",
                        subtitle: "Quizzes to work through",
                        icon: "square.and.pencil",
                        tone: Theme.success,
                        count: openAssessments,
                        route: Route.assessments
                    )
                    // Papers are sat in the centre, so this card carries no badge for work
                    // waiting — it counts what has come back: scores and skill reports.
                    HubCard(
                        title: "Midterms",
                        subtitle: "When the next one is, and how the last went",
                        icon: "calendar.badge.clock",
                        tone: Theme.amber,
                        count: midtermResults,
                        route: Route.midterms
                    )
                    HubCard(
                        title: "Roadmap",
                        subtitle: "Your level, lesson by lesson, and what comes next",
                        icon: "map.fill",
                        tone: Theme.accentDeep,
                        route: Route.roadmap
                    )
                    HubCard(
                        title: "My Progress",
                        subtitle: "How you're doing, beside your group",
                        icon: "chart.line.uptrend.xyaxis",
                        tone: Theme.success,
                        route: Route.progress
                    )
                    HubCard(
                        title: "Services",
                        subtitle: "Support hours with a teacher, and registering for the SAT",
                        icon: "lifepreserver",
                        tone: Theme.subjectEnglish,
                        route: Route.services
                    )
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Learn")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { Task { await load() } }
            .refreshable { await load() }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .classrooms: ClassesListView()
                case .homework: HomeworkListView()
                case .assessments: AssessmentsListView()
                case .midterms: MidtermsView()
                case .roadmap: RoadmapView()
                case .progress: MyProgressView()
                case .services: ServicesView()
                }
            }
            .navigationDestination(for: AssignmentListing.self) { assignment in
                HomeworkDetailView(assignment: assignment)
            }
        }
    }

    @MainActor
    private func load() async {
        // Counts only — a failure here leaves the cards without badges, which is a far
        // better outcome than a hub that refuses to draw.
        assignments = (try? await session.student.assignments()) ?? []
        classroomCount = (try? await session.classrooms.classrooms())?.count
        midtermResults = (try? await session.student.midterms())?.filter(\.submitted).count
    }
}

struct HubCard<Route: Hashable>: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    var count: Int?
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: 14) {
                IconTile(systemName: icon, tone: tone, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 16, weight: .heavy)).foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                // Zero is not shown: an empty badge says "nothing waiting" better than a
                // grey 0, which reads as a score.
                if let count, count > 0 {
                    Text(ScoreText.string(count))
                        .font(.system(size: 12, weight: .heavy).monospacedDigit())
                        .foregroundStyle(tone)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(tone.opacity(0.13)))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            .overlay(alignment: .leading) { Rectangle().fill(tone).frame(width: 3) }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}


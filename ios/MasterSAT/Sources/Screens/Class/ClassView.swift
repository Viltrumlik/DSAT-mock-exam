import SwiftUI
import MasterSATKit

/// The Class tab — the owner's "Class Tab" design: the blue band, then one pager of level cards
/// per subject the student studies (Math, then Reading & Writing), then the SAT SCORE gauge.
///
/// Everything on it comes from the roadmap (`GET /classes/roadmap/`) through the kit — the
/// cards from `ClassLevelCards`, the gauge from `SATGauge` and the student's targets — so this
/// file only loads, routes and lays out. A card opens its class page (`ClassPageRoute`); the
/// lessons, tasks, schedule and people live there now, not on this tab.
///
/// A tab root: every page it opens is a VALUE pushed onto `path`, so re-tapping the tab pops it.
struct ClassView: View {
    /// Pages this root pushes that no `AppLink` names. Kept for the pages that still push them.
    enum Route: Hashable {
        case assessmentReview(attemptId: Int, homeworkId: Int)
        case midtermReport(attemptId: Int, title: String)
    }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router

    @State private var roadmap: RoadmapResponse?
    @State private var loadError: String?
    /// The roadmap has answered at least once, either way.
    @State private var hasLoaded = false
    /// The last refresh failed over cards that were already on screen. They stay; one line
    /// under them says they may be old.
    @State private var refreshFailed = false
    /// Today's "See all" is being routed — the homework list is on its way.
    @State private var routingToDo = false
    @State private var joining = false
    @State private var shown = false
    /// The page's width, for the pagers' cards and their snapping. Measured while the band and
    /// the skeleton are up, long before the roadmap answers; 0 until then.
    @State private var pageWidth: CGFloat = 0
    /// The load the tab's appearance started. Cancelled when the tab goes away and before the next
    /// one starts, so an appearance's load never outlives the appearance.
    @State private var loadTask: Task<Void, Never>?
    /// Every load's number. A pull and an appearance can still overlap; only the newest load's
    /// answer is applied, so an older one landing late never writes over a newer one.
    @State private var loadGeneration = 0

    private var tracks: [RoadmapTrack] { roadmap?.tracks ?? [] }
    private var pagers: [ClassLevelPager] { ClassLevelCards.pagers(for: tracks) }

    private var user: CurrentUser? {
        if case .signedIn(let user) = session.phase { return user }
        return nil
    }

    private var gauge: SATGauge? {
        SATGauge(
            tracks: tracks,
            targetScore: user?.targetScore,
            targetMath: user?.targetMath,
            targetEnglish: user?.targetEnglish
        )
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .classes, onRefresh: {
                await load()
                await session.refreshUser()
            }) {
                VStack(spacing: 0) {
                    ClassBandHeader(shown: shown)
                    content
                }
                .padding(.bottom, 16)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                    if width > 0, width != pageWidth { pageWidth = width }
                }
            }
            .background { ClassTabBackground() }
            // The design keeps the status bar on the band's blue however far the page scrolls.
            // A zero-height inset whose background reaches up into the safe area, over the
            // material `TabRootScroll` puts there; it takes no touch.
            .safeAreaInset(edge: .top, spacing: 0) {
                Color.clear.frame(height: 0)
                    .background(ClassTabPalette.band)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .overlay { ClassTabBottomFade() }
            .toolbar(.hidden, for: .navigationBar)
            // Not `.task`: a TabView never tears its tabs down. The task is held instead, and given
            // up when the tab goes — a push, another tab — so loads cannot land out of order.
            .onAppear {
                if !shown { shown = true }
                showToDoIfAsked()
                loadTask?.cancel()
                loadTask = Task { await load() }
            }
            .onDisappear {
                loadTask?.cancel()
                loadTask = nil
            }
            .onChange(of: router.wantsClassToDo) { showToDoIfAsked() }
            .navigationDestination(for: ClassPageRoute.self) { ClassPageView(route: $0) }
            .navigationDestination(for: AssignmentListing.self) { HomeworkDetailView(assignment: $0) }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .assessmentReview(let attemptId, let homeworkId):
                    AssessmentReviewView(attemptId: attemptId, homeworkId: homeworkId)
                case .midtermReport(let attemptId, let title):
                    MidtermReportView(attemptId: attemptId, title: title)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .sheet(isPresented: $joining) {
                JoinClassSheet { _ in Task { await load() } }
                    .presentationDetents([.medium])
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if roadmap == nil && !hasLoaded {
            // Two cards where the pagers will stand, over the band's edge as they do.
            LoadingSkeleton(rows: 2, height: 128, style: .cards, label: "Loading your classes")
                .padding(.horizontal, 28)
                .padding(.top, -48)
        } else if roadmap == nil {
            // A failed load is never "no classes yet".
            ErrorState(title: "Couldn't load your classes", style: .page) { await load() }
                .accessibilityHint(loadError ?? "")
                .padding(.horizontal, 16)
        } else if pagers.isEmpty {
            EmptyState(
                art: .noTasks,
                title: "No classes yet",
                message: "When you join a class at MasterSAT, your levels and lessons show up here.",
                action: (title: "Join with a code", run: { joining = true })
            )
            .padding(.horizontal, 16)
        } else if pageWidth > 0 {
            ClassLevelsBoard(pagers: pagers, gauge: gauge, width: pageWidth, onOpen: open)
            if refreshFailed {
                StaleNote()
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
            }
        }
    }

    private func open(_ card: ClassLevelCard) {
        guard card.opensClassPage else { return }
        path.append(ClassPageRoute(subject: card.subject, level: card.level))
    }

    // MARK: - Today's "See all"

    /// Today's "See all": the class page of the subject whose homework is due soonest, at the
    /// student's current level — Math when nothing is owed, else Reading & Writing. Applied
    /// once, then the request is cleared. Waits for the roadmap: `load` asks again when it lands.
    /// If the homework does not load, the tab stays on its root: which subject is owed is not
    /// known, and a guess would push a page the student did not ask for.
    private func showToDoIfAsked() {
        guard router.wantsClassToDo, !routingToDo, hasLoaded else { return }
        let candidates = pagers
        guard candidates.contains(where: { $0.currentIndex != nil }) else {
            router.classToDoShown()
            return
        }
        routingToDo = true
        let student = session.student
        Task { @MainActor in
            defer {
                router.classToDoShown()
                routingToDo = false
            }
            guard let homework = try? await student.assignments() else { return }
            // Only onto the tab's root: a page the student opened meanwhile is theirs.
            if path.isEmpty, let route = ClassToDoTarget.route(pagers: candidates, homework: homework) {
                path.append(route)
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        let api = RoadmapAPI(client: session.client)
        do {
            let fresh = try await api.roadmap()
            // A newer load has been started since: its answer is the one to show.
            guard generation == loadGeneration else { return }
            roadmap = fresh
            loadError = nil
            if refreshFailed { refreshFailed = false }
        } catch where Task.isCancelled || generation != loadGeneration {
            // Not a failure: `APIClient` wraps a cancellation as a transport error. Nothing is
            // stored, so a first load stays a skeleton and a refresh keeps its cards unmarked.
            // A superseded load's failure says nothing about the newer one either.
            return
        } catch let error as APIError {
            loadError = error.errorDescription ?? "Couldn't load your classes."
            refreshFailed = roadmap != nil
        } catch {
            loadError = error.localizedDescription
            refreshFailed = roadmap != nil
        }
        hasLoaded = true
        showToDoIfAsked()
    }
}

// MARK: - The board

/// The pagers and the gauge, and their entrance: the cards rise 18 pt and fade in, the bars
/// fill, and the percents and the score count up over 1.1 s. Under Reduce Motion nothing rises
/// or counts — the final values are there from the first frame and the board only fades in.
///
/// The entrance plays once, the first time the board appears; a refresh changes the numbers in
/// place.
private struct ClassLevelsBoard: View {
    let pagers: [ClassLevelPager]
    let gauge: SATGauge?
    let width: CGFloat
    let onOpen: (ClassLevelCard) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false

    var body: some View {
        let filled = entered || reduceMotion
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                ForEach(pagers) { pager in
                    ClassLevelPagerView(pager: pager, width: width, filled: filled, onOpen: onOpen)
                }
            }
            // Over the band's lower edge: the first card's top is 48 pt above it.
            .padding(.top, -54)
            .animation(reduceMotion ? ClassTabMotion.calmFade : ClassTabMotion.fade(0.6).delay(0.2)) {
                $0.opacity(entered ? 1 : 0)
            }
            .animation(ClassTabMotion.glide(0.8).delay(0.2)) {
                $0.offset(y: reduceMotion || entered ? 0 : 18)
            }

            if let gauge {
                ClassScoreGaugeView(gauge: gauge, counted: filled)
                    .padding(.top, 24)
                    .animation(reduceMotion ? ClassTabMotion.calmFade : ClassTabMotion.fade(0.8).delay(0.5)) {
                        $0.opacity(entered ? 1 : 0)
                    }
            }
        }
        .onAppear { if !entered { entered = true } }
    }
}

// MARK: - Where "See all" goes

/// Which class page Today's "See all" opens. Pure, so the choice is the same however it is
/// reached.
enum ClassToDoTarget {
    /// The subject of the homework due soonest — in Today's own order, catch-ups first — that
    /// belongs to a subject with a current level: matched by its class, else by its subject.
    /// With nothing owed, Math, else Reading & Writing. Nil when no subject has a current level.
    static func route(pagers: [ClassLevelPager], homework: [AssignmentListing]) -> ClassPageRoute? {
        let open = pagers.filter { $0.currentIndex != nil }.sorted { $0.subject < $1.subject }
        guard let fallback = open.first else { return nil }
        let owed = TodayPlan(assignments: homework, events: [], homeworkXP: nil).homework
        for item in owed {
            guard let assignment = item.assignment else { continue }
            if let pager = pager(for: assignment, in: open) { return route(for: pager) }
        }
        return route(for: fallback)
    }

    private static func pager(for assignment: AssignmentListing, in pagers: [ClassLevelPager]) -> ClassLevelPager? {
        if let classroomId = assignment.classroomId,
           let byClass = pagers.first(where: { $0.classroomId == classroomId }) {
            return byClass
        }
        guard let key = AssessmentSubjectKey.of(assignment.subject),
              let subject = ClassSubject(rawValue: key.rawValue) else { return nil }
        return pagers.first { $0.subject == subject }
    }

    private static func route(for pager: ClassLevelPager) -> ClassPageRoute? {
        guard let index = pager.currentIndex, pager.cards.indices.contains(index) else { return nil }
        return ClassPageRoute(subject: pager.subject, level: pager.cards[index].level)
    }
}

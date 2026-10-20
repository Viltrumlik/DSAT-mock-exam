import SwiftUI
import MasterSATKit

/// Today — what to do now, across every class: how much of this week's homework is in, what is
/// up next (catching up first, then by deadline, then today's lessons), and the few things the
/// learning center wants seen today — stories, a live quiz, a fresh result, a survey.
///
/// The goal and the SAT date are set in the Me sheet (the countdown here opens it); the full
/// lesson calendar is Class → Schedule. A tab root: every push is a value resolved here.
struct TodayView: View {
    /// Pages this root pushes that no `AppLink` names.
    enum Route: Hashable {
        case midtermReport(attemptId: Int, title: String)
    }

    /// How many homework rows Up next shows before "See all".
    private static let upNextLimit = 6

    let user: CurrentUser
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
    @State private var todayEvents: [ScheduleEvent] = []
    @State private var homeworkXP: Int?
    @State private var loadError: String?
    @State private var hasLoaded = false
    @State private var seenResults: Set<Int> = []
    @State private var lastWeek: TodayPlan.Progress?
    @State private var heroBounce = 0
    @State private var promptDismissed = false
    /// Bumped by pull-to-refresh, so the pieces that load themselves reload with the page.
    @State private var refreshTick = 0
    @State private var shown = false
    @Namespace private var zoom

    /// Worked out on the learning center's calendar — Tashkent's Monday-to-Sunday week and
    /// Tashkent's "today" — whatever time zone the phone is in.
    private var plan: TodayPlan {
        TodayPlan(assignments: assignments, events: todayEvents, homeworkXP: homeworkXP, calendar: ServicesTime.calendar)
    }

    private var freshResult: MidtermListing? { TodayPlan.freshResult(midterms, seen: seenResults) }

    private var seenKey: String { "today.seenResults.\(user.id)" }

    private var rowAnimation: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    /// "Tuesday, 20 October" — the day the plan below is about, so on Tashkent's clock too.
    private var dateLine: String {
        var style = Date.FormatStyle.dateTime.weekday(.wide).day().month(.wide)
        style.timeZone = ServicesTime.tashkent
        return Date.now.formatted(style)
    }

    /// Only asked once iOS has confirmed it has not asked yet, and only when there is something
    /// real to be reminded about.
    private var showsReminderPrompt: Bool {
        !promptDismissed
            && session.notifications.permission == .notAsked
            && (!plan.homework.isEmpty || midterms.contains { !$0.submitted })
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .today) {
                VStack(alignment: .leading, spacing: 18) {
                    AppHeader(
                        title: "Today",
                        subtitle: dateLine,
                        showsBell: true
                    )
                    .stagger(0, shown: shown)

                    // The learning center's noticeboard, above everything the student owns.
                    StoriesRail(refreshID: refreshTick)
                    LiveQuizRunningCard(refreshID: refreshTick)

                    if session.releaseGate.showsNudge {
                        UpdateNudgeCard(config: session.releaseGate.config) {
                            withAnimation { session.releaseGate.dismissNudge() }
                        }
                    }

                    TodayHero(progress: plan.week, loaded: hasLoaded, bounce: heroBounce)
                        .stagger(1, shown: shown)

                    upNext.stagger(2, shown: shown)

                    if let result = freshResult, let attemptId = result.attemptId {
                        FreshResultCard(
                            midterm: result,
                            onOpen: {
                                markSeen(attemptId)
                                // A root push: a second tap while the first is in flight stacks nothing.
                                guard path.isEmpty else { return }
                                path.append(Route.midtermReport(attemptId: attemptId, title: result.title))
                            },
                            onLater: { withAnimation(rowAnimation) { markSeen(attemptId) } }
                        )
                        .transition(rowTransition)
                    }

                    SurveysWaitingCard(refreshID: refreshTick)

                    SATCountdownRow(examDate: user.satExamDate) { router.openMe() }
                        .stagger(3, shown: shown)

                    if showsReminderPrompt {
                        ReminderPromptCard(
                            onEnable: {
                                Task {
                                    await session.notifications.requestPermission()
                                    await session.notifications.reschedule(assignments: assignments, midterms: midterms)
                                }
                            },
                            onDismiss: { promptDismissed = true }
                        )
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable {
                refreshTick += 1
                await load()
            }
            // Not `.task`: a TabView never tears its tabs down, so a task would load once per
            // launch. This runs on every return to the tab and every pop back to the root.
            .onAppear {
                shown = true
                loadSeen()
                Task { await load() }
            }
            .navigationDestination(for: AssignmentListing.self) { assignment in
                HomeworkDetailView(assignment: assignment).zoomDestination(id: assignment.id, in: zoom)
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .midtermReport(let attemptId, let title):
                    MidtermReportView(attemptId: attemptId, title: title)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
        }
    }

    // MARK: - Up next

    @ViewBuilder
    private var upNext: some View {
        let next = plan.upNext(limit: Self.upNextLimit)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                DotHeading(title: "Up next", count: hasLoaded ? plan.homework.count + plan.lessons.count : nil)
                if next.more > 0 {
                    Button("See all") { router.show(.classes) }
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            if !hasLoaded {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if let loadError, assignments.isEmpty {
                // A failed load is never "all caught up".
                RetryNotice(message: loadError) { await load() }
            } else if plan.isAllClear {
                AllDoneCard()
            } else {
                ForEach(next.items) { item in
                    row(item).transition(rowTransition)
                }
            }
        }
        .animation(rowAnimation, value: next.items.map(\.id))
    }

    @ViewBuilder
    private func row(_ item: WorkItem) -> some View {
        if let assignment = item.assignment {
            NavigationLink(value: assignment) { WorkRow(item: item) }
                .buttonStyle(PressBounce())
                .zoomSource(id: assignment.id, in: zoom)
        } else {
            // A lesson is information: there is nothing deeper to open on a phone.
            WorkRow(item: item)
        }
    }

    // MARK: - Fresh result

    private func loadSeen() {
        let stored = Set(UserDefaults.standard.array(forKey: seenKey) as? [Int] ?? [])
        if stored != seenResults { seenResults = stored }
    }

    private func markSeen(_ attemptId: Int) {
        guard !seenResults.contains(attemptId) else { return }
        seenResults.insert(attemptId)
        UserDefaults.standard.set(Array(seenResults).sorted(), forKey: seenKey)
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        let student = session.student
        let rewardsAPI = session.rewards
        let now = Date.now
        // The endpoint reads its dates on the phone's calendar and the plan reads Tashkent's;
        // a day either side covers both, and the plan keeps only the events of its own today.
        let day: TimeInterval = 86_400
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let rules = rewardsAPI.rules()
        async let events = student.schedule(from: now.addingTimeInterval(-day), to: now.addingTimeInterval(day))
        do {
            let freshHomework = try await homework
            let freshPapers = try await papers
            withAnimation(rowAnimation) {
                assignments = freshHomework
                midterms = freshPapers
            }
            loadError = nil
            // Today is opened most, so it keeps the device's reminders in step with the work.
            await session.notifications.reschedule(assignments: freshHomework, midterms: freshPapers)
            await session.notifications.announceResults(midterms: freshPapers)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        // The XP labels and today's lessons are extras: losing either never takes the page down.
        if let fresh = try? await rules { homeworkXP = TodayPlan.homeworkXP(fresh) }
        if let fresh = try? await events { todayEvents = fresh }
        hasLoaded = true
        celebrateIfWeekJustFinished()
    }

    /// The week's last homework just went in: double confetti, and the ring bounces.
    private func celebrateIfWeekJustFinished() {
        let week = plan.week
        if TodayPlan.justFinished(previous: lastWeek, current: week) {
            celebrations.allDone()
            if !reduceMotion { heroBounce += 1 }
        }
        lastWeek = week
    }
}

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
    /// The midterms have loaded at least once in this view's life, so an empty `midterms` means
    /// the student has none rather than that the fetch failed.
    @State private var midtermsKnown = false
    @State private var todayEvents: [ScheduleEvent] = []
    @State private var homeworkXP: Int?
    @State private var loadError: String?
    /// Today's lessons could not be fetched — so an empty list says nothing about tonight.
    @State private var lessonsFailed = false
    @State private var hasLoaded = false
    @State private var seenResults: Set<Int> = []
    /// Nothing is stored for this student yet, so Today has never loaded for them: the scores
    /// already out are old news and are marked seen without a card (`TodayPlan.freshResult`).
    @State private var isFirstRun = false
    /// Each class's lesson length, so a three-hour lesson stays on Today for three hours.
    @State private var lessonHours: [Int: Int] = [:]
    /// The classes have answered at least once; until then the lengths are unknown, not absent.
    @State private var classesKnown = false
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
        TodayPlan(
            assignments: assignments, events: todayEvents, homeworkXP: homeworkXP,
            lessonHours: lessonHours, calendar: ServicesTime.calendar
        )
    }

    /// The homework did not load and there is none from an earlier load to show instead.
    private var homeworkFailed: Bool { loadError != nil && assignments.isEmpty }

    /// The last refresh failed over homework an earlier load brought: the rows stay, and say so.
    private var homeworkStale: Bool { loadError != nil && !assignments.isEmpty }

    private var freshResult: MidtermListing? {
        TodayPlan.freshResult(midterms, seen: seenResults, firstRun: isFirstRun)
    }

    private var seenKey: String { "today.seenResults.\(user.id)" }

    private var rowAnimation: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    /// The day the plan below is about, so on Tashkent's clock too.
    private func dateText(_ style: Date.FormatStyle) -> String {
        var style = style
        style.timeZone = ServicesTime.tashkent
        return Date.now.formatted(style)
    }

    /// "Tuesday, 20 October" — and, where that does not fit beside the pills, "Tue, 20 Oct".
    private var dateLine: String { dateText(.dateTime.weekday(.wide).day().month(.wide)) }
    private var shortDateLine: String { dateText(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) }
    /// What VoiceOver reads, whichever form is drawn.
    private var spokenDate: String { dateText(.dateTime.weekday(.wide).day().month(.wide).year()) }

    /// Only asked once iOS has confirmed it has not asked yet, and only when there is something
    /// real to be reminded about.
    private var showsReminderPrompt: Bool {
        !promptDismissed
            && session.notifications.permission == .notAsked
            && (!plan.homework.isEmpty || midterms.contains { !$0.submitted })
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .today, onRefresh: {
                refreshTick += 1
                // A class joined or re-timed since the last look: ask for the lengths again.
                classesKnown = false
                await load()
            }) {
                VStack(alignment: .leading, spacing: 18) {
                    AppHeader(
                        title: "Today",
                        subtitle: dateLine,
                        shortSubtitle: shortDateLine,
                        subtitleLabel: spokenDate,
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

                    TodayHero(progress: plan.week, loaded: hasLoaded, bounce: heroBounce, failed: homeworkFailed)
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
            // Not `.task`: a TabView never tears its tabs down, so a task would load once per
            // launch. This runs on every return to the tab and every pop back to the root.
            .onAppear {
                // A return, not the first look: the stories, the live-quiz banner and the surveys
                // load themselves per `refreshTick`, so they are told to look again — a quiz
                // started in class must appear, and a finished one must lose its Join. (The first
                // look needs no bump: they load as they appear.)
                if shown { refreshTick += 1 }
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
                // No count over a failure: a zero beside "didn't load" would read as "nothing owed".
                DotHeading(title: "Up next", count: hasLoaded && !homeworkFailed ? plan.homework.count + plan.lessons.count : nil)
                if next.more > 0 {
                    Button("See all") { router.showClassToDo() }
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            if !hasLoaded {
                // The rows' own shape, so the page does not jump when they arrive.
                LoadingSkeleton(rows: 3, height: 80, style: .cards)
            } else if homeworkFailed {
                // A failed load is never "all caught up". The week card above says it too, in a
                // line; this is the page's one piece of art.
                ErrorState(title: "Today's work didn't load") { await load() }
            } else if plan.isAllClear && lessonsFailed {
                // Nothing owed, but tonight's lessons are unknown: not "all caught up" either.
                RetryNotice(message: "Couldn't load today's lessons.") { await load() }
            } else if plan.isAllClear {
                AllDoneCard()
            } else {
                ForEach(next.items) { item in
                    row(item).transition(rowTransition)
                }
                if lessonsFailed {
                    LessonsUnavailableRow { await load() }
                }
            }
            if homeworkStale { StaleNote() }
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
        let saved = UserDefaults.standard.array(forKey: seenKey) as? [Int]
        let stored = Set(saved ?? [])
        if stored != seenResults { seenResults = stored }
        // No key at all, not an empty one: written the first time a load marks what is out.
        let first = saved == nil
        if first != isFirstRun { isFirstRun = first }
    }

    private func markSeen(_ attemptId: Int) {
        guard !seenResults.contains(attemptId) else { return }
        seenResults.insert(attemptId)
        UserDefaults.standard.set(Array(seenResults).sorted(), forKey: seenKey)
    }

    /// The first load ever: every score already out is old news. Written even when there are
    /// none, so the next load knows this was not the first.
    private func markFirstRunSeen(_ midterms: [MidtermListing]) {
        seenResults.formUnion(TodayPlan.releasedAttempts(midterms))
        UserDefaults.standard.set(Array(seenResults).sorted(), forKey: seenKey)
        isFirstRun = false
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        let student = session.student
        let rewardsAPI = session.rewards
        let classroomsAPI = session.classrooms
        let needsClasses = !classesKnown
        let now = Date.now
        // The endpoint reads its dates on the phone's calendar and the plan reads Tashkent's;
        // a day either side covers both, and the plan keeps only the events of its own today.
        let day: TimeInterval = 86_400
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let rules = rewardsAPI.rules()
        async let events = student.schedule(from: now.addingTimeInterval(-day), to: now.addingTimeInterval(day))
        // Only the lesson lengths come from the classes, so they are asked for once, not on every
        // return to the tab (a pull to refresh asks again).
        async let rooms = needsClasses ? (try? await classroomsAPI.classrooms()) : nil
        var freshHomework: [AssignmentListing]?
        do {
            freshHomework = try await homework
        } catch where Task.isCancelled {
            // Not a failure: `APIClient` wraps a cancellation as a transport error, and an error
            // here would put "Couldn't refresh" under rows that are fine.
            return
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        // Every marked attempt the list carries becomes known to this phone the moment the list
        // arrives, before any review decides whether a score is better than the one before it.
        if let freshHomework { OutcomeBook().noteSeen(in: freshHomework, userID: user.id) }
        // Midterms only feed the result card and the reminder prompt: whether they load never
        // decides whether the homework is shown, and the other way round.
        let freshPapers = try? await papers
        if freshPapers != nil { midtermsKnown = true }
        withAnimation(rowAnimation) {
            if let freshHomework { assignments = freshHomework }
            if let freshPapers { midterms = freshPapers }
        }
        if isFirstRun, let freshPapers { markFirstRunSeen(freshPapers) }
        if let freshHomework {
            loadError = nil
            // Today is opened most, so it keeps the device's reminders in step with the work.
            // `reschedule` clears every pending reminder and rebuilds from what it is given, so
            // it is only given midterms that are known: with them unknown (a failed fetch, and
            // none loaded yet) it is skipped, the exam reminders stay, and the homework ones
            // follow on the next load that has both.
            if midtermsKnown {
                await session.notifications.reschedule(assignments: freshHomework, midterms: midterms)
            }
        }
        if let freshPapers { await session.notifications.announceResults(midterms: freshPapers) }
        // The XP labels and today's lessons are extras: losing either never takes the page down.
        // Losing the lessons is remembered, though: an empty list must not read as a free evening.
        if let fresh = try? await rules { homeworkXP = TodayPlan.homeworkXP(fresh) }
        // A failed lookup leaves the lengths as they were (two hours, on a first look): losing
        // them never takes the page down, and the next load asks again.
        if let fresh = await rooms {
            let hours = TodayPlan.lessonHours(of: ProfileClasses.memberships(fresh))
            if hours != lessonHours { lessonHours = hours }
            classesKnown = true
        }
        do {
            todayEvents = try await events
            lessonsFailed = false
        } catch {
            lessonsFailed = true
        }
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

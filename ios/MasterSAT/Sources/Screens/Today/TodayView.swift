import SwiftUI
import MasterSATKit

/// Today — the stories, the four stat cards, and the few things the learning center wants seen
/// today: a live quiz, a fresh result, a survey, Services and the Shop.
///
/// This week's homework ring, Up next and the SAT countdown are not on Today (owner, 2026-10-29):
/// the class's To-do and the Me sheet carry them. The homework is still read here — it keeps the
/// device's reminders in step and plays the week-done confetti. A tab root: every push is a value
/// resolved here.
struct TodayView: View {
    /// Pages this root pushes that no `AppLink` names.
    enum Route: Hashable {
        case midtermReport(attemptId: Int, title: String)
    }

    let user: CurrentUser
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(RewardsStore.self) private var rewards
    @Environment(StatusBarChrome.self) private var statusBar: StatusBarChrome?
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
    /// The midterms have loaded at least once in this view's life, so an empty `midterms` means
    /// the student has none rather than that the fetch failed.
    @State private var midtermsKnown = false
    @State private var homeworkXP: Int?
    @State private var loadError: String?
    @State private var hasLoaded = false
    @State private var seenResults: Set<Int> = []
    /// Nothing is stored for this student yet, so Today has never loaded for them: the scores
    /// already out are old news and are marked seen without a card (`TodayPlan.freshResult`).
    @State private var isFirstRun = false
    @State private var lastWeek: TodayPlan.Progress?
    @State private var promptDismissed = false
    /// Bumped by pull-to-refresh, so the pieces that load themselves reload with the page.
    @State private var refreshTick = 0
    @State private var shown = false
    /// Today has read the hero board at least once: an empty place is then "not on the board yet",
    /// not "loading". The place itself is `RewardsStore.rank`, noted by whoever read it last.
    @State private var rankRead = false
    @State private var showingChecklist = false
    @State private var examDates: ServicesLoadState<[ExamDateOption]> = .loading
    /// This root's claim on the status bar: white over the band.
    @State private var statusBarOwner = UUID()
    @Namespace private var zoom

    /// Worked out on the learning center's calendar — Tashkent's Monday-to-Sunday week — whatever
    /// time zone the phone is in. Homework only: today's lessons were for Up next.
    private var plan: TodayPlan {
        TodayPlan(
            assignments: assignments, events: [], homeworkXP: homeworkXP,
            lessonHours: [:], calendar: ServicesTime.calendar
        )
    }

    private var freshResult: MidtermListing? {
        TodayPlan.freshResult(midterms, seen: seenResults, firstRun: isFirstRun)
    }

    private var seenKey: String { "today.seenResults.\(user.id)" }

    private var rowAnimation: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
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
            TabRootScroll(tab: .today, onRefresh: {
                refreshTick += 1
                await load()
            }) {
                VStack(spacing: 0) {
                    // 1–2: the wordmark, the bell and the avatar; the stories moved up into the
                    // band, above the stat cards (owner, 2026-10-28).
                    TabBand(shown: shown) {
                        BrandWordmark()
                    } below: {
                        StoriesRail(refreshID: refreshTick, onBand: true)
                    }

                    // 3: Coins · XP · Strike · Leaderboard, riding up over the band's edge.
                    TodayStatCards(rank: rewards.rank, rankRead: rankRead) { router.openLeaderboardSheet() }
                        .padding(.horizontal, 16)
                        .padding(.top, -62)

                    SlotStack(spacing: 18) {
                        // 4: the Daily Challenge — the owner's other session builds it; empty until then.
                        DailyChallengeSlot()

                        LiveQuizRunningCard(refreshID: refreshTick)

                        if session.releaseGate.showsNudge {
                            UpdateNudgeCard(config: session.releaseGate.config) {
                                withAnimation(rowAnimation) { session.releaseGate.dismissNudge() }
                            }
                        }

                        // 5: a fresh result, then the reminder nudge. This week, Up next and the SAT
                        // countdown are gone from Today (owner, 2026-10-29).
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

                        // 6: Services — each opens what the app already has.
                        TodayServicesRow(
                            onSupport: { open(.support) },
                            onRegistration: { showingChecklist = true },
                            // No FAQ page exists in the app: the closest is Services, which says
                            // what each service is and how it works.
                            onFAQ: { open(.services) }
                        )
                        .stagger(1, shown: shown)

                        // 7: the Shop rail.
                        TodayShopRail(refreshID: refreshTick) { open(.shop) }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 18)
                    .padding(.bottom, 16)
                }
            }
            .background(NewLook.page)
            // The band's blue stays under the status bar however far the page scrolls (as Class).
            .safeAreaInset(edge: .top, spacing: 0) {
                Color.clear.frame(height: 0)
                    .background(ClassTabPalette.band)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .overlay { ClassTabBottomFade(color: NewLook.page) }
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
                // The band is blue in either appearance: the clock over it is white.
                statusBar?.ask(.light, on: .today, owner: statusBarOwner)
                loadSeen()
                Task { await load() }
            }
            .onDisappear { statusBar?.release(owner: statusBarOwner) }
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
            .sheet(isPresented: $showingChecklist) {
                SatChecklistSheet(dates: examDates) { await loadExamDates() }
                    .noBarClearance()
            }
            .task(id: showingChecklist) {
                if showingChecklist, examDates.value == nil { await loadExamDates() }
            }
        }
    }

    /// Through the router, as every route in the app is: a page pushed on the tab it belongs to.
    private func open(_ link: AppLink) {
        router.open(link, baseURL: session.client.config.baseURL) { openURL($0) }
    }

    /// The SAT checklist's exam dates, read when the checklist opens (as Services reads them).
    @MainActor
    private func loadExamDates() async {
        if examDates.value == nil { examDates = .loading }
        do {
            let dates = try await session.student.examDates()
            guard !Task.isCancelled else { return }
            examDates = .loaded(dates)
        } catch {
            guard !Task.isCancelled, examDates.value == nil else { return }
            examDates = .failed(ServicesError.message(error))
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
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let rules = rewardsAPI.rules()
        // The Leaderboard card's place: the hero board, as the Rewards hero and the XP window ask it.
        async let board = try? await LeaderboardAPI(client: session.client).board(.heroBoard)
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
        // The XP labels are an extra: losing them never takes the page down.
        if let fresh = try? await rules { homeworkXP = TodayPlan.homeworkXP(fresh) }
        if let fresh = await board, !Task.isCancelled { showRank(fresh) }
        hasLoaded = true
        celebrateIfWeekJustFinished()
    }

    /// Notes the place the card shows — onto a quiet stage only, as the Rewards hero does: while
    /// a welcome-back check or a trophy card is playing, the place it is about to announce must
    /// not be on the card first. Asked again once the stage is quiet.
    @MainActor
    private func showRank(_ board: LeaderboardBoard) {
        guard celebrations.isQuiet else {
            celebrations.whenQuiet("today.rank") { Task { await reloadRank() } }
            return
        }
        rewards.noteRank(board.standing?.rank)
        if !rankRead { rankRead = true }
    }

    @MainActor
    private func reloadRank() async {
        guard let fresh = try? await LeaderboardAPI(client: session.client).board(.heroBoard) else { return }
        showRank(fresh)
    }

    /// The week's last homework just went in: double confetti.
    private func celebrateIfWeekJustFinished() {
        let week = plan.week
        if TodayPlan.justFinished(previous: lastWeek, current: week) {
            celebrations.allDone()
        }
        lastWeek = week
    }
}

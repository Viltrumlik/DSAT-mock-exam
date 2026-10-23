import SwiftUI
import MasterSATKit

/// The Class tab — every class the student is in, together.
///
/// Chips narrow it to a subject (or, with two classes of one subject, to one class); one class
/// has no chips. Under them, each class's next lesson with its Telegram group and a live quiz to
/// join, then the segments. A tab root: every row pushes a VALUE resolved here, so re-tapping
/// the tab pops it.
struct ClassView: View {
    enum Segment: Hashable { case tasks, schedule, people, files }

    /// Pages this root pushes that no `AppLink` names.
    enum Route: Hashable {
        case assessmentReview(attemptId: Int, homeworkId: Int)
        case midtermReport(attemptId: Int, title: String)
    }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var classrooms: [Classroom] = []
    @State private var classesError: String?
    @State private var hasLoaded = false
    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
    /// Whether each of those has arrived. Empty is not "loaded": until `.loaded`, the Tasks lists
    /// show a spinner or a retry, never "Nothing to do here", and no badge counts them.
    @State private var homeworkState = ClassSourceState.pending
    @State private var midtermState = ClassSourceState.pending
    /// The last refresh failed over a list that was already on screen (`ClassSourceState` keeps
    /// the old rows and forgets that it failed). The rows stay; one line under them says so.
    @State private var refreshFailed = false
    /// The next two weeks of lessons, for the class cards. The calendar loads its own month.
    @State private var upcoming: [ScheduleEvent] = []
    @State private var liveRooms: [LiveQuizSummary] = []
    @State private var telegram: [Int: TelegramGroupState] = [:]
    @State private var homeworkXP: Int?
    /// The chip by id, never by position — ids change shape when the classes do, so every reload
    /// resolves it again (`ClassFilter.resolvedID`).
    @State private var chip = ClassFilter.allID
    @State private var segment: Segment = .tasks
    @State private var taskFilter: ClassTaskFilter = .toDo
    @State private var telegramClass: Classroom?
    @State private var joining = false
    @State private var refreshTick = 0
    /// People and Files, per class, kept while the tab lives.
    @State private var sections = ClassSectionsModel()
    @State private var shown = false
    @Namespace private var zoom

    private var filter: ClassFilter { ClassFilter(classrooms: classrooms) }
    private var activeChip: String { filter.resolvedID(chip) }
    private var visibleClasses: [Classroom] { filter.classes(for: activeChip) }

    private var tasks: ClassTasks {
        ClassTasks(assignments: assignments, midterms: midterms, filter: filter, chipID: activeChip, homeworkXP: homeworkXP)
    }

    private var motion: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var cardTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.92).combined(with: .opacity)
    }

    private var chipItems: [PillTabs<String>.Item] {
        filter.chips.map { chip in
            // Owed homework only, as the To do badge counts it: classwork is done in class.
            let open = homeworkState == .loaded ? assignments.filter {
                filter.includes(classroomId: $0.classroomId, chipID: chip.id)
                    && !HomeworkProgress.isDone($0) && !$0.isClasswork
            }.count : 0
            let icon = chip.subject == .math ? "function" : chip.subject == .english ? "book.closed" : "square.grid.2x2"
            return PillTabs<String>.Item(tab: chip.id, title: chip.label, icon: icon, count: open > 0 ? open : nil)
        }
    }

    private var segmentItems: [SegmentBar<Segment>.Item] {
        [
            .init(segment: .tasks, title: "Tasks"),
            .init(segment: .schedule, title: "Schedule"),
            .init(segment: .people, title: "People"),
            .init(segment: .files, title: "Files"),
        ]
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .classes, onRefresh: {
                refreshTick += 1
                await load()
            }) {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader(title: "Class").stagger(0, shown: shown)
                    content
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            // Not `.task`: a TabView never tears its tabs down.
            .onAppear {
                shown = true
                showToDoIfAsked()
                Task { await load() }
            }
            .onChange(of: router.wantsClassToDo) { showToDoIfAsked() }
            .navigationDestination(for: AssignmentListing.self) { assignment in
                HomeworkDetailView(assignment: assignment).zoomDestination(id: assignment.id, in: zoom)
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .assessmentReview(let attemptId, let homeworkId):
                    AssessmentReviewView(attemptId: attemptId, homeworkId: homeworkId)
                case .midtermReport(let attemptId, let title):
                    MidtermReportView(attemptId: attemptId, title: title)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .sheet(item: $telegramClass, onDismiss: { Task { await loadTelegram() } }) { room in
                ClassroomTelegramSheet(classroomId: room.id, className: room.name, initialState: telegram[room.id]) { state in
                    telegram[room.id] = state
                }
                .noBarClearance()
            }
            .sheet(isPresented: $joining) {
                JoinClassSheet { _ in Task { await load() } }
                    .presentationDetents([.medium])
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !hasLoaded && classrooms.isEmpty {
            // A class card or two, then the segment under them.
            LoadingSkeleton(rows: 2, height: 100, style: .cards)
        } else if let classesError, classrooms.isEmpty {
            // A failed load is never "no classes yet".
            ClassroomErrorState(
                title: "Couldn't load your classes",
                message: ErrorState.nothingLost
            ) { await load() }
            .accessibilityHint(classesError)
        } else if classrooms.isEmpty {
            EmptyState(
                art: .noTasks,
                title: "No classes yet",
                message: "Have a class code? Join now to get started.",
                action: (title: "Join with a code", run: { joining = true })
            )
        } else {
            if !filter.chips.isEmpty {
                PillTabs(items: chipItems, selection: $chip).stagger(1, shown: shown)
            }

            VStack(spacing: 12) {
                ForEach(visibleClasses) { room in
                    ClassLessonCard(
                        room: room,
                        next: ProfileLessons.next(
                            in: upcoming, classroomId: room.id, hours: room.lessonHours, calendar: ServicesTime.calendar
                        ),
                        telegram: TelegramGroupButton.resolve(state: telegram[room.id], classroomGroupURL: room.telegramGroupURL),
                        liveQuizOn: liveRooms.contains { $0.classroomId == room.id },
                        onTelegram: { openTelegram(room) }
                    )
                    .transition(cardTransition)
                }
            }
            .animation(motion, value: visibleClasses.map(\.id))
            .stagger(2, shown: shown)

            SegmentBar(items: segmentItems, selection: $segment)
                .stagger(3, shown: shown)

            Group {
                switch segment {
                case .tasks:
                    ClassTasksSegment(
                        tasks: tasks,
                        homework: homeworkState,
                        midterms: midtermState,
                        filter: $taskFilter,
                        zoom: zoom,
                        retry: { await load() }
                    )
                case .schedule:
                    ClassScheduleSegment(
                        classIds: activeChip == ClassFilter.allID ? nil : Set(visibleClasses.map(\.id)),
                        assignments: assignments,
                        refreshID: refreshTick,
                        path: $path
                    )
                case .people:
                    ClassPeopleSegment(classes: visibleClasses, model: sections, refreshID: refreshTick)
                case .files:
                    ClassFilesSegment(classes: visibleClasses, model: sections, refreshID: refreshTick)
                }
            }
            .stagger(4, shown: shown)

            if refreshFailed { StaleNote() }

            Button { joining = true } label: {
                Label("Join another class", systemImage: "person.badge.plus")
                    .appFont(13, weight: .bold)
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PressBounce())
            .padding(.top, 4)
        }
    }

    /// Today's "See all": every class, Tasks, To do. Applied once, then the request is cleared.
    private func showToDoIfAsked() {
        guard router.wantsClassToDo else { return }
        if chip != ClassFilter.allID { chip = ClassFilter.allID }
        if segment != .tasks { segment = .tasks }
        if taskFilter != .toDo { taskFilter = .toDo }
        router.classToDoShown()
    }

    private func openTelegram(_ room: Classroom) {
        switch TelegramGroupButton.resolve(state: telegram[room.id], classroomGroupURL: room.telegramGroupURL) {
        case .join: telegramClass = room
        case .link(let raw): if let url = URL(string: raw) { openURL(url) }
        case .none: break
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        let classroomsAPI = session.classrooms
        let student = session.student
        let rewardsAPI = session.rewards
        let live = LiveQuizAPI(client: session.client)
        let now = Date.now
        // The endpoint reads its dates on the phone's calendar and the cards read Tashkent's: a
        // day back keeps today's lesson in the window on a phone that is already into tomorrow.
        let start = now.addingTimeInterval(-86_400)
        let end = Calendar.current.date(byAdding: .day, value: 14, to: now) ?? now
        // A list that failed shows its skeleton again while this retries.
        if homeworkState == .failed { homeworkState = .pending }
        if midtermState == .failed { midtermState = .pending }
        async let rooms = classroomsAPI.classrooms()
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let rules = rewardsAPI.rules()
        async let lessons = student.schedule(from: start, to: end)
        async let quizzes = live.mine()
        do {
            // A removed student's row still comes back from /classes/ with no role.
            let fresh = ProfileClasses.memberships(try await rooms)
            // Chip ids change shape with the classes ("math" ↔ "class-7"): resolve against the
            // classes just fetched, so a chip that has gone reads as All in the same update.
            let resolved = ClassFilter(classrooms: fresh).resolvedID(chip)
            withAnimation(motion) {
                classrooms = fresh
                chip = resolved
            }
            classesError = nil
        } catch where Task.isCancelled {
            // Not a failure: `APIClient` wraps a cancellation as a transport error. Nothing is
            // stored, so a first load stays a skeleton and a refresh keeps its rows unmarked.
            return
        } catch let error as APIError {
            classesError = error.errorDescription ?? "Couldn't load your classes."
        } catch {
            classesError = error.localizedDescription
        }
        // The classes have answered, so their cards and any error can show now; the lists below
        // wait on their own sources.
        hasLoaded = true
        // Each of the rest fails on its own and keeps what was on screen. Homework and midterms
        // also say whether they arrived: a failure with nothing loaded is a retry, not "nothing".
        let freshHomework = try? await homework
        if Task.isCancelled { return }
        if let freshHomework {
            withAnimation(motion) { assignments = freshHomework }
            // Every marked attempt the list carries becomes known to this phone, before any review
            // decides whether a score is better than the one before it (`OutcomeMemory`).
            if case .signedIn(let user) = session.phase { OutcomeBook().noteSeen(in: freshHomework, userID: user.id) }
        }
        homeworkState.finish(succeeded: freshHomework != nil)
        let freshMidterms = try? await papers
        if Task.isCancelled { return }
        if let freshMidterms { midterms = freshMidterms }
        midtermState.finish(succeeded: freshMidterms != nil)
        // A failure over rows that were already here leaves `.loaded` as it was, so it is read
        // off the outcomes: any source that failed while it had something to show.
        let stale = (classesError != nil && !classrooms.isEmpty)
            || (freshHomework == nil && homeworkState == .loaded)
            || (freshMidterms == nil && midtermState == .loaded)
        if refreshFailed != stale { refreshFailed = stale }
        if let fresh = try? await rules { homeworkXP = TodayPlan.homeworkXP(fresh) }
        if let fresh = try? await lessons { upcoming = fresh }
        if let fresh = try? await quizzes {
            liveRooms = fresh.filter { $0.status != .finished && $0.status != .terminated }
        }
        await loadTelegram()
    }

    /// A failed lookup leaves the button on the class's static link, which still works.
    @MainActor
    private func loadTelegram() async {
        let api = ClassroomTelegramAPI(client: session.client)
        for room in classrooms {
            if let state = try? await api.state(classroomId: room.id), telegram[room.id] != state {
                telegram[room.id] = state
            }
        }
    }
}

import SwiftUI
import MasterSATKit

/// One panel's data: the last good answer, whether the last try failed, and whether one is out.
///
/// A panel draws a placeholder while there is no answer and no failure, the failure (with a
/// retry) when the only thing it has is a failure, and the answer otherwise — so a refresh
/// that blinks never trades a real list for an error, and a failure is never drawn as
/// "nothing here".
struct ProfileLoad<Value> {
    var value: Value?
    var failed = false
    var isLoading = false

    /// Nothing to show yet, and nothing has gone wrong: draw the placeholder.
    var isPending: Bool { value == nil && !failed }
    /// Failed, with no earlier answer to fall back on: draw the failure.
    var isFailed: Bool { value == nil && failed }
}

/// The profile page's state: every panel's data, loaded side by side and failing on its own —
/// the web's `/profile`, where each tab's data is its own request with its own failure.
///
/// Overview reads `/users/me/` (phone, Telegram), `/users/telegram/config/`, `/rewards/me/`,
/// `/classes/my-assignments/`, `/exams/attempts/` and `/users/exam-dates/`; the Classes tab's
/// count needs `/classes/`. The rest of the Classes tab — the timetable, each class's
/// Telegram group, the classmates — waits until the tab is first opened, as on the web.
@MainActor
@Observable
final class ProfileModel {
    // Overview
    var account = ProfileLoad<AccountProfile>()
    /// Nil until known, and on failure — the web treats a failed lookup as "no Telegram
    /// sign-in here", which only hides the checklist's Telegram step.
    var telegramSignIn: TelegramSignInConfig?
    var rewards = ProfileLoad<MyRewards>()
    var homework = ProfileLoad<[AssignmentListing]>()
    var attempts = ProfileLoad<[ProfileAttempt]>()
    var examDates = ProfileLoad<[ExamDateOption]>()

    // Classes
    var classes = ProfileLoad<[Classroom]>()
    var schedule = ProfileLoad<[ScheduleEvent]>()
    var people: [Int: ProfileLoad<[ClassroomMember]>] = [:]
    /// Each class's Telegram group, where the lookup answered. A class missing here falls
    /// back to its static link — `TelegramGroupButton.resolve` — which still works.
    var groups: [Int: TelegramGroupState] = [:]
    var selectedClassId: Int?

    // The rows under the tabs — badges only: nil (not fetched) shows no badge, never "0 open".
    var openSurveys: Int?
    var openEvents: Int?

    /// A goal or date saved here, until the session's own copy of the account catches up.
    var savedUser: CurrentUser?
    var isSavingGoal = false
    var isSavingExamDate = false

    private var hasAppeared = false
    private var classesOpened = false

    /// The classes the student holds a seat in.
    var memberClasses: [Classroom]? { classes.value.map(ProfileClasses.memberships) }

    var selectedClass: Classroom? {
        guard let list = memberClasses else { return nil }
        return list.first { $0.id == selectedClassId } ?? list.first
    }

    // MARK: - Loading

    /// Everything the first time the page appears; after that — coming back from a page it
    /// opened — only what those pages change: the details, the rewards, the homework and the
    /// badges. Pull to refresh reloads the lot.
    func appeared(_ session: Session) async {
        if hasAppeared {
            async let identity: Void = session.refreshUser()
            async let details: Void = loadAccount(session)
            async let wallet: Void = loadRewards(session)
            async let work: Void = loadHomework(session)
            async let badges: Void = loadCounts(session)
            _ = await (identity, details, wallet, work, badges)
        } else {
            hasAppeared = true
            await refreshAll(session)
        }
    }

    /// Also re-reads the session's own copy of the account: the goal and the date on this page
    /// are read from it, and Home saves them without touching it — so a goal changed on Home
    /// would otherwise show here as the old one.
    func refreshAll(_ session: Session) async {
        async let identity: Void = session.refreshUser()
        async let details: Void = loadAccount(session)
        async let signIn: Void = loadTelegramSignIn(session)
        async let wallet: Void = loadRewards(session)
        async let work: Void = loadHomework(session)
        async let results: Void = loadAttempts(session)
        async let dates: Void = loadExamDates(session)
        async let rooms: Void = loadClasses(session, refreshing: true)
        async let timetable: Void = loadScheduleIfOpened(session)
        async let badges: Void = loadCounts(session)
        _ = await (identity, details, signIn, wallet, work, results, dates, rooms, timetable, badges)
    }

    func loadAccount(_ session: Session) async {
        let api = AccountAPI(client: session.client)
        await run(\.account) { try await api.profile() }
    }

    func loadTelegramSignIn(_ session: Session) async {
        let api = AccountAPI(client: session.client)
        if let config = try? await api.telegramConfig() { telegramSignIn = config }
    }

    func loadRewards(_ session: Session) async {
        let api = session.rewards
        await run(\.rewards) { try await api.me() }
    }

    func loadHomework(_ session: Session) async {
        let api = session.student
        await run(\.homework) { try await api.assignments() }
    }

    func loadAttempts(_ session: Session) async {
        let api = ProfileAPI(client: session.client)
        await run(\.attempts) { try await api.attempts() }
    }

    func loadExamDates(_ session: Session) async {
        let api = session.student
        await run(\.examDates) { try await api.examDates() }
    }

    /// The class list. Once the Classes tab has been opened, a list that lands brings the
    /// tab's pieces that hang off it — each class's Telegram group, the chosen class's
    /// classmates — so opening the tab before the list arrives loses nothing.
    func loadClasses(_ session: Session, refreshing: Bool = false) async {
        let api = session.classrooms
        await run(\.classes) { try await api.classrooms() }
        let ids = memberClasses?.map(\.id) ?? []
        if selectedClassId.map({ !ids.contains($0) }) ?? true { selectedClassId = ids.first }
        guard classesOpened, classes.value != nil else { return }
        async let telegram: Void = loadGroups(session)
        async let mates: Void = loadSelectedPeople(session, force: refreshing)
        _ = await (telegram, mates)
    }

    func loadCounts(_ session: Session) async {
        async let surveys = CommunityCounts.openSurveys(session)
        async let events = CommunityCounts.eventsOpenForSignUp(session)
        let (s, e) = await (surveys, events)
        // A failed count keeps the last badge rather than dropping it on a blink.
        if let s { openSurveys = s }
        if let e { openEvents = e }
    }

    // MARK: - The Classes tab

    /// The first time the Classes tab opens: the timetable, each class's Telegram group, and
    /// the selected class's classmates.
    func openClasses(_ session: Session) async {
        guard !classesOpened else { return }
        classesOpened = true
        async let timetable: Void = loadSchedule(session)
        async let pieces: Void = loadClassPieces(session)
        _ = await (timetable, pieces)
    }

    /// "Try again" on the Classes tab: the list (and what hangs off it) and the timetable.
    func retryClasses(_ session: Session) async {
        async let rooms: Void = loadClasses(session, refreshing: true)
        async let timetable: Void = loadSchedule(session)
        _ = await (rooms, timetable)
    }

    /// The Telegram groups and classmates when the list is in; the list itself when it is
    /// not — it brings them when it lands. A list already on its way is left to do that.
    private func loadClassPieces(_ session: Session) async {
        if classes.value != nil {
            async let telegram: Void = loadGroups(session)
            async let mates: Void = loadSelectedPeople(session, force: false)
            _ = await (telegram, mates)
        } else if !classes.isLoading {
            await loadClasses(session)
        }
    }

    private func loadScheduleIfOpened(_ session: Session) async {
        if classesOpened { await loadSchedule(session) }
    }

    /// Three weeks ahead from today — the web's window. Enough for every class's next lesson.
    func loadSchedule(_ session: Session) async {
        let api = session.student
        let today = Calendar.current.startOfDay(for: Date())
        let until = Calendar.current.date(byAdding: .day, value: 21, to: today) ?? today
        await run(\.schedule) { try await api.schedule(from: today, to: until) }
    }

    func loadGroups(_ session: Session) async {
        guard let rooms = memberClasses, !rooms.isEmpty else { return }
        let api = ClassroomTelegramAPI(client: session.client)
        await withTaskGroup(of: (Int, TelegramGroupState?).self) { group in
            for room in rooms {
                group.addTask { (room.id, try? await api.state(classroomId: room.id)) }
            }
            for await (id, state) in group {
                if let state { groups[id] = state }
            }
        }
    }

    func loadGroup(_ classroomId: Int, session: Session) async {
        if let state = try? await ClassroomTelegramAPI(client: session.client).state(classroomId: classroomId) {
            groups[classroomId] = state
        }
    }

    /// "Classmates" on a card: that class, its list loaded if it is not already.
    func select(_ classroomId: Int, session: Session) async {
        selectedClassId = classroomId
        await loadSelectedPeople(session, force: false)
    }

    func loadSelectedPeople(_ session: Session, force: Bool) async {
        guard let room = selectedClass else { return }
        var load = people[room.id] ?? ProfileLoad()
        guard force || (load.value == nil && !load.isLoading) else { return }
        load.isLoading = true
        people[room.id] = load
        let api = session.classrooms
        do {
            let rows = try await api.people(classroomId: room.id)
            load.value = rows
            load.failed = false
        } catch {
            load.failed = true
        }
        load.isLoading = false
        people[room.id] = load
    }

    // MARK: - Saving the goal

    /// The same save Home makes, through the same call. Never retried on its own.
    func saveGoal(english: Int, math: Int, session: Session) async -> Bool {
        guard !isSavingGoal else { return false }
        isSavingGoal = true
        defer { isSavingGoal = false }
        do {
            savedUser = try await session.student.updateProfile(targetEnglish: english, targetMath: math)
            Task { await session.refreshUser() }
            return true
        } catch {
            return false
        }
    }

    /// `nil` is "Not decided yet" — a real choice, sent as a clear.
    func saveExamDate(_ date: String?, session: Session) async -> Bool {
        guard !isSavingExamDate else { return false }
        isSavingExamDate = true
        defer { isSavingExamDate = false }
        do {
            savedUser = try await session.student.updateProfile(satExamDate: .some(date))
            Task { await session.refreshUser() }
            return true
        } catch {
            return false
        }
    }

    // MARK: - Plumbing

    /// Load one panel through its key path. A second call while one is out is dropped — the
    /// page appearing twice must not send everything twice.
    private func run<Value: Sendable>(
        _ path: ReferenceWritableKeyPath<ProfileModel, ProfileLoad<Value>>,
        _ fetch: @Sendable () async throws -> Value
    ) async {
        guard !self[keyPath: path].isLoading else { return }
        self[keyPath: path].isLoading = true
        do {
            let value = try await fetch()
            self[keyPath: path].value = value
            self[keyPath: path].failed = false
        } catch {
            self[keyPath: path].failed = true
        }
        self[keyPath: path].isLoading = false
    }
}

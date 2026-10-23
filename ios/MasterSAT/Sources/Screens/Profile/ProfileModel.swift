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

/// The Me sheet's state: every panel's data, read side by side and failing on its own — the
/// web's `/profile`, where each tab's data is its own request with its own failure.
///
/// Overview reads `/users/me/` (the phone and Telegram, for the hero and the checklist),
/// `/users/telegram/config/`, `/rewards/me/`, `/classes/my-assignments/`, `/exams/attempts/`,
/// `/users/exam-dates/` and `/midterms/mine/`; the Classes tab's count needs `/classes/`. The
/// rest of the Classes tab — the timetable, each class's Telegram group, the classmates — waits
/// until the tab is first opened, as on the web. It also re-reads the session's own copy of the
/// account, which the goal and the date are drawn from.
///
/// `ProfileLoad.isLoading` stays unused for the slots read through `run`, as in `ExploreModel`:
/// no panel draws it, and a write nobody reads would redraw the page for nothing. Which reads
/// are out is kept aside. The classmates keep theirs: a class's list is asked for once.
@MainActor
@Observable
final class ProfileModel {
    // Overview
    private(set) var account = ProfileLoad<AccountProfile>()
    /// Nil until known, and on failure — the web treats a failed lookup as "no Telegram
    /// sign-in here", which only hides the checklist's Telegram step.
    private(set) var telegramSignIn: TelegramSignInConfig?
    private(set) var rewards = ProfileLoad<MyRewards>()
    private(set) var homework = ProfileLoad<[AssignmentListing]>()
    private(set) var attempts = ProfileLoad<[ProfileAttempt]>()
    private(set) var examDates = ProfileLoad<[ExamDateOption]>()
    private(set) var midterms = ProfileLoad<[MidtermListing]>()
    /// What the centre marked each shown sitting, by attempt. The list carries no pass mark,
    /// so it is read from each sitting's report; a sitting missing here simply shows no
    /// "Passed" — the panel never says "not passed", so an unknown claims nothing.
    private(set) var passed: [Int: Bool] = [:]
    /// The first round of those reports has answered (or there was nothing to ask). Until then
    /// the Midterms panel holds its skeleton, so a "Passed" never pops in after the rows.
    private(set) var verdictsSettled = false

    // Classes
    private(set) var classes = ProfileLoad<[Classroom]>()
    private(set) var schedule = ProfileLoad<[ScheduleEvent]>()
    private(set) var people: [Int: ProfileLoad<[ClassroomMember]>] = [:]
    /// Each class's Telegram group, where the lookup answered. A class missing here falls
    /// back to its static link — `TelegramGroupButton.resolve` — which still works.
    private(set) var groups: [Int: TelegramGroupState] = [:]
    private(set) var selectedClassId: Int?

    /// A goal or date saved here, until the session's own copy of the account catches up.
    var savedUser: CurrentUser?
    private(set) var isSavingGoal = false
    private(set) var isSavingExamDate = false

    @ObservationIgnored private var hasAppeared = false
    @ObservationIgnored private var classesOpened = false
    @ObservationIgnored private var inFlight: Set<AnyKeyPath> = []
    @ObservationIgnored private var askingPassed: Set<Int> = []

    /// The sittings the Midterms panel shows, newest first.
    var shownMidterms: [MidtermListing] { MidtermResults.latest(midterms.value ?? []) }

    /// The classes the student holds a seat in.
    var memberClasses: [Classroom]? { classes.value.map(ProfileClasses.memberships) }

    var selectedClass: Classroom? {
        guard let list = memberClasses else { return nil }
        return list.first { $0.id == selectedClassId } ?? list.first
    }

    /// One of the student's classes, from the list already in hand — the class page opens on
    /// it at once instead of reading it again.
    func memberClass(_ id: Int) -> Classroom? {
        memberClasses?.first { $0.id == id }
    }

    // MARK: - Loading

    /// Everything the first time the page appears; after that — coming back from a page it
    /// opened — only what those pages change: the account (Account, Sign-in & password), the
    /// session's copy of it, the rewards (the shop, the points page) and the homework. Pull to
    /// refresh reloads the lot.
    func appeared(_ session: Session) async {
        if hasAppeared {
            async let identity: Void = session.refreshUser()
            async let details: Void = loadAccount(session)
            async let wallet: Void = loadRewards(session)
            async let work: Void = loadHomework(session)
            _ = await (identity, details, wallet, work)
        } else {
            hasAppeared = true
            await refreshAll(session)
        }
    }

    /// Also re-reads the session's own copy of the account: the goal and the date on this page
    /// are read from it, and Today saves them without touching it — so a goal changed there
    /// would otherwise show here as the old one.
    func refreshAll(_ session: Session) async {
        async let identity: Void = session.refreshUser()
        async let details: Void = loadAccount(session)
        async let signIn: Void = loadTelegramSignIn(session)
        async let wallet: Void = loadRewards(session)
        async let work: Void = loadHomework(session)
        async let results: Void = loadAttempts(session)
        async let dates: Void = loadExamDates(session)
        async let papers: Void = loadMidterms(session)
        async let rooms: Void = loadClasses(session, refreshing: true)
        async let timetable: Void = loadScheduleIfOpened(session)
        _ = await (identity, details, signIn, wallet, work, results, dates, papers, rooms, timetable)
    }

    func loadAccount(_ session: Session) async {
        let api = AccountAPI(client: session.client)
        await run(\.account) { try await api.profile() }
    }

    func loadTelegramSignIn(_ session: Session) async {
        let api = AccountAPI(client: session.client)
        let request = Task { try await api.telegramConfig() }
        if let config = try? await request.value, telegramSignIn != config { telegramSignIn = config }
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

    /// The list `MidtermsView` reads, then the verdict of each sitting it shows.
    func loadMidterms(_ session: Session) async {
        let api = session.student
        await run(\.midterms) { try await api.midterms() }
        await loadVerdicts(session)
    }

    /// Each shown sitting's report, once per sheet: only its `passed` is wanted. A report the
    /// server will not give — sealed, or a sitting scored before per-question results were
    /// kept — is an answer too ("no mark to show"); a failed read is asked again the next time
    /// the list loads. At most three, side by side, so the skeleton they hold is short.
    private func loadVerdicts(_ session: Session) async {
        let shown = shownMidterms.compactMap(\.attemptId)
        let ids = shown.filter { passed[$0] == nil && !askingPassed.contains($0) }
        if !ids.isEmpty {
            askingPassed.formUnion(ids)
            let api = session.results
            await withTaskGroup(of: (Int, Bool?).self) { group in
                for id in ids {
                    group.addTask {
                        let request = Task { try await api.midtermErrorReport(attemptId: id) }
                        do {
                            return (id, try await request.value.markedPassed)
                        } catch APIError.forbidden, APIError.conflict {
                            return (id, false)
                        } catch {
                            return (id, nil)
                        }
                    }
                }
                for await (id, verdict) in group {
                    askingPassed.remove(id)
                    if let verdict, passed[id] != verdict { passed[id] = verdict }
                }
            }
        }
        // Not while another round is still asking about a shown sitting: that round settles it.
        if midterms.value != nil, !verdictsSettled, askingPassed.isDisjoint(with: shown) {
            verdictsSettled = true
        }
    }

    /// The class list. Once the Classes tab has been opened, a list that lands brings the
    /// tab's pieces that hang off it — each class's Telegram group, the chosen class's
    /// classmates — so opening the tab before the list arrives loses nothing.
    func loadClasses(_ session: Session, refreshing: Bool = false) async {
        let api = session.classrooms
        await run(\.classes) { try await api.classrooms() }
        let ids = memberClasses?.map(\.id) ?? []
        if selectedClassId.map({ !ids.contains($0) }) ?? true, selectedClassId != ids.first {
            selectedClassId = ids.first
        }
        guard classesOpened, classes.value != nil else { return }
        async let telegram: Void = loadGroups(session)
        async let mates: Void = loadSelectedPeople(session, force: refreshing)
        _ = await (telegram, mates)
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
        } else if !inFlight.contains(\ProfileModel.classes) {
            await loadClasses(session)
        }
    }

    private func loadScheduleIfOpened(_ session: Session) async {
        if classesOpened { await loadSchedule(session) }
    }

    /// Three weeks ahead — the web's window, enough for every class's next lesson. The endpoint
    /// reads its dates on the phone's calendar and the cards read Tashkent's: a day back keeps
    /// today's lesson in the window on a phone that is already into tomorrow (the Class tab's
    /// rule).
    func loadSchedule(_ session: Session) async {
        let api = session.student
        let now = Date.now
        let start = now.addingTimeInterval(-86_400)
        let end = Calendar.current.date(byAdding: .day, value: 21, to: now) ?? now
        await run(\.schedule) { try await api.schedule(from: start, to: end) }
    }

    func loadGroups(_ session: Session) async {
        guard let rooms = memberClasses, !rooms.isEmpty else { return }
        let api = ClassroomTelegramAPI(client: session.client)
        await withTaskGroup(of: (Int, TelegramGroupState?).self) { group in
            for room in rooms {
                group.addTask {
                    let request = Task { try await api.state(classroomId: room.id) }
                    return (room.id, try? await request.value)
                }
            }
            for await (id, state) in group {
                if let state { setGroup(state, for: id) }
            }
        }
    }

    func loadGroup(_ classroomId: Int, session: Session) async {
        let api = ClassroomTelegramAPI(client: session.client)
        let request = Task { try await api.state(classroomId: classroomId) }
        if let state = try? await request.value { setGroup(state, for: classroomId) }
    }

    /// What the Telegram sheet learnt about a class's group, or a lookup's answer.
    func setGroup(_ state: TelegramGroupState, for classroomId: Int) {
        if groups[classroomId] != state { groups[classroomId] = state }
    }

    /// "Classmates" on a card: that class, its list loaded if it is not already.
    func select(_ classroomId: Int, session: Session) async {
        if selectedClassId != classroomId { selectedClassId = classroomId }
        await loadSelectedPeople(session, force: false)
    }

    /// Run on its own task like every other read, and stored whatever becomes of the caller —
    /// the request's own error is a real one.
    func loadSelectedPeople(_ session: Session, force: Bool) async {
        guard let room = selectedClass else { return }
        let id = room.id
        var load = people[id] ?? ProfileLoad()
        guard !load.isLoading, force || load.value == nil else { return }
        load.isLoading = true
        people[id] = load
        let api = session.classrooms
        let request = Task { try await api.people(classroomId: id) }
        do {
            let rows = try await request.value
            load.value = rows
            load.failed = false
        } catch {
            load.failed = true
        }
        load.isLoading = false
        people[id] = load
    }

    // MARK: - Saving the goal

    /// The same save Today makes, through the same call. Never retried on its own.
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

    /// The session caught up with a save made here (or with an edit made elsewhere).
    func sessionCaughtUp() {
        if savedUser != nil { savedUser = nil }
    }

    // MARK: - Plumbing

    /// One panel's read, finished whatever becomes of the task that asked: a push or a pull can
    /// cancel that task mid-request, and `APIClient` words a cancellation as a transport
    /// failure. The request runs on its own task, which nothing cancels, so whatever it throws
    /// is the request's own answer and is stored — a failure dropped because the caller had
    /// gone would leave a first load on its skeleton for good. A second call while one is out
    /// is dropped: the page appearing twice must not send everything twice.
    ///
    /// Every write is guarded: each one notifies the page whether or not the value changed.
    private func run<Value: Equatable & Sendable>(
        _ slot: ReferenceWritableKeyPath<ProfileModel, ProfileLoad<Value>>,
        _ fetch: @escaping @Sendable () async throws -> Value
    ) async {
        guard !inFlight.contains(slot) else { return }
        inFlight.insert(slot)
        defer { inFlight.remove(slot) }
        let request = Task { try await fetch() }
        do {
            let value = try await request.value
            if self[keyPath: slot].value != value { self[keyPath: slot].value = value }
            if self[keyPath: slot].failed { self[keyPath: slot].failed = false }
        } catch {
            if !self[keyPath: slot].failed { self[keyPath: slot].failed = true }
        }
    }
}

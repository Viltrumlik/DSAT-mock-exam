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

/// The Me sheet's state: what its panels show, each read side by side and failing on its own.
///
/// It reads `/users/me/` (the phone and Telegram, for the hero and the checklist),
/// `/users/telegram/config/`, `/exams/attempts/` and `/users/exam-dates/` (Your goal), and
/// `/midterms/mine/` (Midterms & certificates) — and re-reads the session's own copy of the
/// account, which the goal and the date are drawn from.
///
/// `ProfileLoad.isLoading` stays unused here, as in `ExploreModel`: no panel draws it, and a
/// write nobody reads would redraw the page for nothing. Which reads are out is kept aside.
@MainActor
@Observable
final class ProfileModel {
    private(set) var account = ProfileLoad<AccountProfile>()
    /// Nil until known, and on failure — the web treats a failed lookup as "no Telegram
    /// sign-in here", which only hides the checklist's Telegram step.
    private(set) var telegramSignIn: TelegramSignInConfig?
    private(set) var attempts = ProfileLoad<[ProfileAttempt]>()
    private(set) var examDates = ProfileLoad<[ExamDateOption]>()
    private(set) var midterms = ProfileLoad<[MidtermListing]>()
    /// What the centre marked each shown sitting, by attempt. The list carries no pass mark,
    /// so it is read from each sitting's report; a sitting missing here simply shows no
    /// "Passed" — the panel never says "not passed", so an unknown claims nothing.
    private(set) var passed: [Int: Bool] = [:]

    /// A goal or date saved here, until the session's own copy of the account catches up.
    var savedUser: CurrentUser?
    private(set) var isSavingGoal = false
    private(set) var isSavingExamDate = false

    @ObservationIgnored private var hasAppeared = false
    @ObservationIgnored private var inFlight: Set<AnyKeyPath> = []
    @ObservationIgnored private var askingPassed: Set<Int> = []

    /// The sittings the Midterms panel shows, newest first.
    var shownMidterms: [MidtermListing] { MidtermResults.latest(midterms.value ?? []) }

    // MARK: - Loading

    /// Everything the first time the page appears; after that — coming back from a page it
    /// opened — only what those pages change: the account (Account, Sign-in & password) and
    /// the session's copy of it. Pull to refresh reloads the lot.
    func appeared(_ session: Session) async {
        if hasAppeared {
            async let identity: Void = session.refreshUser()
            async let details: Void = loadAccount(session)
            _ = await (identity, details)
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
        async let results: Void = loadAttempts(session)
        async let dates: Void = loadExamDates(session)
        async let papers: Void = loadMidterms(session)
        _ = await (identity, details, signIn, results, dates, papers)
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
    /// kept — is an answer too ("no mark to show"); a failed or cancelled read is asked again
    /// the next time the list loads.
    private func loadVerdicts(_ session: Session) async {
        let ids = shownMidterms.compactMap(\.attemptId).filter { passed[$0] == nil && !askingPassed.contains($0) }
        guard !ids.isEmpty else { return }
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
    /// failure, which would be stored as one. A second call while one is out is dropped — the
    /// page appearing twice must not send everything twice.
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
            // A failure nobody is waiting for any more says nothing.
            guard !Task.isCancelled else { return }
            if !self[keyPath: slot].failed { self[keyPath: slot].failed = true }
        }
    }
}

import Foundation
import Observation

/// Drives one exam attempt: holds the student's work, keeps it saved, and moves the
/// attempt through its modules.
///
/// Everything time- or order-sensitive here is a port of the web runner's hooks, and the
/// reasoning is kept with it — these rules exist because of incidents, not preferences.
///
/// Lives on the main actor because SwiftUI reads it directly; the network work it starts
/// hops off and comes back.
@MainActor
@Observable
public final class ExamRunner {

    // MARK: - Published state

    public private(set) var attempt: Attempt?
    public private(set) var answers: [String: String] = [:]
    public private(set) var flagged: [Int] = []
    /// Crossed-out options, per question. Local only — the server neither stores nor
    /// grades them, they are a thinking aid.
    public private(set) var eliminated: [String: Set<String>] = [:]
    public private(set) var currentIndex: Int = 0
    public private(set) var isSubmitting = false
    public private(set) var lastError: APIError?
    /// Server's off-screen tally on a proctored sitting.
    public private(set) var offscreen: OffscreenTally?

    /// The module the in-memory answers belong to. Autosave refuses to write when this
    /// disagrees with the live module — `save_attempt` REPLACES the module's answer map,
    /// so a mismatched write destroys real work.
    public private(set) var answersModuleId: Int?

    // MARK: - Collaborators

    private let api: ExamAPI
    private let attemptId: Int
    private let drafts: DraftStoring
    private let policy: AutosavePolicy
    public let backend: ExamBackend

    // MARK: - Autosave bookkeeping

    /// Signature the server has actually accepted, per module. Anything else is unsent.
    private var acceptedSignature: (moduleId: Int, signature: String)?
    /// The answer MAP the server accepted — the baseline for "what is still unsent".
    private var acceptedAnswers: (moduleId: Int, answers: [String: String])?
    /// Answers as of the previous pass, used only until anything has been accepted.
    private var previousAnswers: (moduleId: Int, answers: [String: String])?
    /// When the oldest still-unsent answer change happened (the typing max-wait cap).
    private var dirtySince: Date?
    /// When the last save request was issued (the rate floor).
    private var lastIssuedAt: Date?
    private var saveTask: Task<Void, Never>?
    private var isSaveInFlight = false
    private var hydratedModuleId: Int?

    /// The app is foregrounded and this is the live attempt. False stands the autosave
    /// down completely.
    public var isEnabled: Bool = true
    public var isOnline: Bool = true

    public init(
        attemptId: Int,
        api: ExamAPI,
        backend: ExamBackend,
        drafts: DraftStoring = FileDraftStore(),
        policy: AutosavePolicy = AutosavePolicy()
    ) {
        self.attemptId = attemptId
        self.api = api
        self.backend = backend
        self.drafts = drafts
        self.policy = policy
    }

    // MARK: - Derived

    public var questions: [ExamQuestion] { attempt?.questions ?? [] }

    public var currentQuestion: ExamQuestion? {
        guard currentIndex >= 0, currentIndex < questions.count else { return nil }
        return questions[currentIndex]
    }

    public var clock: ExamClock? {
        guard let attempt else { return nil }
        return attempt.onBreak ? ExamClock.forBreak(attempt: attempt) : ExamClock(attempt: attempt)
    }

    public var answeredCount: Int {
        questions.filter { answers[String($0.id)]?.isEmpty == false }.count
    }

    // MARK: - Loading

    public func loadStatus() async {
        do {
            apply(try await api.status(attemptId: attemptId))
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    public func start() async {
        do {
            apply(try await api.start(attemptId: attemptId))
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    /// Proceed from the mock's break into Math.
    public func endBreak() async {
        guard backend.hasBreak else { return }
        do {
            apply(try await api.endBreak(attemptId: attemptId))
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    /// Adopt a server snapshot, subject to the forward-only merge rules.
    public func apply(_ snapshot: Attempt) {
        guard AttemptMerge.shouldAccept(previous: attempt, next: snapshot) else { return }
        attempt = snapshot
        rehydrateIfModuleChanged()
    }

    /// Rehydrate the student's work once per module id, and reset navigation so Module 1's
    /// position can never carry into Module 2.
    private func rehydrateIfModuleChanged() {
        guard let attempt, let moduleId = attempt.activeModuleId else { return }
        guard hydratedModuleId != moduleId else { return }
        hydratedModuleId = moduleId

        let merged = AnswerMerge.merge(
            serverAnswers: attempt.savedAnswers,
            serverFlagged: attempt.flaggedQuestions,
            serverVersion: attempt.versionNumber,
            draft: drafts.read(attemptId: attemptId, moduleId: moduleId)
        )
        answers = merged.answers
        flagged = merged.flagged
        eliminated = [:]
        currentIndex = 0
        answersModuleId = moduleId

        // A fresh module has nothing accepted yet; carrying the previous module's baseline
        // would make the first real answer look already-sent.
        acceptedSignature = nil
        acceptedAnswers = nil
        previousAnswers = nil
        dirtySince = nil
    }

    // MARK: - Student actions

    public func selectAnswer(questionId: Int, value: String) {
        answers[String(questionId)] = value
        scheduleSave()
    }

    public func clearAnswer(questionId: Int) {
        answers.removeValue(forKey: String(questionId))
        scheduleSave()
    }

    public func toggleFlag(questionId: Int) {
        if let index = flagged.firstIndex(of: questionId) {
            flagged.remove(at: index)
        } else {
            flagged.append(questionId)
        }
        scheduleSave()
    }

    public func toggleEliminate(questionId: Int, optionKey: String) {
        let key = String(questionId)
        // Eliminating the chosen option also deselects it — keeping both would show a
        // struck-through answer as still selected.
        if answers[key] == optionKey {
            answers.removeValue(forKey: key)
        }
        var current = eliminated[key] ?? []
        if current.contains(optionKey) { current.remove(optionKey) } else { current.insert(optionKey) }
        eliminated[key] = current
        scheduleSave()
    }

    public func goTo(_ index: Int) {
        currentIndex = max(0, min(index, max(0, questions.count - 1)))
    }

    public func next() { goTo(currentIndex + 1) }
    public func previous() { goTo(currentIndex - 1) }

    // MARK: - Autosave

    private func scheduleSave() {
        guard let attempt else { return }
        let liveModuleId = attempt.activeModuleId

        let signature = AutosavePayload.signature(answers: answers, flagged: flagged)
        let baseline = acceptedAnswers.flatMap { $0.moduleId == liveModuleId ? $0.answers : nil }
            ?? previousAnswers.flatMap { $0.moduleId == liveModuleId ? $0.answers : nil }
        let changed = baseline.map { AutosavePayload.changedAnswerIds(from: $0, to: answers) } ?? []
        if let liveModuleId { previousAnswers = (liveModuleId, answers) }

        let now = Date()
        if !changed.isEmpty, dirtySince == nil { dirtySince = now }

        let context = AutosavePolicy.Context(
            isEnabled: isEnabled,
            isAttemptActive: attempt.isActive,
            liveModuleId: liveModuleId,
            answersModuleId: answersModuleId,
            isSubmitting: isSubmitting,
            isOnline: isOnline,
            acceptedSignature: acceptedSignature.flatMap { $0.moduleId == liveModuleId ? $0.signature : nil },
            pendingSignature: signature,
            changedQuestionIds: changed,
            textInputQuestionIds: textInputQuestionIds(),
            dirtySince: dirtySince,
            lastIssuedAt: lastIssuedAt,
            now: now
        )

        let decision = policy.decide(context)

        if decision.shouldWriteDraft, let liveModuleId {
            // Synchronous, before anything else can fail: this is the copy that survives
            // the app being killed.
            drafts.write(
                attemptId: attemptId,
                draft: ExamDraft(
                    answers: answers,
                    flagged: flagged,
                    version: attempt.versionNumber,
                    moduleId: liveModuleId
                )
            )
        }

        guard case .send(let delay) = decision.action, let liveModuleId else { return }

        saveTask?.cancel()
        let payload = (answers: answers, flagged: flagged, signature: signature)
        saveTask = Task { [weak self] in
            await self?.flush(after: delay, moduleId: liveModuleId, payload: payload, retry: 0)
        }
    }

    private func flush(
        after delay: TimeInterval,
        moduleId: Int,
        payload: (answers: [String: String], flagged: [Int], signature: String),
        retry: Int
    ) async {
        if delay > 0 {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        if Task.isCancelled { return }

        // An earlier save is still open. Re-arm rather than return: returning would abandon
        // this change and nothing else would carry it — the next attempt only happens on
        // another edit, which is not guaranteed once the student stops typing. This is also
        // what coalesces a burst: whichever payload wins the re-arm is the newest one, and
        // it is a superset of the ones behind it.
        if isSaveInFlight {
            await flush(after: AutosavePolicy.inFlightRetryDelay, moduleId: moduleId, payload: payload, retry: retry)
            return
        }

        guard let version = attempt?.versionNumber else { return }
        isSaveInFlight = true
        lastIssuedAt = Date()
        dirtySince = nil
        defer { isSaveInFlight = false }

        do {
            let snapshot = try await api.saveAttempt(
                attemptId: attemptId,
                answers: payload.answers,
                flagged: payload.flagged,
                expectedVersion: version,
                idempotencyKey: IdempotencyKeys.save(attemptId: attemptId, moduleId: moduleId, version: version)
            )
            // Record acceptance BEFORE applying the snapshot, which re-renders.
            acceptedSignature = (moduleId, payload.signature)
            acceptedAnswers = (moduleId, payload.answers)
            apply(snapshot)
            // The draft is deliberately NOT cleared. This callback cannot know it is still
            // current — the student may have answered again while the request was open, in
            // which case the draft holds work this payload never carried, and clearing it
            // destroys the only copy. A stale draft can only fill gaps the server is
            // missing, never override newer server answers. `submitModule` clears it once
            // the module is genuinely finished.
        } catch APIError.versionConflict(let canonical) {
            // A hard 409 wrote nothing and carries the authoritative attempt. Adopt it
            // rather than retrying blind: a background flush bumps the version without this
            // closure ever seeing it, so re-sending the same captured version can only 409
            // again — the "409 burst" seen in production.
            if let canonical {
                apply(canonical)
                // Re-arm against the fresh version so these answers still reach the server.
                scheduleSave()
            }
        } catch let error as APIError {
            lastError = error
            // The draft still holds the work and the payload stays unsent, so a later edit
            // re-arms this. Retry only what retrying can fix.
            if error.isRetryable, retry < AutosavePolicy.maxRetries {
                let backoff = pow(2.0, Double(retry + 1))
                await flush(after: backoff, moduleId: moduleId, payload: payload, retry: retry + 1)
            }
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    /// Fire-and-forget flush for a leaving app (backgrounded, or about to be killed).
    ///
    /// `background: true` tells the server this comes from a client that is NOT looking at
    /// the exam, so it may persist answers but must never advance the attempt — opening
    /// the next module would start its 32-minute clock on a screen nobody is watching.
    ///
    /// Deliberately sends no `expected_version_number`: a fire-and-forget request can
    /// neither observe a 409 nor retry one, so pinning a version turns any concurrent
    /// autosave into a silently discarded flush.
    public func flushOnLeaving() async {
        guard let attempt, attempt.isActive, let moduleId = attempt.activeModuleId,
              answersModuleId == moduleId else { return }
        drafts.write(
            attemptId: attemptId,
            draft: ExamDraft(answers: answers, flagged: flagged, version: attempt.versionNumber, moduleId: moduleId)
        )
        _ = try? await api.saveAttempt(
            attemptId: attemptId,
            answers: answers,
            flagged: flagged,
            expectedVersion: nil,
            isBackground: true
        )
    }

    private func textInputQuestionIds() -> Set<String> {
        Set(questions.filter(\.isMathInput).map { String($0.id) })
    }

    // MARK: - Submitting

    /// Submit the active module and advance.
    public func submitModule() async {
        guard let attempt, attempt.isActive, let moduleId = attempt.activeModuleId, !isSubmitting else { return }

        isSubmitting = true
        // Submit owns the answers from here. Cancelling the pending autosave is not just
        // tidiness: an unversioned save racing the real submit is the exact shape of the
        // "Module 2 skip" incident. The work is carried anyway — every answer was saved as
        // it was given, the submit payload holds the map, and the draft survives a crash.
        saveTask?.cancel()
        defer { isSubmitting = false }

        let version = attempt.versionNumber
        do {
            let snapshot = try await api.submitModule(
                attemptId: attemptId,
                moduleId: moduleId,
                answers: answers,
                flagged: flagged,
                expectedVersion: version,
                idempotencyKey: IdempotencyKeys.submit(attemptId: attemptId, moduleId: moduleId, version: version)
            )
            // The module is genuinely finished, so its draft has nothing left to protect.
            drafts.clear(attemptId: attemptId, moduleId: moduleId)
            apply(snapshot)
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    // MARK: - Proctoring

    /// Report that the student left the exam, and adopt what it cost them.
    ///
    /// Called when the app is backgrounded or the screen is obscured during a proctored
    /// sitting. The client never decides the consequence — the server owns the tally,
    /// because a local count is cleared by relaunching the app, which is exactly what a
    /// student gaming the rule would do.
    public func reportOffscreen(eventId: UUID = UUID()) async {
        guard attempt?.isProctored == true else { return }
        do {
            let tally = try await api.reportOffscreen(
                attemptId: attemptId,
                idempotencyKey: IdempotencyKeys.offscreen(attemptId: attemptId, eventId: eventId)
            )
            offscreen = tally
            if let updated = tally.attempt { apply(updated) }
        } catch {
            // A failed report must not block the student or crash the runner; the sitting
            // continues and the server reconciles on the next snapshot.
        }
    }

    // MARK: - Polling

    /// Poll the server while the attempt is live.
    ///
    /// The clock is server-authoritative, so this is also what corrects any local drift —
    /// and what notices that the module was closed by the deadline while the student was
    /// still looking at a question.
    public func poll(every interval: Duration = .seconds(15)) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: interval)
            if Task.isCancelled { return }
            guard let attempt, !attempt.isFinished else { return }
            await loadStatus()
        }
    }
}

import Foundation
import Observation

/// Drives one assessment attempt.
///
/// Unlike the exam runner this saves per answer rather than per module, because that is
/// what the endpoint takes: `/attempts/answer/` writes ONE question. That makes the
/// failure mode different too — there is no "the module's answers were replaced by a stale
/// map" here, only "this one answer did not land" — so the safety comes from `client_seq`
/// and from retrying the specific questions that failed, not from a signature over the
/// whole set.
@MainActor
@Observable
public final class AssessmentRunner {

    // MARK: - Published state

    public private(set) var bundle: AssessmentBundle?
    public private(set) var answers: [Int: JSONValue] = [:]
    public private(set) var flagged: Set<Int> = []
    public private(set) var currentIndex: Int = 0
    public private(set) var isSubmitting = false
    public private(set) var isLoading = true
    public private(set) var lastError: APIError?
    /// Questions whose last write failed. They are retried on the next flush, and the UI
    /// can say so rather than pretending everything is saved.
    public private(set) var unsaved: Set<Int> = []

    public var questions: [AssessmentQuestion] { bundle?.orderedQuestions ?? [] }

    public var currentQuestion: AssessmentQuestion? {
        questions.indices.contains(currentIndex) ? questions[currentIndex] : nil
    }

    public var answeredCount: Int {
        questions.reduce(0) { count, q in
            count + ((answers[q.id].map { !$0.isEmpty } ?? false) ? 1 : 0)
        }
    }

    public var isComplete: Bool { !questions.isEmpty && answeredCount == questions.count }

    // MARK: - Collaborators

    private let api: AssessmentAPI
    private let attemptId: Int

    /// Monotonic per question. The server keeps the highest it has seen, so a reply that
    /// arrives out of order cannot overwrite a newer answer.
    private var seq: [Int: Int] = [:]
    private var nextSeq = 1
    private var saveTasks: [Int: Task<Void, Never>] = [:]

    /// Typing coalesces; picking a choice does not.
    ///
    /// Same reasoning as the exam runner's delay table: a tapped choice is a complete
    /// thought and goes immediately, while a number being typed would otherwise cost one
    /// request per keystroke. The cap matters because a student who types an answer and
    /// immediately hits submit must not lose the last keystrokes.
    private let typingDelay: Duration = .milliseconds(400)

    public init(attemptId: Int, api: AssessmentAPI) {
        self.attemptId = attemptId
        self.api = api
    }

    // MARK: - Lifecycle

    public func load() async {
        isLoading = true
        lastError = nil
        do {
            let loaded = try await api.bundle(attemptId: attemptId)
            bundle = loaded
            // The server's own record of the answers is the source of truth on open: a
            // student may have answered on another device, or on the web.
            for a in loaded.attempt.answers where !a.answer.isEmpty {
                answers[a.questionId] = a.answer
                seq[a.questionId] = a.clientSeq
                nextSeq = max(nextSeq, a.clientSeq + 1)
            }
            currentIndex = min(
                max(loaded.attempt.currentQuestionIndex, 0),
                max(loaded.orderedQuestions.count - 1, 0)
            )
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
        isLoading = false
    }

    // MARK: - Answering

    /// Record an answer locally and schedule the write.
    ///
    /// `immediate` is for a tapped choice; typed input passes false so the keystrokes
    /// coalesce.
    public func setAnswer(_ value: JSONValue, for questionId: Int, immediate: Bool = true) {
        answers[questionId] = value
        saveTasks[questionId]?.cancel()
        saveTasks[questionId] = Task { [weak self] in
            guard let self else { return }
            if !immediate {
                try? await Task.sleep(for: self.typingDelay)
                if Task.isCancelled { return }
            }
            await self.push(questionId: questionId)
        }
    }

    public func toggleFlag(_ questionId: Int) {
        if flagged.contains(questionId) { flagged.remove(questionId) } else { flagged.insert(questionId) }
    }

    public func go(to index: Int) {
        guard questions.indices.contains(index) else { return }
        currentIndex = index
    }

    public func next() { go(to: currentIndex + 1) }
    public func previous() { go(to: currentIndex - 1) }

    private func push(questionId: Int) async {
        guard let value = answers[questionId] else { return }
        let mySeq = nextSeq
        nextSeq += 1
        seq[questionId] = mySeq
        do {
            try await api.answer(
                attemptId: attemptId,
                questionId: questionId,
                answer: value,
                clientSeq: mySeq,
                currentIndex: currentIndex
            )
            unsaved.remove(questionId)
        } catch let error as APIError {
            unsaved.insert(questionId)
            lastError = error
        } catch {
            unsaved.insert(questionId)
        }
    }

    /// Write everything still pending and wait for it.
    ///
    /// Called before submitting and when the app leaves the foreground. iOS can kill a
    /// backgrounded app without warning, so "I'll send it when we come back" is not a
    /// plan the student can rely on.
    public func flush() async {
        for (_, task) in saveTasks { task.cancel() }
        saveTasks.removeAll()
        let pending = Set(answers.keys).union(unsaved)
        for id in pending.sorted() {
            await push(questionId: id)
        }
    }

    public func submit() async -> Bool {
        guard !isSubmitting else { return false }
        isSubmitting = true
        lastError = nil
        defer { isSubmitting = false }
        // Flush FIRST. A submit that races an unsent answer grades work the student did
        // but the server never saw.
        await flush()
        do {
            try await api.submit(attemptId: attemptId)
            return true
        } catch let error as APIError {
            lastError = error
            return false
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
            return false
        }
    }

    public func pauseForLeaving() async {
        await flush()
        // Best effort: the pause endpoint stops the clock, but a failure here costs the
        // student some counted time, not their answers, so it never surfaces as an error.
        try? await api.pause(attemptId: attemptId)
    }

    public func resume() async {
        do {
            try await api.resume(attemptId: attemptId)
        } catch let error as APIError {
            lastError = error
        } catch {}
    }
}

import Foundation
import Observation

/// Drives one vocabulary study run and banks its answers.
///
/// The rule that matters here is the same one the exam runner lives by, in miniature: work
/// the student has done must survive them walking away. A run flushed as `partial` records
/// its answers without marking the set complete, so 20 of 25 cards still count.
///
/// Two more rules came with per-game mastery:
///
/// - **A run is bound to the homework it was launched from.** `assignmentId` goes out with
///   the start call and nowhere else; without it the server guesses, and a set on two
///   homeworks banks every run against one of them.
/// - **Completing is a latch.** The finishing call is the only one that can master a game,
///   so it must go out exactly once and must not be lost to a partial flush that happened to
///   be in flight — flushes queue behind each other rather than skipping.
@MainActor
@Observable
public final class VocabStudyRunner {

    public let mode: VocabStudyMode
    /// The homework this run belongs to; nil for self-study.
    public let assignmentId: Int?
    public private(set) var words: [VocabWord]
    public private(set) var index: Int = 0
    /// Answers not yet sent. The server APPENDS, so a flush must send only what is new —
    /// re-sending banked answers would double-count them.
    public private(set) var pending: [VocabResult] = []
    public private(set) var correctCount = 0
    public private(set) var answeredCount = 0
    public private(set) var summary: VocabSessionSummary?
    /// The most recent call's failure; cleared by the next success.
    public private(set) var lastError: APIError?
    /// Why the server would not open this run — the 400 "That homework is not assigned to
    /// you for this set.", or no network. Nothing played without a session can ever be
    /// credited, so a mode does not deal a card while this stands.
    public private(set) var startError: APIError?
    /// The finishing call failed. The answers are still held; `complete()` sends them again.
    public private(set) var saveError: APIError?
    public private(set) var isStarting = false
    /// The finishing call is in flight — "Saving your progress…".
    public private(set) var isCompleting = false
    public private(set) var isFinished = false
    /// The round is over and the finishing call owns the session from here.
    public private(set) var completionRequested = false

    private let api: StudentAPI
    private let setId: Int
    private var sessionId: Int?
    private var startedAt: Date?
    /// The flush in flight. Each new flush waits for it, so two sends can never carry the
    /// same pending tail and a completing call is never skipped because a partial one was
    /// still on the wire.
    private var inFlight: Task<Void, Never>?

    public init(
        mode: VocabStudyMode,
        words: [VocabWord],
        setId: Int,
        assignmentId: Int? = nil,
        api: StudentAPI
    ) {
        self.mode = mode
        self.words = words
        self.setId = setId
        self.assignmentId = assignmentId
        self.api = api
    }

    /// The server has a session row to grade against.
    public var isStarted: Bool { sessionId != nil }

    public var currentWord: VocabWord? {
        index >= 0 && index < words.count ? words[index] : nil
    }

    public var progress: Double {
        words.isEmpty ? 0 : Double(min(answeredCount, words.count)) / Double(words.count)
    }

    /// Open the run server-side. Safe to call again after a failure — that is the retry.
    public func begin() async {
        guard sessionId == nil, !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        startError = nil
        do {
            sessionId = try await api.startVocabularySession(
                setId: setId,
                mode: mode,
                assignmentId: assignmentId
            ).id
            // Timed from the server's acknowledgement, as the web does, so a slow start
            // does not inflate the student's time.
            startedAt = Date()
            lastError = nil
        } catch {
            let failure = Self.apiError(error)
            startError = failure
            lastError = failure
        }
        // A round that ended before the start landed is graded now rather than never.
        if sessionId != nil, completionRequested, !isFinished {
            await flush(isPartial: false)
        }
    }

    public func answer(correct: Bool) {
        guard let word = currentWord else { return }
        record(wordId: word.id, correct: correct)
        index += 1
    }

    /// Record one word's outcome without moving a cursor.
    ///
    /// Matching and Speed do not walk a queue — a pair is graded the moment it is found,
    /// and a speed prompt the moment it is tapped — so they report by word id and drive
    /// their own idea of "finished".
    public func record(wordId: Int, correct: Bool) {
        pending.append(VocabResult(wordId: wordId, correct: correct))
        answeredCount += 1
        if correct { correctCount += 1 }
    }

    /// Flashcards loop: a word the student missed comes back at the end of the queue.
    ///
    /// The answer is still recorded — getting it wrong then right is genuinely different
    /// from getting it right first time, and the server's progress model wants both.
    public func requeueCurrentWord() {
        guard let word = currentWord else { return }
        words.append(word)
    }

    /// Grade the run: the one call that marks the set completed and can master this game.
    ///
    /// Only the first request counts — a second waits for the first and then finds the run
    /// finished. After a failure it is also the retry: the answers were kept.
    public func complete() async {
        completionRequested = true
        await flush(isPartial: false)
    }

    /// Bank what has been answered.
    ///
    /// `isPartial` is the flush for walking away mid-run. Once the round is over, even the
    /// walking-away flush completes it: a finished round whose grading call failed must not
    /// be banked as unfinished just because the student left before retrying.
    public func flush(isPartial: Bool) async {
        let previous = inFlight
        let task = Task { [weak self] in
            await previous?.value
            await self?.send(completing: !isPartial)
        }
        inFlight = task
        await task.value
    }

    private func send(completing requested: Bool) async {
        guard let sessionId, !isFinished else { return }
        let completing = requested || completionRequested
        // Nothing new to send, and not the finishing call: stay quiet.
        if !completing && pending.isEmpty { return }

        let batch = pending
        let elapsed = Int(Date().timeIntervalSince(startedAt ?? Date()) * 1000)
        if completing { isCompleting = true }
        defer { if completing { isCompleting = false } }
        do {
            let result = try await api.finishVocabularySession(
                id: sessionId,
                results: batch,
                durationMs: max(0, elapsed),
                isPartial: !completing
            )
            // Clear only what was actually accepted — an answer given while the request was
            // open must not be dropped with it.
            pending.removeFirst(min(batch.count, pending.count))
            summary = result
            lastError = nil
            if completing {
                isFinished = true
                saveError = nil
            }
        } catch {
            let failure = Self.apiError(error)
            lastError = failure
            if completing { saveError = failure }
        }
    }

    public var isComplete: Bool { index >= words.count }

    private static func apiError(_ error: Error) -> APIError {
        (error as? APIError) ?? .transport(underlying: error.localizedDescription)
    }
}

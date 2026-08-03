import Foundation
import Observation

/// Drives one vocabulary study run and banks its answers.
///
/// The rule that matters here is the same one the exam runner lives by, in miniature: work
/// the student has done must survive them walking away. A run flushed as `partial` records
/// its answers without marking the set complete, so 20 of 25 cards still count.
@MainActor
@Observable
public final class VocabStudyRunner {

    public let mode: VocabStudyMode
    public private(set) var words: [VocabWord]
    public private(set) var index: Int = 0
    /// Answers not yet sent. The server APPENDS, so a flush must send only what is new —
    /// re-sending banked answers would double-count them.
    public private(set) var pending: [VocabResult] = []
    public private(set) var correctCount = 0
    public private(set) var answeredCount = 0
    public private(set) var summary: VocabSessionSummary?
    public private(set) var lastError: APIError?
    public private(set) var isFinished = false

    private let api: StudentAPI
    private let setId: Int
    private var sessionId: Int?
    private var startedAt: Date?
    private var isFlushing = false

    public init(mode: VocabStudyMode, words: [VocabWord], setId: Int, api: StudentAPI) {
        self.mode = mode
        self.words = words
        self.setId = setId
        self.api = api
    }

    public var currentWord: VocabWord? {
        index >= 0 && index < words.count ? words[index] : nil
    }

    public var progress: Double {
        words.isEmpty ? 0 : Double(min(answeredCount, words.count)) / Double(words.count)
    }

    /// Open the run server-side. Answers are kept locally until a flush, so a failure here
    /// is not fatal — the student can still study, they just will not be credited.
    public func begin() async {
        startedAt = Date()
        do {
            sessionId = try await api.startVocabularySession(setId: setId, mode: mode).id
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    public func answer(correct: Bool) {
        guard let word = currentWord else { return }
        pending.append(VocabResult(wordId: word.id, correct: correct))
        answeredCount += 1
        if correct { correctCount += 1 }
        index += 1
    }

    /// Flashcards loop: a word the student missed comes back at the end of the queue.
    ///
    /// The answer is still recorded — getting it wrong then right is genuinely different
    /// from getting it right first time, and the server's progress model wants both.
    public func requeueCurrentWord() {
        guard let word = currentWord else { return }
        words.append(word)
    }

    /// Bank what has been answered.
    ///
    /// `isPartial` is the flush for walking away mid-run. A completed run sends
    /// `isPartial: false`, which is what marks the set done.
    public func flush(isPartial: Bool) async {
        guard let sessionId, !isFlushing else { return }
        // Nothing new to send, and not the finishing call: stay quiet.
        if pending.isEmpty && isPartial { return }
        isFlushing = true
        defer { isFlushing = false }

        let batch = pending
        let elapsed = Int((Date().timeIntervalSince(startedAt ?? Date())) * 1000)
        do {
            let result = try await api.finishVocabularySession(
                id: sessionId,
                results: batch,
                durationMs: max(0, elapsed),
                isPartial: isPartial
            )
            // Clear only what was actually accepted — an answer given while the request was
            // open must not be dropped with it.
            pending.removeFirst(min(batch.count, pending.count))
            summary = result
            if !isPartial { isFinished = true }
        } catch let error as APIError {
            lastError = error
        } catch {
            lastError = .transport(underlying: error.localizedDescription)
        }
    }

    public var isComplete: Bool { index >= words.count }
}

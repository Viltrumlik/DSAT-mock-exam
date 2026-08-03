import Foundation
import Testing
@testable import MasterSATKit

/// Restoring work after a relaunch. The rule this replaced was "the server wins whenever it
/// has anything", and it threw away exactly the answers the draft exists to save: the ones
/// made inside the autosave window or during a save that never landed.
@Suite struct AnswerMergeTests {

    @Test("With no draft the server's answers stand")
    func noDraftKeepsServerAnswers() {
        let result = AnswerMerge.merge(
            serverAnswers: ["1": "A"], serverFlagged: [1], serverVersion: 5, draft: nil
        )
        #expect(result.answers == ["1": "A"])
        #expect(result.flagged == [1])
    }

    @Test("The draft fills in answers the server never received")
    func draftFillsGaps() {
        // The critical case: question 2 was answered and the save never landed. It exists
        // only on the device, and losing it here means it grades Omitted.
        let draft = ExamDraft(answers: ["1": "A", "2": "B"], flagged: [], version: 4, moduleId: 10)
        let result = AnswerMerge.merge(
            serverAnswers: ["1": "A"], serverFlagged: [], serverVersion: 5, draft: draft
        )
        #expect(result.answers == ["1": "A", "2": "B"])
    }

    @Test("A strictly newer server wins on conflicts but still takes the draft's extras")
    func newerServerWinsConflicts() {
        // The draft is based on version 4, the server is on 5: the server has since
        // accepted something this draft never saw, so it stays authoritative where they
        // disagree — while the draft still contributes what the server is missing.
        let draft = ExamDraft(answers: ["1": "OLD", "2": "ONLY_LOCAL"], flagged: [], version: 4, moduleId: 10)
        let result = AnswerMerge.merge(
            serverAnswers: ["1": "NEW"], serverFlagged: [], serverVersion: 5, draft: draft
        )
        #expect(result.answers["1"] == "NEW")
        #expect(result.answers["2"] == "ONLY_LOCAL")
    }

    @Test("A draft at the same version wins on conflicts")
    func sameVersionDraftWins() {
        // Same version means the draft is at least as fresh — it holds a change made after
        // that snapshot was taken.
        let draft = ExamDraft(answers: ["1": "LOCAL"], flagged: [], version: 5, moduleId: 10)
        let result = AnswerMerge.merge(
            serverAnswers: ["1": "SERVER"], serverFlagged: [], serverVersion: 5, draft: draft
        )
        #expect(result.answers["1"] == "LOCAL")
    }

    @Test("Unknown versions treat the draft as fresh")
    func unknownVersionsFavourDraft() {
        let draft = ExamDraft(answers: ["1": "LOCAL"], flagged: [], version: nil, moduleId: 10)
        let result = AnswerMerge.merge(
            serverAnswers: ["1": "SERVER"], serverFlagged: [], serverVersion: nil, draft: draft
        )
        #expect(result.answers["1"] == "LOCAL")
    }

    @Test("Flags are unioned")
    func flagsAreUnioned() {
        // Flags are advisory, so neither side's flags should vanish on a restore.
        let draft = ExamDraft(answers: [:], flagged: [2, 3], version: 5, moduleId: 10)
        let result = AnswerMerge.merge(
            serverAnswers: [:], serverFlagged: [1, 2], serverVersion: 5, draft: draft
        )
        #expect(result.flagged == [1, 2, 3])
    }
}

@Suite struct DraftStoreTests {

    @Test("A draft round-trips")
    func draftRoundTrips() {
        let store = InMemoryDraftStore()
        let draft = ExamDraft(answers: ["1": "A"], flagged: [1], version: 3, moduleId: 10)
        store.write(attemptId: 42, draft: draft)
        #expect(store.read(attemptId: 42, moduleId: 10) == draft)
    }

    @Test("Drafts are scoped by module")
    func draftsScopedByModule() {
        // Module 1 work must never bleed into Module 2 — a submit sends the whole map.
        let store = InMemoryDraftStore()
        store.write(attemptId: 42, draft: ExamDraft(answers: ["1": "A"], flagged: [], version: 3, moduleId: 10))
        #expect(store.read(attemptId: 42, moduleId: 11) == nil)
    }

    @Test("Drafts are scoped by attempt")
    func draftsScopedByAttempt() {
        let store = InMemoryDraftStore()
        store.write(attemptId: 42, draft: ExamDraft(answers: ["1": "A"], flagged: [], version: 3, moduleId: 10))
        #expect(store.read(attemptId: 43, moduleId: 10) == nil)
    }

    @Test("A file-backed draft survives a process restart")
    func fileDraftSurvivesRestart() throws {
        // The real crash-safety guarantee: iOS kills backgrounded apps without warning.
        let directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("drafts-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let draft = ExamDraft(answers: ["7": "C"], flagged: [7], version: 12, moduleId: 20)
        FileDraftStore(directory: directory).write(attemptId: 99, draft: draft)

        // A brand-new store instance stands in for the next launch.
        let reopened = FileDraftStore(directory: directory)
        #expect(reopened.read(attemptId: 99, moduleId: 20) == draft)
    }

    @Test("Clearing removes only the named module")
    func clearIsScoped() {
        let store = InMemoryDraftStore()
        store.write(attemptId: 1, draft: ExamDraft(answers: ["1": "A"], flagged: [], version: 1, moduleId: 10))
        store.write(attemptId: 1, draft: ExamDraft(answers: ["2": "B"], flagged: [], version: 1, moduleId: 11))
        store.clear(attemptId: 1, moduleId: 10)
        #expect(store.read(attemptId: 1, moduleId: 10) == nil)
        #expect(store.read(attemptId: 1, moduleId: 11) != nil)
    }
}

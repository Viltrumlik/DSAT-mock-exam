import Foundation

/// Reconciling the server's saved work with the local crash-safety draft.
/// Port of `mergeServerAndDraft` in `hooks/useAnswers.ts`.
public enum AnswerMerge {

    public struct Result: Sendable, Equatable {
        public let answers: [String: String]
        public let flagged: [Int]
    }

    /// Merge by recency.
    ///
    /// The draft is written synchronously on every change, so it can hold answers made
    /// inside the autosave delay window or during a save that never reached the server.
    /// Its stored `version` is the server version it was based on: when that is >= the
    /// server's current version (or either is unknown) the draft is at least as fresh and
    /// wins on conflicting questions. In every case the draft fills in answers the server
    /// is missing, so nothing pending is dropped — while a strictly newer server stays
    /// authoritative on conflicts.
    ///
    /// The rule this replaced was "server wins whenever it has anything", and it silently
    /// threw away exactly the answers this merge exists to save.
    public static func merge(
        serverAnswers: [String: String],
        serverFlagged: [Int],
        serverVersion: Int?,
        draft: ExamDraft?
    ) -> Result {
        guard let draft else {
            return Result(answers: serverAnswers, flagged: serverFlagged)
        }

        let draftAtLeastAsFresh: Bool
        if let draftVersion = draft.version, let serverVersion {
            draftAtLeastAsFresh = draftVersion >= serverVersion
        } else {
            draftAtLeastAsFresh = true
        }

        var answers = serverAnswers
        for (questionId, value) in draft.answers {
            if draftAtLeastAsFresh || serverAnswers[questionId] == nil {
                answers[questionId] = value
            }
        }

        // Flags are advisory — they do not affect grading — so union them rather than
        // letting either side's flags disappear on a restore.
        var flaggedSet = Set(serverFlagged)
        flaggedSet.formUnion(draft.flagged)

        return Result(answers: answers, flagged: flaggedSet.sorted())
    }
}

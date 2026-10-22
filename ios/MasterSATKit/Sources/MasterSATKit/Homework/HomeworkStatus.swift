import Foundation

/// The status the homework page's chip reads.
///
/// The server's `workflow_status` is a hand-in's status, and a homework of word sets is never
/// handed in — a word set is finished by playing it (`HomeworkProgress`). So for words the server
/// says "not started" for good, even after the student has finished every set, and the page tells
/// the truth from the sets themselves. Everything else is the server's word, which the client must
/// not recompute.
public enum HomeworkStatus {
    /// The one status the client names itself: every word set played to the end. Not the server's
    /// "submitted" — nothing was handed in.
    public static let completed = "completed"

    /// What to read the chip from: the submission's status, else the row's — except that a word
    /// homework the server still calls "not started" reads "in progress" once any set has been
    /// played, and "completed" once every set has.
    ///
    /// Only words speak for themselves. A quiz homework's status is its first quiz's, kept by the
    /// server and refreshed with the row; a hand-in's is the submission's. And a homework that also
    /// has a file to hand in or a paper to sit is never "completed" by its sets alone
    /// (`HomeworkProgress.isDone` knows the difference).
    public static func shown(for homework: AssignmentListing, submission: Submission?) -> String? {
        let reported = submission?.workflowStatus ?? homework.workflowStatus
        guard isNotStarted(reported), homework.assessmentHomeworks.isEmpty else { return reported }
        // A set with no words has nothing to play: it is never owed, and playing it proves nothing.
        let sets = homework.vocabHomeworks.filter { $0.wordCount > 0 }
        guard !sets.isEmpty else { return reported }
        if HomeworkProgress.isDone(homework) { return completed }
        if sets.contains(where: { $0.state.lowercased() != "not_started" }) { return "in_progress" }
        return reported
    }

    /// Work that is with the teacher already — or finished, for words — so its deadline is a date,
    /// not something to catch up on.
    public static func isWithTheTeacher(_ status: String?) -> Bool {
        let key = (status ?? "").lowercased()
        return key == completed || ProfileHomework.isTurnedIn(key)
    }

    private static func isNotStarted(_ status: String?) -> Bool {
        let key = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return key.isEmpty || key == "not_started"
    }
}

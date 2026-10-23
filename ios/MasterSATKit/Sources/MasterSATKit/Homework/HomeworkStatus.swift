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

    /// The other status the client names: a homework whose only pieces are word sets with no words
    /// yet — nothing to play, nothing to hand in, no paper. The lists file it under Done (it is never
    /// owed, `HomeworkProgress.isDone`), but "Completed" would be untrue (nothing was done) and "Not
    /// started" would contradict Done. Neutral: once the teacher fills a set, it is owed again.
    public static let nothingYet = "nothing_yet"

    /// What a quiz the server has just accepted raises its homework to, before any read says so.
    /// "Submitted" is the least that is true: a graded attempt is past it, and the server's own
    /// word replaces it the moment a read brings one.
    public static let handedIn = "submitted"

    /// What to read the chip from: the submission's status, else the row's — except that a word
    /// homework the server still calls "not started" reads "in progress" once any set has been
    /// played, "completed" once every set has, and "nothing yet" while its only sets are empty.
    ///
    /// Only words speak for themselves. A quiz homework's status is its first quiz's, kept by the
    /// server and refreshed with the row; a hand-in's is the submission's. And a homework that also
    /// has a file to hand in or a paper to sit is never "completed" by its sets alone
    /// (`HomeworkProgress.isDone` knows the difference).
    ///
    /// `floor` is a status the page has seen the server confirm — the hand-in of the quiz the status
    /// follows (`isStatusQuiz`) — which the row it holds has not caught up with. A row that is
    /// behind it reads as the floor, so the chip does not go back to "Not started" for the moments
    /// between a quiz closing and the next read landing. It never covers a word the server has
    /// already said (anything past "in progress", or a word it does not know), nor a submission's
    /// own status, and the page drops it once a read reaches it (`reached`).
    public static func shown(for homework: AssignmentListing, submission: Submission?, floor: String? = nil) -> String? {
        let said = submission?.workflowStatus
        let status = base(for: homework, reported: said ?? homework.workflowStatus)
        guard let floor, said == nil, rank(status) < rank(floor) else { return status }
        return floor
    }

    /// Whether a status the server reported is at or past `floor` — its word has caught up with
    /// what the page already knew, and the floor is no longer needed.
    public static func reached(_ status: String?, _ floor: String) -> Bool {
        rank(status) >= rank(floor)
    }

    /// The server's status for a homework is its FIRST quiz's (`my_assignments` reads `hws[0]`):
    /// handing in any later quiz moves nothing, and must not raise a floor.
    public static func isStatusQuiz(_ homeworkId: Int, of homework: AssignmentListing) -> Bool {
        homework.assessmentHomeworks.first?.homeworkId == homeworkId
    }

    private static func base(for homework: AssignmentListing, reported: String?) -> String? {
        guard isNotStarted(reported), homework.assessmentHomeworks.isEmpty else { return reported }
        // A set with no words has nothing to play: it is never owed, and playing it proves nothing.
        let sets = homework.vocabHomeworks.filter { $0.wordCount > 0 }
        guard !sets.isEmpty else {
            return HomeworkProgress.asksNothingYet(homework) ? nothingYet : reported
        }
        if HomeworkProgress.isDone(homework) { return completed }
        if sets.contains(where: { $0.state.lowercased() != "not_started" }) { return "in_progress" }
        return reported
    }

    /// How far a status has got: not started, begun, handed in, then everything past that (graded,
    /// reviewed, returned, completed — and any word this build does not know, which is never "behind").
    private static func rank(_ status: String?) -> Int {
        switch (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "", "not_started": return 0
        case "in_progress": return 1
        case "submitted": return 2
        default: return 3
        }
    }

    /// Work that is with the teacher already — or finished, for words — so its deadline is a date,
    /// not something to catch up on.
    public static func isWithTheTeacher(_ status: String?) -> Bool {
        let key = (status ?? "").lowercased()
        return key == completed || ProfileHomework.isTurnedIn(key)
    }

    /// Nothing is owed on it, so its deadline is a date, never "Catch up": work with the teacher, or
    /// a homework with nothing to do yet — which is not with the teacher, since nothing was handed in.
    public static func owesNothing(_ status: String?) -> Bool {
        isWithTheTeacher(status) || (status ?? "").lowercased() == nothingYet
    }

    private static func isNotStarted(_ status: String?) -> Bool {
        let key = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return key.isEmpty || key == "not_started"
    }
}

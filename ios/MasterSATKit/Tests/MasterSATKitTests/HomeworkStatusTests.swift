import Foundation
import Testing
@testable import MasterSATKit

/// The status chip on the homework page. The server's `workflow_status` is a hand-in's status, and a
/// word homework is never handed in — so for words the page reads the sets themselves.
@Suite struct HomeworkStatusTests {

    private func listing(_ json: [String: Any]) throws -> AssignmentListing {
        try JSONCoding.decoder.decode(AssignmentListing.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func submission(status: String, workflow: String) throws -> Submission {
        let json: [String: Any] = ["id": 1, "status": status, "revision": 1, "workflow_status": workflow]
        return try JSONCoding.decoder.decode(Submission.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func set(_ id: Int, words: Int = 20, state: String) -> [String: Any] {
        ["id": id, "set_id": id, "set_title": "Set \(id)", "word_count": words, "state": state]
    }

    private func words(_ sets: [[String: Any]], status: String? = "NOT_STARTED", extra: [String: Any] = [:]) throws -> AssignmentListing {
        var json: [String: Any] = ["id": 1, "vocab_homeworks": sets]
        if let status { json["workflow_status"] = status }
        for (key, value) in extra { json[key] = value }
        return try listing(json)
    }

    // MARK: - Word homework

    @Test("A word homework that has been played is not \"Not started\"")
    func playedWordsAreInProgress() throws {
        let homework = try words([set(1, state: "in_progress"), set(2, state: "not_started")])
        #expect(HomeworkStatus.shown(for: homework, submission: nil) == "in_progress")
    }

    @Test("A word homework with every set finished is completed — it is never handed in")
    func finishedWordsAreCompleted() throws {
        let homework = try words([set(1, state: "completed"), set(2, state: "completed")])
        #expect(HomeworkStatus.shown(for: homework, submission: nil) == HomeworkStatus.completed)
        // One set finished and one not is still on its way.
        let half = try words([set(1, state: "completed"), set(2, state: "not_started")])
        #expect(HomeworkStatus.shown(for: half, submission: nil) == "in_progress")
    }

    @Test("A word homework nobody has touched stays not started")
    func untouchedWords() throws {
        let homework = try words([set(1, state: "not_started")])
        #expect(HomeworkStatus.shown(for: homework, submission: nil) == "NOT_STARTED")
    }

    @Test("A set with no words has nothing to play, so it neither holds a homework back nor finishes one")
    func emptySetsAreIgnored() throws {
        let finished = try words([set(1, state: "completed"), set(2, words: 0, state: "not_started")])
        #expect(HomeworkStatus.shown(for: finished, submission: nil) == HomeworkStatus.completed)
        // Only empty sets: not "completed" (nothing was played) and not "not started" either.
        let onlyEmpty = try words([set(1, words: 0, state: "not_started")])
        #expect(HomeworkStatus.shown(for: onlyEmpty, submission: nil) == HomeworkStatus.nothingYet)
        let emptyAndPlayed = try words([set(1, words: 0, state: "completed")])
        #expect(HomeworkStatus.shown(for: emptyAndPlayed, submission: nil) == HomeworkStatus.nothingYet)
    }

    @Test("A homework of only empty word sets has nothing to do yet — the status Done lists it under")
    func onlyEmptySetsAskNothingYet() throws {
        let empty = [set(1, words: 0, state: "not_started"), set(2, words: 0, state: "not_started")]
        let homework = try words(empty)
        let status = HomeworkStatus.shown(for: homework, submission: nil)
        #expect(status == HomeworkStatus.nothingYet)
        // The same answer as the lists, which file it under Done.
        #expect(HomeworkProgress.isDone(homework))
        // Not with the teacher — nothing was handed in — yet its date is only a date: there is
        // nothing to catch up on.
        #expect(!HomeworkStatus.isWithTheTeacher(status))
        #expect(HomeworkStatus.owesNothing(status))
        #expect(!HomeworkStatus.owesNothing("not_started"))
        #expect(!HomeworkStatus.owesNothing("in_progress"))
        #expect(HomeworkStatus.owesNothing(HomeworkStatus.completed))
        #expect(HomeworkStatus.owesNothing("SUBMITTED"))
        // Still asked for a file or a paper: owed, and the server's word stands.
        let withUpload = try words(empty, extra: ["allow_file_upload": true])
        #expect(HomeworkStatus.shown(for: withUpload, submission: nil) == "NOT_STARTED")
        let withPaper = try words(empty, extra: ["contents": [["kind": "MOCK", "title": "Mock"]]])
        #expect(HomeworkStatus.shown(for: withPaper, submission: nil) == "NOT_STARTED")
        // Anything the server has said past "not started" is kept.
        #expect(HomeworkStatus.shown(for: try words(empty, status: "GRADED"), submission: nil) == "GRADED")
    }

    @Test("Words beside a file to hand in or a paper to sit are not complete until the server says so")
    func wordsWithMoreToDo() throws {
        let withUpload = try words([set(1, state: "completed")], extra: ["allow_file_upload": true])
        #expect(HomeworkStatus.shown(for: withUpload, submission: nil) == "in_progress")
        let withPaper = try words(
            [set(1, state: "completed")],
            extra: ["contents": [["kind": "PASTPAPER", "title": "June 2025"]]]
        )
        #expect(HomeworkStatus.shown(for: withPaper, submission: nil) == "in_progress")
        // Handed in: the hand-in's own word stands.
        let handedIn = try submission(status: "SUBMITTED", workflow: "SUBMITTED")
        #expect(HomeworkStatus.shown(for: withUpload, submission: handedIn) == "SUBMITTED")
    }

    @Test("The case the server writes in does not matter")
    func caseIsFolded() throws {
        let lower = try words([set(1, state: "in_progress")], status: "not_started")
        #expect(HomeworkStatus.shown(for: lower, submission: nil) == "in_progress")
        let missing = try words([set(1, state: "in_progress")], status: nil)
        #expect(HomeworkStatus.shown(for: missing, submission: nil) == "in_progress")
    }

    // MARK: - The server's word stands

    @Test("Anything the server reports past \"not started\" is kept as it is")
    func serverStatusStands() throws {
        for status in ["submitted", "GRADED", "returned", "in_progress"] {
            let homework = try words([set(1, state: "completed")], status: status)
            #expect(HomeworkStatus.shown(for: homework, submission: nil) == status)
        }
    }

    @Test("A quiz homework keeps what the row says — the sets do not speak for a quiz")
    func quizzesAreTheServers() throws {
        let homework = try listing([
            "id": 1, "workflow_status": "not_started",
            "assessment_homeworks": [["homework_id": 2]],
            "vocab_homeworks": [set(1, state: "completed")],
        ])
        #expect(HomeworkStatus.shown(for: homework, submission: nil) == "not_started")
    }

    @Test("The submission's status wins over the row's, as it did before")
    func submissionWins() throws {
        let homework = try listing(["id": 1, "workflow_status": "not_started"])
        let handedIn = try submission(status: "SUBMITTED", workflow: "SUBMITTED")
        #expect(HomeworkStatus.shown(for: homework, submission: handedIn) == "SUBMITTED")
        #expect(HomeworkStatus.shown(for: homework, submission: nil) == "not_started")
    }

    @Test("A plain hand-in with nothing in it is not started, and a missing status stays missing")
    func plainHandIn() throws {
        let homework = try listing(["id": 1])
        #expect(HomeworkStatus.shown(for: homework, submission: nil) == nil)
    }

    // MARK: - A hand-in the page has seen the server accept

    private func quiz(_ ids: [Int], status: String? = "not_started") throws -> AssignmentListing {
        var json: [String: Any] = ["id": 1, "assessment_homeworks": ids.map { ["homework_id": $0] }]
        if let status { json["workflow_status"] = status }
        return try listing(json)
    }

    @Test("A quiz the server just accepted holds the chip at Submitted until a read says so")
    func floorLiftsAStaleRow() throws {
        for stale in ["not_started", "NOT_STARTED", "in_progress"] {
            let row = try quiz([5], status: stale)
            #expect(HomeworkStatus.shown(for: row, submission: nil, floor: HomeworkStatus.handedIn) == "submitted")
        }
        let missing = try quiz([5], status: nil)
        #expect(HomeworkStatus.shown(for: missing, submission: nil, floor: HomeworkStatus.handedIn) == "submitted")
    }

    @Test("The floor never covers what the server has already said — graded, reviewed, returned or anything unknown")
    func floorYieldsToTheServer() throws {
        for said in ["submitted", "GRADED", "reviewed", "returned", "completed", "something_new"] {
            let row = try quiz([5], status: said)
            #expect(HomeworkStatus.shown(for: row, submission: nil, floor: HomeworkStatus.handedIn) == said)
        }
    }

    @Test("A submission that reports its own status keeps the word it gave")
    func floorDoesNotOverrideASubmission() throws {
        let row = try quiz([5], status: "not_started")
        let draft = try submission(status: "DRAFT", workflow: "NOT_STARTED")
        #expect(HomeworkStatus.shown(for: row, submission: draft, floor: HomeworkStatus.handedIn) == "NOT_STARTED")
    }

    @Test("Without a floor nothing changes")
    func noFloor() throws {
        let row = try quiz([5], status: "not_started")
        #expect(HomeworkStatus.shown(for: row, submission: nil) == "not_started")
        #expect(HomeworkStatus.shown(for: row, submission: nil, floor: nil) == "not_started")
    }

    @Test("A read has caught up with the floor when it reports Submitted or anything past it")
    func reaching() {
        #expect(HomeworkStatus.reached("submitted", HomeworkStatus.handedIn))
        #expect(HomeworkStatus.reached("GRADED", HomeworkStatus.handedIn))
        #expect(HomeworkStatus.reached("reviewed", HomeworkStatus.handedIn))
        #expect(HomeworkStatus.reached("something_new", HomeworkStatus.handedIn))
        #expect(!HomeworkStatus.reached("in_progress", HomeworkStatus.handedIn))
        #expect(!HomeworkStatus.reached("not_started", HomeworkStatus.handedIn))
        #expect(!HomeworkStatus.reached(nil, HomeworkStatus.handedIn))
    }

    @Test("Only the homework's first quiz speaks for its status")
    func firstQuizOnly() throws {
        // The server's status is the first quiz's (`my_assignments`): handing in the second moves nothing.
        let bundle = try quiz([5, 6])
        #expect(HomeworkStatus.isStatusQuiz(5, of: bundle))
        #expect(!HomeworkStatus.isStatusQuiz(6, of: bundle))
        #expect(!HomeworkStatus.isStatusQuiz(5, of: try listing(["id": 1])))
    }

    @Test("A completed word homework counts as with the teacher already")
    func completedIsHandedIn() {
        #expect(HomeworkStatus.isWithTheTeacher(HomeworkStatus.completed))
        #expect(HomeworkStatus.isWithTheTeacher("submitted"))
        #expect(HomeworkStatus.isWithTheTeacher("GRADED"))
        #expect(HomeworkStatus.isWithTheTeacher("reviewed"))
        #expect(!HomeworkStatus.isWithTheTeacher("in_progress"))
        #expect(!HomeworkStatus.isWithTheTeacher("returned"))
        #expect(!HomeworkStatus.isWithTheTeacher(nil))
    }
}

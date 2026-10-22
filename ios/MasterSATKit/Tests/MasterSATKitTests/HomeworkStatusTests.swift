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
        let onlyEmpty = try words([set(1, words: 0, state: "not_started")])
        #expect(HomeworkStatus.shown(for: onlyEmpty, submission: nil) == "NOT_STARTED")
        let emptyAndPlayed = try words([set(1, words: 0, state: "completed")])
        #expect(HomeworkStatus.shown(for: emptyAndPlayed, submission: nil) == "NOT_STARTED")
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

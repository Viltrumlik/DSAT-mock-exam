import Foundation
import Testing
@testable import MasterSATKit

@Suite struct AssignmentRulesTests {

    private func listing(_ json: [String: Any]) throws -> AssignmentListing {
        try JSONCoding.decoder.decode(AssignmentListing.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test("The detail enriches the row and never replaces what only the row knows")
    func mergeKeepsTheStudentsSide() throws {
        // The detail endpoint is the teacher's view: no classroom_id, no workflow_status, no
        // per-student progress. Swapping the row for it made the page say "no classroom".
        let row = try listing([
            "id": 1, "title": "Essay", "classroom_id": 7, "classroom_name": "Maths A",
            "workflow_status": "SUBMITTED",
            "vocab_homeworks": [["id": 3, "set_id": 9, "set_title": "Set 1", "word_count": 20, "state": "in_progress"]],
        ])
        let detail = try listing([
            "id": 1, "title": "Essay — argument analysis", "instructions": "Write 300 words.",
            "external_urls": ["https://a.example/x", "https://b.example/y"], "external_url_labels": ["Reading", ""],
            "allow_file_upload": true, "locks_file_upload": false, "category": "HOMEWORK", "max_score": "100.00",
            "vocab_homeworks": [],
        ])
        let merged = row.merging(detail: detail)
        #expect(merged.classroomId == 7)
        #expect(merged.classroomName == "Maths A")
        #expect(merged.workflowStatus == "SUBMITTED")
        #expect(merged.vocabHomeworks.first?.state == "in_progress")
        #expect(merged.title == "Essay — argument analysis")
        #expect(merged.instructions == "Write 300 words.")
        #expect(merged.maxScore == 100)
        #expect(merged.namedLinks.map(\.label) == ["Reading", ""])
        #expect(merged.offersFileUpload)
    }

    @Test("A file hand-in is offered only when the teacher allowed one or there is nothing else to do")
    func uploadIsOfferedByTheWebsRule() throws {
        // The old app put an upload box on EVERY homework, quizzes included.
        let quiz = try listing(["id": 1, "assessment_homeworks": [["homework_id": 4]]])
        #expect(!quiz.offersFileUpload)
        let quizWithUpload = try listing(["id": 1, "assessment_homeworks": [["homework_id": 4]], "allow_file_upload": true])
        #expect(quizWithUpload.offersFileUpload)
        let fileOnly = try listing(["id": 2])
        #expect(fileOnly.offersFileUpload)
        let classwork = try listing(["id": 3, "category": "CLASSWORK"])
        #expect(!classwork.offersFileUpload)
    }

    @Test("Hand-in closes at the deadline unless the work came back, and for good once reviewed")
    func handInWindow() throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let past = try listing(["id": 1, "due_at": "2033-05-17T00:00:00Z"])      // before `now`
        let future = try listing(["id": 1, "due_at": "2033-05-19T00:00:00Z"])    // after `now`
        let undated = try listing(["id": 1])
        #expect(past.isHandInClosed(submissionStatus: nil, now: now))
        #expect(past.isHandInClosed(submissionStatus: "SUBMITTED", now: now))
        #expect(!past.isHandInClosed(submissionStatus: "RETURNED", now: now))
        #expect(!future.isHandInClosed(submissionStatus: "DRAFT", now: now))
        #expect(future.isHandInClosed(submissionStatus: "REVIEWED", now: now))
        #expect(!undated.isHandInClosed(submissionStatus: nil, now: now))
    }

    @Test("Classwork carries the teacher's award")
    func classworkAward() throws {
        let item = try listing(["id": 1, "category": "CLASSWORK",
                                "classwork_award": ["points": 8, "xp": 8, "awarded_at": "2026-09-20T10:00:00Z", "note": "Great"]])
        #expect(item.isClasswork)
        #expect(item.classworkAward?.points == 8)
    }
}

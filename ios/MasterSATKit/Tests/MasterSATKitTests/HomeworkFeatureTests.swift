import Foundation
import Testing
@testable import MasterSATKit

@Suite struct HomeworkFeatureTests {

    private func listing(_ json: [String: Any]) throws -> AssignmentListing {
        try JSONCoding.decoder.decode(AssignmentListing.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private var tashkent: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Tashkent")!
        return calendar
    }

    // MARK: - Countdown

    @Test("The countdown counts calendar days, and a passed deadline reads Catch up")
    func countdown() {
        // 2026-09-20 10:00 in Tashkent.
        let now = Date(timeIntervalSince1970: 1_789_880_400)
        let calendar = tashkent
        func text(_ due: String?, handedIn: Bool = false) -> String {
            HomeworkWording.countdown(dueAt: due, handedIn: handedIn, now: now, calendar: calendar)
        }
        #expect(text(nil) == "No deadline")
        #expect(text("2026-09-20T18:00:00+05:00") == "Due today")
        #expect(text("2026-09-21T09:00:00+05:00") == "1 day left")
        #expect(text("2026-09-23T18:00:00+05:00") == "3 days left")
        // Never "Past due" — the student is invited to catch up, not told off.
        #expect(text("2026-09-19T18:00:00+05:00") == "Catch up")
        #expect(text("2026-09-20T09:00:00+05:00") == "Catch up")
        // Work already with the teacher is not something to catch up on.
        #expect(text("2026-09-19T18:00:00+05:00", handedIn: true) == "Deadline passed")
    }

    @Test("Sections read as the SAT sections they are")
    func sectionLabels() {
        #expect(HomeworkWording.sectionLabel("ENGLISH") == "Reading & Writing")
        #expect(HomeworkWording.sectionLabel("READING_WRITING") == "Reading & Writing")
        #expect(HomeworkWording.sectionLabel("MATH") == "Math")
        #expect(HomeworkWording.sectionLabel(nil) == "—")
    }

    @Test("The hero badge names the one thing inside, or calls a bundle a bundle")
    func badges() throws {
        #expect(HomeworkWording.badge(for: try listing(["id": 1])) == "Homework")
        #expect(HomeworkWording.badge(for: try listing(["id": 1, "category": "CLASSWORK"])) == "Classwork")
        #expect(HomeworkWording.badge(for: try listing(["id": 1, "assessment_homeworks": [["homework_id": 2]]])) == "Quiz")
        #expect(HomeworkWording.badge(for: try listing([
            "id": 1, "practice_test": 9,
            "practice_bundle_tests": [["id": 9, "name": "June 2025", "subject": "MATH", "state": "not_started"]],
        ])) == "Past Paper")
        #expect(HomeworkWording.badge(for: try listing([
            "id": 1, "assessment_homeworks": [["homework_id": 2]],
            "vocab_homeworks": [["id": 3, "set_id": 4]],
        ])) == "Bundle")
    }

    // MARK: - Papers sat on a computer

    @Test("Past-paper sections list one row each, with their own state and the retake wording")
    func pastPaperRows() throws {
        let homework = try listing([
            "id": 1, "practice_test_ids": [10, 11],
            "practice_bundle_tests": [
                ["id": 10, "name": "June 2025", "subject": "READING_WRITING", "state": "completed", "attempt_id": 5, "retake": false],
                ["id": 11, "name": "June 2025", "subject": "MATH", "state": "not_started", "retake": true],
            ],
        ])

        let rows = homework.computerPapers

        #expect(rows.map(\.name) == ["June 2025 · Reading & Writing", "June 2025 · Math"])
        #expect(rows.map(\.stateLabel) == ["Review", "Start again"])
        #expect(rows.allSatisfy { $0.kind == .pastPaper })
        // Only the finished section has a certificate to show.
        #expect(rows.map(\.certificateAttemptId) == [5, nil])
    }

    @Test("A single section keeps its plain name; a missing name falls back to the collection")
    func singleSection() throws {
        let homework = try listing([
            "id": 1, "practice_test": 12,
            "practice_bundle_tests": [["id": 12, "name": "", "collection_name": "March 2024", "subject": "MATH", "state": "in_progress"]],
        ])
        let row = try #require(homework.computerPapers.first)
        #expect(row.name == "March 2024")
        #expect(row.subject == "Math")
        #expect(row.stateLabel == "Resume")
    }

    @Test("A mock is one row named by the server, its state taken from its sections")
    func mockRow() throws {
        let finished = try listing([
            "id": 1, "mock_exam": 3,
            "contents": [["kind": "MOCK", "title": "October Mock", "item_count": 98]],
            "practice_bundle_tests": [
                ["id": 20, "name": "RW", "subject": "READING_WRITING", "state": "completed"],
                ["id": 21, "name": "M", "subject": "MATH", "state": "completed"],
            ],
        ])
        let row = try #require(finished.computerPapers.first)
        #expect(finished.computerPapers.count == 1)
        #expect(row.kind == .mock)
        #expect(row.certificateAttemptId == nil)
        #expect(row.name == "October Mock")
        #expect(row.stateLabel == "Review")
        #expect(row.subject == "Reading & Writing · Math")

        let halfway = try listing([
            "id": 1, "mock_exam": 3,
            "practice_bundle_tests": [
                ["id": 20, "subject": "READING_WRITING", "state": "completed"],
                ["id": 21, "subject": "MATH", "state": "not_started"],
            ],
        ])
        #expect(halfway.computerPapers.first?.stateLabel == "Resume")
        #expect(halfway.computerPapers.first?.name == "Mock Exam")
    }

    @Test("A practice pack is one row, not one per section")
    func packRow() throws {
        let homework = try listing([
            "id": 1, "practice_test_pack_ids": [7],
            "contents": [["kind": "PRACTICE", "title": "Pack A"]],
            "practice_bundle_tests": [
                ["id": 30, "subject": "MATH", "state": "not_started", "retake": true],
                ["id": 31, "subject": "MATH", "state": "not_started"],
            ],
        ])
        let rows = homework.computerPapers
        #expect(rows.count == 1)
        #expect(rows.first?.kind == .practice)
        #expect(rows.first?.name == "Pack A")
        #expect(rows.first?.stateLabel == "Start again")
        #expect(homework.offersFileUpload == false)
    }

    @Test("A past-paper homework from the list is not a hand-in, even before its detail arrives")
    func listRowWithPaperOffersNoUpload() throws {
        // `my-assignments` sends `contents` but none of the paper fields.
        let row = try listing([
            "id": 1, "content_type": "pastpaper",
            "contents": [["kind": "PASTPAPER", "title": "June 2025", "item_count": 98]],
        ])
        #expect(row.hasLaunchableContent)
        #expect(!row.offersFileUpload)
    }

    @Test("A quiz and a word set are not papers, and nothing is listed for a plain hand-in")
    func noPapers() throws {
        #expect(try listing(["id": 1, "assessment_homeworks": [["homework_id": 2]]]).computerPapers.isEmpty)
        #expect(try listing(["id": 1]).computerPapers.isEmpty)
    }

    @Test("The detail's papers survive the merge onto the list row")
    func mergeKeepsPapers() throws {
        let row = try listing(["id": 1, "classroom_id": 4, "workflow_status": "NOT_STARTED"])
        let detail = try listing([
            "id": 1, "mock_exam": 3, "contents": [["kind": "MOCK", "title": "October Mock"]],
            "practice_bundle_tests": [["id": 20, "subject": "MATH", "state": "in_progress"]],
            "submission_limits": ["max_files_per_submission": 10],
        ])
        let merged = row.merging(detail: detail)
        #expect(merged.classroomId == 4)
        #expect(merged.computerPapers.first?.name == "October Mock")
        #expect(merged.submissionLimits?.maxFilesPerSubmission == 10)
        // A field the server left out keeps the standard value rather than becoming zero.
        #expect(merged.submissionLimits?.maxFileBytes == SubmissionLimits.standard.maxFileBytes)
    }

    // MARK: - Upload limits

    @Test("A file is checked as it is picked: its type, then its size")
    func singleFileChecks() {
        let limits = SubmissionLimits.standard
        #expect(limits.problem(fileName: "essay.pdf", bytes: 2_000_000) == nil)
        #expect(limits.problem(fileName: "IMG_0001.HEIC", bytes: 1_000) == .typeNotAccepted(fileName: "IMG_0001.HEIC"))
        #expect(limits.problem(fileName: "notes", bytes: 1_000) == .typeNotAccepted(fileName: "notes"))
        #expect(limits.problem(fileName: "scan.jpg", bytes: 60 * 1024 * 1024) == .fileTooLarge(fileName: "scan.jpg", bytes: 60 * 1024 * 1024))
        #expect(limits.problem(fileName: "scan.jpg", bytes: 50 * 1024 * 1024) == nil)
    }

    @Test("The whole upload is checked for count and size before it is sent")
    func batchChecks() {
        let limits = SubmissionLimits.standard
        let photo = (name: "p.jpg", bytes: 5 * 1024 * 1024)
        #expect(limits.problem(files: [photo, photo], alreadyHandedIn: 48) == nil)
        #expect(limits.problem(files: [photo, photo], alreadyHandedIn: 49) == .tooManyFiles(total: 51))
        let big = Array(repeating: (name: "p.jpg", bytes: 20 * 1024 * 1024), count: 4)
        #expect(limits.problem(files: big, alreadyHandedIn: 0) == .uploadTooLarge(bytes: 80 * 1024 * 1024))
    }

    @Test("Refusals say what to do, in plain sizes")
    func limitMessages() {
        let limits = SubmissionLimits.standard
        #expect(limits.message(for: .fileTooLarge(fileName: "scan.jpg", bytes: 72 * 1024 * 1024))
                == "“scan.jpg” is 72 MB. Each file can be up to 50 MB — a smaller photo or a PDF will go through.")
        #expect(limits.message(for: .tooManyFiles(total: 52)).contains("Remove 2"))
        #expect(limits.message(for: .typeNotAccepted(fileName: "a.heic")).contains(".pdf"))
        #expect(SubmissionLimits.megabytes(2_516_582) == "2.4 MB")
        #expect(SubmissionLimits.megabytes(696_320) == "680 KB")
    }
}

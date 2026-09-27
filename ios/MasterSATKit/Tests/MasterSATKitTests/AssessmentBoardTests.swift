import Foundation
import Testing
@testable import MasterSATKit

/// The rules the student assessments board narrows by — the port of the web's
/// `studentAssessmentNav` and its tests, plus the card states the board reads from
/// `progress.workflow_status`. Category strings are the prod shapes: `"Domain › Subdomain"`.
@Suite struct AssessmentBoardRulesTests {

    @Test("Subjects read both the set spelling and the platform spelling")
    func subjectKeys() {
        #expect(AssessmentSubjectKey.of("math") == .math)
        #expect(AssessmentSubjectKey.of("MATH") == .math)
        #expect(AssessmentSubjectKey.of("english") == .english)
        #expect(AssessmentSubjectKey.of("READING_WRITING") == .english)
        #expect(AssessmentSubjectKey.of("") == nil)
        #expect(AssessmentSubjectKey.of(nil) == nil)
        #expect(AssessmentSubjectKey.of("physics") == nil)
    }

    @Test("The domain is the part of the category before the ›")
    func domainOfCategory() {
        #expect(AssessmentBoard.domain(of: "Algebra › Linear functions") == "Algebra")
        #expect(AssessmentBoard.domain(of: "Standard English Conventions › Boundaries") == "Standard English Conventions")
        #expect(AssessmentBoard.domain(of: "Geometry and Trigonometry") == "Geometry and Trigonometry")
    }

    @Test("An uncategorised set is filed under Other instead of dropped")
    func uncategorisedIsOther() {
        #expect(AssessmentBoard.domain(of: "") == "Other")
        #expect(AssessmentBoard.domain(of: "   ") == "Other")
        #expect(AssessmentBoard.domain(of: nil) == "Other")
    }

    @Test("Domains come in the SAT's order, whatever order they arrived in")
    func domainsInSatOrder() {
        #expect(AssessmentBoard.orderedDomains(.math, present: ["Geometry and Trigonometry", "Algebra", "Advanced Math"])
            == ["Algebra", "Advanced Math", "Geometry and Trigonometry"])
        #expect(AssessmentBoard.orderedDomains(.english, present: ["Standard English Conventions", "Craft and Structure", "Information and Ideas"])
            == ["Craft and Structure", "Information and Ideas", "Standard English Conventions"])
    }

    @Test("An unknown domain follows the known ones, and Other is last")
    func unknownDomainsThenOther() {
        #expect(AssessmentBoard.orderedDomains(.math, present: ["Other", "Calculus", "Algebra", "Arithmetic"])
            == ["Algebra", "Arithmetic", "Calculus", "Other"])
    }

    @Test("To-do keeps work whose deadline is still ahead, and undated work")
    func openTodo() throws {
        let now = try #require(JSONCoding.parseServerDate("2026-09-13T12:00:00+05:00"))
        #expect(AssessmentBoard.isOpenTodo(dueAt: "2026-09-15T16:00:00+05:00", done: false, now: now))
        #expect(AssessmentBoard.isOpenTodo(dueAt: nil, done: false, now: now))
        #expect(AssessmentBoard.isOpenTodo(dueAt: "2026-09-12T16:00:00+05:00", done: false, now: now) == false)
        #expect(AssessmentBoard.isOpenTodo(dueAt: "2026-09-20T16:00:00+05:00", done: true, now: now) == false)
    }

    @Test("The nearest deadline comes first and undated work last")
    func todoOrder() {
        let due: [String?] = ["2026-09-20T16:00:00+05:00", nil, "2026-09-14T16:00:00+05:00"]
        let sorted = due.sorted { AssessmentBoard.compareTodo($0, $1) < 0 }
        #expect(sorted == ["2026-09-14T16:00:00+05:00", "2026-09-20T16:00:00+05:00", nil])
    }

    @Test("A card's column is read from workflow_status")
    func cardStates() throws {
        func state(_ json: String) throws -> AssessmentCardState {
            AssessmentCardState.of(try JSONCoding.decoder.decode(AssessmentProgress.self, from: Data(json.utf8)))
        }
        #expect(try state(#"{"workflow_status":"graded","state":"completed","graded":true}"#) == .completed)
        #expect(try state(#"{"workflow_status":"submitted","state":"completed","graded":false}"#) == .submitted)
        #expect(try state(#"{"workflow_status":"in_progress","state":"in_progress"}"#) == .inProgress)
        #expect(try state(#"{"workflow_status":"not_started","state":"not_started"}"#) == .notStarted)
        // An attempt in some other status (abandoned, expired) is back in To do.
        #expect(try state(#"{"workflow_status":"abandoned","state":"not_started"}"#) == .notStarted)
        #expect(AssessmentCardState.of(nil) == .notStarted)
    }

    @Test("A payload without workflow_status falls back to state")
    func stateFallback() throws {
        let submitted = try JSONCoding.decoder.decode(AssessmentProgress.self, from: Data(#"{"state":"completed","graded":false}"#.utf8))
        let graded = try JSONCoding.decoder.decode(AssessmentProgress.self, from: Data(#"{"state":"completed","graded":true}"#.utf8))
        #expect(AssessmentCardState.of(submitted) == .submitted)
        #expect(AssessmentCardState.of(graded) == .completed)
    }

    @Test("Submitted work sits with the finished work")
    func submittedIsDone() {
        #expect(AssessmentCardState.submitted.column == .done)
        #expect(AssessmentCardState.completed.column == .done)
        #expect(AssessmentCardState.inProgress.column == .inProgress)
        #expect(AssessmentCardState.notStarted.column == .todo)
        #expect(AssessmentCardState.submitted.isDone)
    }

    @Test("Desmos is offered on Middle and Senior maths only")
    func calculatorGate() {
        #expect(AssessmentTools.offersCalculator(subject: "math", level: "middle"))
        #expect(AssessmentTools.offersCalculator(subject: "math", level: "senior"))
        #expect(AssessmentTools.offersCalculator(subject: "math", level: "junior") == false)
        #expect(AssessmentTools.offersCalculator(subject: "math", level: "") == false)
        #expect(AssessmentTools.offersCalculator(subject: "math", level: nil) == false)
        #expect(AssessmentTools.offersCalculator(subject: "english", level: "senior") == false)
    }

    @Test("The runner's set carries its level")
    func setLevelDecodes() throws {
        let set = try JSONCoding.decoder.decode(
            AssessmentSetInfo.self,
            from: Data(#"{"id":1,"title":"Linear","subject":"math","level":"senior","category":"Algebra › Linear functions"}"#.utf8)
        )
        #expect(set.level == "senior")
        #expect(set.offersCalculator)
    }
}

@Suite struct AssessmentBoardGroupingTests {

    /// One homework per card, the shape `my-assignments` sends.
    private func assignment(
        id: Int,
        homeworkId: Int,
        subject: String,
        category: String?,
        workflow: String = "not_started",
        total: Int = 10,
        due: String? = nil,
        classroom: String = "Math ODD",
        title: String = "Set"
    ) -> [String: Any] {
        var set: [String: Any] = ["id": homeworkId, "subject": subject, "title": title, "description": ""]
        set["category"] = category ?? ""
        let state = ["graded": "completed", "submitted": "completed", "in_progress": "in_progress"][workflow] ?? "not_started"
        var progress: [String: Any] = ["workflow_status": workflow, "state": state, "total_questions": total]
        if workflow == "graded" { progress["graded"] = true; progress["percent"] = 80 }
        var a: [String: Any] = [
            "id": id, "title": "Homework \(id)", "classroom_id": 2, "classroom_name": classroom,
            "assessment_homeworks": [["homework_id": homeworkId, "set": set, "progress": progress]],
        ]
        a["due_at"] = due ?? NSNull()
        return a
    }

    private func board(_ items: [[String: Any]]) throws -> AssessmentBoard {
        let data = try JSONSerialization.data(withJSONObject: items)
        return AssessmentBoard(assignments: try JSONCoding.decoder.decode([AssignmentListing].self, from: data))
    }

    @Test("Two subjects land on the subject picker, English first")
    func twoSubjects() throws {
        let b = try board([
            assignment(id: 1, homeworkId: 11, subject: "math", category: "Algebra › Linear functions"),
            assignment(id: 2, homeworkId: 12, subject: "english", category: "Craft and Structure › Words in Context"),
        ])

        #expect(b.subjects.map(\.key) == [.english, .math])
        #expect(b.soleSubject == nil)
    }

    @Test("One subject is the landing: there is nothing to choose between")
    func soleSubject() throws {
        let b = try board([
            assignment(id: 1, homeworkId: 11, subject: "math", category: "Geometry and Trigonometry › Circles"),
            assignment(id: 2, homeworkId: 12, subject: "MATH", category: "Algebra › Linear functions"),
            assignment(id: 3, homeworkId: 13, subject: "math", category: nil),
        ])

        let sole = try #require(b.soleSubject)
        #expect(sole.key == .math)
        #expect(sole.domains.map(\.name) == ["Algebra", "Geometry and Trigonometry", "Other"])
        #expect(sole.domain(named: "Other")?.entries.map(\.id) == [13])
    }

    @Test("A subject's counts say how much is still to do")
    func counts() throws {
        let b = try board([
            assignment(id: 1, homeworkId: 11, subject: "math", category: "Algebra › A", workflow: "graded"),
            assignment(id: 2, homeworkId: 12, subject: "math", category: "Algebra › B", workflow: "submitted"),
            assignment(id: 3, homeworkId: 13, subject: "math", category: "Algebra › C", workflow: "in_progress"),
            assignment(id: 4, homeworkId: 14, subject: "math", category: "Algebra › D"),
        ])

        let c = AssessmentBoard.counts(b.entries)
        #expect(c == AssessmentBoard.Counts(total: 4, todo: 2, done: 2))
        let columns = AssessmentBoard.columns(b.entries)
        #expect(columns[.done]?.map(\.id) == [11, 12])
        #expect(columns[.inProgress]?.map(\.id) == [13])
        #expect(columns[.todo]?.map(\.id) == [14])
    }

    @Test("To-do is open work only, nearest deadline first, undated last")
    func todoStrip() throws {
        let now = try #require(JSONCoding.parseServerDate("2026-09-13T12:00:00+05:00"))
        let b = try board([
            assignment(id: 1, homeworkId: 11, subject: "math", category: "Algebra › A", due: nil),
            assignment(id: 2, homeworkId: 12, subject: "math", category: "Algebra › B", due: "2026-09-20T16:00:00+05:00"),
            assignment(id: 3, homeworkId: 13, subject: "math", category: "Algebra › C", due: "2026-09-14T16:00:00+05:00"),
            assignment(id: 4, homeworkId: 14, subject: "math", category: "Algebra › D", due: "2026-09-10T16:00:00+05:00"),
            assignment(id: 5, homeworkId: 15, subject: "math", category: "Algebra › E", workflow: "graded", due: "2026-09-30T16:00:00+05:00"),
            assignment(id: 6, homeworkId: 16, subject: "math", category: "Algebra › F", workflow: "in_progress"),
        ])

        // A passed deadline leaves the strip (it is still on its domain board); handed-in
        // work leaves it too. Work in progress with no deadline is still open.
        #expect(b.todo(now: now).map(\.id) == [13, 12, 11, 16])
    }

    @Test("Search spans every subject and domain")
    func searchSpansEverything() throws {
        let b = try board([
            assignment(id: 1, homeworkId: 11, subject: "math", category: "Algebra › Linear functions", title: "Slopes"),
            assignment(id: 2, homeworkId: 12, subject: "english", category: "Craft and Structure › Words in Context", classroom: "English EVEN", title: "Vocabulary in context"),
        ])

        #expect(b.search("slopes").map(\.id) == [11])
        #expect(b.search("english").map(\.id) == [12], "subject label and class name are searched too")
        #expect(b.search("linear").map(\.id) == [11], "and the category")
        #expect(b.search("   ").isEmpty)
    }

    @Test("A card's question count comes from the progress total")
    func questionCountFromProgress() throws {
        // `my-assignments` never sends `question_count`; reading it left "N questions · ~M min" blank.
        let b = try board([assignment(id: 1, homeworkId: 11, subject: "math", category: "Algebra › A", total: 12)])
        let entry = try #require(b.entries.first)
        #expect(entry.questionCount == 12)
        #expect(entry.estimatedMinutes == 15)
        #expect(entry.subjectLabel == "Math")
        #expect(entry.tags == ["Algebra › A"])
    }

    @Test("Work with no recognised subject is on no subject — the page shows it all instead")
    func unplacedWork() throws {
        let b = try board([assignment(id: 1, homeworkId: 11, subject: "", category: nil)])
        #expect(b.subjects.isEmpty)
        #expect(b.entries.count == 1)
        #expect(b.entries.first?.subjectLabel == "General")
    }
}

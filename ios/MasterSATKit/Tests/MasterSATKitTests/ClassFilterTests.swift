import Foundation
import Testing
@testable import MasterSATKit

private func room(_ id: Int, _ name: String, _ subject: String) throws -> Classroom {
    try ProfileFixtures.room(["id": id, "name": name, "subject": subject, "my_role": "STUDENT"])
}

@Suite struct ClassFilterTests {

    @Test("One class, or none, has nothing to choose between")
    func noChips() throws {
        #expect(ClassFilter(classrooms: []).chips.isEmpty)
        let one = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH")])
        #expect(one.chips.isEmpty)
        #expect(one.classes(for: ClassFilter.allID).map(\.id) == [1])
    }

    @Test("A class of each subject is named by its subject: All · Math · English")
    func subjectChips() throws {
        let filter = ClassFilter(classrooms: [try room(2, "English EVEN", "ENGLISH"), try room(1, "Math ODD", "MATH")])
        #expect(filter.chips.map(\.id) == ["all", "math", "english"])
        #expect(filter.chips.map(\.label) == ["All", "Math", "English"])
        #expect(filter.classes(for: "math").map(\.id) == [1])
    }

    @Test("Two classes of one subject are named by class")
    func classChips() throws {
        let filter = ClassFilter(classrooms: [
            try room(1, "Math ODD", "MATH"), try room(2, "Math EVEN", "MATH"), try room(3, "English EVEN", "ENGLISH"),
        ])
        #expect(filter.chips.map(\.label) == ["All", "Math EVEN", "Math ODD", "English"])
        #expect(filter.chips.map(\.id) == ["all", "class-2", "class-1", "english"])
    }

    @Test("A chip shows its own classes' work; work with no class only under All")
    func includesClassroom() throws {
        let filter = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH"), try room(2, "English EVEN", "ENGLISH")])
        #expect(filter.includes(classroomId: 1, chipID: "math"))
        #expect(!filter.includes(classroomId: 2, chipID: "math"))
        #expect(!filter.includes(classroomId: nil, chipID: "math"))
        #expect(filter.includes(classroomId: nil, chipID: "all"))
        #expect(filter.includes(classroomId: 2, chipID: "gone"), "an unknown chip is All")
    }

    @Test("A midterm is placed by its subject")
    func includesSubject() throws {
        let filter = ClassFilter(classrooms: [
            try room(1, "Math ODD", "MATH"), try room(2, "Math EVEN", "MATH"), try room(3, "English EVEN", "ENGLISH"),
        ])
        #expect(filter.includes(subject: "MATH", chipID: "class-1"))
        #expect(!filter.includes(subject: "READING_WRITING", chipID: "class-1"))
        #expect(filter.includes(subject: "READING_WRITING", chipID: "english"))
        #expect(filter.includes(subject: "", chipID: "all"))
        #expect(!filter.includes(subject: "", chipID: "english"))
    }

    @Test("A chip that has gone reads as All")
    func resolved() throws {
        let filter = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH"), try room(2, "English EVEN", "ENGLISH")])
        #expect(filter.resolvedID("math") == "math")
        #expect(filter.resolvedID("class-9") == "all")
    }
}

@Suite struct ClassTasksTests {
    typealias W = WorkFixtures
    typealias F = ProfileFixtures

    private func fixture() throws -> (ClassFilter, [AssignmentListing], [MidtermListing]) {
        let filter = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH"), try room(2, "English EVEN", "ENGLISH")])
        let assignments = [
            try W.homework(1, due: F.at(2)),
            try W.homework(2, due: F.at(-1)),
            try W.homework(3, due: F.at(-3), status: "SUBMITTED"),
            try W.homework(4, due: F.at(-1), status: "SUBMITTED"),
            try W.homework(5, due: F.at(1), classroom: 2, className: "English EVEN"),
            try W.homework(6, due: F.at(-2), status: "graded", extra: ["assessment_homeworks": [W.quiz(61, "graded")]]),
        ]
        let midterms = [
            try F.decode(MidtermListing.self, ["midterm_id": 1, "title": "Math midterm", "subject": "MATH", "attempt_id": 4, "submitted": true]),
            try F.decode(MidtermListing.self, ["midterm_id": 2, "title": "English midterm", "subject": "READING_WRITING", "attempt_id": 5, "submitted": true]),
            try F.decode(MidtermListing.self, ["midterm_id": 3, "title": "Not sat", "subject": "MATH", "submitted": false]),
        ]
        return (filter, assignments, midterms)
    }

    @Test("Under a chip: to do in Today's order, done latest first, results of that subject")
    func underAChip() throws {
        let (filter, assignments, midterms) = try fixture()
        let tasks = ClassTasks(assignments: assignments, midterms: midterms, filter: filter, chipID: "math", homeworkXP: 15, now: F.now)
        #expect(tasks.toDo.compactMap { $0.assignment?.id } == [2, 1])
        #expect(tasks.done.map(\.id) == [4, 6, 3])
        #expect(tasks.assessmentResults.map(\.id) == [61])
        #expect(tasks.midtermResults.map(\.title) == ["Math midterm"])
        #expect(tasks.resultsCount == 2)
    }

    @Test("Under All: every class, every sat midterm, newest sitting first")
    func underAll() throws {
        let (filter, assignments, midterms) = try fixture()
        let tasks = ClassTasks(assignments: assignments, midterms: midterms, filter: filter, chipID: "all", homeworkXP: 15, now: F.now)
        #expect(tasks.toDo.compactMap { $0.assignment?.id } == [2, 5, 1])
        #expect(tasks.midtermResults.map(\.title) == ["English midterm", "Math midterm"])
    }

    @Test("Classwork stays in the class's To do list, but is never counted as owed")
    func classwork() throws {
        let (filter, assignments, midterms) = try fixture()
        let withClasswork = assignments + [
            try W.homework(7, due: nil, extra: ["category": "CLASSWORK"]),
            try W.homework(8, due: nil, status: "SUBMITTED", extra: ["category": "CLASSWORK"]),
        ]
        let tasks = ClassTasks(assignments: withClasswork, midterms: midterms, filter: filter, chipID: "math", homeworkXP: 15, now: F.now)
        #expect(tasks.toDo.compactMap { $0.assignment?.id } == [2, 1, 7], "undated classwork ends the list")
        #expect(tasks.toDo.first { $0.assignment?.id == 7 }?.xpCap == nil)
        #expect(tasks.owedCount == 2)
        #expect(tasks.done.map(\.id).contains(8), "classwork the teacher marked done is listed as done")
    }

    @Test("Dated classwork is never a catch-up and never outranks owed homework")
    func datedClasswork() throws {
        let (filter, assignments, midterms) = try fixture()
        let withClasswork = assignments + [
            try W.homework(9, due: F.at(-5), extra: ["category": "CLASSWORK"]),
            try W.homework(10, due: F.at(0.5), extra: ["category": "CLASSWORK"]),
        ]
        let tasks = ClassTasks(assignments: withClasswork, midterms: midterms, filter: filter, chipID: "math", homeworkXP: 15, now: F.now)
        // Owed first (the catch-up before the one still ahead), then the classwork, by date.
        #expect(tasks.toDo.compactMap { $0.assignment?.id } == [2, 1, 9, 10])
        #expect(tasks.toDo.map(\.catchUp) == [true, false, false, false])
        #expect(tasks.toDo.map(\.isClasswork) == [false, false, true, true])
        #expect(tasks.owedCount == 2)
    }
}

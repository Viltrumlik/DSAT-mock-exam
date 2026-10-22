import Foundation
import Testing
@testable import MasterSATKit

@Suite struct VocabReviewTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }

    private func section(_ id: Int, words: Int, mastered: Int) -> String {
        #"{"id":\#(id),"title":"Section \#(id)","set_count":2,"word_count":\#(words),"progress":{"new":\#(words - mastered),"mastered":\#(mastered),"total":\#(words)}}"#
    }

    private func set(_ id: Int, mastered: Int, words: Int = 10) -> String {
        let modes = ["flashcard", "matching", "speed", "test"].enumerated()
            .map { #""\#($0.element)":\#($0.offset < mastered)"# }.joined(separator: ",")
        return #"{"id":\#(id),"title":"Set \#(id)","word_count":\#(words),"completed":\#(mastered > 0),"mastery":{"modes":{\#(modes)}}}"#
    }

    private func group(_ id: Int, due: String?, _ sets: [String]) -> String {
        let dueJSON = due.map { #""\#($0)""# } ?? "null"
        return #"{"assignment_id":\#(id),"assignment_title":"Homework \#(id)","classroom_id":1,"classroom_name":"English","due_at":\#(dueJSON),"sets":[\#(sets.joined(separator: ","))]}"#
    }

    @Test("The count is the bank's words still to master — exact, from the sections")
    func count() throws {
        let sections = try decode([VocabSection].self, "[\(section(1, words: 100, mastered: 40)),\(section(2, words: 50, mastered: 50))]")
        let review = VocabReview(sections: sections, homework: [])
        #expect(review.wordsToMaster == 60)
        #expect(review.wordsMastered == 90)
    }

    @Test("Start opens the word homework due soonest that is not mastered — catch-up first")
    func homeworkFirst() throws {
        let homework = try decode([VocabHomeworkGroup].self, """
        [\(group(10, due: "2026-10-25T18:00:00Z", [set(1, mastered: 4), set(2, mastered: 1, words: 12)])),
         \(group(11, due: "2026-10-19T18:00:00Z", [set(3, mastered: 2)])),
         \(group(12, due: nil, [set(4, mastered: 0)]))]
        """)
        let review = VocabReview(sections: [], homework: homework)
        let expected = VocabReview.HomeworkSet(
            setId: 3, title: "Set 3", assignmentId: 11, assignmentTitle: "Homework 11",
            dueAt: "2026-10-19T18:00:00Z", wordCount: 10, gamesLeft: 2
        )
        #expect(review.next == .homework(expected))
    }

    @Test("A mastered set is never the target; no deadline comes last")
    func skipsMastered() throws {
        let homework = try decode([VocabHomeworkGroup].self, """
        [\(group(12, due: nil, [set(4, mastered: 1)])), \(group(10, due: "2026-10-25T18:00:00Z", [set(1, mastered: 4)]))]
        """)
        guard case .homework(let next) = VocabReview(sections: [], homework: homework).next else {
            Issue.record("expected a homework target")
            return
        }
        #expect(next.setId == 4)
        #expect(next.gamesLeft == 3)
    }

    @Test("A set with no words is never owed — it would open a page with nothing to play")
    func skipsEmptySets() throws {
        // An empty set due first, ahead of a real one: Start targets the real one.
        let homework = try decode([VocabHomeworkGroup].self, """
        [\(group(10, due: "2026-10-19T18:00:00Z", [set(1, mastered: 0, words: 0)])),
         \(group(11, due: "2026-10-25T18:00:00Z", [set(2, mastered: 1)]))]
        """)
        guard case .homework(let next) = VocabReview(sections: [], homework: homework).next else {
            Issue.record("expected a homework target")
            return
        }
        #expect(next.setId == 2)

        // The only homework is an empty set: the section fallback, then caught up, never homework.
        let onlyEmpty = try decode([VocabHomeworkGroup].self, "[\(group(10, due: nil, [set(1, mastered: 0, words: 0)]))]")
        let open = try decode([VocabSection].self, "[\(section(2, words: 40, mastered: 10))]")
        #expect(VocabReview(sections: open, homework: onlyEmpty).next == .section(id: 2, title: "Section 2", wordsToMaster: 30))
        let done = try decode([VocabSection].self, "[\(section(2, words: 40, mastered: 40))]")
        #expect(VocabReview(sections: done, homework: onlyEmpty).next == .caughtUp)
        // No words anywhere — an empty set is not words — is nothing yet, not a finish line.
        #expect(VocabReview(sections: [], homework: onlyEmpty).next == .nothingYet)
    }

    @Test("An undated set comes after a dated one even when the server lists it first")
    func undatedLast() throws {
        let homework = try decode([VocabHomeworkGroup].self, """
        [\(group(12, due: nil, [set(4, mastered: 0)])),
         \(group(10, due: "2026-10-25T18:00:00Z", [set(1, mastered: 0)]))]
        """)
        guard case .homework(let next) = VocabReview(sections: [], homework: homework).next else {
            Issue.record("expected a homework target")
            return
        }
        #expect(next.setId == 1)
    }

    @Test("The same deadline keeps the server's order — across groups and inside one")
    func sameDeadlineKeepsServerOrder() throws {
        let due = "2026-10-25T18:00:00Z"
        let sameDay = try decode([VocabHomeworkGroup].self, """
        [\(group(10, due: due, [set(7, mastered: 0), set(8, mastered: 0)])),
         \(group(11, due: due, [set(9, mastered: 0)]))]
        """)
        guard case .homework(let first) = VocabReview(sections: [], homework: sameDay).next else {
            Issue.record("expected a homework target")
            return
        }
        #expect(first.setId == 7)

        let swapped = try decode([VocabHomeworkGroup].self, """
        [\(group(11, due: due, [set(9, mastered: 0)])),
         \(group(10, due: due, [set(7, mastered: 0), set(8, mastered: 0)]))]
        """)
        guard case .homework(let second) = VocabReview(sections: [], homework: swapped).next else {
            Issue.record("expected a homework target")
            return
        }
        #expect(second.setId == 9)
    }

    @Test("No homework owed: the section with the most words still to master")
    func sectionNext() throws {
        let sections = try decode([VocabSection].self, "[\(section(1, words: 100, mastered: 90)),\(section(2, words: 80, mastered: 20)),\(section(3, words: 60, mastered: 0))]")
        let homework = try decode([VocabHomeworkGroup].self, "[\(group(10, due: nil, [set(1, mastered: 4)]))]")
        #expect(VocabReview(sections: sections, homework: homework).next == .section(id: 2, title: "Section 2", wordsToMaster: 60))
    }

    @Test("Everything mastered is all caught up; no words anywhere is nothing yet — neither is an error")
    func endStates() throws {
        let done = try decode([VocabSection].self, "[\(section(1, words: 30, mastered: 30))]")
        #expect(VocabReview(sections: done, homework: []).next == .caughtUp)
        let finishedHomework = try decode([VocabHomeworkGroup].self, "[\(group(10, due: nil, [set(1, mastered: 4)]))]")
        #expect(VocabReview(sections: [], homework: finishedHomework).next == .caughtUp)
        #expect(VocabReview(sections: [], homework: []).next == .nothingYet)
    }

    @Test("Inside a section, the set with the most words still to master; ties keep the server's order")
    func bestSet() throws {
        let detail = try decode(VocabSectionDetail.self, #"""
        {"id":2,"title":"Section 2","sets":[
          {"id":21,"title":"A","order":0,"word_count":10,"progress":{"mastered":10,"total":10}},
          {"id":22,"title":"B","order":1,"word_count":12,"progress":{"mastered":4,"total":12}},
          {"id":23,"title":"C","order":2,"word_count":9,"progress":{"mastered":1,"total":9}}]}
        """#)
        #expect(VocabReview.bestSet(in: detail)?.id == 22)

        let allDone = try decode(VocabSectionDetail.self, #"""
        {"id":2,"title":"S","sets":[{"id":21,"title":"A","word_count":5,"progress":{"mastered":5,"total":5}}]}
        """#)
        #expect(VocabReview.bestSet(in: allDone) == nil)
    }
}

import Foundation
import Testing
@testable import MasterSATKit

@Suite struct CelebrationRuleTests {

    private func summary(_ json: String) throws -> VocabSessionSummary {
        try JSONCoding.decoder.decode(VocabSessionSummary.self, from: Data(json.utf8))
    }

    @Test("A midterm is celebrated when the centre marked it passed — never a pre-midterm, never a miss")
    func midterm() {
        #expect(CelebrationRule.midterm(isGraded: true, passed: true))
        #expect(!CelebrationRule.midterm(isGraded: true, passed: false))
        #expect(!CelebrationRule.midterm(isGraded: true, passed: nil), "no pass mark, no verdict")
        #expect(!CelebrationRule.midterm(isGraded: false, passed: true), "a pre-midterm is scored, never judged")
    }

    @Test("An assessment is celebrated only when it beat the attempt before it")
    func assessment() {
        #expect(CelebrationRule.assessment(percent: 75, previous: 60))
        #expect(!CelebrationRule.assessment(percent: 60, previous: 60), "level is not better")
        #expect(!CelebrationRule.assessment(percent: 40, previous: 60))
        #expect(!CelebrationRule.assessment(percent: 100, previous: nil), "nothing to beat proves nothing")
    }

    @Test("An assessment is compared at the lists' resolution — whole percents, rounded half to even")
    func assessmentResolution() {
        #expect(!CelebrationRule.assessment(percent: 60.2, previous: 60), "60.2 and 60 are both 60%")
        #expect(!CelebrationRule.assessment(percent: 60, previous: 60.4))
        #expect(!CelebrationRule.assessment(percent: 60.4, previous: 59.6), "both are 60%")
        #expect(CelebrationRule.assessment(percent: 60.6, previous: 60), "60.6 is 61%")
        #expect(!CelebrationRule.assessment(percent: 12.5, previous: 12), "12.5 rounds to 12, as Python's round does — not up to 13")
        #expect(!CelebrationRule.assessment(percent: 12.5, previous: 11.5), "11.5 and 12.5 both round to 12")
        #expect(CelebrationRule.assessment(percent: 13.5, previous: 13), "13.5 rounds to 14")
    }

    @Test("A percent is named in whole percents, rounded half to even — the scale the rule weighs")
    func wholePercent() {
        #expect(CelebrationRule.wholePercent(60.4) == 60)
        #expect(CelebrationRule.wholePercent(60.6) == 61)
        #expect(CelebrationRule.wholePercent(12.5) == 12, "half to even, not up to 13 as a plain rounding would")
        #expect(CelebrationRule.wholePercent(13.5) == 14)
        #expect(CelebrationRule.wholePercent(0.5) == 0)
        #expect(CelebrationRule.wholePercent(1.5) == 2)
        #expect(CelebrationRule.wholePercent(99.5) == 100)
        #expect(CelebrationRule.wholePercent(0) == 0)
        #expect(CelebrationRule.wholePercent(100) == 100)
    }

    @Test("The percent a page names is the one the rule weighed: a score that reads the same is no improvement")
    func labelAndRuleAgree() {
        for previous in stride(from: 0.0, through: 99.0, by: 0.5) {
            let named = Double(CelebrationRule.wholePercent(previous))
            #expect(!CelebrationRule.assessment(percent: named, previous: previous),
                    "\(named)% is not up from \(previous), which reads as \(named)%")
            #expect(CelebrationRule.assessment(percent: named + 1, previous: previous),
                    "\(named + 1)% is up from \(previous), which reads as \(named)%")
        }
    }

    @Test("A word-game round is celebrated when the server says it mastered its game")
    func vocabRound() throws {
        let mastered = try summary(#"{"id":1,"correct_count":5,"total_count":5,"set_completed":true,"mode_mastered":true}"#)
        let notMastered = try summary(#"{"id":2,"correct_count":4,"total_count":5,"set_completed":true,"mode_mastered":false}"#)
        let older = try summary(#"{"id":3,"correct_count":5,"total_count":5,"set_completed":true}"#)
        #expect(CelebrationRule.vocabRound(mastered))
        #expect(!CelebrationRule.vocabRound(notMastered))
        #expect(!CelebrationRule.vocabRound(older), "a server that does not say so has not said so")
        #expect(!CelebrationRule.vocabRound(nil), "a round whose save failed has no summary")
    }
}

@Suite struct OutcomeMemoryTests {

    @Test("The first attempt on a set is only remembered; a later, better one improved on it, on every showing")
    func improvement() {
        var memory = OutcomeMemory()
        let first = memory.showAssessment(setKey: "12/Linear equations", attemptId: 40, percent: 60)
        #expect(first == nil)

        let second = memory.showAssessment(setKey: "12/Linear equations", attemptId: 52, percent: 75)
        #expect(second == 60)

        let again = memory.showAssessment(setKey: "12/Linear equations", attemptId: 52, percent: 75)
        #expect(again == 60, "the page can say \"Up from 60%\" every time it opens")
    }

    @Test("Level or lower is no improvement; an older attempt opened later changes nothing")
    func noImprovement() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60)
        let level = memory.showAssessment(setKey: "s", attemptId: 41, percent: 60)
        #expect(level == nil)
        let lower = memory.showAssessment(setKey: "s", attemptId: 42, percent: 30)
        #expect(lower == nil)
        let better = memory.showAssessment(setKey: "s", attemptId: 43, percent: 50)
        #expect(better == 30, "measured against the newest attempt before it, not the best")

        let older = memory.showAssessment(setKey: "s", attemptId: 39, percent: 90)
        #expect(older == nil, "attempt 39 came before 43 — it is not an improvement on it")
        let newest = memory.showAssessment(setKey: "s", attemptId: 44, percent: 55)
        #expect(newest == 50, "the older attempt did not become the one to beat")
    }

    @Test("Each set is compared only with itself")
    func setsApart() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "12/Algebra", attemptId: 40, percent: 90)
        let other = memory.showAssessment(setKey: "12/Geometry", attemptId: 41, percent: 50)
        #expect(other == nil)
        let next = memory.showAssessment(setKey: "12/Geometry", attemptId: 42, percent: 60)
        #expect(next == 50)
    }

    @Test("An attempt taken on the web, noted from a list, is the attempt before the next one shown")
    func webAttemptBetween() {
        var memory = OutcomeMemory()
        let first = memory.showAssessment(setKey: "12/Algebra", attemptId: 40, percent: 30)
        #expect(first == nil)
        memory.noteSeen(setKey: "12/Algebra", attemptId: 45, percent: 90)
        let second = memory.showAssessment(setKey: "12/Algebra", attemptId: 50, percent: 60)
        #expect(second == nil, "60% is down from the 90% taken on the web in between — not \"Up from 30%\"")

        var phoneOnly = OutcomeMemory()
        _ = phoneOnly.showAssessment(setKey: "12/Algebra", attemptId: 40, percent: 30)
        let up = phoneOnly.showAssessment(setKey: "12/Algebra", attemptId: 50, percent: 60)
        #expect(up == 30, "the same two attempts, with nothing between them, did improve")
    }

    @Test("A noted attempt is the one to beat even when it scored less than an earlier one — newest, not best")
    func notedNewestNotBest() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60)
        memory.noteSeen(setKey: "s", attemptId: 45, percent: 20)
        let next = memory.showAssessment(setKey: "s", attemptId: 50, percent: 40)
        #expect(next == 20)
    }

    @Test("Noting an attempt older than the newest seen changes nothing")
    func noteOlderIgnored() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 43, percent: 50)
        memory.noteSeen(setKey: "s", attemptId: 39, percent: 99)
        memory.noteSeen(setKey: "s", attemptId: 43, percent: 10)
        let next = memory.showAssessment(setKey: "s", attemptId: 44, percent: 55)
        #expect(next == 50, "attempt 43 stays the one before 44, at the score it was shown with")
    }

    @Test("Noting an attempt celebrates nothing, and showing a noted attempt is not an improvement on itself")
    func noteIsQuiet() {
        var memory = OutcomeMemory()
        memory.noteSeen(setKey: "s", attemptId: 40, percent: 60)
        #expect(memory.celebrated.isEmpty, "noting marks no outcome as celebrated")

        let shown = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60)
        #expect(shown == nil, "an attempt is never compared with itself")

        var first = OutcomeMemory()
        first.noteSeen(setKey: "s", attemptId: 40, percent: 95)
        #expect(first.newestSeen["s"] == OutcomeMemory.Attempt(attemptId: 40, percent: 95), "a first note is only remembered")
        #expect(first.improvedFrom.isEmpty)
        #expect(first.celebrated.isEmpty)
    }

    @Test("An attempt the phone learned of from a list still beat the one before it when its review opens")
    func notedThenShown() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60)
        memory.noteSeen(setKey: "s", attemptId: 41, percent: 80)
        let shown = memory.showAssessment(setKey: "s", attemptId: 41, percent: 80)
        #expect(shown == 60, "the list refresh that follows a hand-in must not cost the attempt its improvement")
        let celebrate = memory.celebrate(OutcomeMemory.assessmentKey(41), if: shown != nil)
        #expect(celebrate, "and it is celebrated once, here — not when it was noted")
    }

    @Test("An improved attempt says so again only while its score still beats the one it beat")
    func reshown() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60)
        let improved = memory.showAssessment(setKey: "s", attemptId: 41, percent: 80)
        #expect(improved == 60)
        _ = memory.showAssessment(setKey: "s", attemptId: 42, percent: 30)

        let again = memory.showAssessment(setKey: "s", attemptId: 41, percent: 80)
        #expect(again == 60, "a later attempt does not take it back")
        let regradedLevel = memory.showAssessment(setKey: "s", attemptId: 41, percent: 60)
        #expect(regradedLevel == nil, "a mark that fell to the score it beat is no longer better")
        let regradedDown = memory.showAssessment(setKey: "s", attemptId: 41, percent: 55)
        #expect(regradedDown == nil)
    }

    @Test("A review that names no set is compared with nothing and remembers nothing")
    func noSetKey() {
        var memory = OutcomeMemory()
        let none: String? = nil
        let unnamed = memory.showAssessment(setKey: none, attemptId: 40, percent: 90)
        #expect(unnamed == nil)
        #expect(memory == OutcomeMemory())

        let named: String? = "12/Algebra"
        let first = memory.showAssessment(setKey: named, attemptId: 41, percent: 50)
        #expect(first == nil)
        let second = memory.showAssessment(setKey: named, attemptId: 42, percent: 60)
        #expect(second == 50, "a key that is there behaves exactly as the plain call does")
    }

    @Test("A list's rounded score is refined by the review's exact one, so an equal score is never an improvement")
    func listRoundedThenReview() {
        var memory = OutcomeMemory()
        memory.noteSeen(setKey: "s", attemptId: 40, percent: 60)
        let shown = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60.4)
        #expect(shown == nil, "an attempt is never compared with itself")
        #expect(memory.newestSeen["s"] == OutcomeMemory.Attempt(attemptId: 40, percent: 60.4), "the review's number replaces the list's")

        let retake = memory.showAssessment(setKey: "s", attemptId: 41, percent: 60.2)
        #expect(retake == nil, "60.2% against 60.4% is the same 60% — not \"Up from 60%\"")
        let better = memory.showAssessment(setKey: "s", attemptId: 42, percent: 61)
        #expect(better == 60.2, "a whole percent better is an improvement, on the exact score it beat")
    }

    @Test("Half-way scores round to even, as the lists do")
    func halfEven() {
        var memory = OutcomeMemory()
        memory.noteSeen(setKey: "s", attemptId: 40, percent: 12)
        let level = memory.showAssessment(setKey: "s", attemptId: 41, percent: 12.5)
        #expect(level == nil, "12.5 is 12% on the list's scale")
        let up = memory.showAssessment(setKey: "s", attemptId: 42, percent: 13.5)
        #expect(up == 12.5, "13.5 is 14%, past 12")
    }

    @Test("Showing the attempt the list brought refines it without celebrating it, and the next attempt is measured from the refined score")
    func refineEqualId() {
        // A teacher re-grade up, picked up when the review opens.
        var regraded = OutcomeMemory()
        regraded.noteSeen(setKey: "s", attemptId: 40, percent: 50)
        let shown = regraded.showAssessment(setKey: "s", attemptId: 40, percent: 72.5)
        #expect(shown == nil, "a better mark on the same attempt is not that attempt beating itself")
        #expect(regraded.improvedFrom.isEmpty)
        #expect(regraded.celebrated.isEmpty)
        let next = regraded.showAssessment(setKey: "s", attemptId: 41, percent: 75)
        #expect(next == 72.5, "measured from the re-graded 72.5%, not the 50% the list once carried")

        // An improved attempt stays improved, on the same score it beat, as its number is refined.
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60.4)
        let improved = memory.showAssessment(setKey: "s", attemptId: 41, percent: 75)
        #expect(improved == 60.4)
        let refined = memory.showAssessment(setKey: "s", attemptId: 41, percent: 75.3)
        #expect(refined == 60.4)
        #expect(memory.newestSeen["s"] == OutcomeMemory.Attempt(attemptId: 41, percent: 75.3))
        let level = memory.showAssessment(setKey: "s", attemptId: 42, percent: 75.4)
        #expect(level == nil, "75.4% is the same 75% as 75.3%")
    }

    @Test("An outcome is celebrated once, and only when it qualifies")
    func once() {
        var memory = OutcomeMemory()
        let notYet = memory.celebrate(OutcomeMemory.midtermKey(7), if: false)
        #expect(!notYet)
        let first = memory.celebrate(OutcomeMemory.midtermKey(7), if: true)
        #expect(first)
        let second = memory.celebrate(OutcomeMemory.midtermKey(7), if: true)
        #expect(!second, "opening the report again is not a new event")
        let other = memory.celebrate(OutcomeMemory.assessmentKey(7), if: true)
        #expect(other, "an assessment and a midterm never share a key")
        #expect(OutcomeMemory.midtermKey(7) == "midterm.7")
        #expect(OutcomeMemory.assessmentKey(7) == "assessment.7")
    }
}

@Suite struct OutcomeBookTests {

    private func scratch() -> (UserDefaults, String) {
        let name = "outcomes-tests-\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test("Nothing stored reads as an empty memory; what was written reads back, per student")
    func roundTrip() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let book = OutcomeBook(defaults: defaults)
        #expect(book.read(userID: 7) == OutcomeMemory())

        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "12/Algebra", attemptId: 40, percent: 60)
        _ = memory.showAssessment(setKey: "12/Algebra", attemptId: 41, percent: 80)
        _ = memory.celebrate(OutcomeMemory.assessmentKey(41), if: true)
        book.write(memory, userID: 7)

        #expect(book.read(userID: 7) == memory)
        #expect(book.read(userID: 8) == OutcomeMemory(), "another account on the phone starts empty")
        #expect(OutcomeBook.key(userID: 7) == "outcomes.v1.7")
    }

    @Test("A memory stored by the first build reads back whole, and a field added later never wipes it")
    func storedV1() throws {
        let v1 = #"{"lastShown":{"12/Algebra":{"attemptId":41,"percent":80}},"improvedFrom":{"41":60},"celebrated":["assessment.41","midterm.7"]}"#
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set(Data(v1.utf8), forKey: OutcomeBook.key(userID: 5))
        var memory = OutcomeBook(defaults: defaults).read(userID: 5)
        #expect(memory.newestSeen["12/Algebra"] == OutcomeMemory.Attempt(attemptId: 41, percent: 80))
        #expect(memory.improvedFrom == [41: 60])
        #expect(memory.celebrated == ["assessment.41", "midterm.7"])

        let next = memory.showAssessment(setKey: "12/Algebra", attemptId: 42, percent: 95)
        #expect(next == 80, "what was stored is what the next attempt is measured against")
        let again = memory.celebrate(OutcomeMemory.assessmentKey(41), if: true)
        #expect(!again, "and an outcome celebrated before is not celebrated again")

        // A value missing any field — one added after it was written — keeps the rest.
        let onlyCelebrated = try JSONDecoder().decode(OutcomeMemory.self, from: Data(#"{"celebrated":["midterm.7"]}"#.utf8))
        #expect(onlyCelebrated.celebrated == ["midterm.7"])
        #expect(onlyCelebrated.newestSeen.isEmpty)
        let onlyNewest = try JSONDecoder().decode(OutcomeMemory.self, from: Data(#"{"lastShown":{"s":{"attemptId":3,"percent":50}}}"#.utf8))
        #expect(onlyNewest.newestSeen["s"]?.attemptId == 3)
        #expect(onlyNewest.celebrated.isEmpty)
        let empty = try JSONDecoder().decode(OutcomeMemory.self, from: Data("{}".utf8))
        #expect(empty == OutcomeMemory())
    }

    @Test("A value that will not decode is an empty memory, not a crash")
    func corrupt() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set(Data("not json".utf8), forKey: OutcomeBook.key(userID: 3))
        #expect(OutcomeBook(defaults: defaults).read(userID: 3) == OutcomeMemory())
    }
}

/// A my-assignments list, as far as the outcome memory reads it: the homeworks of an assignment,
/// each with the attempt the list carries for it.
enum ListFixtures {
    static func progress(_ attemptId: Int?, percent: Int?, state: String = "completed", graded: Bool? = true) -> [String: Any] {
        var json: [String: Any] = ["state": state, "workflow_status": state == "completed" ? "graded" : state]
        if let attemptId { json["attempt_id"] = attemptId }
        if let percent { json["percent"] = percent }
        if let graded { json["graded"] = graded }
        return json
    }

    static func link(_ homeworkId: Int, title: String?, progress: [String: Any]?) -> [String: Any] {
        var json: [String: Any] = ["homework_id": homeworkId]
        if let title { json["set"] = ["id": homeworkId, "title": title, "subject": "math"] }
        if let progress { json["progress"] = progress }
        return json
    }

    static func assignment(_ id: Int, _ links: [[String: Any]]) throws -> AssignmentListing {
        try JSONCoding.decoder.decode(
            AssignmentListing.self,
            from: JSONSerialization.data(withJSONObject: ["id": id, "title": "Homework \(id)", "assessment_homeworks": links])
        )
    }
}

@Suite struct OutcomeListNotingTests {
    typealias F = ListFixtures

    @Test("Every completed, graded attempt a list carries becomes known, under the key its review builds")
    func notesWhatTheListCarries() throws {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [
            try F.assignment(12, [F.link(101, title: "Linear equations", progress: F.progress(41, percent: 80))]),
            try F.assignment(13, [F.link(102, title: "Geometry", progress: F.progress(52, percent: 55))]),
        ])
        #expect(memory.newestSeen["12/Linear equations"] == OutcomeMemory.Attempt(attemptId: 41, percent: 80))
        #expect(memory.newestSeen["13/Geometry"] == OutcomeMemory.Attempt(attemptId: 52, percent: 55))
        #expect(memory.newestSeen.count == 2)
        #expect(memory.celebrated.isEmpty, "noting a list never celebrates")
        #expect(memory.improvedFrom.isEmpty)
    }

    @Test("Every set a homework bundles is read, not only the first")
    func readsEveryBundledSet() throws {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [try F.assignment(12, [
            F.link(101, title: "Algebra", progress: F.progress(41, percent: 80)),
            F.link(102, title: "Geometry", progress: F.progress(42, percent: 70)),
        ])])
        #expect(memory.newestSeen["12/Algebra"]?.attemptId == 41)
        #expect(memory.newestSeen["12/Geometry"]?.attemptId == 42)
    }

    @Test("What is not a finished, marked score is not noted")
    func skipsWhatHasNoScore() throws {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [try F.assignment(12, [
            F.link(101, title: "In progress", progress: F.progress(41, percent: 40, state: "in_progress")),
            F.link(102, title: "Waiting for a mark", progress: F.progress(42, percent: 70, graded: false)),
            F.link(103, title: "No percent", progress: F.progress(43, percent: nil)),
            F.link(104, title: "No attempt", progress: F.progress(nil, percent: 70)),
            F.link(105, title: "Not started", progress: F.progress(nil, percent: nil, state: "not_started", graded: nil)),
            F.link(106, title: "No progress at all", progress: nil),
        ])])
        #expect(memory == OutcomeMemory())
    }

    @Test("A server that does not say whether it is graded still has its score noted")
    func gradedUnsaid() throws {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [try F.assignment(12, [F.link(101, title: "Algebra", progress: F.progress(41, percent: 80, graded: nil))])])
        #expect(memory.newestSeen["12/Algebra"]?.attemptId == 41)
    }

    @Test("A set with no title is keyed by its homework alone, as its review would")
    func untitledSet() throws {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [try F.assignment(12, [F.link(101, title: nil, progress: F.progress(41, percent: 80))])])
        #expect(memory.newestSeen[OutcomeMemory.setKey(assignmentId: 12, setTitle: nil)]?.attemptId == 41)
        #expect(memory.newestSeen["12/"]?.attemptId == 41)
    }

    @Test("A later list with a newer, better attempt is the attempt that beat the one before it")
    func laterListImproves() throws {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [try F.assignment(12, [F.link(101, title: "Algebra", progress: F.progress(40, percent: 60))])])
        memory.noteSeen(in: [try F.assignment(12, [F.link(101, title: "Algebra", progress: F.progress(41, percent: 80))])])
        #expect(memory.improvedFrom == [41: 60])
        let shown = memory.showAssessment(setKey: "12/Algebra", attemptId: 41, percent: 80)
        #expect(shown == 60, "its review says \"Up from 60%\" whether the list or the review reached the phone first")

        // The same list again, or an older attempt, teaches nothing new.
        let before = memory
        memory.noteSeen(in: [try F.assignment(12, [F.link(101, title: "Algebra", progress: F.progress(40, percent: 99))])])
        #expect(memory == before)
    }

    @Test("An empty list changes nothing")
    func emptyList() {
        var memory = OutcomeMemory()
        memory.noteSeen(in: [])
        #expect(memory == OutcomeMemory())
    }
}

@Suite struct OutcomeBookListNotingTests {
    typealias F = ListFixtures

    private func scratch() -> (UserDefaults, String) {
        let name = "outcomes-list-tests-\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test("A list is noted into the student's own memory, and no one else's")
    func notesPerStudent() throws {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let book = OutcomeBook(defaults: defaults)
        book.noteSeen(in: [try F.assignment(12, [F.link(101, title: "Algebra", progress: F.progress(41, percent: 80))])], userID: 7)
        #expect(book.read(userID: 7).newestSeen["12/Algebra"] == OutcomeMemory.Attempt(attemptId: 41, percent: 80))
        #expect(book.read(userID: 8) == OutcomeMemory(), "another account on the phone is untouched")
    }

    @Test("A list that teaches nothing writes nothing")
    func writesOnlyOnChange() throws {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let book = OutcomeBook(defaults: defaults)
        book.noteSeen(in: [], userID: 7)
        #expect(defaults.data(forKey: OutcomeBook.key(userID: 7)) == nil, "nothing to note, nothing stored")

        // What is stored already knows the attempt. The bytes are kept in a spelling the encoder
        // would not write, so a rewrite would show.
        let stored = Data(#"{"lastShown": {"12/Algebra": {"attemptId": 41, "percent": 80}}}"#.utf8)
        defaults.set(stored, forKey: OutcomeBook.key(userID: 7))
        book.noteSeen(in: [try F.assignment(12, [F.link(101, title: "Algebra", progress: F.progress(41, percent: 80))])], userID: 7)
        #expect(defaults.data(forKey: OutcomeBook.key(userID: 7)) == stored)
    }
}

@Suite struct HandInBaselineTests {

    @Test("A task's gain is measured from the start, raised to what the header held at hand-in")
    func baseline() {
        #expect(XPDelta.baseline(atStart: 100, atHandIn: 130) == 130, "a rise in between is not the task's")
        #expect(XPDelta.baseline(atStart: 100, atHandIn: 100) == 100)
        #expect(XPDelta.baseline(atStart: 100, atHandIn: nil) == 100)
        #expect(XPDelta.baseline(atStart: 100, atHandIn: 90) == 100, "a stale read never lowers it")
        #expect(XPDelta.baseline(atStart: nil, atHandIn: 130) == nil, "unknown at the start measures nothing")
    }
}

@Suite struct AssessmentSetKeyTests {

    private func review(_ meta: String) throws -> AssessmentReview {
        try JSONCoding.decoder.decode(AssessmentReview.self, from: Data(#"{"meta":\#(meta),"questions":[]}"#.utf8))
    }

    @Test("A review names its set by homework and title; without the homework it names nothing")
    func setKey() throws {
        let full = try review(#"{"assignment_id":12,"assignment_title":"Week 3","set_title":"Linear equations","question_count":10}"#)
        #expect(full.meta?.assignmentId == 12)
        #expect(full.setKey == "12/Linear equations")

        let untitled = try review(#"{"assignment_id":12,"question_count":10}"#)
        #expect(untitled.setKey == "12/")

        let older = try review(#"{"set_title":"Linear equations","question_count":10}"#)
        #expect(older.meta?.assignmentId == nil)
        #expect(older.setKey == nil)
    }

    @Test("The key a list builds for an assignment's set is the key its review carries")
    func listAndReviewAgree() throws {
        let full = try review(#"{"assignment_id":12,"set_title":"Linear equations","question_count":10}"#)
        #expect(full.setKey == OutcomeMemory.setKey(assignmentId: 12, setTitle: "Linear equations"))
        #expect(OutcomeMemory.setKey(assignmentId: 12, setTitle: nil) == "12/")
    }
}

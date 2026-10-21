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

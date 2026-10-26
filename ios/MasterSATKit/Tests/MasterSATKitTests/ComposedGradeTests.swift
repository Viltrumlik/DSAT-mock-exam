import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ComposedGradeTests {

    private func submission(composed: Any?) throws -> Submission {
        var json: [String: Any] = ["id": 7, "revision": 1, "status": "REVIEWED"]
        if let composed { json["composed_grade"] = composed }
        return try JSONCoding.decoder.decode(Submission.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func grade(
        _ state: String,
        percent: Any? = NSNull(),
        automatic: Any? = NSNull(),
        manual: Any? = NSNull(),
        manualWeight: Any = 20,
        automaticWeight: Any = 80
    ) -> [String: Any] {
        [
            "state": state,
            "percent": percent ?? NSNull(),
            "automatic_percent": automatic ?? NSNull(),
            "manual_percent": manual ?? NSNull(),
            "manual_weight_percent": manualWeight,
            "automatic_weight_percent": automaticWeight,
        ]
    }

    private let mark = SubmissionReview(grade: 50, maxScore: 100, feedback: nil, reviewedAt: nil)

    // MARK: - Decoding

    @Test("A homework with no manual component composes nothing")
    func noManualComponent() throws {
        #expect(try submission(composed: NSNull()).composedGrade == nil)
        #expect(try submission(composed: nil).composedGrade == nil)
        #expect(try submission(composed: grade("no_manual_component", manualWeight: 0, automaticWeight: 100)).composedGrade == nil)
    }

    @Test("A payload this cannot read is treated as no composition, and the raw mark stands")
    func malformed() throws {
        // No `state` at all: the one thing this type must never do is invent a grade.
        let shapeless = try submission(composed: ["percent": 90, "manual_weight_percent": 20])
        #expect(shapeless.composedGrade == nil)
        #expect(ComposedGradeRules.pillText(review: mark, grade: shapeless.composedGrade) == "50 / 100")
        #expect(try submission(composed: "final").composedGrade == nil)
    }

    @Test("A state this build has never heard of is not read as a settled grade")
    func unknownState() throws {
        // The failure this guards: `awaiting` and `unavailable` both come out false for an
        // unrecognised word, so the percent beside them prints as the last word on a grade the
        // server may not have finished with. A backend that adds a state must not silently
        // turn an old app into a liar — it shows the mark it always showed.
        let future = try submission(composed: grade("awaiting_second_marker", percent: 60))
        #expect(future.composedGrade == nil)
        #expect(ComposedGradeRules.pillText(review: mark, grade: future.composedGrade) == "50 / 100")
        #expect(try submission(composed: grade("")).composedGrade == nil)
        #expect(try submission(composed: grade("FINAL")).composedGrade == nil)
    }

    @Test("The final state carries the whole grade and both sides of the split")
    func final() throws {
        let composed = try #require(
            try submission(composed: grade("final", percent: 82, automatic: 90, manual: 50)).composedGrade
        )
        #expect(composed.percent == 82)
        #expect(composed.automaticPercent == 90)
        #expect(composed.manualPercent == 50)
        #expect(composed.manualWeight == 20)
        #expect(composed.automaticWeight == 80)
        #expect(composed.awaiting == false)
        #expect(composed.unavailable == false)
    }

    @Test("The two sides of the grade read the same quoted as they do unquoted")
    func percentsAsStrings() throws {
        // DRF writes a `DecimalField` as a string in places. A percent lost to a pair of
        // quotes is a split sentence that names no numbers and a settled card that never
        // appears — the one bug this whole type exists to stop.
        let composed = try #require(
            try submission(composed: grade("final", percent: "82.00", automatic: "90.50", manual: "50.00")).composedGrade
        )
        #expect(composed.percent == 82)
        #expect(composed.automaticPercent == 90.5)
        #expect(composed.manualPercent == 50)
        #expect(ComposedGradeRules.pillText(review: mark, grade: composed) == "82%")
    }

    @Test("Weights arriving as strings, out of range, or missing still read as 0-100 that sum")
    func weights() throws {
        let strings = try #require(
            try submission(composed: grade("final", percent: "82.5", manualWeight: "20", automaticWeight: "80")).composedGrade
        )
        #expect(strings.percent == 82.5)
        #expect(strings.manualWeight == 20)
        // A row edited in a shell can hold anything; a screen must not print 140%.
        let wild = try #require(try submission(composed: grade("final", manualWeight: 140, automaticWeight: -40)).composedGrade)
        #expect(wild.manualWeight == 100)
        #expect(wild.automaticWeight == 0)
        // Only the manual share arrived: the other side is what is left of 100.
        var partial = grade("final", manualWeight: 30)
        partial.removeValue(forKey: "automatic_weight_percent")
        let inferred = try #require(try submission(composed: partial).composedGrade)
        #expect(inferred.automaticWeight == 70)
    }

    // MARK: - The figure

    @Test("Percents print as the website prints them")
    func percentText() {
        #expect(ComposedGradeRules.percentText(90) == "90%")
        #expect(ComposedGradeRules.percentText(90.5) == "90.5%")
        #expect(ComposedGradeRules.percentText(90.25) == "90.25%")
        #expect(ComposedGradeRules.percentText(0) == "0%")
        // Never "-0%".
        #expect(ComposedGradeRules.percentText(-0.001) == "0%")
        // A full grade is "100%", not "100.00%" — the zeros the website drops, dropped here.
        #expect(ComposedGradeRules.percentText(100) == "100%")
        #expect(ComposedGradeRules.percentText(90.10) == "90.1%")
        #expect(ComposedGradeRules.percentText(90.004) == "90%")
    }

    @Test("A composition with no total of its own leaves the card with whatever the mark was")
    func pillWithoutATotal() throws {
        // `final` and nothing numeric with it: there is no grade to print, and with no review
        // either there is nothing at all. A card that invents a figure here is the failure.
        let composed = try submission(composed: grade("final")).composedGrade
        #expect(ComposedGradeRules.pillText(review: nil, grade: composed) == nil)
        #expect(ComposedGradeRules.pillText(review: mark, grade: composed) == "50 / 100")
    }

    @Test("Which state draws a sentence, and which number may be called auto-marked")
    func readings() throws {
        func composed(_ state: String, percent: Any? = NSNull()) throws -> ComposedGrade? {
            try submission(composed: grade(state, percent: percent)).composedGrade
        }
        #expect(try ComposedGradeRules.isPending(composed("awaiting_manual_mark", percent: 72)))
        #expect(try ComposedGradeRules.isPending(composed("unavailable")))
        #expect(try !ComposedGradeRules.isPending(composed("final", percent: 82)))
        // No composition at all: the card is the card it always was.
        #expect(!ComposedGradeRules.isPending(nil))

        // "Auto-marked" labels the raw mark and nothing else: a composed grade has a teacher's
        // judgement inside it, and a sentence is not a number at all.
        #expect(try !ComposedGradeRules.showsRawMark(composed("final", percent: 82)))
        #expect(try !ComposedGradeRules.showsRawMark(composed("awaiting_manual_mark", percent: 72)))
        #expect(try !ComposedGradeRules.showsRawMark(composed("unavailable")))
        #expect(try ComposedGradeRules.showsRawMark(composed("final")))
        #expect(ComposedGradeRules.showsRawMark(nil))
    }

    @Test("Each state puts its own word where the mark used to be")
    func pill() throws {
        func text(_ composed: [String: Any]) throws -> String? {
            ComposedGradeRules.pillText(review: mark, grade: try submission(composed: composed).composedGrade)
        }
        // The bug this task exists for: a teacher's 50 inside a grade of 82 never reads "50".
        #expect(try text(grade("final", percent: 82, automatic: 90, manual: 50)) == "82%")
        #expect(try text(grade("awaiting_manual_mark", percent: 72, automatic: 90)) == "Waiting on your teacher's mark")
        #expect(try text(grade("unavailable")) == "Total unavailable")
        // No mark, no composition, no share: the raw mark is the only number there is, and it
        // is what this card showed before the share existed.
        #expect(try text(grade("final", manualWeight: 0, automaticWeight: 100)) == "50 / 100")
        // No composition at all leaves the card exactly as it was.
        #expect(ComposedGradeRules.pillText(review: mark, grade: nil) == "50 / 100")
        #expect(ComposedGradeRules.pillText(review: nil, grade: nil) == nil)
    }

    // MARK: - The split

    @Test("The split sentence names both sides, the automatic score and the teacher's mark")
    func breakdown() throws {
        let composed = try #require(
            try submission(composed: grade("final", percent: 82, automatic: 90, manual: 50)).composedGrade
        )
        #expect(ComposedGradeRules.breakdownSentence(composed) == """
            Your teacher's mark is worth 20% of this grade; the other 80% is graded \
            automatically and stands at 90%. Your teacher marked it 50%.
            """)
    }

    @Test("A mark still owed is left out of the sentence rather than guessed at")
    func breakdownAwaiting() throws {
        let composed = try #require(
            try submission(composed: grade("awaiting_manual_mark", percent: 72, automatic: 90)).composedGrade
        )
        #expect(ComposedGradeRules.breakdownSentence(composed) == """
            Your teacher's mark is worth 20% of this grade; the other 80% is graded \
            automatically and stands at 90%.
            """)
    }

    @Test("A 0% share says so, and a 100% share has no split to explain")
    func breakdownEdges() throws {
        let noWeight = try #require(
            try submission(composed: grade("final", percent: 90, automatic: 90, manualWeight: 0, automaticWeight: 100)).composedGrade
        )
        #expect(ComposedGradeRules.breakdownSentence(noWeight) == """
            This grade is worked out automatically. Your teacher's comments are theirs, and \
            they do not change the number.
            """)
        let wholeMark = try #require(
            try submission(composed: grade("final", percent: 50, manual: 50, manualWeight: 100, automaticWeight: 0)).composedGrade
        )
        #expect(ComposedGradeRules.breakdownSentence(wholeMark) == nil)
    }

    @Test("A total that could not be worked out is a failure, never a missing grade")
    func breakdownUnavailable() throws {
        let composed = try #require(try submission(composed: grade("unavailable")).composedGrade)
        #expect(composed.unavailable)
        #expect(ComposedGradeRules.breakdownSentence(composed)?.hasPrefix("Your teacher's mark is saved") == true)
    }

    // MARK: - Before the teacher marks

    @Test("The settled part is the whole grade so far, not the automatic side's own score")
    func settled() throws {
        let composed = try #require(
            try submission(composed: grade("awaiting_manual_mark", percent: 72, automatic: 90)).composedGrade
        )
        let settled = try #require(ComposedGradeRules.settledSoFar(composed))
        // 90 is the automatic side; 72 is the grade. The figure is the grade.
        #expect(settled.figure == "72% so far")
        #expect(settled.sentence == """
            The automatically graded 80% of this homework is settled at 90%, which puts the \
            whole grade at 72% so far. The remaining 20% is your teacher's mark, and they are \
            still checking your work — this grade can only go up.
            """)
    }

    @Test("Nothing is called already decided unless a weighted automatic part really is")
    func settledWithheld() throws {
        func settled(_ composed: [String: Any]) throws -> ComposedGradeRules.SettledSoFar? {
            ComposedGradeRules.settledSoFar(try #require(try submission(composed: composed).composedGrade))
        }
        // Marked: nothing is waiting.
        #expect(try settled(grade("final", percent: 82, automatic: 90, manual: 50)) == nil)
        // The mark is the whole grade — an automatic score here carries nothing.
        #expect(try settled(grade("awaiting_manual_mark", automatic: 90, manualWeight: 100, automaticWeight: 0)) == nil)
        // Nothing auto-graded to settle.
        #expect(try settled(grade("awaiting_manual_mark")) == nil)
        #expect(try settled(grade("unavailable")) == nil)
    }
}

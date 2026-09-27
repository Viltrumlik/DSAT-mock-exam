import Foundation
import Testing
@testable import MasterSATKit

/// The survey rules are a port of the SERVER's (`surveys/models.py`, `surveys/services.py`),
/// so these mirror its own tests in `surveys/tests_surveys.py` wherever one exists.
@Suite struct SurveyRulesTests {

    // The school's recommendation survey: a 0–10 slider where 8 is satisfactory, and a
    // "what did we get right?" question shown only to the satisfied.
    let rating = SurveyQuestion(
        id: 10, order: 3, prompt: "Would you recommend us?", type: .rating,
        scaleMin: 0, scaleMax: 10, followUpThreshold: 8,
        followUpPlaceholder: "Why did you give this score?"
    )
    let reasons = SurveyQuestion(
        id: 11, order: 4, prompt: "What makes you recommend us?", type: .multiChoice,
        options: ["Teacher", "Community", "Exams"],
        conditionQuestion: 10, conditionOperator: .atLeast, conditionValue: .number(8)
    )

    private func question(
        _ id: Int, order: Int, type: SurveyQuestionType = .shortText, required: Bool = false,
        options: [String] = [], on source: Int? = nil, rule: SurveyConditionOperator? = nil,
        value: SurveyConditionValue? = nil
    ) -> SurveyQuestion {
        SurveyQuestion(
            id: id, order: order, prompt: "Q\(id)", type: type, isRequired: required,
            options: options, conditionQuestion: source, conditionOperator: rule, conditionValue: value
        )
    }

    // MARK: - Visibility (is_visible_given)

    @Test("A satisfied student is asked what they liked")
    func satisfiedSeesReasons() {
        #expect(SurveyRules.isVisible(reasons, given: [10: .number(8)]))
        #expect(SurveyRules.isVisible(reasons, given: [10: .number(10)]))
    }

    @Test("An unsatisfied student is not")
    func unsatisfiedDoesNot() {
        #expect(!SurveyRules.isVisible(reasons, given: [10: .number(5)]))
        #expect(!SurveyRules.isVisible(reasons, given: [10: .number(7)]))
    }

    @Test("The bar is the same one the follow-up uses: 8 opens the reasons, not the box")
    func sameBar() {
        #expect(SurveyRules.isVisible(reasons, given: [10: .number(8)]))
        #expect(!SurveyRules.wantsFollowUp(rating, answer: .number(8)))
        #expect(!SurveyRules.isVisible(reasons, given: [10: .number(7)]))
        #expect(SurveyRules.wantsFollowUp(rating, answer: .number(7)))
    }

    @Test("A skipped source hides the dependent — no answer is not a low score")
    func skippedSourceHides() {
        #expect(!SurveyRules.isVisible(reasons, given: [:]))
        let whatWentWrong = question(12, order: 5, type: .longText, on: 10, rule: .below, value: .number(8))
        #expect(!SurveyRules.isVisible(whatWentWrong, given: [:]))
    }

    @Test("BELOW is the mirror of AT_LEAST")
    func belowMirrors() {
        let q = question(12, order: 5, type: .longText, on: 10, rule: .below, value: .number(8))
        #expect(SurveyRules.isVisible(q, given: [10: .number(5)]))
        #expect(!SurveyRules.isVisible(q, given: [10: .number(8)]))
    }

    @Test("ANY_OF reads a choice answer, NONE_OF is its inverse")
    func choiceRules() {
        let anyOf = question(12, order: 5, on: 11, rule: .anyOf, value: .options(["Teacher"]))
        #expect(SurveyRules.isVisible(anyOf, given: [11: .choices(["Teacher", "Exams"])]))
        #expect(!SurveyRules.isVisible(anyOf, given: [11: .choices(["Community"])]))

        let noneOf = question(13, order: 6, on: 11, rule: .noneOf, value: .options(["Teacher"]))
        #expect(!SurveyRules.isVisible(noneOf, given: [11: .choices(["Teacher"])]))
        #expect(SurveyRules.isVisible(noneOf, given: [11: .choices(["Community"])]))

        // A single-choice source is one pick, compared the same way.
        #expect(SurveyRules.isVisible(anyOf, given: [11: .text("Teacher")]))
    }

    @Test("ANSWERED only asks whether they said anything — and 0 is something")
    func answeredRule() {
        let q = question(12, order: 5, on: 10, rule: .answered)
        #expect(SurveyRules.isVisible(q, given: [10: .number(0)]))
        #expect(!SurveyRules.isVisible(q, given: [:]))
    }

    @Test("An unanswered source hides the question for every rule but ANSWERED, unknown ones included")
    func unansweredHidesAll() {
        for rule: SurveyConditionOperator in [.atLeast, .below, .anyOf, .noneOf, .other("SOMEDAY")] {
            let q = question(12, order: 5, on: 10, rule: rule, value: .number(3))
            #expect(!SurveyRules.isVisible(q, given: [:]), "rule \(rule)")
        }
        // …and once the source IS answered, a rule this build does not know shows the question.
        let unknown = question(12, order: 5, on: 10, rule: .other("SOMEDAY"), value: .number(3))
        #expect(SurveyRules.isVisible(unknown, given: [10: .number(1)]))
    }

    @Test("A broken condition fails open")
    func brokenFailsOpen() {
        // A score rule with no score, a list, or words to compare against.
        for value: SurveyConditionValue? in [nil, .options(["8"]), .text("eight")] {
            let q = question(12, order: 5, on: 10, rule: .atLeast, value: value)
            #expect(SurveyRules.isVisible(q, given: [10: .number(2)]), "value \(String(describing: value))")
        }
        // A score rule whose source's type was changed under it to checkboxes.
        let q = question(12, order: 5, on: 11, rule: .atLeast, value: .number(8))
        #expect(SurveyRules.isVisible(q, given: [11: .choices(["Teacher"])]))
    }

    @Test("A source that was deleted, or half a condition, leaves the question visible")
    func deletedSourceIsVisible() {
        // `condition_question` is SET_NULL on delete, so the dependent arrives unconditional.
        #expect(SurveyRules.isVisible(question(12, order: 5, on: nil, rule: .atLeast, value: .number(8)), given: [:]))
        #expect(SurveyRules.isVisible(question(12, order: 5, on: 10, rule: nil), given: [:]))
    }

    @Test("A score stored as the string \"7\" is still a score, as int() reads it")
    func stringScore() {
        let q = question(12, order: 5, on: 10, rule: .atLeast, value: .text(" 7 "))
        #expect(SurveyRules.isVisible(q, given: [10: .number(7)]))
        #expect(!SurveyRules.isVisible(q, given: [10: .number(6)]))
    }

    @Test("Top to bottom: a question whose source is hidden reads it as unanswered")
    func hiddenChainsHide() {
        let followOn = question(12, order: 5, on: 11, rule: .answered)
        let all = [rating, reasons, followOn]

        // A stale pick from before the student lowered the score must not keep the chain open.
        let low: [Int: SurveyAnswer] = [10: .number(5), 11: .choices(["Teacher"])]
        #expect(SurveyRules.visibleQuestions(all, answers: low).map(\.id) == [10])

        let high: [Int: SurveyAnswer] = [10: .number(9), 11: .choices(["Teacher"])]
        #expect(SurveyRules.visibleQuestions(all, answers: high).map(\.id) == [10, 11, 12])
    }

    @Test("Questions are evaluated in the server's order, whatever order they arrive in")
    func orderIsTheServers() {
        let first = question(3, order: 0)
        let tieLater = question(9, order: 1)
        let tieEarlier = question(4, order: 1)
        let ordered = SurveyRules.ordered([tieLater, rating, first, tieEarlier])
        #expect(ordered.map(\.id) == [3, 4, 9, 10])
        // The dependent is still evaluated after its source when handed in first.
        #expect(SurveyRules.visibleQuestions([reasons, rating], answers: [10: .number(9)]).map(\.id) == [10, 11])
    }

    @Test("Whitespace is blank, the way normalize_answer strips it")
    func whitespaceIsBlank() {
        let name = question(1, order: 0, required: true)
        let dependent = question(2, order: 1, on: 1, rule: .answered)
        #expect(!SurveyRules.isAnswered(.text("   \n"), for: name))
        #expect(SurveyRules.visibleQuestions([name, dependent], answers: [1: .text("  ")]).map(\.id) == [1])
        #expect(SurveyRules.gaps(in: [name], answers: [1: .text("  ")], followUps: [:])
            == [SurveyGap(questionId: 1, kind: .answer)])
    }

    @Test("Zero is an answer, not a blank")
    func zeroIsAnAnswer() {
        #expect(SurveyRules.isAnswered(.number(0), for: rating))
        #expect(!SurveyRules.isAnswered(.choices([]), for: reasons))
        #expect(!SurveyRules.isAnswered(nil, for: rating))
    }

    // MARK: - Follow-up box (wants_follow_up)

    @Test("A score strictly below the threshold opens the box; no threshold means never")
    func scoreFollowUp() {
        #expect(SurveyRules.wantsFollowUp(rating, answer: .number(0)))
        #expect(SurveyRules.wantsFollowUp(rating, answer: .number(7)))
        #expect(!SurveyRules.wantsFollowUp(rating, answer: .number(8)))
        #expect(!SurveyRules.wantsFollowUp(rating, answer: nil))
        let noBar = SurveyQuestion(id: 20, type: .scale, scaleMin: 1, scaleMax: 5)
        #expect(!SurveyRules.wantsFollowUp(noBar, answer: .number(1)))
    }

    @Test("A trigger option opens the box, even as one pick among several")
    func choiceFollowUp() {
        let multi = SurveyQuestion(
            id: 21, type: .multiChoice, options: ["A", "I have a suggestion"],
            followUpOptions: ["I have a suggestion"]
        )
        #expect(SurveyRules.wantsFollowUp(multi, answer: .choices(["A", "I have a suggestion"])))
        #expect(!SurveyRules.wantsFollowUp(multi, answer: .choices(["A"])))

        let single = SurveyQuestion(id: 22, type: .singleChoice, options: ["Yes", "No"], followUpOptions: ["No"])
        #expect(SurveyRules.wantsFollowUp(single, answer: .text("No")))
        #expect(!SurveyRules.wantsFollowUp(single, answer: .text("Yes")))
    }

    @Test("A skipped question never opens its box — not even over an option called None")
    func skippedNoneOption() {
        // The server bug the guard exists for: str(None) is "None".
        let clubs = SurveyQuestion(
            id: 23, type: .multiChoice, options: ["Chess", "Debate", "None"], followUpOptions: ["None"]
        )
        #expect(!SurveyRules.wantsFollowUp(clubs, answer: nil))
        #expect(!SurveyRules.wantsFollowUp(clubs, answer: .choices([])))
        #expect(SurveyRules.wantsFollowUp(clubs, answer: .choices(["None"])))
    }

    @Test("Text questions never open a follow-up box")
    func textHasNoBox() {
        let text = SurveyQuestion(id: 24, type: .longText, followUpThreshold: 3, followUpOptions: ["x"])
        #expect(!SurveyRules.wantsFollowUp(text, answer: .text("x")))
    }

    // MARK: - What is still missing

    @Test("A required question with no answer is a gap; an optional one is not")
    func requiredGaps() {
        let required = question(1, order: 0, required: true)
        let optional = question(2, order: 1)
        #expect(SurveyRules.gaps(in: [required, optional], answers: [:], followUps: [:])
            == [SurveyGap(questionId: 1, kind: .answer)])
        #expect(SurveyRules.gaps(in: [required, optional], answers: [1: .text("Ok")], followUps: [:]).isEmpty)
    }

    @Test("An open, required follow-up with no note is a gap — whitespace does not count")
    func noteGaps() {
        let strict = SurveyQuestion(
            id: 30, type: .rating, scaleMin: 0, scaleMax: 10, followUpThreshold: 8, followUpRequired: true
        )
        #expect(SurveyRules.gaps(in: [strict], answers: [30: .number(3)], followUps: [:])
            == [SurveyGap(questionId: 30, kind: .note)])
        #expect(SurveyRules.gaps(in: [strict], answers: [30: .number(3)], followUps: [30: "  "])
            == [SurveyGap(questionId: 30, kind: .note)])
        #expect(SurveyRules.gaps(in: [strict], answers: [30: .number(3)], followUps: [30: "Too fast"]).isEmpty)
        // A satisfied score closes the box, so nothing is owed.
        #expect(SurveyRules.gaps(in: [strict], answers: [30: .number(9)], followUps: [:]).isEmpty)
        // The comment is optional by default.
        #expect(SurveyRules.gaps(in: [rating], answers: [10: .number(3)], followUps: [:]).isEmpty)
    }

    @Test("A hidden question is never required; it is when it IS shown")
    func hiddenNotRequired() {
        let requiredReasons = SurveyQuestion(
            id: 11, order: 4, prompt: "What makes you recommend us?", type: .multiChoice, isRequired: true,
            options: ["Teacher", "Community", "Exams"],
            conditionQuestion: 10, conditionOperator: .atLeast, conditionValue: .number(8)
        )
        #expect(SurveyRules.gaps(in: [rating, requiredReasons], answers: [10: .number(3)], followUps: [:]).isEmpty)
        #expect(SurveyRules.gaps(in: [rating, requiredReasons], answers: [10: .number(9)], followUps: [:])
            == [SurveyGap(questionId: 11, kind: .answer)])
    }

    @Test("Gaps come in page order, so Submit can scroll to the first")
    func gapsInPageOrder() {
        let a = question(5, order: 2, required: true)
        let b = question(6, order: 0, required: true)
        let c = question(7, order: 1, required: true)
        #expect(SurveyRules.gaps(in: [a, b, c], answers: [:], followUps: [:]).map(\.questionId) == [6, 7, 5])
    }

    // MARK: - Payloads

    @Test("Submit drops answers to hidden questions and notes on closed boxes")
    func submissionDropsHidden() {
        let payload = SurveyRules.submission(
            [rating, reasons],
            answers: [10: .number(4), 11: .choices(["Teacher"])],
            followUps: [10: "  Too fast  ", 11: "stray"]
        )
        #expect(payload.answers == ["10": .number(4)])
        #expect(payload.followUps == ["10": "Too fast"])

        // A satisfied score: the reasons are sent, and the "why?" note is not.
        let happy = SurveyRules.submission(
            [rating, reasons],
            answers: [10: .number(9), 11: .choices(["Teacher", "Teacher", "Exams"])],
            followUps: [10: "left over from a 6"]
        )
        #expect(happy.answers == ["10": .number(9), "11": .choices(["Teacher", "Exams"])])
        #expect(happy.followUps.isEmpty)
    }

    @Test("Submit trims text and leaves blanks out")
    func submissionNormalises() {
        let name = question(1, order: 0)
        let tick = question(2, order: 1, type: .multiChoice, options: ["A"])
        let payload = SurveyRules.submission([name, tick], answers: [1: .text("  Ann "), 2: .choices([])], followUps: [:])
        #expect(payload.answers == ["1": .text("Ann")])
    }

    @Test("The draft keeps hidden answers and every note, so moving a score back restores them")
    func draftKeepsEverything() {
        let payload = SurveyRules.draft(
            [rating, reasons],
            answers: [10: .number(4), 11: .choices(["Teacher"])],
            followUps: [10: "Too fast", 11: "", 99: "orphan"]
        )
        #expect(payload.answers == ["10": .number(4), "11": .choices(["Teacher"])])
        #expect(payload.followUps == ["10": "Too fast"])
    }

    // MARK: - Restoring a draft

    @Test("A saved answer that no longer fits the question is dropped or trimmed")
    func restoredFits() {
        #expect(SurveyRules.restored(.number(7), for: rating) == .number(7))
        #expect(SurveyRules.restored(.text("7"), for: rating) == .number(7))
        #expect(SurveyRules.restored(.number(11), for: rating) == nil)

        let single = SurveyQuestion(id: 40, type: .singleChoice, options: ["Yes", "No"])
        #expect(SurveyRules.restored(.text("Yes"), for: single) == .text("Yes"))
        #expect(SurveyRules.restored(.text("Maybe"), for: single) == nil)

        let capped = SurveyQuestion(id: 41, type: .multiChoice, options: ["A", "B", "C"], maxSelections: 2)
        #expect(SurveyRules.restored(.choices(["C", "Gone", "A", "B"]), for: capped) == .choices(["C", "A"]))
        #expect(SurveyRules.restored(.choices(["Gone"]), for: capped) == nil)

        let date = SurveyQuestion(id: 42, type: .date)
        #expect(SurveyRules.restored(.text("2026-09-25"), for: date) == .text("2026-09-25"))
        #expect(SurveyRules.restored(.text("2026-02-30"), for: date) == nil)

        let text = SurveyQuestion(id: 43, type: .shortText)
        #expect(SurveyRules.restored(.number(12), for: text) == .text("12"))
    }

    @Test("A draft fills the blanks and never overwrites what is on screen")
    func mergeKeepsLocal() {
        let draft = SurveyDraft(
            answers: [10: .number(3), 11: .choices(["Exams"]), 99: .text("gone question")],
            followUps: [10: "saved note"]
        )
        let merged = SurveyRules.merge(
            draft: draft, into: [10: .number(9)], followUps: [:], questions: [rating, reasons]
        )
        #expect(merged.answers == [10: .number(9), 11: .choices(["Exams"])])
        #expect(merged.followUps == [10: "saved note"])
    }

    // MARK: - Dates

    @Test("A date answer is a calendar day, written YYYY-MM-DD")
    func dates() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "Asia/Tashkent"))
        let day = try #require(SurveyDate.date(from: "2026-09-05", calendar: calendar))
        #expect(SurveyDate.string(from: day, calendar: calendar) == "2026-09-05")
        #expect(SurveyDate.date(from: "2026-9-5", calendar: calendar) != nil)
        #expect(SurveyDate.date(from: "2026-02-30", calendar: calendar) == nil)
        #expect(SurveyDate.date(from: "05/09/2026", calendar: calendar) == nil)
        #expect(SurveyDate.date(from: "", calendar: calendar) == nil)
    }
}

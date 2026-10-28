import Testing
@testable import MasterSATKit

/// The new look's Practice & results wording: the hand-in window, the question map and the
/// review's answer pair.
@Suite struct PracticeLookTests {
    @Test("Hand-in counts are the runner's own: blank is what is left, never negative")
    func handInCounts() {
        let summary = HandInSummary(answered: 9, total: 12, flagged: 2)
        #expect(summary.blank == 3)
        #expect(summary.message == "3 questions are still blank.")
        #expect(summary.reassurance != nil)

        #expect(HandInSummary(answered: 11, total: 12, flagged: 0).message == "1 question is still blank.")
        // More answers than questions (a stale count) still reads as none blank, not -1.
        #expect(HandInSummary(answered: 14, total: 12, flagged: 0).blank == 0)
    }

    @Test("With nothing blank the window keeps the alert's words, and no nudge back")
    func handInComplete() {
        let summary = HandInSummary(answered: 12, total: 12, flagged: 0)
        #expect(summary.message == "Your teacher will see it once you do.")
        #expect(summary.reassurance == nil)
        // A flag is still somewhere to go back to.
        #expect(HandInSummary(answered: 12, total: 12, flagged: 1).reassurance != nil)
    }

    @Test("A map cell is current before answered; answered is never 'correct'")
    func mapCells() {
        #expect(QuestionMapCellState.of(isCurrent: true, isAnswered: true) == .current)
        #expect(QuestionMapCellState.of(isCurrent: false, isAnswered: true) == .answered)
        #expect(QuestionMapCellState.of(isCurrent: false, isAnswered: false) == .blank)
    }

    @Test("The map's subtitle names flags only when there are some")
    func mapSubtitle() {
        #expect(QuestionMapSubtitle.text(answered: 7, total: 12, flagged: 2) == "7 of 12 answered · 2 flagged")
        #expect(QuestionMapSubtitle.text(answered: 0, total: 12, flagged: 0) == "0 of 12 answered")
    }

    @Test("The answer pair carries plain, short words; markup and long text stay the letter")
    func answerLabel() {
        #expect(ReviewAnswerLabel.text(letter: "C", choiceText: "y = 3x - 1") == "C · y = 3x - 1")
        #expect(ReviewAnswerLabel.text(letter: "A", choiceText: "$y = 3x + 1$") == "A")
        #expect(ReviewAnswerLabel.text(letter: "B", choiceText: "<i>ubiquitous</i>") == "B")
        #expect(ReviewAnswerLabel.text(letter: "D", choiceText: String(repeating: "word ", count: 10)) == "D")
        #expect(ReviewAnswerLabel.text(letter: "D", choiceText: nil) == "D")
        #expect(ReviewAnswerLabel.text(letter: "D", choiceText: "   ") == "D")
    }
}

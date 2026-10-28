import Foundation

// The new look's Practice & results (mockups 30–39): the few sentences and states the restyled
// runner, review and midterm pages print, kept here so their wording is tested once.

/// The runner's own three counts for "Hand this in?" (mockup 32) — answered · blank · flagged —
/// and the one sentence under the title. Nothing here is graded: a blank is a count, not a verdict.
public struct HandInSummary: Equatable, Sendable {
    public let answered: Int
    public let total: Int
    public let flagged: Int

    public init(answered: Int, total: Int, flagged: Int) {
        self.answered = max(0, min(answered, total))
        self.total = max(0, total)
        self.flagged = max(0, flagged)
    }

    public var blank: Int { total - answered }

    /// The alert's words, kept to the word: "3 questions are still blank." or, with none blank,
    /// "Your teacher will see it once you do."
    public var message: String {
        switch blank {
        case 0: "Your teacher will see it once you do."
        case 1: "1 question is still blank."
        default: "\(blank) questions are still blank."
        }
    }

    /// The quiet line under the counts — said only when there is somewhere to go back to.
    public var reassurance: String? {
        blank > 0 || flagged > 0 ? "You can go back to any of them first — your answers are saved." : nil
    }
}

/// One cell of the question map (mockup 31). Answered is blue, never green: green means
/// "correct" on the review, and the runner never says so.
public enum QuestionMapCellState: Equatable, Sendable {
    case current, answered, blank

    public static func of(isCurrent: Bool, isAnswered: Bool) -> QuestionMapCellState {
        if isCurrent { return .current }
        return isAnswered ? .answered : .blank
    }
}

/// "7 of 12 answered · 2 flagged" — the map's subtitle, both real numbers.
public enum QuestionMapSubtitle {
    public static func text(answered: Int, total: Int, flagged: Int) -> String {
        let head = "\(answered) of \(total) answered"
        return flagged > 0 ? "\(head) · \(flagged) flagged" : head
    }
}

/// The review's "Your answer / Correct answer" pair (mockup 33) for a choice question: the
/// letter, and the option's words beside it when they are plain and short enough for the panel.
/// Markup or maths (KaTeX, HTML) cannot be drawn in a label, so those stay the letter alone.
public enum ReviewAnswerLabel {
    /// Longer than this, the words would wrap the panel; the options below carry them in full.
    public static let maxInline = 24

    public static func text(letter: String, choiceText: String?) -> String {
        guard let raw = choiceText?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              !ContentText.needsRendering(raw),
              raw.count <= maxInline,
              !raw.contains("\n")
        else { return letter }
        return "\(letter) · \(raw)"
    }
}

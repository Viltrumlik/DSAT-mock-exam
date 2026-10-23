import Foundation

/// What the teacher's mark is worth on one homework, read off the server's `composed_grade`.
///
/// A homework can give the teacher's mark a share of the grade — `manual_grade_weight_percent`
/// — and then `review.grade` is that mark and nothing more: with a 20% share, a teacher's 50
/// sits inside a grade the server composed as 90. The phone used to print the mark on its own,
/// so a student read 50 where their teacher's screens said 90.
///
/// The arithmetic is the server's (`backend/classes/grade_composition.py`) and is NEVER redone
/// here. The `state` is the server's own word too: "the teacher has not marked yet" and "we
/// could not work it out" are different answers, and only the backend knows which.
///
/// Mirrors the web's `describeManualShare` (`features/classroom/submissionsApi.ts`), including
/// the thing it does by returning null: a homework with no manual component composes nothing,
/// and every screen reads it exactly as it did before the share existed.
public struct ComposedGrade: Decodable, Sendable, Equatable {
    /// The whole grade as it stands, 0-100, already weighted. `nil` while nothing that carries
    /// weight has a number behind it.
    public let percent: Double?
    /// The engines' part on its own 0-100 scale. `nil` when nothing here is graded
    /// automatically — which is not zero, and is never drawn as zero.
    public let automaticPercent: Double?
    /// The teacher's own mark on its own 0-100 scale, or `nil` while it is still owed.
    ///
    /// Not `review.grade`, which is out of the review's ceiling and, on a review the platform
    /// wrote itself, holds the automatic score rather than any teacher's judgement. This is the
    /// server's reading of the mark, and the only one a screen may attribute to a person.
    public let manualPercent: Double?
    /// The share the teacher awards by hand, 0-100 — as APPLIED, which is not always as typed
    /// (a homework with nothing auto-graded hands the mark the whole grade).
    public let manualWeight: Int
    public let automaticWeight: Int
    /// The mark is still owed AND can still move `percent`.
    public let awaiting: Bool
    /// The composition could not be read. A failure, never "no grade yet".
    public let unavailable: Bool

    public init(
        percent: Double?,
        automaticPercent: Double?,
        manualPercent: Double?,
        manualWeight: Int,
        automaticWeight: Int,
        awaiting: Bool,
        unavailable: Bool
    ) {
        self.percent = percent
        self.automaticPercent = automaticPercent
        self.manualPercent = manualPercent
        self.manualWeight = manualWeight
        self.automaticWeight = automaticWeight
        self.awaiting = awaiting
        self.unavailable = unavailable
    }

    // The server's three state names. Spelled here rather than compared inline so that a
    // rename on the backend is one grep away from this file.
    static let stateNoManualComponent = "no_manual_component"
    static let stateAwaitingManual = "awaiting_manual_mark"
    static let stateUnavailable = "unavailable"

    /// Thrown for a payload that composes nothing — no manual component, or a shape this
    /// cannot read. Both mean the same thing to every caller: show the raw mark, as before.
    /// Throwing rather than returning nil is what lets `try?` at the decode site do it.
    struct NothingComposed: Error {}

    private enum CodingKeys: String, CodingKey {
        case state, percent
        case automaticPercent = "automatic_percent"
        case manualPercent = "manual_percent"
        case manualWeight = "manual_weight_percent"
        case automaticWeight = "automatic_weight_percent"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // A payload with no readable `state` is malformed, not "final with no numbers": the
        // one thing this type must never do is invent a grade, so it declines instead.
        guard let state = try? c.decode(String.self, forKey: .state), state != Self.stateNoManualComponent else {
            throw NothingComposed()
        }
        percent = Self.number(c, .percent)
        automaticPercent = Self.number(c, .automaticPercent)
        manualPercent = Self.number(c, .manualPercent)
        let manual = Self.clamp(Self.number(c, .manualWeight) ?? 0)
        manualWeight = manual
        automaticWeight = Self.clamp(Self.number(c, .automaticWeight) ?? Double(100 - manual))
        awaiting = state == Self.stateAwaitingManual
        unavailable = state == Self.stateUnavailable
    }

    /// DRF can send a weight or a percent as a string; a grade lost to a number in quotes is
    /// the same bug `SubmissionReview` already guards against.
    private static func number(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Double? {
        if let d = try? c.decodeIfPresent(Double.self, forKey: key), d.isFinite { return d }
        if let s = try? c.decodeIfPresent(String.self, forKey: key), let d = Double(s), d.isFinite { return d }
        return nil
    }

    private static func clamp(_ value: Double) -> Int {
        Int(max(0, min(100, value)).rounded())
    }
}

/// The words a homework page says about a composed grade — the web's `gradePill`,
/// `GradeBreakdown` and `SettledSoFar`, line for line.
public enum ComposedGradeRules {

    /// The web's `pct`: `+n.toFixed(2)%` — "90%", "90.5%", "90.25%".
    public static func percentText(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        // `-0.00` is a real output of rounding a tiny negative, and "-0%" is not a grade.
        if rounded == 0 { return "0%" }
        var text = String(format: "%.2f", rounded)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text + "%"
    }

    /// The figure in the student's feedback card.
    ///
    /// Once a share exists the raw mark never stands in for the grade again: the whole number,
    /// or an honest word about why there isn't one yet, takes its place. The one exception is
    /// the bottom of the ladder — a 0% share on a homework with nothing auto-graded composes
    /// nothing at all, and the mark below is then the only number there is. Blanking the
    /// figure there would leave a card whose own line says the score is shown above.
    public static func pillText(review: SubmissionReview?, grade: ComposedGrade?) -> String? {
        if let grade {
            if grade.unavailable { return "Total unavailable" }
            if grade.awaiting { return "Waiting on your teacher's mark" }
            if let percent = grade.percent { return percentText(percent) }
        }
        return review?.scoreText
    }

    /// Where the grade came from, said under the figure that shows it. `nil` when there is
    /// nothing to explain — a 100% share IS the teacher's mark, and a sentence splitting it
    /// would be a sentence about nothing.
    public static func breakdownSentence(_ grade: ComposedGrade) -> String? {
        if grade.unavailable {
            return "Your teacher's mark is saved and it counts. It is only the single number "
                + "adding it to the automatically graded part that could not be worked out here "
                + "— ask your teacher for the total."
        }
        // A review that carries no weight is worth saying out loud: the student is looking at
        // a mark and a grade that will not move with it, and silence reads as the mark having
        // counted.
        if grade.manualWeight == 0 {
            return "This grade is worked out automatically. Your teacher's comments are theirs, "
                + "and they do not change the number."
        }
        if grade.automaticWeight == 0 { return nil }
        let automatic = grade.automaticPercent.map { " and stands at \(percentText($0))" } ?? ""
        // The mark comes from the composition, never from `review.grade`: on a review the
        // platform wrote itself that field holds the automatic score, and printing it here
        // would credit the teacher with a number they never typed.
        let mark = grade.manualPercent.map { " Your teacher marked it \(percentText($0))." } ?? ""
        return "Your teacher's mark is worth \(grade.manualWeight)% of this grade; the other "
            + "\(grade.automaticWeight)% is graded automatically\(automatic).\(mark)"
    }

    /// The part of a grade that is already decided, before the teacher has marked anything.
    public struct SettledSoFar: Equatable, Sendable {
        /// "90% so far" — the WHOLE grade as it stands, the automatic side already weighted.
        /// Not the automatic side's own percent: on an 80/20 split that reads as the grade,
        /// and a student who saw 95% beside "can only go up" finished on 90.
        public let figure: String
        public let sentence: String
    }

    /// Vocabulary mastered on Monday settles the automatic side at once; the upload slot may
    /// not be used until Friday. The server composes and serves that number anyway — this is
    /// what finally shows it, instead of leaving the student to guess.
    ///
    /// `nil` unless every part of it is true. `automaticWeight > 0` is load-bearing: where the
    /// teacher's mark is the whole grade an automatic score can still be recorded and it
    /// carries nothing, and calling that "already decided" promises a part of a grade that
    /// does not exist.
    public static func settledSoFar(_ grade: ComposedGrade) -> SettledSoFar? {
        guard grade.awaiting, !grade.unavailable, grade.automaticWeight > 0,
              let automatic = grade.automaticPercent, let soFar = grade.percent else { return nil }
        return SettledSoFar(
            figure: "\(percentText(soFar)) so far",
            sentence: "The automatically graded \(grade.automaticWeight)% of this homework is "
                + "settled at \(percentText(automatic)), which puts the whole grade at "
                + "\(percentText(soFar)) so far. The remaining \(grade.manualWeight)% is your "
                + "teacher's mark, and they are still checking your work — this grade can only go up."
        )
    }
}

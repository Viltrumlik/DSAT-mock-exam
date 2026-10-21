import Foundation

/// When a SCORE is celebrated.
///
/// Effort — handing something in — is celebrated every time (`FinishedWork`). An outcome is
/// celebrated only when it is good news the app can prove: a midterm the centre marked passed,
/// an assessment that beat the attempt before it on the same set, a word game the server says
/// this round mastered. Never a score that went down, never one the app only believes, and never
/// twice (`OutcomeMemory`). Its readers are the assessment review, the midterm report and the
/// word games' end screen.
public enum CelebrationRule {
    /// A midterm the centre marked passed. A pre-midterm is scored but never judged
    /// (`is_graded` false), so it is never celebrated, whatever it scored.
    public static func midterm(isGraded: Bool, passed: Bool?) -> Bool {
        isGraded && passed == true
    }

    /// An attempt that scored more than the attempt before it on the same set. With no attempt
    /// before it — or none this phone saw — there is nothing to beat, so nothing is celebrated.
    public static func assessment(percent: Double, previous: Double?) -> Bool {
        guard let previous else { return false }
        return percent > previous
    }

    /// A word-game round the server says mastered its game. The server recomputes
    /// `mode_mastered` from the stored round, so a round whose save failed — no summary — is
    /// never celebrated, and neither is a clean sweep the phone only thinks it saw.
    public static func vocabRound(_ summary: VocabSessionSummary?) -> Bool {
        summary?.modeMastered == true
    }
}

/// What this phone knows of a student's own scores — so an outcome is celebrated once, and an
/// assessment can be compared with the attempt before it.
///
/// The server keeps every attempt, but gives the app no list of them: `my-result` returns the
/// latest, any attempt's review is served by id, and the my-assignments lists carry each
/// homework's latest completed attempt (`attempt_id`, `percent`). So "the attempt before" is the
/// newest earlier attempt of the same set (`AssessmentReview.setKey`) that this phone has come
/// to know — shown on a review (`showAssessment`) or read off a list (`noteSeen`), so an attempt
/// taken on the web counts once a list has carried it. Attempt ids grow in the order attempts
/// are started, so an older attempt opened after a newer one is not "before" it and changes
/// nothing.
///
/// A phone that never saw an attempt cannot compare with it; the rule errs the quiet way —
/// nothing to compare with, nothing celebrated.
public struct OutcomeMemory: Codable, Sendable, Equatable {
    /// An attempt as this phone knows it: which one, and what it scored.
    public struct Attempt: Codable, Sendable, Equatable {
        public let attemptId: Int
        public let percent: Double

        public init(attemptId: Int, percent: Double) {
            self.attemptId = attemptId
            self.percent = percent
        }
    }

    /// The newest attempt known, per set — shown or noted, whichever path brought it. (Stored
    /// under its first build's name, `lastShown`, so what is on a phone still reads.)
    public private(set) var newestSeen: [String: Attempt] = [:]
    /// Per attempt that beat the newest one known before it: the score it beat.
    public private(set) var improvedFrom: [Int: Double] = [:]
    /// Outcomes already celebrated (`assessmentKey`, `midtermKey`).
    public private(set) var celebrated: Set<String> = []

    private enum CodingKeys: String, CodingKey {
        case newestSeen = "lastShown"
        case improvedFrom, celebrated
    }

    public init() {}

    /// Every field is optional on the way in, like `LastSeen`'s newer fields: a field added
    /// after a value was stored reads as its default and never wipes what that value did hold.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        newestSeen = try c.decodeIfPresent([String: Attempt].self, forKey: .newestSeen) ?? [:]
        improvedFrom = try c.decodeIfPresent([Int: Double].self, forKey: .improvedFrom) ?? [:]
        celebrated = try c.decodeIfPresent(Set<String>.self, forKey: .celebrated) ?? []
    }

    /// The key of a set, from the homework (assignment) it is in and its title — one homework
    /// carries a set once. The review (`AssessmentReview.setKey`) and a my-assignments list
    /// build it here, so an attempt noted from a list is the same set a review opens.
    public static func setKey(assignmentId: Int, setTitle: String?) -> String {
        "\(assignmentId)/\(setTitle ?? "")"
    }

    /// An attempt is known — read off a list rather than opened, say one taken on the web, or
    /// one the list brought in before its review was opened. It becomes the set's newest attempt
    /// when it is newer than the one known; an older one changes nothing. This never celebrates
    /// and returns nothing: it only decides what the next attempt is compared with.
    ///
    /// The attempt itself is compared with the one it replaced, as when it is shown, and the
    /// answer is kept, so its review says "up from" whether the list or the review reached the
    /// phone first.
    public mutating func noteSeen(setKey: String, attemptId: Int, percent: Double) {
        guard let newest = newestSeen[setKey] else {
            newestSeen[setKey] = Attempt(attemptId: attemptId, percent: percent)
            return
        }
        guard attemptId > newest.attemptId else { return }
        if CelebrationRule.assessment(percent: percent, previous: newest.percent) {
            improvedFrom[attemptId] = newest.percent
        }
        newestSeen[setKey] = Attempt(attemptId: attemptId, percent: percent)
    }

    /// A marked attempt is on screen. Returns the score it improved on — when it beat the newest
    /// earlier attempt of the same set this phone knew — on every showing, so the page can say
    /// so each time it opens; nil otherwise. It is returned only while the score on screen still
    /// beats it: a mark since corrected down to that score, or below, is no improvement.
    /// Remembers the attempt as the set's newest, as `noteSeen` does.
    public mutating func showAssessment(setKey: String, attemptId: Int, percent: Double) -> Double? {
        noteSeen(setKey: setKey, attemptId: attemptId, percent: percent)
        guard let from = improvedFrom[attemptId],
              CelebrationRule.assessment(percent: percent, previous: from)
        else { return nil }
        return from
    }

    /// For a review that may not name its set (`AssessmentReview.setKey`): without a key there is
    /// nothing to compare with and nothing to remember, so nothing is returned and nothing kept.
    public mutating func showAssessment(setKey: String?, attemptId: Int, percent: Double) -> Double? {
        guard let setKey else { return nil }
        return showAssessment(setKey: setKey, attemptId: attemptId, percent: percent)
    }

    /// Whether an outcome's celebration plays now: it qualifies and has never played. Marks it,
    /// so a page opened again does not celebrate again.
    public mutating func celebrate(_ key: String, if qualifies: Bool) -> Bool {
        guard qualifies, !celebrated.contains(key) else { return false }
        celebrated.insert(key)
        return true
    }

    public static func assessmentKey(_ attemptId: Int) -> String { "assessment.\(attemptId)" }
    public static func midtermKey(_ attemptId: Int) -> String { "midterm.\(attemptId)" }
}

/// The memory on the phone, one small JSON value per student in `UserDefaults` — the same home
/// as `LastSeenBook` and Today's seen results. Keyed by user id, so a second account on the
/// phone starts empty; a value that will not decode reads as empty rather than failing.
// @unchecked: the SDK does not mark UserDefaults Sendable, but Apple documents it as thread-safe.
public struct OutcomeBook: @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public static func key(userID: Int) -> String { "outcomes.v1.\(userID)" }

    public func read(userID: Int) -> OutcomeMemory {
        guard let data = defaults.data(forKey: Self.key(userID: userID)),
              let memory = try? JSONDecoder().decode(OutcomeMemory.self, from: data)
        else { return OutcomeMemory() }
        return memory
    }

    public func write(_ memory: OutcomeMemory, userID: Int) {
        guard let data = try? JSONEncoder().encode(memory) else { return }
        defaults.set(data, forKey: Self.key(userID: userID))
    }
}

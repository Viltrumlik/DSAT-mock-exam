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

/// What this phone has shown a student of their own scores — so an outcome is celebrated once,
/// and an assessment can be compared with the attempt before it.
///
/// The server keeps only a homework's newest attempt (`my-result`), so "the attempt before" is
/// the newest earlier one this phone showed for the same set (`AssessmentReview.setKey`).
/// Attempt ids grow in the order attempts are started, so an older attempt opened after a newer
/// one is not "before" it and changes nothing.
public struct OutcomeMemory: Codable, Sendable, Equatable {
    public struct Shown: Codable, Sendable, Equatable {
        public let attemptId: Int
        public let percent: Double

        public init(attemptId: Int, percent: Double) {
            self.attemptId = attemptId
            self.percent = percent
        }
    }

    /// The newest attempt shown, per set.
    public private(set) var lastShown: [String: Shown] = [:]
    /// Per attempt that beat the one before it: the score it beat.
    public private(set) var improvedFrom: [Int: Double] = [:]
    /// Outcomes already celebrated (`assessmentKey`, `midtermKey`).
    public private(set) var celebrated: Set<String> = []

    public init() {}

    /// A marked attempt is on screen. Returns the score it improved on — when it beat the newest
    /// earlier attempt on the same set this phone showed — on every showing, so the page can say
    /// so each time it opens; nil otherwise. Remembers it as the set's newest attempt.
    public mutating func showAssessment(setKey: String, attemptId: Int, percent: Double) -> Double? {
        if let previous = lastShown[setKey] {
            if attemptId > previous.attemptId {
                if CelebrationRule.assessment(percent: percent, previous: previous.percent) {
                    improvedFrom[attemptId] = previous.percent
                }
                lastShown[setKey] = Shown(attemptId: attemptId, percent: percent)
            }
        } else {
            lastShown[setKey] = Shown(attemptId: attemptId, percent: percent)
        }
        return improvedFrom[attemptId]
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

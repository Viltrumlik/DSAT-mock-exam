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
    ///
    /// Compared in whole percents, rounded half to even: that is the scale the server's lists
    /// carry a score on (`round(percent)` in Python, which rounds half to even — Swift's plain
    /// `rounded()` would round 12.5 up), while a review carries two decimals. The same attempt
    /// reads as 60 on a list and 60.4 on its review, and a retake that scored 60.2 is no better
    /// than either, so two scores that are the same whole percent are never an improvement.
    public static func assessment(percent: Double, previous: Double?) -> Bool {
        guard let previous else { return false }
        return whole(percent) > whole(previous)
    }

    /// A percent as the whole number the rule weighed. A page that says "Up from X%", or shows the
    /// score itself, writes this rather than a plain rounding, which goes half away from zero: at
    /// x.5 it would name a number the rule never compared (12.5 is 12 to the rule, and "13%"
    /// would claim a lower mark was beaten than the one that was).
    public static func wholePercent(_ value: Double) -> Int {
        Int(whole(value))
    }

    private static func whole(_ value: Double) -> Double {
        value.rounded(.toNearestOrEven)
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
/// latest, and any attempt's review is served by id. The my-assignments lists carry, per
/// homework, the latest STARTED attempt (`_hw_progress`), and report it as completed — with
/// `attempt_id` and a whole-number `percent` — only if that one is finished: a retake in
/// progress hides the completed attempt before it. So "the attempt before" is the newest earlier
/// attempt of the same set (`AssessmentReview.setKey`) that this phone has come to know — shown
/// on a review (`showAssessment`) or read off a list (`noteSeen`), so an attempt taken on the web
/// counts once a list has carried it. Attempt ids grow in the order attempts are started, so an
/// older attempt opened after a newer one is not "before" it and changes nothing.
///
/// What this cannot know is an attempt the phone never saw, neither opened nor carried by a
/// list. A phone that knows nothing of a set compares nothing and celebrates nothing. But a phone
/// that knows two attempts of a set, with a third taken between them on the web that no list
/// ever carried, will say "Up from X%" against the older of the two, an attempt that is not the
/// one before. Frequent list loads narrow that gap; only a field from the server — the previous
/// attempt's score on the review — would close it.
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
    /// one the list brought in before its review was opened. Only a completed, graded attempt
    /// has a score to note. It becomes the set's newest attempt when it is newer than the one
    /// known; an older or the same one changes nothing (the same one is refined by its review,
    /// `showAssessment`, whose number is exact where a list's is a whole percent). This never
    /// celebrates and returns nothing: it only decides what the next attempt is compared with.
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

    /// Every completed, graded assessment attempt a my-assignments list carries becomes known
    /// (`noteSeen(setKey:attemptId:percent:)`), so that an attempt taken on the web — or finished
    /// before its review was ever opened — is the attempt before the next one. Read per
    /// `AssessmentHomeworkLink`: the list's top-level `assessment_progress` covers only the first
    /// bundled set. The key is built as the review builds it. Never celebrates anything.
    public mutating func noteSeen(in assignments: [AssignmentListing]) {
        for assignment in assignments {
            for link in assignment.assessmentHomeworks {
                // `percent` is only sent with a mark; a submission still waiting for one has none.
                guard let progress = link.progress, progress.isCompleted, progress.graded != false,
                      let attemptId = progress.attemptId, let percent = progress.percent else { continue }
                noteSeen(
                    setKey: Self.setKey(assignmentId: assignment.id, setTitle: link.assessmentSet?.title),
                    attemptId: attemptId,
                    percent: Double(percent)
                )
            }
        }
    }

    /// A marked attempt is on screen. Returns the score it improved on — when it beat the newest
    /// earlier attempt of the same set this phone knew — on every showing, so the page can say
    /// so each time it opens; nil otherwise. It is returned only while the score on screen still
    /// beats it: a mark since corrected down to that score, or below, is no improvement (scores
    /// are compared in whole percents, `CelebrationRule.assessment`).
    /// Remembers the attempt as the set's newest, as `noteSeen` does; when that is the attempt
    /// already known — a list brought it, or it was shown before — the review's exact number
    /// replaces the stored one, which a list had rounded and a re-grade may have moved. That
    /// changes only what the next attempt is measured against: an attempt is never compared with
    /// itself, so this never decides whether this one improved.
    public mutating func showAssessment(setKey: String, attemptId: Int, percent: Double) -> Double? {
        noteSeen(setKey: setKey, attemptId: attemptId, percent: percent)
        if newestSeen[setKey]?.attemptId == attemptId {
            newestSeen[setKey] = Attempt(attemptId: attemptId, percent: percent)
        }
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

    /// A my-assignments list has arrived (`OutcomeMemory.noteSeen(in:)`): what it carries becomes
    /// known to this phone before any review decides "improved". Called wherever the app loads
    /// the student's assignments to show them, so an attempt counts as "the attempt before" on
    /// whichever page first met it. Synchronous, so it cannot interleave with a review's own
    /// read-and-write of the same memory on the main actor; and written only when it learned
    /// something, since most loads carry nothing new.
    public func noteSeen(in assignments: [AssignmentListing], userID: Int) {
        var memory = read(userID: userID)
        let before = memory
        memory.noteSeen(in: assignments)
        if memory != before { write(memory, userID: userID) }
    }
}

import Foundation

// The Class tab's SAT SCORE gauge (owner's decision Q1, 2026-10-28): the gauge shows the score
// the student's current LEVELS stand for, not a test result. "har bir levelga o'tganda score
// o'zgaradi" — the number moves when a level is passed. The ladder is a kit constant; there is
// no server field for it.

/// A subject on the Class tab, as the roadmap names it. Math comes first, as on the server.
public enum ClassSubject: String, Sendable, Equatable, CaseIterable, Comparable {
    case math
    /// Reading & Writing — the server's `english` track.
    case english

    /// The roadmap track's `subject` key. Nil for one this build does not know.
    public init?(trackSubject: String) {
        self.init(rawValue: trackSubject.lowercased())
    }

    public static func < (lhs: ClassSubject, rhs: ClassSubject) -> Bool {
        allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
    }
}

/// The section score each level stands for.
public enum LevelScoreLadder {
    /// The owner's ladder: Math Foundation 450 · Junior 550 · Middle 650 · Senior 750;
    /// English Junior 550 · Middle 650 · Senior 750. English has no Foundation rung.
    public static let scores: [ClassSubject: [String: Int]] = [
        .math: ["foundation": 450, "junior": 550, "middle": 650, "senior": 750],
        .english: ["junior": 550, "middle": 650, "senior": 750],
    ]

    /// One SAT section, 200–800.
    public static let sectionRange: ClosedRange<Int> = 200...800
    /// Both sections, 400–1600.
    public static let totalRange: ClosedRange<Int> = 400...1600

    /// The section score for a level code (`junior`, …). Nil for a rung the ladder does not
    /// price — an English class mis-tagged `foundation`, say — rather than a guess.
    public static func sectionScore(subject: ClassSubject, level: String) -> Int? {
        scores[subject]?[level.lowercased()]
    }
}

/// The semicircle gauge: one number, the range it sits in, and where the target ring goes.
///
/// * Both subjects: Math level + English level on 400–1600 ("SAT SCORE"; Junior + Junior =
///   1100), with `User.target_score` as the target.
/// * One subject: that section alone on 200–800 ("MATH SCORE" / "ENGLISH SCORE"), with that
///   section's own target (`target_math` / `target_english`).
/// * A subject counts only when its track names an own level the ladder prices. With none,
///   there is no gauge.
///
/// Everything is clamped into the range; a target of 0 or less is no target.
public struct SATGauge: Sendable, Equatable {
    /// Nil when the gauge is the whole SAT; the one section otherwise.
    public let subject: ClassSubject?
    public let score: Int
    public let range: ClosedRange<Int>
    public let target: Int?

    /// "SAT SCORE", "MATH SCORE" or "ENGLISH SCORE".
    public var title: String {
        switch subject {
        case nil: return "SAT SCORE"
        case .math: return "MATH SCORE"
        case .english: return "ENGLISH SCORE"
        }
    }

    /// 0…1 along the arc, left to right.
    public var scoreFraction: Double { Self.fraction(score, in: range) }
    /// 0…1 along the arc, or nil with no target.
    public var targetFraction: Double? { target.map { Self.fraction($0, in: range) } }
    /// The filled arc in degrees, 0…180 — the design's `180 * (score - 400) / 1200`.
    public var scoreAngle: Double { Self.angle(scoreFraction) }

    /// `levels` maps each subject the student studies to their own level code.
    public init?(levels: [ClassSubject: String], targetScore: Int?, targetMath: Int?, targetEnglish: Int?) {
        let priced = levels.compactMap { subject, level in
            LevelScoreLadder.sectionScore(subject: subject, level: level).map { (subject, $0) }
        }.sorted { $0.0 < $1.0 }
        guard !priced.isEmpty else { return nil }

        let range: ClosedRange<Int>
        let rawTarget: Int?
        if priced.count == 1, let only = priced.first {
            subject = only.0
            range = LevelScoreLadder.sectionRange
            rawTarget = only.0 == .math ? targetMath : targetEnglish
        } else {
            subject = nil
            range = LevelScoreLadder.totalRange
            rawTarget = targetScore
        }
        self.range = range
        score = Self.clamp(priced.reduce(0) { $0 + $1.1 }, to: range)
        target = rawTarget.flatMap { $0 > 0 ? Self.clamp($0, to: range) : nil }
    }

    /// From the roadmap: each track's own level, the tracks without one left out.
    public init?(tracks: [RoadmapTrack], targetScore: Int?, targetMath: Int?, targetEnglish: Int?) {
        var levels: [ClassSubject: String] = [:]
        for track in tracks {
            guard let subject = ClassSubject(trackSubject: track.subject),
                  let own = track.ownLevel, !own.isEmpty, levels[subject] == nil else { continue }
            levels[subject] = own
        }
        self.init(levels: levels, targetScore: targetScore, targetMath: targetMath, targetEnglish: targetEnglish)
    }

    // MARK: Maths

    /// Where `value` sits in `range`, 0…1.
    public static func fraction(_ value: Int, in range: ClosedRange<Int>) -> Double {
        let span = Double(range.upperBound - range.lowerBound)
        guard span > 0 else { return 0 }
        return min(1, max(0, Double(value - range.lowerBound) / span))
    }

    /// A fraction of the arc in degrees, 0…180.
    public static func angle(_ fraction: Double) -> Double {
        min(1, max(0, fraction)) * 180
    }

    /// Where a marker sits on the arc, from the circle's centre, in screen terms (y grows
    /// downward): 0 is the left end, 0.5 the top, 1 the right end. The target ring goes here.
    public static func point(_ fraction: Double, radius: Double) -> (x: Double, y: Double) {
        let theta = Double.pi * min(1, max(0, fraction))
        return (-radius * cos(theta), -radius * sin(theta))
    }

    static func clamp(_ value: Int, to range: ClosedRange<Int>) -> Int {
        min(range.upperBound, max(range.lowerBound, value))
    }
}

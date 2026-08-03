import Foundation

/// The student's progress, computed from what they have actually sat.
///
/// Pure: it takes the lists the app has already fetched and returns numbers. Nothing here
/// is invented — every field is nil-able and a section that has no real data says so
/// rather than showing a zero, because a fabricated "0%" reads as a result.
public struct Analytics: Sendable, Equatable {
    public struct ScorePoint: Sendable, Equatable, Identifiable {
        public let id: Int
        public let label: String
        public let title: String
        public let subject: String
        public let score: Double
        public let date: Date?
    }

    public struct SubjectStat: Sendable, Equatable, Identifiable {
        public let id: String
        public let label: String
        public let attempts: Int
        public let best: Double?
        public let average: Double?
        /// Latest minus first, on this subject. Nil until there are two to compare.
        public let delta: Double?
    }

    public let current: Double?
    public let best: Double?
    public let average: Double?
    public let target: Int?
    /// Target minus current. Negative means they are past it.
    public let gap: Double?
    public let goalReached: Bool
    public let totalAttempts: Int
    public let history: [ScorePoint]
    public let subjects: [SubjectStat]
    /// Latest minus the one before it. Nil with fewer than two results.
    public let trendDelta: Double?
    public let midtermsSat: Int
    public let mocksSat: Int
    /// Homework the student has handed in, out of what they were given.
    public let homeworkDone: Int
    public let homeworkTotal: Int

    public var hasAnyResult: Bool { !history.isEmpty }

    public static let empty = Analytics(
        current: nil, best: nil, average: nil, target: nil, gap: nil, goalReached: false,
        totalAttempts: 0, history: [], subjects: [], trendDelta: nil,
        midtermsSat: 0, mocksSat: 0, homeworkDone: 0, homeworkTotal: 0
    )

    /// Build the model.
    ///
    /// Past papers carry the score history because they are the only thing every student
    /// sits repeatedly on the same scale. Mocks and midterms are counted, not averaged
    /// into it: a midterm is scored out of 100 or 800 depending on its scale, and mixing
    /// those into one "average score" produces a number that means nothing.
    public static func build(
        pastpaperAttempts: [PastpaperAttemptSummary],
        mocks: [MockListing],
        midterms: [MidtermListing],
        assignments: [AssignmentListing],
        user: CurrentUser?
    ) -> Analytics {
        let scored = pastpaperAttempts
            .filter { $0.isCompleted && $0.score != nil }
            .sorted { orderKey($0) < orderKey($1) }

        let history: [ScorePoint] = scored.enumerated().map { index, attempt in
            let date = attempt.submittedAt.flatMap { JSONCoding.parseServerDate($0) }
            return ScorePoint(
                id: attempt.id,
                label: date.map { Self.shortDay.string(from: $0) } ?? "#\(index + 1)",
                title: attempt.title?.isEmpty == false ? attempt.title! : "Past paper",
                subject: attempt.subject ?? "",
                score: attempt.score ?? 0,
                date: date
            )
        }

        let values = history.map(\.score)
        let current = values.last
        let best = values.max()
        let average = values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
        let trendDelta = values.count >= 2 ? values[values.count - 1] - values[values.count - 2] : nil

        let target = user?.targetScore
        let gap: Double? = {
            guard let target, let current else { return nil }
            return Double(target) - current
        }()

        var subjects: [SubjectStat] = []
        for (key, label) in [("MATH", "Math"), ("READING_WRITING", "Reading & Writing")] {
            let rows = history.filter { normalise($0.subject) == key }
            guard !rows.isEmpty else { continue }
            let scores = rows.map(\.score)
            subjects.append(
                SubjectStat(
                    id: key,
                    label: label,
                    attempts: rows.count,
                    best: scores.max(),
                    average: scores.reduce(0, +) / Double(scores.count),
                    delta: scores.count >= 2 ? scores[scores.count - 1] - scores[0] : nil
                )
            )
        }

        let handedIn = assignments.filter {
            ["submitted", "graded", "returned", "completed"].contains(($0.workflowStatus ?? "").lowercased())
        }

        return Analytics(
            current: current,
            best: best,
            average: average,
            target: target,
            gap: gap,
            goalReached: {
                guard let target, let best else { return false }
                return best >= Double(target)
            }(),
            totalAttempts: scored.count,
            history: history,
            subjects: subjects,
            trendDelta: trendDelta,
            midtermsSat: midterms.filter(\.submitted).count,
            mocksSat: mocks.filter(\.submitted).count,
            homeworkDone: handedIn.count,
            homeworkTotal: assignments.count
        )
    }

    /// Chronological where dates exist, by id otherwise.
    ///
    /// Sorting on the date alone would scatter every attempt with no `submitted_at` to
    /// the front of the chart in whatever order the API returned them.
    private static func orderKey(_ attempt: PastpaperAttemptSummary) -> Double {
        if let raw = attempt.submittedAt, let date = JSONCoding.parseServerDate(raw) {
            return date.timeIntervalSince1970
        }
        return Double(attempt.id)
    }

    private static func normalise(_ subject: String) -> String {
        let upper = subject.uppercased()
        if upper.contains("MATH") { return "MATH" }
        if upper.contains("READ") || upper.contains("ENGLISH") || upper == "RW" { return "READING_WRITING" }
        return upper
    }

    nonisolated(unsafe) private static let shortDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "d MMM"
        return f
    }()
}

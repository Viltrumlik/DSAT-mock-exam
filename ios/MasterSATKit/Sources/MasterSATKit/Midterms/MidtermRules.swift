import Foundation

// The midterm list's buckets and words, ported from the web's `app/(main)/midterm/MidtermList.tsx`.
// The app still has no Start button — papers are sat in the centre — but it sorts them the
// way the site does, so a student sees the same paper in the same place on both.

/// Where a midterm sits on the list.
public enum MidtermBucket: String, CaseIterable, Sendable {
    /// Can be sat now: open, begun and not handed in, or a granted re-sit.
    case available
    /// Not open yet: before its window, or the teacher has not started the room.
    case scheduled
    /// The window closed without a sitting. Said as "Closed", never "Missed".
    case closed
    /// Handed in.
    case past

    public var title: String {
        switch self {
        case .available: return "Available now"
        case .scheduled: return "Scheduled"
        case .closed: return "Closed"
        case .past: return "Past attempts"
        }
    }
}

extension MidtermListing {
    /// The web's rules, in its order. A granted re-sit out-ranks every schedule bucket (the
    /// server exempts it from the class window), so it is never "scheduled" or "closed", and
    /// never "past" either — that would show only the old mark it is about to replace.
    public var bucket: MidtermBucket {
        if resitOpen || (!submitted && (inProgress || isOpen)) { return .available }
        if submitted { return .past }
        if isBeforeStart || awaitingCode { return .scheduled }
        return .closed
    }

    /// The row's badge.
    public var badge: String {
        switch bucket {
        case .available:
            if resitOpen { return "Re-sit available" }
            return inProgress ? "In progress" : "Available"
        case .scheduled: return awaitingCode ? "Not started" : "Scheduled"
        case .closed: return "Closed"
        case .past: return "Completed"
        }
    }

    /// "1h 5m · 40 questions · Mathematics" — the row's meta line.
    public var metaLine: String {
        var parts: [String] = []
        if let minutes = durationMinutes, minutes > 0 {
            parts.append(minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m")
        }
        if let count = questionCount, count > 0 { parts.append("\(count) questions") }
        let subject = MidtermWording.subjectLabel(subject)
        if !subject.isEmpty { parts.append(subject) }
        return parts.joined(separator: " · ")
    }

    /// The score to show: only once the teacher has released it.
    public var releasedScore: Double? { resultsVisible ? score : nil }
}

public enum MidtermWording {
    /// "Mathematics" / "Reading & Writing" — the web's `subjectLabel`: a midterm is one or
    /// the other. Empty only when the server sent nothing.
    public static func subjectLabel(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces).uppercased()
        if value.isEmpty { return "" }
        return value == "MATH" ? "Mathematics" : "Reading & Writing"
    }

    /// "starts in 2d 4h 10m" / "3h 5m 9s" / "4m 12s" — the web's countdown under a scheduled
    /// row. Nil once the moment has come.
    public static func startsIn(_ target: Date, now: Date = Date()) -> String? {
        let seconds = Int(target.timeIntervalSince(now).rounded(.down))
        guard seconds > 0 else { return nil }
        let d = seconds / 86_400, h = (seconds % 86_400) / 3600, m = (seconds % 3600) / 60, s = seconds % 60
        if d > 0 { return "\(d)d \(h)h \(m)m" }
        if h > 0 { return "\(h)h \(m)m \(s)s" }
        return "\(m)m \(s)s"
    }
}

// MARK: - The error report's words

extension MidtermErrorReport {
    /// "topic" on a paper taught from the learning center's own list (junior and foundation
    /// maths), "skill" on an SAT-tagged one. The server decides; anything else is "skill".
    public var noun: String { topicNoun == "topic" ? "topic" : "skill" }

    /// "Topics" / "Skills".
    public var nounPluralTitle: String { noun == "topic" ? "Topics" : "Skills" }

    /// Round((total − wrong) / total × 100), the web's accuracy; 0 for an empty paper.
    public var accuracyPercent: Int {
        guard totalCount > 0 else { return 0 }
        return Int((Double(totalCount - wrongCount) / Double(totalCount) * 100).rounded())
    }
}

/// Why a midterm's error report is not on screen. Each needs its own words.
public enum MidtermReportUnavailable: Equatable, Sendable {
    /// 403: the teacher has not published the results (or the attempt is not finished).
    case sealed(message: String)
    /// 409 `not_analysed`: the sitting predates the per-question record, so there is no
    /// breakdown to show. Not an error the student can fix, and not a clean paper either.
    case notAnalysed
    /// Anything else — offline, a server fault. Worth a retry.
    case failed(message: String)

    public init(_ error: Error) {
        switch error as? APIError {
        case .forbidden(let detail, _)?:
            self = .sealed(message: detail.isEmpty ? "Your teacher has not published these results yet." : detail)
        case .conflict?:
            self = .notAnalysed
        case let apiError?:
            self = .failed(message: apiError.errorDescription ?? "Your error report is not available for this attempt.")
        case nil:
            self = .failed(message: error.localizedDescription)
        }
    }
}

import Foundation

// The words My Progress writes on its own, ported line for line from the web
// (`frontend/src/features/progress/peerInsights.ts`, `PeerGroupCard.tsx`, `MyProgressPage.tsx`).
//
// Each sentence is a pure function of the payload, so every one is testable and none is
// invented: it reads a figure the server sent. Growth-oriented by rule — a strength is named,
// a gap is said as the next thing to do, and nothing calls a student behind, low or last.

// MARK: - Numbers

public enum ProgressFormat {
    /// JavaScript's `Math.round`: halves go UP, towards +∞ — `Math.round(-2.5)` is `-2`.
    /// Swift's `.rounded()` sends halves away from zero, which would make a gap of −2.5 read
    /// "−3 vs group" here and "−2 vs group" on the laptop.
    public static func jsRound(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }

    /// A whole number as text, or nil for NaN/∞ — which must never reach the screen as "0".
    static func whole(_ value: Double) -> String? {
        guard value.isFinite else { return nil }
        let rounded = jsRound(value)
        // −0 prints as "-0"; a rounded value of zero is just zero.
        return String(Int(rounded == 0 ? 0 : rounded))
    }

    /// "83%", or an em dash. NEVER "0%" for a number the server did not send.
    public static func percent(_ value: Double?) -> String {
        guard let value, let text = whole(value) else { return "—" }
        return "\(text)%"
    }

    /// "120", or an em dash — for counts such as words mastered.
    public static func count(_ value: Double?) -> String {
        guard let value, let text = whole(value) else { return "—" }
        return text
    }

    /// "+11 vs group", "−4 vs group" (a true minus sign) or "Level with group"; nil when
    /// either side is missing.
    public static func deltaChip(_ gap: Double?) -> String? {
        guard let gap, gap.isFinite else { return nil }
        let rounded = jsRound(gap)
        if rounded == 0 { return "Level with group" }
        let size = whole(abs(rounded)) ?? "0"
        return "\(rounded > 0 ? "+" : "−")\(size) vs group"
    }
}

// MARK: - The sentences

public struct PeerInsight: Sendable, Equatable, Identifiable {
    public enum Tone: String, Sendable { case success, warning, info, muted }
    public enum Icon: String, Sendable { case trophy, sparkles, target, calendar, lock, users }

    public let key: String
    public let tone: Tone
    public let icon: Icon
    public let text: String

    public var id: String { key }
}

public enum PeerInsights {
    /// The student's value minus the group's average, to one decimal — or nil when either is
    /// missing.
    public static func gapToGroup(_ metric: PeerProgressMetric?) -> Double? {
        guard let metric, let you = metric.you, let average = metric.groupAverage else { return nil }
        return ProgressFormat.jsRound((you - average) * 10) / 10
    }

    /// At most three sentences, strongest first, so the card stays a summary rather than a
    /// report.
    public static func insights(for group: PeerProgressGroup, minPeers: Int) -> [PeerInsight] {
        let m = group.metrics
        let all: [PeerProgressMetric?] = [m.attendance, m.homework, m.overall, m.vocabulary]

        // Nothing about the group can be said yet — say why, once, and stop.
        if !all.contains(where: { $0?.groupAverage != nil }) {
            return [PeerInsight(
                key: "few",
                tone: .muted,
                icon: .users,
                text: "Group figures appear once \(minPeers) classmates have marks in this class."
            )]
        }

        var out: [PeerInsight] = []

        // Strengths first. The top quarter on any measure is named together; failing that,
        // being above the middle overall is still worth saying.
        let measures: [(name: String, metric: PeerProgressMetric?)] = [
            ("attendance", m.attendance),
            ("homework", m.homework),
            ("words mastered", m.vocabulary),
        ]
        let tops = measures.filter { $0.metric?.standing == .topQuarter }.map(\.name)
        if !tops.isEmpty {
            out.append(PeerInsight(
                key: "top", tone: .success, icon: .trophy,
                text: "Top quarter of your group for \(list(tops))."
            ))
        } else if m.overall.standing == .upperHalf {
            out.append(PeerInsight(
                key: "upper", tone: .success, icon: .sparkles,
                text: "Overall, you're in the upper half of your group."
            ))
        }

        // The month so far, which can be good news the term's average hides: a student under
        // the group across the term who is ahead of it THIS month should hear that first.
        let marked = group.attendanceTrend.filter { $0.you != nil }
        let last = marked.last
        let previous = marked.count >= 2 ? marked[marked.count - 2] : nil
        var aheadThisMonth = false
        if let last, let you = last.you, let groupRate = last.group {
            aheadThisMonth = you >= groupRate
        }
        if aheadThisMonth, m.attendance.standing != .topQuarter,
           let last, let you = last.you, let groupRate = last.group {
            out.append(PeerInsight(
                key: "month-ahead", tone: .success, icon: .sparkles,
                text: "In \(monthName(last.month)) your attendance (\(whole(you))%) is above your group's (\(whole(groupRate))%)."
            ))
        } else if let last, let now = last.you, let previous, let before = previous.you, now - before >= 5 {
            out.append(PeerInsight(
                key: "trend-up", tone: .success, icon: .sparkles,
                text: "Your attendance is up from \(whole(before))% in \(monthName(previous.month)) to \(whole(now))% in \(monthName(last.month))."
            ))
        }

        // The actionable gap: a count of homework, which is a thing to go and do.
        let toReach = m.homeworkDetail.toReachAverage
        if toReach > 0 {
            out.append(PeerInsight(
                key: "homework-gap", tone: .warning, icon: .target,
                text: "\(toReach) more homework \(toReach == 1 ? "brings" : "bring") you up to your group's average."
            ))
        }

        // Attendance under the group's: the group's figure, and what moves it — never a
        // verdict. Not said in a month the student is already ahead: it would contradict the
        // line above it.
        if !aheadThisMonth, let gap = gapToGroup(m.attendance), gap < 0, let average = m.attendance.groupAverage {
            out.append(PeerInsight(
                key: "attendance-gap", tone: .info, icon: .calendar,
                text: "Your group attends \(whole(average))% of lessons — every lesson you come to closes the gap."
            ))
        }

        if group.standingsHidden {
            out.append(PeerInsight(
                key: "hidden", tone: .muted, icon: .lock,
                text: "Your teacher keeps standings in this class private, so only averages are shown."
            ))
        }

        return Array(out.prefix(3))
    }

    /// "attendance", "attendance and homework", "attendance, homework and words mastered".
    static func list(_ names: [String]) -> String {
        guard names.count > 1, let lastName = names.last else { return names.first ?? "" }
        return "\(names.dropLast().joined(separator: ", ")) and \(lastName)"
    }

    /// "2026-09" → "September". English on purpose, like the web: the page is in English, and
    /// a sentence must not change with the phone's region.
    static func monthName(_ month: String) -> String {
        let parts = month.split(separator: "-")
        let number = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        // The web's `new Date(y, (m || 1) - 1, 1)`: a missing month is January, and a
        // thirteenth rolls into the next year's January.
        let index = ((number == 0 ? 1 : number) - 1) % 12
        return monthNames[(index + 12) % 12]
    }

    private static let monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    private static func whole(_ value: Double) -> String {
        ProgressFormat.whole(value) ?? "—"
    }
}

// MARK: - A measure's tile

/// The words on one metric tile of a "You and your group" card.
public enum PeerMetricText {
    public enum Unit: Sendable { case percent, words }

    /// The student's figure: "92%", "120", or "—".
    public static func value(_ metric: PeerProgressMetric, unit: Unit) -> String {
        unit == .percent ? ProgressFormat.percent(metric.you) : ProgressFormat.count(metric.you)
    }

    /// "Group average 81%" / "Group average 85 words", or "No group figure yet".
    public static func groupAverage(_ metric: PeerProgressMetric, unit: Unit) -> String {
        guard let average = metric.groupAverage else { return "No group figure yet" }
        switch unit {
        case .percent: return "Group average \(ProgressFormat.percent(average))"
        case .words: return "Group average \(ProgressFormat.count(average)) words"
        }
    }

    /// The band line: a quarter named, or — in the lower half — the distance to the average,
    /// which is a next step rather than a label. Nil when there is no band to state.
    public static func band(_ metric: PeerProgressMetric, unit: Unit) -> String? {
        switch metric.standing {
        case .topQuarter: return "Top quarter of your group"
        case .upperHalf: return "Upper half of your group"
        case .lowerHalf:
            guard let gap = PeerInsights.gapToGroup(metric), let size = ProgressFormat.whole(abs(ProgressFormat.jsRound(gap))) else {
                return nil
            }
            return "\(size) \(unit == .percent ? "points" : "words") to your group's average"
        case nil: return nil
        }
    }

    /// "12 present · 1 late · 1 excused" — what was marked, zeros left out (but "present"
    /// always said). "Nothing marked for you yet" when the student has no rate.
    public static func attendanceDetail(_ metric: PeerProgressMetric, detail: PeerAttendanceDetail) -> String {
        guard metric.you != nil else { return "Nothing marked for you yet" }
        var parts = ["\(detail.present) present"]
        if detail.late != 0 { parts.append("\(detail.late) late") }
        if detail.absent != 0 { parts.append("\(detail.absent) missed") }
        if detail.excused != 0 { parts.append("\(detail.excused) excused") }
        return parts.joined(separator: " · ")
    }

    /// "6 of 8 done · 2 left", or "No homework set yet".
    public static func homeworkDetail(_ detail: PeerHomeworkDetail) -> String {
        guard detail.total != 0 else { return "No homework set yet" }
        return "\(detail.completed) of \(detail.total) done · \(detail.remaining) left"
    }

    public static let overallDetail = "Attendance and homework, counted together"
    public static let vocabularyDetail = "Words proved in all four games"

    /// "18 students", "1 student".
    public static func groupSize(_ size: Int) -> String {
        "\(size) \(size == 1 ? "student" : "students")"
    }

    /// Where the student and the group's average sit on a tile's scale, 0…1 each. Percentages
    /// are out of 100; a count is out of a quarter more than the larger of the two, so both
    /// marks stay on the scale.
    public static func scale(_ metric: PeerProgressMetric, unit: Unit) -> (you: Double?, group: Double?) {
        let maximum: Double
        switch unit {
        case .percent: maximum = 100
        case .words: maximum = max(1, metric.you ?? 0, metric.groupAverage ?? 0) * 1.25
        }
        func position(_ value: Double?) -> Double? {
            guard let value, value.isFinite else { return nil }
            return min(1, max(0, value / maximum))
        }
        return (position(metric.you), position(metric.groupAverage))
    }
}

// MARK: - The ladder's words

/// The words on My Progress's "Level by level" cards.
public enum MyProgressText {
    /// The pill on a level: "Studying now", "Finished", "No record", "Ahead of you".
    public static func pill(_ state: MyProgressLevelState?) -> String {
        switch state {
        case .current: return "Studying now"
        case .done: return "Finished"
        case .upcoming: return "Ahead of you"
        case .notRecorded, nil: return "No record"
        }
    }

    /// The honest sentence for a rung with no numbers, which is a different thing per state.
    public static func emptyNote(_ state: MyProgressLevelState?) -> String {
        switch state {
        case .upcoming: return "You haven’t started this level yet."
        case .notRecorded: return "You joined the course after this level, so there is nothing recorded here."
        default: return "Nothing has been marked or set for this level yet."
        }
    }

    /// NOT "present + late of counted" — that read as a perfect record beside a percentage
    /// saying otherwise, because a late is worth half a lesson. Say what was marked instead.
    public static func attendanceDetail(_ attendance: MyProgressAttendance?) -> String {
        guard let attendance else { return "not marked" }
        var parts = ["\(attendance.present) present"]
        if attendance.late != 0 { parts.append("\(attendance.late) late") }
        if attendance.absent != 0 { parts.append("\(attendance.absent) missed") }
        return parts.joined(separator: " · ")
    }

    public static func homeworkDetail(_ homework: MyProgressHomework?) -> String {
        guard let homework else { return "none set" }
        return "\(homework.completed) of \(homework.total)"
    }

    /// Said out loud when only one half exists — otherwise a number looks like it covers both
    /// and quietly does not.
    public static func basisNote(_ basis: [String]) -> String? {
        guard basis.count == 1, let only = basis.first else { return nil }
        return "Counted from \(only) only — there is nothing recorded for the other half yet."
    }

    public static func trackLine(_ track: MyProgressTrack) -> String {
        guard let label = track.currentLevelLabel, !label.isEmpty else { return "No level set on your class yet." }
        return "You are on \(label)."
    }

    public static let footnote = "Each level’s percentage is your attendance and your homework counted equally. Attendance counts a late as half a lesson, and an excused absence is left out altogether. A level with nothing recorded shows a dash rather than a zero. Your group’s figures are averages over the students in your class now, and appear once enough classmates have marks."
}

// MARK: - Dates

/// The server's plain dates, read as the student's local calendar day.
public enum LearnDates {
    /// `YYYY-MM-DD` at local midnight — not UTC, or it reads as the day before for anyone
    /// west of Greenwich.
    public static func day(_ iso: String, calendar: Calendar = .current) -> Date? {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// `YYYY-MM` → the first of that month, local.
    public static func month(_ iso: String, calendar: Calendar = .current) -> Date? {
        let parts = iso.prefix(7).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1))
    }
}

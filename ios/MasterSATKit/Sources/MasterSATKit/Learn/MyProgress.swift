import Foundation

// My Progress — `GET /api/classes/progress/` (how each level went) and
// `GET /api/classes/progress/peers/` (the student beside their group).
//
// Contracts: `backend/classes/progress.py` and `backend/classes/progress_peers.py`. The rule
// both pages live by, and the reason nearly every number here is optional: an unknown figure
// is nil and shows as "—", NEVER as 0%. A level nobody taught the student, a register nobody
// marked, a group too small to average — each is "we don't know", not "you did none of it".

// MARK: - The ladder

public struct MyProgressReport: Decodable, Sendable, Equatable {
    public let tracks: [MyProgressTrack]
    /// The mean of every level that has a number; nil when nothing is measurable yet.
    public let overall: Double?
    public let weights: Weights

    public struct Weights: Sendable, Equatable {
        public let attendance: Double
        public let homework: Double
    }

    private enum CodingKeys: String, CodingKey { case tracks, overall, weights }
    private enum WeightKeys: String, CodingKey { case attendance, homework }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tracks = LearnDecode.list(c, .tracks)
        overall = LearnDecode.double(c, .overall)
        if let w = try? c.nestedContainer(keyedBy: WeightKeys.self, forKey: .weights) {
            weights = Weights(
                attendance: LearnDecode.double(w, .attendance) ?? 0.5,
                homework: LearnDecode.double(w, .homework) ?? 0.5
            )
        } else {
            weights = Weights(attendance: 0.5, homework: 0.5)
        }
    }
}

public struct MyProgressTrack: Decodable, Sendable, Equatable, Identifiable {
    /// `math` or `english`.
    public let subject: String
    public let subjectLabel: String
    public let currentLevel: String?
    public let currentLevelLabel: String?
    public let levels: [MyProgressLevel]

    public var id: String { subject }

    private enum CodingKeys: String, CodingKey {
        case subject, levels
        case subjectLabel = "subject_label"
        case currentLevel = "current_level"
        case currentLevelLabel = "current_level_label"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        subject = try c.decode(String.self, forKey: .subject)
        subjectLabel = LearnDecode.string(c, .subjectLabel) ?? subject.capitalized
        currentLevel = LearnDecode.string(c, .currentLevel)
        currentLevelLabel = LearnDecode.string(c, .currentLevelLabel)
        levels = LearnDecode.list(c, .levels)
    }
}

public enum MyProgressLevelState: String, Sendable, Equatable {
    /// The level they are studying now.
    case current
    /// A level they have finished, with real numbers.
    case done
    /// Below their level, but they never sat it here — they joined part-way.
    case notRecorded = "not-recorded"
    /// Still ahead of them.
    case upcoming
}

public struct MyProgressLevel: Decodable, Sendable, Equatable, Identifiable {
    public let level: String
    public let levelLabel: String
    /// Nil for a state this build does not know; the page then says the neutral thing.
    public let state: MyProgressLevelState?
    public let classroomId: Int?
    public let classroomName: String?
    public let attendance: MyProgressAttendance?
    public let homework: MyProgressHomework?
    /// The two halves combined, or nil when neither could be measured. Never 0 for unknown.
    public let overall: Double?
    /// Which halves `overall` actually counted: "attendance", "homework", both, or neither.
    public let basis: [String]

    public var id: String { level }

    private enum CodingKeys: String, CodingKey {
        case level, state, attendance, homework, overall, basis
        case levelLabel = "level_label"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = try c.decode(String.self, forKey: .level)
        levelLabel = LearnDecode.string(c, .levelLabel) ?? level.capitalized
        state = LearnDecode.string(c, .state).flatMap { MyProgressLevelState(rawValue: $0.lowercased()) }
        classroomId = LearnDecode.int(c, .classroomId)
        classroomName = LearnDecode.string(c, .classroomName)
        attendance = try? c.decodeIfPresent(MyProgressAttendance.self, forKey: .attendance)
        homework = try? c.decodeIfPresent(MyProgressHomework.self, forKey: .homework)
        overall = LearnDecode.double(c, .overall)
        basis = LearnDecode.list(c, .basis)
    }
}

/// How a student did on one classroom's register.
public struct MyProgressAttendance: Decodable, Sendable, Equatable {
    /// 0–100, weighted: present 1, late ½, absent 0. Nil even when the object exists — a
    /// register of nothing but excused absences has no denominator.
    public let rate: Double?
    public let present: Int
    public let late: Int
    public let absent: Int
    public let excused: Int
    /// The denominator: marked sessions minus the excused ones.
    public let counted: Int

    private enum CodingKeys: String, CodingKey { case rate, present, late, absent, excused, counted }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rate = LearnDecode.double(c, .rate)
        present = LearnDecode.int(c, .present) ?? 0
        late = LearnDecode.int(c, .late) ?? 0
        absent = LearnDecode.int(c, .absent) ?? 0
        excused = LearnDecode.int(c, .excused) ?? 0
        counted = LearnDecode.int(c, .counted) ?? 0
    }
}

/// How much of one classroom's published homework they finished.
public struct MyProgressHomework: Decodable, Sendable, Equatable {
    public let rate: Double?
    public let completed: Int
    public let total: Int

    private enum CodingKeys: String, CodingKey { case rate, completed, total }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rate = LearnDecode.double(c, .rate)
        completed = LearnDecode.int(c, .completed) ?? 0
        total = LearnDecode.int(c, .total) ?? 0
    }
}

// MARK: - You and your group

public struct PeerProgress: Decodable, Sendable, Equatable {
    /// One per subject, for the classroom the ladder marks "Studying now".
    public let groups: [PeerProgressGroup]
    /// Fewest classmates with a value before any group figure is shown.
    public let minPeers: Int

    private enum CodingKeys: String, CodingKey {
        case groups
        case minPeers = "min_peers"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        groups = LearnDecode.list(c, .groups)
        minPeers = LearnDecode.int(c, .minPeers) ?? 4
    }
}

/// A quarter band, never a rank — "top quarter" is something to aim at; "17th of 18" is not.
public enum PeerProgressStanding: String, Sendable, Equatable {
    case topQuarter = "top_quarter"
    case upperHalf = "upper_half"
    case lowerHalf = "lower_half"
}

/// One measure, the student beside their group. Group figures are aggregates and are nil
/// below the server's minimum group size — never zero, and never a classmate's own number.
public struct PeerProgressMetric: Decodable, Sendable, Equatable {
    public let you: Double?
    public let groupAverage: Double?
    public let groupMedian: Double?
    /// How many students the group figures cover, the student included.
    public let measured: Int?
    /// Nil when the group is too small, the student has no value, or standings are hidden.
    public let standing: PeerProgressStanding?

    public init(
        you: Double?,
        groupAverage: Double?,
        groupMedian: Double? = nil,
        measured: Int? = nil,
        standing: PeerProgressStanding? = nil
    ) {
        self.you = you
        self.groupAverage = groupAverage
        self.groupMedian = groupMedian
        self.measured = measured
        self.standing = standing
    }

    private enum CodingKeys: String, CodingKey {
        case you, measured, standing
        case groupAverage = "group_average"
        case groupMedian = "group_median"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        you = LearnDecode.double(c, .you)
        groupAverage = LearnDecode.double(c, .groupAverage)
        groupMedian = LearnDecode.double(c, .groupMedian)
        measured = LearnDecode.int(c, .measured)
        standing = LearnDecode.string(c, .standing).flatMap { PeerProgressStanding(rawValue: $0.lowercased()) }
    }

    static let unknown = PeerProgressMetric(you: nil, groupAverage: nil)
}

public struct PeerAttendanceDetail: Sendable, Equatable {
    public let present: Int
    public let late: Int
    public let absent: Int
    public let excused: Int

    public init(present: Int = 0, late: Int = 0, absent: Int = 0, excused: Int = 0) {
        self.present = present
        self.late = late
        self.absent = absent
        self.excused = excused
    }
}

public struct PeerHomeworkDetail: Sendable, Equatable {
    public let completed: Int
    public let total: Int
    public let remaining: Int
    /// Further pieces that would lift the student to the group's average; 0 when there.
    public let toReachAverage: Int

    public init(completed: Int = 0, total: Int = 0, remaining: Int = 0, toReachAverage: Int = 0) {
        self.completed = completed
        self.total = total
        self.remaining = remaining
        self.toReachAverage = toReachAverage
    }
}

/// The four measures. On the wire the attendance and homework objects carry their `detail`
/// inline; here it sits beside the metric so every measure has the one `PeerProgressMetric`
/// shape.
public struct PeerProgressMetrics: Decodable, Sendable, Equatable {
    public let attendance: PeerProgressMetric
    public let attendanceDetail: PeerAttendanceDetail
    public let homework: PeerProgressMetric
    public let homeworkDetail: PeerHomeworkDetail
    public let overall: PeerProgressMetric
    /// English groups only — words proved in all four games. Absent on a Math group.
    public let vocabulary: PeerProgressMetric?

    public init(
        attendance: PeerProgressMetric,
        attendanceDetail: PeerAttendanceDetail = PeerAttendanceDetail(),
        homework: PeerProgressMetric,
        homeworkDetail: PeerHomeworkDetail = PeerHomeworkDetail(),
        overall: PeerProgressMetric,
        vocabulary: PeerProgressMetric? = nil
    ) {
        self.attendance = attendance
        self.attendanceDetail = attendanceDetail
        self.homework = homework
        self.homeworkDetail = homeworkDetail
        self.overall = overall
        self.vocabulary = vocabulary
    }

    private enum CodingKeys: String, CodingKey { case attendance, homework, overall, vocabulary }
    private enum DetailKeys: String, CodingKey {
        case detail
        case present, late, absent, excused
        case completed, total, remaining
        case toReachAverage = "to_reach_average"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attendance = (try? c.decodeIfPresent(PeerProgressMetric.self, forKey: .attendance)) ?? .unknown
        homework = (try? c.decodeIfPresent(PeerProgressMetric.self, forKey: .homework)) ?? .unknown
        overall = (try? c.decodeIfPresent(PeerProgressMetric.self, forKey: .overall)) ?? .unknown
        vocabulary = try? c.decodeIfPresent(PeerProgressMetric.self, forKey: .vocabulary)

        let a = (try? c.nestedContainer(keyedBy: DetailKeys.self, forKey: .attendance))
            .flatMap { try? $0.nestedContainer(keyedBy: DetailKeys.self, forKey: .detail) }
        attendanceDetail = PeerAttendanceDetail(
            present: a.flatMap { LearnDecode.int($0, .present) } ?? 0,
            late: a.flatMap { LearnDecode.int($0, .late) } ?? 0,
            absent: a.flatMap { LearnDecode.int($0, .absent) } ?? 0,
            excused: a.flatMap { LearnDecode.int($0, .excused) } ?? 0
        )

        let h = (try? c.nestedContainer(keyedBy: DetailKeys.self, forKey: .homework))
            .flatMap { try? $0.nestedContainer(keyedBy: DetailKeys.self, forKey: .detail) }
        homeworkDetail = PeerHomeworkDetail(
            completed: h.flatMap { LearnDecode.int($0, .completed) } ?? 0,
            total: h.flatMap { LearnDecode.int($0, .total) } ?? 0,
            remaining: h.flatMap { LearnDecode.int($0, .remaining) } ?? 0,
            toReachAverage: h.flatMap { LearnDecode.int($0, .toReachAverage) } ?? 0
        )
    }
}

/// How one marked lesson went. The web calls an absence "Missed" — the fact, not a charge.
public enum PeerLessonStatus: String, Sendable, Equatable {
    case present = "PRESENT"
    case late = "LATE"
    case absent = "ABSENT"
    case excused = "EXCUSED"

    public var label: String {
        switch self {
        case .present: return "Present"
        case .late: return "Late"
        case .absent: return "Missed"
        case .excused: return "Excused"
        }
    }
}

public struct PeerLessonMark: Decodable, Sendable, Equatable {
    /// `YYYY-MM-DD`.
    public let date: String
    public let status: PeerLessonStatus

    public init(date: String, status: PeerLessonStatus) {
        self.date = date
        self.status = status
    }

    private enum CodingKeys: String, CodingKey { case date, status }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        // An unknown status is dropped with its lesson rather than drawn as something it isn't.
        let raw = try c.decode(String.self, forKey: .status)
        guard let status = PeerLessonStatus(rawValue: raw.uppercased()) else {
            throw DecodingError.dataCorruptedError(forKey: .status, in: c, debugDescription: "Unknown status \(raw)")
        }
        self.status = status
    }
}

public struct PeerTrendMonth: Decodable, Sendable, Equatable, Identifiable {
    /// `YYYY-MM`.
    public let month: String
    public let you: Double?
    /// Nil where too few classmates were marked that month.
    public let group: Double?

    public var id: String { month }

    public init(month: String, you: Double?, group: Double?) {
        self.month = month
        self.you = you
        self.group = group
    }

    private enum CodingKeys: String, CodingKey { case month, you, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decode(String.self, forKey: .month)
        you = LearnDecode.double(c, .you)
        group = LearnDecode.double(c, .group)
    }
}

/// One classroom — the one on the student's current rung of one subject — with the student
/// beside the rest of it.
public struct PeerProgressGroup: Decodable, Sendable, Equatable, Identifiable {
    public let subject: String
    public let subjectLabel: String
    public let classroomId: Int
    public let classroomName: String
    public let level: String
    public let levelLabel: String
    /// Everyone in the comparison, the student included.
    public let groupSize: Int
    /// The teacher hid this class's leaderboard: averages only, no bands.
    public let standingsHidden: Bool
    public let metrics: PeerProgressMetrics
    /// The student's own last marked lessons, oldest first — at most eight.
    public let recentLessons: [PeerLessonMark]
    /// Months with marks, oldest first — at most four.
    public let attendanceTrend: [PeerTrendMonth]

    public var id: Int { classroomId }

    public init(
        subject: String,
        subjectLabel: String,
        classroomId: Int,
        classroomName: String,
        level: String,
        levelLabel: String,
        groupSize: Int,
        standingsHidden: Bool = false,
        metrics: PeerProgressMetrics,
        recentLessons: [PeerLessonMark] = [],
        attendanceTrend: [PeerTrendMonth] = []
    ) {
        self.subject = subject
        self.subjectLabel = subjectLabel
        self.classroomId = classroomId
        self.classroomName = classroomName
        self.level = level
        self.levelLabel = levelLabel
        self.groupSize = groupSize
        self.standingsHidden = standingsHidden
        self.metrics = metrics
        self.recentLessons = recentLessons
        self.attendanceTrend = attendanceTrend
    }

    private enum CodingKeys: String, CodingKey {
        case subject, level, metrics
        case subjectLabel = "subject_label"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
        case levelLabel = "level_label"
        case groupSize = "group_size"
        case standingsHidden = "standings_hidden"
        case recentLessons = "recent_lessons"
        case attendanceTrend = "attendance_trend"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = LearnDecode.int(c, .classroomId) else {
            throw DecodingError.keyNotFound(
                CodingKeys.classroomId,
                .init(codingPath: c.codingPath, debugDescription: "A group without its classroom")
            )
        }
        classroomId = id
        subject = LearnDecode.string(c, .subject) ?? ""
        subjectLabel = LearnDecode.string(c, .subjectLabel) ?? subject.capitalized
        classroomName = LearnDecode.string(c, .classroomName) ?? ""
        level = LearnDecode.string(c, .level) ?? ""
        levelLabel = LearnDecode.string(c, .levelLabel) ?? level.capitalized
        groupSize = LearnDecode.int(c, .groupSize) ?? 0
        standingsHidden = LearnDecode.bool(c, .standingsHidden) ?? false
        metrics = (try? c.decode(PeerProgressMetrics.self, forKey: .metrics)) ?? PeerProgressMetrics(
            attendance: .unknown, homework: .unknown, overall: .unknown
        )
        recentLessons = LearnDecode.list(c, .recentLessons)
        attendanceTrend = LearnDecode.list(c, .attendanceTrend)
    }
}

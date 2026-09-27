import Foundation

// `GET /api/classes/roadmap/` — the student's per-subject level ladder.
//
// The contract lives in `backend/classes/roadmap.py`. Two things about its shape are easy to
// get wrong and are pinned by tests:
//
// * `{"tracks": []}` is the WHOLE payload for a student in no class: `months_to_sat` and
//   `months_to_sat_basis` are absent, not null. They decode as nil / [].
// * Only the student's OWN level carries the per-student lesson keys (`state`,
//   `assignment_id`, `delivery_id`, …). Every other level is a bare outline of four keys,
//   and the missing ones are the server's lock — the app never sees an id it may not open.

/// The whole roadmap: one track per subject the student studies, Math before English.
public struct RoadmapResponse: Decodable, Sendable, Equatable {
    public let tracks: [RoadmapTrack]
    /// How long until the student could sit the SAT — the slower of their courses. Nil when
    /// no track can be estimated, and absent altogether when there are no tracks.
    public let monthsToSat: Double?
    /// Which subjects `monthsToSat` actually accounts for.
    public let monthsToSatBasis: [String]

    public init(tracks: [RoadmapTrack], monthsToSat: Double? = nil, monthsToSatBasis: [String] = []) {
        self.tracks = tracks
        self.monthsToSat = monthsToSat
        self.monthsToSatBasis = monthsToSatBasis
    }

    private enum CodingKeys: String, CodingKey {
        case tracks
        case monthsToSat = "months_to_sat"
        case monthsToSatBasis = "months_to_sat_basis"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tracks = LearnDecode.list(c, .tracks)
        monthsToSat = LearnDecode.double(c, .monthsToSat)
        let basis: [String] = LearnDecode.list(c, .monthsToSatBasis)
        monthsToSatBasis = basis
    }
}

/// One subject's ladder.
public struct RoadmapTrack: Decodable, Sendable, Equatable, Identifiable {
    /// `math` or `english`.
    public let subject: String
    public let subjectLabel: String
    public let ownLevel: String?
    public let ownLevelLabel: String?
    /// The classroom whose released homework the own-level lessons open.
    public let ownClassroomId: Int?
    /// Which week the GROUP is in, counted in lessons held. Null before the first lesson.
    public let currentWeek: Int?
    /// Lessons of the OWN level finished — not of the whole ladder.
    public let completedLessons: Int
    public let totalLessons: Int
    /// 0…1, or nil when the own level has nothing published to be part-way through.
    public let completionRate: Double?
    public let nextLevel: String?
    public let nextLevelLabel: String?
    /// Course months left in this subject; 0 once finished, nil when nobody authored durations.
    public let monthsRemaining: Double?
    public let levels: [RoadmapLevel]

    public var id: String { subject }

    /// The rung marked `is_own_level`, found the way the web finds it — by the flag, not by
    /// matching `own_level` against the level codes.
    public var ownLevelIndex: Int? { levels.firstIndex(where: \.isOwnLevel) }

    public init(
        subject: String,
        subjectLabel: String,
        ownLevel: String? = nil,
        ownLevelLabel: String? = nil,
        ownClassroomId: Int? = nil,
        currentWeek: Int? = nil,
        completedLessons: Int = 0,
        totalLessons: Int = 0,
        completionRate: Double? = nil,
        nextLevel: String? = nil,
        nextLevelLabel: String? = nil,
        monthsRemaining: Double? = nil,
        levels: [RoadmapLevel] = []
    ) {
        self.subject = subject
        self.subjectLabel = subjectLabel
        self.ownLevel = ownLevel
        self.ownLevelLabel = ownLevelLabel
        self.ownClassroomId = ownClassroomId
        self.currentWeek = currentWeek
        self.completedLessons = completedLessons
        self.totalLessons = totalLessons
        self.completionRate = completionRate
        self.nextLevel = nextLevel
        self.nextLevelLabel = nextLevelLabel
        self.monthsRemaining = monthsRemaining
        self.levels = levels
    }

    private enum CodingKeys: String, CodingKey {
        case subject, levels
        case subjectLabel = "subject_label"
        case ownLevel = "own_level"
        case ownLevelLabel = "own_level_label"
        case ownClassroomId = "own_classroom_id"
        case currentWeek = "current_week"
        case completedLessons = "completed_lessons"
        case totalLessons = "total_lessons"
        case completionRate = "completion_rate"
        case nextLevel = "next_level"
        case nextLevelLabel = "next_level_label"
        case monthsRemaining = "months_remaining"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The identity key: a track with no subject cannot be told apart from its neighbour.
        subject = try c.decode(String.self, forKey: .subject)
        subjectLabel = LearnDecode.string(c, .subjectLabel) ?? subject.capitalized
        ownLevel = LearnDecode.string(c, .ownLevel)
        ownLevelLabel = LearnDecode.string(c, .ownLevelLabel)
        ownClassroomId = LearnDecode.int(c, .ownClassroomId)
        currentWeek = LearnDecode.int(c, .currentWeek)
        completedLessons = LearnDecode.int(c, .completedLessons) ?? 0
        totalLessons = LearnDecode.int(c, .totalLessons) ?? 0
        completionRate = LearnDecode.double(c, .completionRate)
        nextLevel = LearnDecode.string(c, .nextLevel)
        nextLevelLabel = LearnDecode.string(c, .nextLevelLabel)
        monthsRemaining = LearnDecode.double(c, .monthsRemaining)
        levels = LearnDecode.list(c, .levels)
    }
}

/// One rung of a subject's ladder. English has no Foundation rung at all — an absent level
/// is absent, never greyed.
public struct RoadmapLevel: Decodable, Sendable, Equatable, Identifiable {
    /// `foundation`, `junior`, `middle` or `senior`.
    public let level: String
    public let levelLabel: String
    public let isOwnLevel: Bool
    /// False → no published journal for this level yet ("coming soon").
    public let journalPublished: Bool
    public let lessonCount: Int
    /// How long the school says this level takes. 0 = nobody has filled it in.
    public let durationMonths: Int
    public let lessons: [RoadmapLesson]

    public var id: String { level }

    public init(
        level: String,
        levelLabel: String,
        isOwnLevel: Bool = false,
        journalPublished: Bool = true,
        lessonCount: Int? = nil,
        durationMonths: Int = 0,
        lessons: [RoadmapLesson] = []
    ) {
        self.level = level
        self.levelLabel = levelLabel
        self.isOwnLevel = isOwnLevel
        self.journalPublished = journalPublished
        self.lessonCount = lessonCount ?? lessons.count
        self.durationMonths = durationMonths
        self.lessons = lessons
    }

    private enum CodingKeys: String, CodingKey {
        case level, lessons
        case levelLabel = "level_label"
        case isOwnLevel = "is_own_level"
        case journalPublished = "journal_published"
        case lessonCount = "lesson_count"
        case durationMonths = "duration_months"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = try c.decode(String.self, forKey: .level)
        levelLabel = LearnDecode.string(c, .levelLabel) ?? level.capitalized
        isOwnLevel = LearnDecode.bool(c, .isOwnLevel) ?? false
        journalPublished = LearnDecode.bool(c, .journalPublished) ?? false
        let lessons: [RoadmapLesson] = LearnDecode.list(c, .lessons)
        self.lessons = lessons
        lessonCount = LearnDecode.int(c, .lessonCount) ?? lessons.count
        durationMonths = LearnDecode.int(c, .durationMonths) ?? 0
    }
}

/// Where the student's delivery of a lesson stands. Sent only on the own level.
public enum RoadmapLessonState: String, Sendable, Equatable {
    /// Homework released and finished.
    case completed
    /// Homework released, not finished yet — or a midterm with a sitting scheduled.
    case available
    /// Homework not released yet.
    case upcoming
}

/// One session on the path.
///
/// Every lesson carries the four outline keys. The rest arrive on the student's own level
/// only; everywhere else they are absent, and absence reads as "nothing to open".
public struct RoadmapLesson: Decodable, Sendable, Equatable {
    public let lessonNumber: Int
    public let title: String
    /// `HOMEWORK` or `MIDTERM`.
    public let lessonType: String
    public let isMidterm: Bool

    // Own level only:
    public let accessible: Bool?
    /// Nil on every level but the student's own (and for a state this build does not know).
    public let state: RoadmapLessonState?
    /// The released homework. Always nil for a midterm.
    public let assignmentId: Int?
    /// ISO date-time with offset; the delivered date, or the planned one.
    public let scheduledFor: String?
    /// What the reading endpoints address.
    public let deliveryId: Int?
    /// Whether there is anything to read before this lesson's homework.
    public let hasRoadmap: Bool
    /// Whether the student has got past the reading — read it, or it asks no confirmation.
    public let roadmapRead: Bool

    public var scheduledDate: Date? { scheduledFor.flatMap(JSONCoding.parseServerDate) }

    public init(
        lessonNumber: Int,
        title: String,
        lessonType: String = "HOMEWORK",
        isMidterm: Bool = false,
        accessible: Bool? = nil,
        state: RoadmapLessonState? = nil,
        assignmentId: Int? = nil,
        scheduledFor: String? = nil,
        deliveryId: Int? = nil,
        hasRoadmap: Bool = false,
        roadmapRead: Bool = false
    ) {
        self.lessonNumber = lessonNumber
        self.title = title
        self.lessonType = lessonType
        self.isMidterm = isMidterm
        self.accessible = accessible
        self.state = state
        self.assignmentId = assignmentId
        self.scheduledFor = scheduledFor
        self.deliveryId = deliveryId
        self.hasRoadmap = hasRoadmap
        self.roadmapRead = roadmapRead
    }

    private enum CodingKeys: String, CodingKey {
        case title, accessible, state
        case lessonNumber = "lesson_number"
        case lessonType = "lesson_type"
        case isMidterm = "is_midterm"
        case assignmentId = "assignment_id"
        case scheduledFor = "scheduled_for"
        case deliveryId = "delivery_id"
        case hasRoadmap = "has_roadmap"
        case roadmapRead = "roadmap_read"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let number = LearnDecode.int(c, .lessonNumber) else {
            throw DecodingError.keyNotFound(
                CodingKeys.lessonNumber,
                .init(codingPath: c.codingPath, debugDescription: "A lesson without a number has no place on the path")
            )
        }
        lessonNumber = number
        lessonType = (LearnDecode.string(c, .lessonType) ?? "HOMEWORK").uppercased()
        isMidterm = LearnDecode.bool(c, .isMidterm) ?? (lessonType == "MIDTERM")
        // The server never sends a blank title (`roadmap._lesson_title`); the same fallback
        // here keeps a circle from opening onto "3. ".
        let raw = (LearnDecode.string(c, .title) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        title = raw.isEmpty ? "\(isMidterm ? "Midterm" : "Lesson") \(number)" : raw
        accessible = LearnDecode.bool(c, .accessible)
        state = LearnDecode.string(c, .state).flatMap { RoadmapLessonState(rawValue: $0.lowercased()) }
        assignmentId = LearnDecode.int(c, .assignmentId)
        scheduledFor = LearnDecode.string(c, .scheduledFor)
        deliveryId = LearnDecode.int(c, .deliveryId)
        hasRoadmap = LearnDecode.bool(c, .hasRoadmap) ?? false
        roadmapRead = LearnDecode.bool(c, .roadmapRead) ?? false
    }
}

// MARK: - Reading

/// `GET|POST /api/classes/roadmap/<delivery_id>/reading/` — one session's reading.
///
/// `homeworkAssignmentId` is withheld by the server until the homework is released AND the
/// student has confirmed the reading (when the author asked for that). A nil here means there
/// is genuinely nothing to open yet.
public struct RoadmapReading: Decodable, Sendable, Equatable {
    public let deliveryId: Int
    public let classroomId: Int?
    public let lessonNumber: Int
    public let title: String
    public let summary: String
    public let estimatedMinutes: Int
    /// Whether the homework waits on "I've finished reading".
    public let requireReadConfirmation: Bool
    public let read: Bool
    public let homeworkReleased: Bool
    public let homeworkAssignmentId: Int?
    public let sections: [RoadmapSection]

    private enum CodingKeys: String, CodingKey {
        case title, summary, read, sections
        case deliveryId = "delivery_id"
        case classroomId = "classroom_id"
        case lessonNumber = "lesson_number"
        case estimatedMinutes = "estimated_minutes"
        case requireReadConfirmation = "require_read_confirmation"
        case homeworkReleased = "homework_released"
        case homeworkAssignmentId = "homework_assignment_id"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = LearnDecode.int(c, .deliveryId) else {
            throw DecodingError.keyNotFound(
                CodingKeys.deliveryId,
                .init(codingPath: c.codingPath, debugDescription: "A reading without its delivery id")
            )
        }
        deliveryId = id
        classroomId = LearnDecode.int(c, .classroomId)
        let number = LearnDecode.int(c, .lessonNumber) ?? 0
        lessonNumber = number
        let raw = (LearnDecode.string(c, .title) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        title = raw.isEmpty ? "Lesson \(number)" : raw
        summary = LearnDecode.string(c, .summary) ?? ""
        estimatedMinutes = LearnDecode.int(c, .estimatedMinutes) ?? 0
        requireReadConfirmation = LearnDecode.bool(c, .requireReadConfirmation) ?? false
        read = LearnDecode.bool(c, .read) ?? false
        homeworkReleased = LearnDecode.bool(c, .homeworkReleased) ?? false
        homeworkAssignmentId = LearnDecode.int(c, .homeworkAssignmentId)
        sections = LearnDecode.list(c, .sections)
    }
}

/// One block of a reading: a passage, a picture, or a video.
public struct RoadmapSection: Decodable, Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable {
        case text = "TEXT"
        case image = "IMAGE"
        case video = "VIDEO"
    }

    public let id: Int
    /// Nil for a kind this build does not know — the view skips it rather than guessing.
    public let kind: Kind?
    public let heading: String
    /// TEXT only. Plain text; blank lines separate paragraphs. Never HTML.
    public let body: String
    public let caption: String
    /// IMAGE only. Signed; expires in about an hour.
    public let imageURL: String?
    /// VIDEO only — the author's link, or a signed URL for an uploaded file.
    public let videoURL: String?

    /// The passage as the web prints it: split on blank lines, trimmed, empties dropped.
    public var paragraphs: [String] { RoadmapText.paragraphs(body) }

    private enum CodingKeys: String, CodingKey {
        case id, kind, heading, body, caption
        case imageURL = "image_url"
        case videoURL = "video_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = LearnDecode.int(c, .id) else {
            throw DecodingError.keyNotFound(
                CodingKeys.id,
                .init(codingPath: c.codingPath, debugDescription: "A section without an id")
            )
        }
        self.id = id
        kind = LearnDecode.string(c, .kind).flatMap { Kind(rawValue: $0.uppercased()) }
        heading = LearnDecode.string(c, .heading) ?? ""
        body = LearnDecode.string(c, .body) ?? ""
        caption = LearnDecode.string(c, .caption) ?? ""
        imageURL = LearnDecode.string(c, .imageURL).flatMap { $0.isEmpty ? nil : $0 }
        videoURL = LearnDecode.string(c, .videoURL).flatMap { $0.isEmpty ? nil : $0 }
    }
}

import Foundation

/// The signed-in student, from `/api/users/me/`.
///
/// A lean subset: Swift's `Decodable` ignores fields it does not declare, so the payload's
/// staff-only and security-console fields simply pass by. Add a property here only when a
/// screen actually reads it.
///
/// Encodable too, in the server's own keys, so the app can keep the last copy on the device
/// and open while offline instead of greeting a signed-in student with the sign-in form.
public struct CurrentUser: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let email: String
    public let username: String?
    public let firstName: String?
    public let lastName: String?
    public let role: String?
    public let isFrozen: Bool
    public let profileImageURL: String?
    public let satExamDate: String?
    public let targetScore: Int?
    public let targetEnglish: Int?
    public let targetMath: Int?
    public let profileComplete: Bool?
    public let missingFields: [String]?
    public let emailVerified: Bool?

    public var displayName: String {
        let full = [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        if !full.isEmpty { return full }
        if let username, !username.isEmpty { return username }
        return email
    }

    public var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, username, role
        case firstName = "first_name"
        case lastName = "last_name"
        case isFrozen = "is_frozen"
        case profileImageURL = "profile_image_url"
        case satExamDate = "sat_exam_date"
        case targetScore = "target_score"
        case targetEnglish = "target_english"
        case targetMath = "target_math"
        case profileComplete = "profile_complete"
        case missingFields = "missing_fields"
        case emailVerified = "email_verified"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        email = (try? c.decode(String.self, forKey: .email)) ?? ""
        username = try? c.decodeIfPresent(String.self, forKey: .username)
        firstName = try? c.decodeIfPresent(String.self, forKey: .firstName)
        lastName = try? c.decodeIfPresent(String.self, forKey: .lastName)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        isFrozen = (try? c.decodeIfPresent(Bool.self, forKey: .isFrozen)) as? Bool ?? false
        profileImageURL = try? c.decodeIfPresent(String.self, forKey: .profileImageURL)
        satExamDate = try? c.decodeIfPresent(String.self, forKey: .satExamDate)
        targetScore = try? c.decodeIfPresent(Int.self, forKey: .targetScore)
        targetEnglish = try? c.decodeIfPresent(Int.self, forKey: .targetEnglish)
        targetMath = try? c.decodeIfPresent(Int.self, forKey: .targetMath)
        profileComplete = try? c.decodeIfPresent(Bool.self, forKey: .profileComplete)
        missingFields = try? c.decodeIfPresent([String].self, forKey: .missingFields)
        emailVerified = try? c.decodeIfPresent(Bool.self, forKey: .emailVerified)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(email, forKey: .email)
        try c.encodeIfPresent(username, forKey: .username)
        try c.encodeIfPresent(firstName, forKey: .firstName)
        try c.encodeIfPresent(lastName, forKey: .lastName)
        try c.encodeIfPresent(role, forKey: .role)
        try c.encode(isFrozen, forKey: .isFrozen)
        try c.encodeIfPresent(profileImageURL, forKey: .profileImageURL)
        try c.encodeIfPresent(satExamDate, forKey: .satExamDate)
        try c.encodeIfPresent(targetScore, forKey: .targetScore)
        try c.encodeIfPresent(targetEnglish, forKey: .targetEnglish)
        try c.encodeIfPresent(targetMath, forKey: .targetMath)
        try c.encodeIfPresent(profileComplete, forKey: .profileComplete)
        try c.encodeIfPresent(missingFields, forKey: .missingFields)
        try c.encodeIfPresent(emailVerified, forKey: .emailVerified)
    }
}

/// A SAT date an admin has published, from `/api/users/exam-dates/`.
///
/// Students choose from this list rather than typing a date — the countdown is only
/// meaningful against a sitting that actually exists. The server already drops past dates.
public struct ExamDateOption: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let examDate: String
    public let label: String

    private enum CodingKeys: String, CodingKey {
        case id, label
        case examDate = "exam_date"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        examDate = (try? c.decode(String.self, forKey: .examDate)) ?? ""
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) as? String ?? ""
    }
}

/// One item on the student's calendar, from `/api/classes/my-schedule/`.
public struct ScheduleEvent: Decodable, Sendable, Equatable, Identifiable {
    public enum Kind: String, Decodable, Sendable {
        case classMeeting = "class"
        case mock
        case midterm
        case assignment
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .unknown
        }
    }

    public let date: String
    public let type: Kind
    public let title: String
    public let sub: String
    public let time: String
    public let classroomId: Int?
    public let assignmentId: Int?
    public let mockExamId: Int?

    /// Events have no server id, and several can share a day and a type (two classes, a
    /// mock and a due date). Compose one so SwiftUI lists stay stable.
    public var id: String {
        "\(date).\(type.rawValue).\(classroomId ?? 0).\(assignmentId ?? 0).\(mockExamId ?? 0).\(title)"
    }

    private enum CodingKeys: String, CodingKey {
        case date, type, title, sub, time
        case classroomId = "classroom_id"
        case assignmentId = "assignment_id"
        case mockExamId = "mock_exam_id"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = (try? c.decode(String.self, forKey: .date)) ?? ""
        type = (try? c.decode(Kind.self, forKey: .type)) ?? .unknown
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        sub = (try? c.decodeIfPresent(String.self, forKey: .sub)) as? String ?? ""
        time = (try? c.decodeIfPresent(String.self, forKey: .time)) as? String ?? ""
        classroomId = try? c.decodeIfPresent(Int.self, forKey: .classroomId)
        assignmentId = try? c.decodeIfPresent(Int.self, forKey: .assignmentId)
        mockExamId = try? c.decodeIfPresent(Int.self, forKey: .mockExamId)
    }
}

/// One homework, from `/api/classes/my-assignments/`.
///
/// A homework is a bundle: it can carry assessments, vocabulary sets, past-paper sections,
/// a mock, a practice pack, files and links — several of each, all at once. Everything the
/// launcher needs to open a piece of content is on this one payload, so opening something
/// never costs a round trip first.
public struct AssignmentListing: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public internal(set) var title: String
    public internal(set) var instructions: String?
    public internal(set) var dueAt: String?
    public let assignedAt: String?
    public internal(set) var subject: String?
    public let contentType: String?
    public let itemCount: Int?
    /// Only `my-assignments` sends these; a per-class list is stamped with them by the
    /// caller (`inClassroom`), since the detail screen loads by class.
    public internal(set) var classroomId: Int?
    public internal(set) var classroomName: String?
    /// Server-computed: submitted / graded / returned / not started. The client must not
    /// recompute this — the rule lives with the grading pipeline, not here.
    public let workflowStatus: String?

    // Content
    public let assessmentHomeworks: [AssessmentHomeworkLink]
    public let vocabHomeworks: [VocabHomeworkLink]
    /// The openable contents in launcher order, each with its display name — quizzes, a
    /// mock, practice packs, a past paper. Vocabulary sets are not in it.
    public internal(set) var contents: [AssignmentContentItem]
    public internal(set) var practiceBundleTests: [PracticeBundleTest]
    public internal(set) var mockExamId: Int?
    public internal(set) var practiceTestPackId: Int?
    /// Every attached practice pack; `practiceTestPackId` is the legacy single one.
    public internal(set) var practiceTestPackIds: [Int]
    /// Standalone past-paper sections (the single legacy FK, and the list).
    public internal(set) var practiceTestId: Int?
    public internal(set) var practiceTestIds: [Int]
    public internal(set) var moduleId: Int?
    /// What one hand-in may carry. Sent only by servers that have it; `SubmissionLimits.standard`
    /// is the server's own default otherwise.
    public internal(set) var submissionLimits: SubmissionLimits?
    public internal(set) var attachments: [AssignmentAttachment]
    public internal(set) var externalURLs: [String]
    public internal(set) var videoURL: String?
    public internal(set) var videoFileURL: String?
    /// True when the teacher wants work handed in through the attached content, not as a
    /// file. The upload UI hides rather than failing at submit time.
    public internal(set) var locksFileUpload: Bool
    /// The teacher's own switch for a file hand-in. Only the detail endpoint sends it.
    public internal(set) var allowFileUpload: Bool?
    /// Names for `externalURLs`, index-aligned; an empty name means "show the address".
    public internal(set) var externalURLLabels: [String]
    /// `HOMEWORK` or `CLASSWORK`. Only the detail and per-class lists send it.
    public internal(set) var category: String?
    /// What the homework is marked out of (a decimal string on the wire).
    public internal(set) var maxScore: Double?
    /// Classwork only: what the teacher gave for it, once they have.
    public internal(set) var classworkAward: ClassworkAward?

    public var isOverdue: Bool {
        guard let dueAt, let due = JSONCoding.parseServerDate(dueAt) else { return false }
        return due < Date()
    }

    /// True when nothing is attached but the homework itself — the student is expected to
    /// hand something in.
    public var expectsFileUpload: Bool {
        !locksFileUpload
            && assessmentHomeworks.isEmpty
            && vocabHomeworks.isEmpty
            && practiceBundleTests.isEmpty
            && mockExamId == nil
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, instructions, subject
        case dueAt = "due_at"
        case assignedAt = "assigned_at"
        case contentType = "content_type"
        case itemCount = "item_count"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
        case workflowStatus = "workflow_status"
        case assessmentHomeworks = "assessment_homeworks"
        case vocabHomeworks = "vocab_homeworks"
        case contents
        case practiceBundleTests = "practice_bundle_tests"
        case mockExam = "mock_exam"
        case practiceTestPack = "practice_test_pack"
        case practiceTestPackIds = "practice_test_pack_ids"
        case practiceTest = "practice_test"
        case practiceTestIds = "practice_test_ids"
        case module
        case submissionLimits = "submission_limits"
        case attachmentURLs = "attachment_urls"
        case externalURLs = "external_urls"
        case videoURL = "video_url"
        case videoFileURL = "video_file_url"
        case locksFileUpload = "locks_file_upload"
        case allowFileUpload = "allow_file_upload"
        case externalURLLabels = "external_url_labels"
        case category
        case maxScore = "max_score"
        case classworkAward = "classwork_award"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        instructions = try? c.decodeIfPresent(String.self, forKey: .instructions)
        dueAt = try? c.decodeIfPresent(String.self, forKey: .dueAt)
        assignedAt = try? c.decodeIfPresent(String.self, forKey: .assignedAt)
        subject = try? c.decodeIfPresent(String.self, forKey: .subject)
        contentType = try? c.decodeIfPresent(String.self, forKey: .contentType)
        itemCount = try? c.decodeIfPresent(Int.self, forKey: .itemCount)
        classroomId = try? c.decodeIfPresent(Int.self, forKey: .classroomId)
        classroomName = try? c.decodeIfPresent(String.self, forKey: .classroomName)
        workflowStatus = try? c.decodeIfPresent(String.self, forKey: .workflowStatus)

        assessmentHomeworks = (try? c.decodeIfPresent([AssessmentHomeworkLink].self, forKey: .assessmentHomeworks))
            as? [AssessmentHomeworkLink] ?? []
        vocabHomeworks = (try? c.decodeIfPresent([VocabHomeworkLink].self, forKey: .vocabHomeworks))
            as? [VocabHomeworkLink] ?? []
        contents = (try? c.decodeIfPresent([AssignmentContentItem].self, forKey: .contents))
            as? [AssignmentContentItem] ?? []
        practiceBundleTests = (try? c.decodeIfPresent([PracticeBundleTest].self, forKey: .practiceBundleTests))
            as? [PracticeBundleTest] ?? []
        mockExamId = try? c.decodeIfPresent(Int.self, forKey: .mockExam)
        practiceTestPackId = try? c.decodeIfPresent(Int.self, forKey: .practiceTestPack)
        practiceTestPackIds = (try? c.decodeIfPresent([Int].self, forKey: .practiceTestPackIds)) as? [Int] ?? []
        practiceTestId = try? c.decodeIfPresent(Int.self, forKey: .practiceTest)
        practiceTestIds = (try? c.decodeIfPresent([Int].self, forKey: .practiceTestIds)) as? [Int] ?? []
        moduleId = try? c.decodeIfPresent(Int.self, forKey: .module)
        submissionLimits = (try? c.decodeIfPresent(SubmissionLimits.self, forKey: .submissionLimits)) ?? nil
        attachments = (try? c.decodeIfPresent([AssignmentAttachment].self, forKey: .attachmentURLs))
            as? [AssignmentAttachment] ?? []
        externalURLs = (try? c.decodeIfPresent([String].self, forKey: .externalURLs)) as? [String] ?? []
        videoURL = try? c.decodeIfPresent(String.self, forKey: .videoURL)
        videoFileURL = try? c.decodeIfPresent(String.self, forKey: .videoFileURL)
        locksFileUpload = (try? c.decodeIfPresent(Bool.self, forKey: .locksFileUpload)) as? Bool ?? false
        allowFileUpload = (try? c.decodeIfPresent(Bool.self, forKey: .allowFileUpload)) ?? nil
        externalURLLabels = (try? c.decodeIfPresent([String].self, forKey: .externalURLLabels)) as? [String] ?? []
        category = try? c.decodeIfPresent(String.self, forKey: .category)
        if let d = try? c.decodeIfPresent(Double.self, forKey: .maxScore) {
            maxScore = d
        } else {
            maxScore = (try? c.decodeIfPresent(String.self, forKey: .maxScore)).flatMap { $0.flatMap(Double.init) }
        }
        classworkAward = (try? c.decodeIfPresent(ClassworkAward.self, forKey: .classworkAward)) ?? nil
    }
}

/// A certificate the student has earned. Only ever present once results are visible.
public struct CertificateInfo: Decodable, Sendable, Equatable {
    public let available: Bool
    public let code: String
    public let downloadURL: String?
    public let rank: Int?
    public let cohortSize: Int?

    private enum CodingKeys: String, CodingKey {
        case available, code, rank
        case downloadURL = "download_url"
        case cohortSize = "cohort_size"
    }
}

/// One midterm, from `/api/midterms/mine/`.
///
/// The three "you cannot start yet" states are deliberately distinct, because they need
/// different words in front of a student: the window has not opened, the teacher has not
/// released the room's code yet, or the window has closed.
public struct MidtermListing: Decodable, Sendable, Equatable, Identifiable {
    public let midtermId: Int
    public let title: String
    public let subject: String
    public let durationMinutes: Int?
    public let questionCount: Int?
    /// A finished row reports the scale IT was sat on; an unsat one the midterm's current
    /// scale. A sitting keeps its own scale and pass mark even if the paper changes later.
    public let scoreCeiling: Double?
    /// `SCALE_100` or `SCALE_800`, on the same terms as `scoreCeiling`.
    public let scoringScale: String?
    /// "classroom" or "standalone". Classroom results are publish-gated.
    public let flavor: String?
    public let attemptId: Int?
    public let state: String
    public let submitted: Bool
    /// The teacher granted a re-sit of a paper this student already finished. It goes back to
    /// "Available" — sat in the centre like any other sitting.
    public let resitOpen: Bool
    public let isOpen: Bool
    public let isBeforeStart: Bool
    /// Inside the window, but the teacher has not generated the room's access code yet.
    public let awaitingCode: Bool
    public let availableAt: String?
    public let deadline: String?
    public let resultsVisible: Bool
    public let score: Double?
    public let certificate: CertificateInfo?

    public var id: Int { midtermId }

    /// A sitting begun and not handed in — resumable in the centre, even past the deadline.
    public var inProgress: Bool { attemptId != nil && !submitted && state != "NOT_STARTED" }

    private enum CodingKeys: String, CodingKey {
        case title, subject, flavor, state, submitted, score, certificate, deadline
        case midtermId = "midterm_id"
        case durationMinutes = "duration_minutes"
        case questionCount = "question_count"
        case scoreCeiling = "score_ceiling"
        case scoringScale = "scoring_scale"
        case resitOpen = "resit_open"
        case attemptId = "attempt_id"
        case isOpen = "is_open"
        case isBeforeStart = "is_before_start"
        case awaitingCode = "awaiting_code"
        case availableAt = "available_at"
        case resultsVisible = "results_visible"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        midtermId = try c.decode(Int.self, forKey: .midtermId)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        durationMinutes = try? c.decodeIfPresent(Int.self, forKey: .durationMinutes)
        questionCount = try? c.decodeIfPresent(Int.self, forKey: .questionCount)
        scoreCeiling = try? c.decodeIfPresent(Double.self, forKey: .scoreCeiling)
        scoringScale = try? c.decodeIfPresent(String.self, forKey: .scoringScale)
        flavor = try? c.decodeIfPresent(String.self, forKey: .flavor)
        attemptId = try? c.decodeIfPresent(Int.self, forKey: .attemptId)
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) as? String ?? "NOT_STARTED"
        submitted = (try? c.decodeIfPresent(Bool.self, forKey: .submitted)) as? Bool ?? false
        resitOpen = (try? c.decodeIfPresent(Bool.self, forKey: .resitOpen)) as? Bool ?? false
        isOpen = (try? c.decodeIfPresent(Bool.self, forKey: .isOpen)) as? Bool ?? true
        isBeforeStart = (try? c.decodeIfPresent(Bool.self, forKey: .isBeforeStart)) as? Bool ?? false
        awaitingCode = (try? c.decodeIfPresent(Bool.self, forKey: .awaitingCode)) as? Bool ?? false
        availableAt = try? c.decodeIfPresent(String.self, forKey: .availableAt)
        deadline = try? c.decodeIfPresent(String.self, forKey: .deadline)
        resultsVisible = (try? c.decodeIfPresent(Bool.self, forKey: .resultsVisible)) as? Bool ?? false
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
        certificate = try? c.decodeIfPresent(CertificateInfo.self, forKey: .certificate)
    }
}

// MARK: - Envelopes

struct ResultsEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    let results: [T]
}

/// A bare JSON array, or a `{"results": [...]}` envelope.
///
/// These endpoints return plain arrays because DRF pagination is not configured. Accepting
/// both shapes means switching pagination on later is a server-side decision, not a
/// coordinated app release.
struct ListOrResults<T: Decodable & Sendable>: Decodable, Sendable {
    let items: [T]

    init(from decoder: Decoder) throws {
        if let array = try? decoder.singleValueContainer().decode([T].self) {
            items = array
            return
        }
        items = try decoder.container(keyedBy: Key.self).decode([T].self, forKey: .results)
    }

    private enum Key: String, CodingKey { case results }
}

struct ItemsEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    let items: [T]
    let count: Int?
}

struct EventsEnvelope: Decodable, Sendable {
    let events: [ScheduleEvent]
    let from: String?
    let to: String?
}

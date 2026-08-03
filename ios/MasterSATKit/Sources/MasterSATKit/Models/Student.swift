import Foundation

/// The signed-in student, from `/api/users/me/`.
///
/// A lean subset: Swift's `Decodable` ignores fields it does not declare, so the payload's
/// staff-only and security-console fields simply pass by. Add a property here only when a
/// screen actually reads it.
public struct CurrentUser: Decodable, Sendable, Equatable, Identifiable {
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
}

/// One available mock, from `/api/mocks/mine/`.
///
/// `attemptId` and `resultAttemptId` are deliberately separate. The active attempt is what
/// "Resume" reopens; the last completed one carries the score. Conflating them made a
/// freshly-earned score vanish the moment a student started a retake.
public struct MockListing: Decodable, Sendable, Equatable, Identifiable {
    public let mockId: Int
    public let title: String
    public let breakMinutes: Int
    public let moduleCount: Int
    public let attemptId: Int?
    public let state: String
    public let inProgress: Bool
    public let submitted: Bool
    public let totalScore: Double?
    public let resultAttemptId: Int?

    public var id: Int { mockId }

    private enum CodingKeys: String, CodingKey {
        case title, state, submitted
        case mockId = "mock_id"
        case breakMinutes = "break_minutes"
        case moduleCount = "module_count"
        case attemptId = "attempt_id"
        case inProgress = "in_progress"
        case totalScore = "total_score"
        case resultAttemptId = "result_attempt_id"
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
/// The server's assignment payload is large — every content kind it can bundle appears on
/// it. This decodes what a list and a detail header need; opening a piece of content goes
/// through its own endpoint anyway.
public struct AssignmentListing: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let instructions: String?
    public let dueAt: String?
    public let subject: String?
    public let contentType: String?
    public let itemCount: Int?
    public let classroomId: Int?
    public let classroomName: String?
    /// Server-computed: submitted / graded / returned / not started. The client must not
    /// recompute this — the rule lives with the grading pipeline, not here.
    public let workflowStatus: String?

    public var isOverdue: Bool {
        guard let dueAt, let due = JSONCoding.parseServerDate(dueAt) else { return false }
        return due < Date()
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, instructions, subject
        case dueAt = "due_at"
        case contentType = "content_type"
        case itemCount = "item_count"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
        case workflowStatus = "workflow_status"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        instructions = try? c.decodeIfPresent(String.self, forKey: .instructions)
        dueAt = try? c.decodeIfPresent(String.self, forKey: .dueAt)
        subject = try? c.decodeIfPresent(String.self, forKey: .subject)
        contentType = try? c.decodeIfPresent(String.self, forKey: .contentType)
        itemCount = try? c.decodeIfPresent(Int.self, forKey: .itemCount)
        classroomId = try? c.decodeIfPresent(Int.self, forKey: .classroomId)
        classroomName = try? c.decodeIfPresent(String.self, forKey: .classroomName)
        workflowStatus = try? c.decodeIfPresent(String.self, forKey: .workflowStatus)
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
    public let scoreCeiling: Double?
    /// "classroom" or "standalone". Classroom results are publish-gated.
    public let flavor: String?
    public let attemptId: Int?
    public let state: String
    public let submitted: Bool
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

    public var inProgress: Bool { attemptId != nil && !submitted && state != "NOT_STARTED" }

    /// Why the student cannot begin, in their own terms. Nil when they can.
    public var blockedReason: String? {
        if submitted { return nil }
        if isBeforeStart { return "Opens later" }
        if awaitingCode { return "Waiting for your teacher to start it" }
        if !isOpen { return "Closed" }
        return nil
    }

    private enum CodingKeys: String, CodingKey {
        case title, subject, flavor, state, submitted, score, certificate, deadline
        case midtermId = "midterm_id"
        case durationMinutes = "duration_minutes"
        case questionCount = "question_count"
        case scoreCeiling = "score_ceiling"
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
        flavor = try? c.decodeIfPresent(String.self, forKey: .flavor)
        attemptId = try? c.decodeIfPresent(Int.self, forKey: .attemptId)
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) as? String ?? "NOT_STARTED"
        submitted = (try? c.decodeIfPresent(Bool.self, forKey: .submitted)) as? Bool ?? false
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

/// One past paper / practice test, from `/api/exams/`.
public struct PastpaperListing: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let subject: String
    public let label: String?
    public let collectionName: String?
    public let practiceDate: String?
    public let modules: [ModuleSummary]

    public var totalMinutes: Int { modules.reduce(0) { $0 + $1.timeLimitMinutes } }

    private enum CodingKeys: String, CodingKey {
        case id, title, subject, label, modules
        case collectionName = "collection_name"
        case practiceDate = "practice_date"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        label = try? c.decodeIfPresent(String.self, forKey: .label)
        collectionName = try? c.decodeIfPresent(String.self, forKey: .collectionName)
        practiceDate = try? c.decodeIfPresent(String.self, forKey: .practiceDate)
        modules = (try? c.decodeIfPresent([ModuleSummary].self, forKey: .modules)) as? [ModuleSummary] ?? []
    }
}

/// Just enough of a pastpaper attempt to label its row.
///
/// Deliberately lean: `/api/exams/attempts/` returns the full runner payload for every
/// attempt — questions included — and a list screen has no use for any of that.
public struct PastpaperAttemptSummary: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let practiceTest: Int?
    public let currentState: String
    public let isCompleted: Bool
    public let isPaused: Bool
    public let score: Double?

    public var inProgress: Bool {
        !isCompleted && currentState != "ABANDONED" && currentState != "NOT_STARTED"
    }

    private enum CodingKeys: String, CodingKey {
        case id, score
        case practiceTest = "practice_test"
        case currentState = "current_state"
        case isCompleted = "is_completed"
        case isPaused = "is_paused"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        practiceTest = try? c.decodeIfPresent(Int.self, forKey: .practiceTest)
        currentState = (try? c.decodeIfPresent(String.self, forKey: .currentState)) as? String ?? "NOT_STARTED"
        isCompleted = (try? c.decodeIfPresent(Bool.self, forKey: .isCompleted)) as? Bool ?? false
        isPaused = (try? c.decodeIfPresent(Bool.self, forKey: .isPaused)) as? Bool ?? false
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
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

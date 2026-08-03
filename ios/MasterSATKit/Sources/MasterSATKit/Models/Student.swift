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

// MARK: - Envelopes

struct ResultsEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    let results: [T]
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

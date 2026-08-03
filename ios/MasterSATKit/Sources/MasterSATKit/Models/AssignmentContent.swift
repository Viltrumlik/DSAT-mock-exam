import Foundation

/// The student's state on one attached assessment.
///
/// `state` is server-derived and the client must not recompute it — the rule that decides
/// whether a submitted-but-ungraded attempt counts as finished lives with grading.
public struct AssessmentProgress: Decodable, Sendable, Equatable {
    public let state: String
    public let attemptId: Int?
    public let graded: Bool?
    public let percent: Int?
    public let correctCount: Int?
    public let totalQuestions: Int?
    public let missedCount: Int?
    public let answeredCount: Int?
    public let lastActivityAt: String?

    public var isCompleted: Bool { state == "completed" }
    public var isInProgress: Bool { state == "in_progress" }

    private enum CodingKeys: String, CodingKey {
        case state, graded, percent
        case attemptId = "attempt_id"
        case correctCount = "correct_count"
        case totalQuestions = "total_questions"
        case missedCount = "missed_count"
        case answeredCount = "answered_count"
        case lastActivityAt = "last_activity_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) as? String ?? "not_started"
        attemptId = try? c.decodeIfPresent(Int.self, forKey: .attemptId)
        graded = try? c.decodeIfPresent(Bool.self, forKey: .graded)
        percent = try? c.decodeIfPresent(Int.self, forKey: .percent)
        correctCount = try? c.decodeIfPresent(Int.self, forKey: .correctCount)
        totalQuestions = try? c.decodeIfPresent(Int.self, forKey: .totalQuestions)
        missedCount = try? c.decodeIfPresent(Int.self, forKey: .missedCount)
        answeredCount = try? c.decodeIfPresent(Int.self, forKey: .answeredCount)
        lastActivityAt = try? c.decodeIfPresent(String.self, forKey: .lastActivityAt)
    }
}

/// One assessment attached to a homework. A homework can bundle several.
public struct AssessmentHomeworkLink: Decodable, Sendable, Equatable, Identifiable {
    public let homeworkId: Int
    /// Named `assessmentSet`, not `set`: inside a computed property Swift reads a bare
    /// `set` as the setter keyword, and the error it produces points nowhere near here.
    public let assessmentSet: AssessmentSetInfo?
    public let progress: AssessmentProgress?
    public let questionCount: Int

    public var id: Int { homeworkId }
    public var title: String { assessmentSet?.title ?? "Assessment" }

    private enum CodingKeys: String, CodingKey {
        case progress
        case assessmentSet = "set"
        case homeworkId = "homework_id"
        case questionCount = "question_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        homeworkId = try c.decode(Int.self, forKey: .homeworkId)
        assessmentSet = try? c.decodeIfPresent(AssessmentSetInfo.self, forKey: .assessmentSet)
        progress = try? c.decodeIfPresent(AssessmentProgress.self, forKey: .progress)
        questionCount = (try? c.decodeIfPresent(Int.self, forKey: .questionCount)) as? Int ?? 0
    }
}

/// One vocabulary set attached to a homework.
public struct VocabHomeworkLink: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let setId: Int
    public let setTitle: String
    public let sectionTitle: String
    public let wordCount: Int
    public let state: String

    private enum CodingKeys: String, CodingKey {
        case id, state
        case setId = "set_id"
        case setTitle = "set_title"
        case sectionTitle = "section_title"
        case wordCount = "word_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        setId = (try? c.decodeIfPresent(Int.self, forKey: .setId)) as? Int ?? 0
        setTitle = (try? c.decodeIfPresent(String.self, forKey: .setTitle)) as? String ?? ""
        sectionTitle = (try? c.decodeIfPresent(String.self, forKey: .sectionTitle)) as? String ?? ""
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) as? String ?? "not_started"
    }
}

/// One past-paper section inside a homework, with the student's own state on it.
public struct PracticeBundleTest: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let subject: String
    public let state: String
    public let attemptId: Int?

    private enum CodingKeys: String, CodingKey {
        case id, name, subject, state
        case attemptId = "attempt_id"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) as? String ?? "Past Paper"
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) as? String ?? "not_started"
        attemptId = try? c.decodeIfPresent(Int.self, forKey: .attemptId)
    }
}

/// A file the teacher attached to a homework.
public struct AssignmentAttachment: Decodable, Sendable, Equatable, Identifiable {
    public let url: String
    public let fileName: String
    public let contentType: String?

    public var id: String { url }

    private enum CodingKeys: String, CodingKey {
        case url
        case fileName = "file_name"
        case contentType = "content_type"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = (try? c.decode(String.self, forKey: .url)) ?? ""
        fileName = (try? c.decodeIfPresent(String.self, forKey: .fileName)) as? String ?? "Attachment"
        contentType = try? c.decodeIfPresent(String.self, forKey: .contentType)
    }
}

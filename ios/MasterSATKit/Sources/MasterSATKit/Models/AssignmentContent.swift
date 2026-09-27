import Foundation

/// The student's state on one attached assessment.
///
/// `state` is server-derived and the client must not recompute it — the rule that decides
/// whether a submitted-but-ungraded attempt counts as finished lives with grading.
public struct AssessmentProgress: Decodable, Sendable, Equatable {
    public let state: String
    /// `graded` / `submitted` / `in_progress` / `not_started` (or an attempt's own status).
    /// The board reads its columns from this, as the web does — `state` folds "submitted"
    /// and "graded" together and cannot tell a mark from a wait.
    public let workflowStatus: String?
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
        case workflowStatus = "workflow_status"
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
        workflowStatus = (try? c.decodeIfPresent(String.self, forKey: .workflowStatus)) ?? nil
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
    /// Sat before this homework was set and not since: it reads "Start again", and only a
    /// sitting finished after the homework was set counts for it.
    public let retake: Bool
    public let collectionName: String?
    /// Usually blank on a standalone section; `name` is the ready display name.
    public let title: String?

    private enum CodingKeys: String, CodingKey {
        case id, name, subject, state, retake, title
        case attemptId = "attempt_id"
        case collectionName = "collection_name"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        // Blank when absent, not "Past Paper": the display falls back through the collection
        // name and the title first, the way the web's launcher does.
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) as? String ?? ""
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) as? String ?? "not_started"
        attemptId = try? c.decodeIfPresent(Int.self, forKey: .attemptId)
        retake = (try? c.decodeIfPresent(Bool.self, forKey: .retake)) as? Bool ?? false
        collectionName = try? c.decodeIfPresent(String.self, forKey: .collectionName)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
    }
}

/// One openable thing inside a homework, as the server names it for the launcher.
///
/// `kind` is `QUIZ`, `MOCK`, `PRACTICE` or `PASTPAPER`, in the order the launcher renders
/// them; `title` is the content's real name ("Practice Test 4", not "Open Past Paper").
public struct AssignmentContentItem: Decodable, Sendable, Equatable {
    public let kind: String
    public let title: String
    public let itemCount: Int?
    /// QUIZ only: which of the homework's assessments this is.
    public let homeworkId: Int?

    private enum CodingKeys: String, CodingKey {
        case kind, title
        case itemCount = "item_count"
        case homeworkId = "homework_id"
    }

    public init(kind: String, title: String, itemCount: Int? = nil, homeworkId: Int? = nil) {
        self.kind = kind
        self.title = title
        self.itemCount = itemCount
        self.homeworkId = homeworkId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (((try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil) ?? "").uppercased()
        title = (((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        itemCount = try? c.decodeIfPresent(Int.self, forKey: .itemCount)
        homeworkId = try? c.decodeIfPresent(Int.self, forKey: .homeworkId)
    }
}

/// A file the teacher attached to a homework.
public struct AssignmentAttachment: Decodable, Sendable, Equatable, Identifiable {
    public let url: String
    public let fileName: String
    public let contentType: String?
    /// Bytes, when the server could read the file.
    public let size: Int?

    public var id: String { url }

    private enum CodingKeys: String, CodingKey {
        case url, size
        case fileName = "file_name"
        case contentType = "content_type"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = (try? c.decode(String.self, forKey: .url)) ?? ""
        fileName = (try? c.decodeIfPresent(String.self, forKey: .fileName)) as? String ?? "Attachment"
        contentType = try? c.decodeIfPresent(String.self, forKey: .contentType)
        size = try? c.decodeIfPresent(Int.self, forKey: .size)
    }
}

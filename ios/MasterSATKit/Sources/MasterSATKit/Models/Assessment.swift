import Foundation

/// The kinds of question an assessment can hold. Unknown values render read-only rather
/// than crashing an attempt a student is halfway through.
public enum AssessmentQuestionType: String, Decodable, Sendable {
    case multipleChoice = "multiple_choice"
    case numeric
    case shortText = "short_text"
    case boolean
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AssessmentQuestionType(rawValue: raw) ?? .unknown
    }
}

public struct AssessmentChoice: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String

    /// The runner sends `id`; the review payload sends the same field as `key`.
    private enum CodingKeys: String, CodingKey { case id, key, text }

    public init(id: String, text: String) {
        self.id = id
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let ident = (try? c.decodeIfPresent(String.self, forKey: .id))
            ?? (try? c.decodeIfPresent(String.self, forKey: .key))
        id = (ident ?? nil) ?? ""
        text = (try? c.decodeIfPresent(String.self, forKey: .text)) as? String ?? ""
    }
}

/// One question inside a running assessment.
///
/// The runner payload deliberately omits `explanation` and `correct_answer` — a student
/// mid-attempt must not be able to read the worked solution out of the response. Review
/// uses `AssessmentReviewQuestion`, which has them.
public struct AssessmentQuestion: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let order: Int
    public let prompt: String
    public let questionPrompt: String?
    public let questionType: AssessmentQuestionType
    public let choices: [AssessmentChoice]
    public let points: Int
    public let questionImage: String?
    public let optionImages: [String: String]

    private enum CodingKeys: String, CodingKey {
        case id, order, prompt, choices, points
        case questionPrompt = "question_prompt"
        case questionType = "question_type"
        case questionImage = "question_image"
        case optionAImage = "option_a_image"
        case optionBImage = "option_b_image"
        case optionCImage = "option_c_image"
        case optionDImage = "option_d_image"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        order = (try? c.decodeIfPresent(Int.self, forKey: .order)) as? Int ?? 0
        prompt = (try? c.decodeIfPresent(String.self, forKey: .prompt)) as? String ?? ""
        questionPrompt = try? c.decodeIfPresent(String.self, forKey: .questionPrompt)
        questionType = (try? c.decodeIfPresent(AssessmentQuestionType.self, forKey: .questionType))
            .flatMap { $0 } ?? .unknown
        choices = (try? c.decodeIfPresent([AssessmentChoice].self, forKey: .choices)) as? [AssessmentChoice] ?? []
        points = (try? c.decodeIfPresent(Int.self, forKey: .points)) as? Int ?? 1
        questionImage = try? c.decodeIfPresent(String.self, forKey: .questionImage)

        var images: [String: String] = [:]
        for (key, letter) in [
            (CodingKeys.optionAImage, "A"), (.optionBImage, "B"),
            (.optionCImage, "C"), (.optionDImage, "D"),
        ] {
            if let url = (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil, !url.isEmpty {
                images[letter] = url
            }
        }
        optionImages = images
    }

    public init(
        id: Int,
        order: Int = 0,
        prompt: String,
        questionPrompt: String? = nil,
        questionType: AssessmentQuestionType = .multipleChoice,
        choices: [AssessmentChoice] = [],
        points: Int = 1,
        questionImage: String? = nil,
        optionImages: [String: String] = [:]
    ) {
        self.id = id
        self.order = order
        self.prompt = prompt
        self.questionPrompt = questionPrompt
        self.questionType = questionType
        self.choices = choices
        self.points = points
        self.questionImage = questionImage
        self.optionImages = optionImages
    }
}

public struct AssessmentSetInfo: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let subject: String
    public let category: String?
    public let description: String?

    private enum CodingKeys: String, CodingKey { case id, title, subject, category, description }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        category = try? c.decodeIfPresent(String.self, forKey: .category)
        description = try? c.decodeIfPresent(String.self, forKey: .description)
    }
}

public struct AssessmentAnswer: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let questionId: Int
    public let answer: JSONValue
    public let clientSeq: Int
    public let isCorrect: Bool?
    public let pointsAwarded: Double?

    private enum CodingKeys: String, CodingKey {
        case id, answer
        case questionId = "question_id"
        case clientSeq = "client_seq"
        case isCorrect = "is_correct"
        case pointsAwarded = "points_awarded"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        questionId = (try? c.decodeIfPresent(Int.self, forKey: .questionId)) as? Int ?? 0
        answer = (try? c.decodeIfPresent(JSONValue.self, forKey: .answer)) as? JSONValue ?? .null
        clientSeq = (try? c.decodeIfPresent(Int.self, forKey: .clientSeq)) as? Int ?? 0
        isCorrect = try? c.decodeIfPresent(Bool.self, forKey: .isCorrect)
        // Decimals arrive as strings from DRF.
        if let d = try? c.decodeIfPresent(Double.self, forKey: .pointsAwarded) {
            pointsAwarded = d
        } else if let s = (try? c.decodeIfPresent(String.self, forKey: .pointsAwarded)) ?? nil {
            pointsAwarded = Double(s)
        } else {
            pointsAwarded = nil
        }
    }
}

/// A running (or finished) assessment attempt.
public struct AssessmentAttempt: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let homeworkId: Int
    public let status: String
    public let gradingStatus: String?
    public let submittedAt: String?
    public let isPaused: Bool
    public let currentQuestionIndex: Int
    public let elapsedSeconds: Int
    public let answers: [AssessmentAnswer]
    public let questionOrder: [Int]

    public var isSubmitted: Bool {
        submittedAt != nil || ["submitted", "graded", "completed"].contains(status.lowercased())
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, answers
        case homeworkId = "homework_id"
        case gradingStatus = "grading_status"
        case submittedAt = "submitted_at"
        case isPaused = "is_paused"
        case currentQuestionIndex = "current_question_index"
        case elapsedSeconds = "elapsed_seconds"
        case questionOrder = "question_order"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        homeworkId = (try? c.decodeIfPresent(Int.self, forKey: .homeworkId)) as? Int ?? 0
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) as? String ?? "in_progress"
        gradingStatus = try? c.decodeIfPresent(String.self, forKey: .gradingStatus)
        submittedAt = try? c.decodeIfPresent(String.self, forKey: .submittedAt)
        isPaused = (try? c.decodeIfPresent(Bool.self, forKey: .isPaused)) as? Bool ?? false
        currentQuestionIndex = (try? c.decodeIfPresent(Int.self, forKey: .currentQuestionIndex)) as? Int ?? 0
        elapsedSeconds = (try? c.decodeIfPresent(Int.self, forKey: .elapsedSeconds)) as? Int ?? 0
        answers = (try? c.decodeIfPresent([AssessmentAnswer].self, forKey: .answers)) as? [AssessmentAnswer] ?? []
        questionOrder = (try? c.decodeIfPresent([Int].self, forKey: .questionOrder)) as? [Int] ?? []
    }
}

/// Everything needed to run one attempt, in a single request.
public struct AssessmentBundle: Decodable, Sendable, Equatable {
    public let attempt: AssessmentAttempt
    public let set: AssessmentSetInfo?
    public let questions: [AssessmentQuestion]

    /// Questions in the order this attempt fixed at start.
    ///
    /// `question_order` is per-attempt: two students can be served the same set in
    /// different orders. Sorting by `order` instead would show a student a different
    /// sequence on the phone than the one their answers were recorded against.
    public var orderedQuestions: [AssessmentQuestion] {
        guard !attempt.questionOrder.isEmpty else {
            return questions.sorted { $0.order < $1.order }
        }
        let byId = Dictionary(uniqueKeysWithValues: questions.map { ($0.id, $0) })
        let ordered = attempt.questionOrder.compactMap { byId[$0] }
        // Anything the order missed still has to be reachable, or a student can never
        // answer it.
        let seen = Set(ordered.map(\.id))
        return ordered + questions.filter { !seen.contains($0.id) }.sorted { $0.order < $1.order }
    }
}

public struct AssessmentResult: Decodable, Sendable, Equatable {
    public let scorePoints: Double
    public let maxPoints: Double
    public let percent: Double
    public let correctCount: Int
    public let totalQuestions: Int
    public let gradedAt: String?

    private enum CodingKeys: String, CodingKey {
        case percent
        case scorePoints = "score_points"
        case maxPoints = "max_points"
        case correctCount = "correct_count"
        case totalQuestions = "total_questions"
        case gradedAt = "graded_at"
    }

    /// DRF serialises decimals as strings by default, so every numeric field here has to
    /// accept both. A silent 0 would read as "you scored nothing".
    private static func decimal(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Double {
        if let d = try? c.decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil { return Double(s) ?? 0 }
        return 0
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        scorePoints = Self.decimal(c, .scorePoints)
        maxPoints = Self.decimal(c, .maxPoints)
        percent = Self.decimal(c, .percent)
        correctCount = (try? c.decodeIfPresent(Int.self, forKey: .correctCount)) as? Int ?? 0
        totalQuestions = (try? c.decodeIfPresent(Int.self, forKey: .totalQuestions)) as? Int ?? 0
        gradedAt = try? c.decodeIfPresent(String.self, forKey: .gradedAt)
    }
}

public struct AssessmentMyResult: Decodable, Sendable, Equatable {
    public let attempt: AssessmentAttempt?
    public let result: AssessmentResult?
}

// MARK: - Review

/// One question as it appears after grading — with the answer key and the explanation,
/// which the runner payload never carries.
public struct AssessmentReviewQuestion: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let order: Int
    public let prompt: String
    public let questionPrompt: String?
    public let questionType: AssessmentQuestionType
    public let choices: [AssessmentChoice]
    public let points: Int
    public let correctAnswer: JSONValue
    public let explanation: String?
    public let questionImage: String?
    public let studentAnswer: JSONValue
    public let isCorrect: Bool?
    public let pointsAwarded: Double?

    public var wasAnswered: Bool { !studentAnswer.isEmpty }

    private enum CodingKeys: String, CodingKey {
        case id, order, prompt, choices, points, explanation
        case questionPrompt = "question_prompt"
        case questionType = "question_type"
        case correctAnswer = "correct_answer"
        case questionImage = "question_image"
        case studentAnswer = "student_answer"
        case isCorrect = "is_correct"
        case pointsAwarded = "points_awarded"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        order = (try? c.decodeIfPresent(Int.self, forKey: .order)) as? Int ?? 0
        prompt = (try? c.decodeIfPresent(String.self, forKey: .prompt)) as? String ?? ""
        questionPrompt = try? c.decodeIfPresent(String.self, forKey: .questionPrompt)
        questionType = (try? c.decodeIfPresent(AssessmentQuestionType.self, forKey: .questionType))
            .flatMap { $0 } ?? .unknown
        choices = (try? c.decodeIfPresent([AssessmentChoice].self, forKey: .choices)) as? [AssessmentChoice] ?? []
        points = (try? c.decodeIfPresent(Int.self, forKey: .points)) as? Int ?? 1
        correctAnswer = (try? c.decodeIfPresent(JSONValue.self, forKey: .correctAnswer)) as? JSONValue ?? .null
        explanation = try? c.decodeIfPresent(String.self, forKey: .explanation)
        questionImage = try? c.decodeIfPresent(String.self, forKey: .questionImage)
        studentAnswer = (try? c.decodeIfPresent(JSONValue.self, forKey: .studentAnswer)) as? JSONValue ?? .null
        isCorrect = try? c.decodeIfPresent(Bool.self, forKey: .isCorrect)
        if let d = try? c.decodeIfPresent(Double.self, forKey: .pointsAwarded) {
            pointsAwarded = d
        } else if let s = (try? c.decodeIfPresent(String.self, forKey: .pointsAwarded)) ?? nil {
            pointsAwarded = Double(s)
        } else {
            pointsAwarded = nil
        }
    }
}

public struct AssessmentReviewMeta: Decodable, Sendable, Equatable {
    public let assignmentTitle: String?
    public let setTitle: String?
    public let setCategory: String?
    public let classroomName: String?
    public let questionCount: Int

    private enum CodingKeys: String, CodingKey {
        case assignmentTitle = "assignment_title"
        case setTitle = "set_title"
        case setCategory = "set_category"
        case classroomName = "classroom_name"
        case questionCount = "question_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        assignmentTitle = try? c.decodeIfPresent(String.self, forKey: .assignmentTitle)
        setTitle = try? c.decodeIfPresent(String.self, forKey: .setTitle)
        setCategory = try? c.decodeIfPresent(String.self, forKey: .setCategory)
        classroomName = try? c.decodeIfPresent(String.self, forKey: .classroomName)
        questionCount = (try? c.decodeIfPresent(Int.self, forKey: .questionCount)) as? Int ?? 0
    }
}

public struct TeacherFeedback: Decodable, Sendable, Equatable {
    public let body: String
    public let teacherName: String?
    public let updatedAt: String?

    private enum CodingKeys: String, CodingKey {
        case body
        case teacherName = "teacher_name"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        body = (try? c.decodeIfPresent(String.self, forKey: .body)) as? String ?? ""
        teacherName = try? c.decodeIfPresent(String.self, forKey: .teacherName)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

public struct AssessmentReview: Decodable, Sendable, Equatable {
    public let meta: AssessmentReviewMeta?
    public let result: AssessmentResult?
    public let questions: [AssessmentReviewQuestion]
    public let teacherFeedback: TeacherFeedback?

    public var missed: [AssessmentReviewQuestion] { questions.filter { $0.isCorrect == false } }

    private enum CodingKeys: String, CodingKey {
        case meta, result, questions
        case teacherFeedback = "teacher_feedback"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        meta = try? c.decodeIfPresent(AssessmentReviewMeta.self, forKey: .meta)
        result = try? c.decodeIfPresent(AssessmentResult.self, forKey: .result)
        questions = (try? c.decodeIfPresent([AssessmentReviewQuestion].self, forKey: .questions))
            as? [AssessmentReviewQuestion] ?? []
        teacherFeedback = try? c.decodeIfPresent(TeacherFeedback.self, forKey: .teacherFeedback)
    }
}

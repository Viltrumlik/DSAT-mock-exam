import Foundation

/// One section inside a practice-test pack.
public struct PracticePackSection: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let subject: String
    public let moduleCount: Int

    private enum CodingKeys: String, CodingKey {
        case id, title, subject
        case moduleCount = "module_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        moduleCount = (try? c.decodeIfPresent(Int.self, forKey: .moduleCount)) as? Int ?? 0
    }
}

/// A curated group of practice sections, from `/api/exams/practice-test-packs/`.
public struct PracticePack: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let description: String?
    public let sections: [PracticePackSection]
    public let createdAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, description, sections
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        sections = (try? c.decodeIfPresent([PracticePackSection].self, forKey: .sections))
            as? [PracticePackSection] ?? []
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

// MARK: - Question Bank practice

public struct BankQuestionSummary: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let bankId: String?
    public let subject: String
    public let questionType: String
    public let difficulty: String
    public let domainName: String?
    public let skillName: String?
    public let questionText: String
    public let hasImage: Bool

    private enum CodingKeys: String, CodingKey {
        case id, subject, difficulty
        case bankId = "qb_id"
        case questionType = "question_type"
        case domainName = "domain_name"
        case skillName = "skill_name"
        case questionText = "question_text"
        case hasImage = "has_image"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        bankId = try? c.decodeIfPresent(String.self, forKey: .bankId)
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        questionType = (try? c.decodeIfPresent(String.self, forKey: .questionType)) as? String ?? ""
        difficulty = (try? c.decodeIfPresent(String.self, forKey: .difficulty)) as? String ?? ""
        domainName = try? c.decodeIfPresent(String.self, forKey: .domainName)
        skillName = try? c.decodeIfPresent(String.self, forKey: .skillName)
        questionText = (try? c.decodeIfPresent(String.self, forKey: .questionText)) as? String ?? ""
        hasImage = (try? c.decodeIfPresent(Bool.self, forKey: .hasImage)) as? Bool ?? false
    }
}

public struct BankChoice: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
    public let image: String?

    public init(id: String, text: String, image: String? = nil) {
        self.id = id
        self.text = text
        self.image = image
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) as? String ?? ""
        text = (try? c.decodeIfPresent(String.self, forKey: .text)) as? String ?? ""
        image = try? c.decodeIfPresent(String.self, forKey: .image)
    }

    private enum CodingKeys: String, CodingKey { case id, text, image }
}

/// A single bank question opened for practice. Carries no answer key — the key arrives
/// only in the response to an answer, so it cannot be read out of the payload first.
public struct BankQuestionDetail: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let bankId: String?
    public let subject: String
    public let questionType: String
    public let difficulty: String
    public let domainName: String?
    public let skillName: String?
    public let passageText: String?
    public let questionText: String
    public let questionPrompt: String?
    public let questionImage: String?
    public let choices: [BankChoice]

    public var isGridIn: Bool { choices.isEmpty }

    private enum CodingKeys: String, CodingKey {
        case id, subject, difficulty, choices
        case bankId = "qb_id"
        case questionType = "question_type"
        case domainName = "domain_name"
        case skillName = "skill_name"
        case passageText = "passage_text"
        case questionText = "question_text"
        case questionPrompt = "question_prompt"
        case questionImage = "question_image"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        bankId = try? c.decodeIfPresent(String.self, forKey: .bankId)
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
        questionType = (try? c.decodeIfPresent(String.self, forKey: .questionType)) as? String ?? ""
        difficulty = (try? c.decodeIfPresent(String.self, forKey: .difficulty)) as? String ?? ""
        domainName = try? c.decodeIfPresent(String.self, forKey: .domainName)
        skillName = try? c.decodeIfPresent(String.self, forKey: .skillName)
        passageText = try? c.decodeIfPresent(String.self, forKey: .passageText)
        questionText = (try? c.decodeIfPresent(String.self, forKey: .questionText)) as? String ?? ""
        questionPrompt = try? c.decodeIfPresent(String.self, forKey: .questionPrompt)
        questionImage = try? c.decodeIfPresent(String.self, forKey: .questionImage)
        choices = (try? c.decodeIfPresent([BankChoice].self, forKey: .choices)) as? [BankChoice] ?? []
    }
}

public struct BankAnswerResult: Decodable, Sendable, Equatable {
    public let isCorrect: Bool
    public let correctAnswer: JSONValue
    public let explanation: String?

    private enum CodingKeys: String, CodingKey {
        case explanation
        case isCorrect = "is_correct"
        case correctAnswer = "correct_answer"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isCorrect = (try? c.decodeIfPresent(Bool.self, forKey: .isCorrect)) as? Bool ?? false
        correctAnswer = (try? c.decodeIfPresent(JSONValue.self, forKey: .correctAnswer)) as? JSONValue ?? .null
        explanation = try? c.decodeIfPresent(String.self, forKey: .explanation)
    }
}

public struct BankTaxonomy: Decodable, Sendable, Equatable {
    public struct Domain: Decodable, Sendable, Equatable, Identifiable {
        public let id: Int
        public let subject: String
        public let name: String
    }

    public struct Skill: Decodable, Sendable, Equatable, Identifiable {
        public let id: Int
        public let domain: Int
        public let subject: String
        public let name: String
    }

    public let domains: [Domain]
    public let skills: [Skill]
}

public struct BankPage: Decodable, Sendable, Equatable {
    public let count: Int
    public let results: [BankQuestionSummary]
}

// MARK: - Invigilated mock sittings

/// The student's place in an invigilated sitting. Never carries the room's code — the
/// code goes one way only, from the teacher's mouth to the join box.
public struct MockSessionPlace: Decodable, Sendable, Equatable, Identifiable {
    public let sessionId: Int
    public let mockId: Int
    public let title: String
    public let sessionDate: String?
    /// OPEN | STARTED | ENDED
    public let status: String
    /// PENDING | APPROVED | REJECTED
    public let myStatus: String
    /// Non-nil the instant the room starts. This is the only thing the waiting room
    /// actually watches for.
    public let attemptId: Int?
    public let startedAt: String?

    public var id: Int { sessionId }
    public var isApproved: Bool { myStatus.uppercased() == "APPROVED" }
    public var isPending: Bool { myStatus.uppercased() == "PENDING" }
    public var isRejected: Bool { myStatus.uppercased() == "REJECTED" }
    public var hasStarted: Bool { attemptId != nil }

    private enum CodingKeys: String, CodingKey {
        case title, status
        case sessionId = "session_id"
        case mockId = "mock_id"
        case sessionDate = "session_date"
        case myStatus = "my_status"
        case attemptId = "attempt_id"
        case startedAt = "started_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(Int.self, forKey: .sessionId)
        mockId = (try? c.decodeIfPresent(Int.self, forKey: .mockId)) as? Int ?? 0
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        sessionDate = try? c.decodeIfPresent(String.self, forKey: .sessionDate)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) as? String ?? "OPEN"
        myStatus = (try? c.decodeIfPresent(String.self, forKey: .myStatus)) as? String ?? "PENDING"
        attemptId = try? c.decodeIfPresent(Int.self, forKey: .attemptId)
        startedAt = try? c.decodeIfPresent(String.self, forKey: .startedAt)
    }
}

// MARK: - Results

/// A finished midterm.
///
/// `released` is the gate, and it is not the same as "graded": a classroom midterm is
/// scored the moment it is submitted but stays sealed until the teacher publishes it.
public struct MidtermResult: Decodable, Sendable, Equatable {
    public let scoreOnly: Bool
    public let released: Bool
    public let subject: String?
    public let scoringScale: String?
    public let totalScore: Double?
    public let scoreCeiling: Double?
    public let certificate: CertificateInfo?

    private enum CodingKeys: String, CodingKey {
        case released, subject, certificate
        case scoreOnly = "score_only"
        case scoringScale = "scoring_scale"
        case totalScore = "total_score"
        case scoreCeiling = "score_ceiling"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        scoreOnly = (try? c.decodeIfPresent(Bool.self, forKey: .scoreOnly)) as? Bool ?? true
        released = (try? c.decodeIfPresent(Bool.self, forKey: .released)) as? Bool ?? false
        subject = try? c.decodeIfPresent(String.self, forKey: .subject)
        scoringScale = try? c.decodeIfPresent(String.self, forKey: .scoringScale)
        totalScore = try? c.decodeIfPresent(Double.self, forKey: .totalScore)
        scoreCeiling = try? c.decodeIfPresent(Double.self, forKey: .scoreCeiling)
        certificate = try? c.decodeIfPresent(CertificateInfo.self, forKey: .certificate)
    }
}

import Foundation

/// How well the student knows a word, as the server tracks it.
public enum VocabWordStatus: String, Codable, Sendable {
    case new
    case learning
    case mastered

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = VocabWordStatus(rawValue: raw.lowercased()) ?? .new
    }
}

public struct VocabWord: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let word: String
    public let definition: String
    public let partOfSpeech: String?
    public let example: String?
    public let synonyms: [String]
    public let status: VocabWordStatus

    private enum CodingKeys: String, CodingKey {
        case id, word, definition, example, synonyms, status
        case partOfSpeech = "part_of_speech"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        word = (try? c.decode(String.self, forKey: .word)) ?? ""
        definition = (try? c.decode(String.self, forKey: .definition)) ?? ""
        partOfSpeech = try? c.decodeIfPresent(String.self, forKey: .partOfSpeech)
        example = try? c.decodeIfPresent(String.self, forKey: .example)
        synonyms = (try? c.decodeIfPresent([String].self, forKey: .synonyms)) as? [String] ?? []
        status = (try? c.decodeIfPresent(VocabWordStatus.self, forKey: .status)) as? VocabWordStatus ?? .new
    }

    public init(
        id: Int,
        word: String,
        definition: String,
        partOfSpeech: String? = nil,
        example: String? = nil,
        synonyms: [String] = [],
        status: VocabWordStatus = .new
    ) {
        self.id = id
        self.word = word
        self.definition = definition
        self.partOfSpeech = partOfSpeech
        self.example = example
        self.synonyms = synonyms
        self.status = status
    }
}

public struct VocabSetSummary: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let sectionTitle: String?
    public let wordCount: Int
    public let completed: Bool

    private enum CodingKeys: String, CodingKey {
        case id, title, completed
        case sectionTitle = "section_title"
        case wordCount = "word_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        sectionTitle = try? c.decodeIfPresent(String.self, forKey: .sectionTitle)
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool ?? false
    }
}

/// One classroom assignment that carries vocabulary sets.
public struct VocabHomeworkGroup: Decodable, Sendable, Equatable, Identifiable {
    public let assignmentId: Int
    public let assignmentTitle: String
    public let classroomId: Int?
    public let classroomName: String?
    public let dueAt: String?
    public let sets: [VocabSetSummary]

    public var id: Int { assignmentId }

    public var isComplete: Bool { !sets.isEmpty && sets.allSatisfy(\.completed) }

    private enum CodingKeys: String, CodingKey {
        case sets
        case assignmentId = "assignment_id"
        case assignmentTitle = "assignment_title"
        case classroomId = "classroom_id"
        case classroomName = "classroom_name"
        case dueAt = "due_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        assignmentId = try c.decode(Int.self, forKey: .assignmentId)
        assignmentTitle = (try? c.decode(String.self, forKey: .assignmentTitle)) ?? ""
        classroomId = try? c.decodeIfPresent(Int.self, forKey: .classroomId)
        classroomName = try? c.decodeIfPresent(String.self, forKey: .classroomName)
        dueAt = try? c.decodeIfPresent(String.self, forKey: .dueAt)
        sets = (try? c.decodeIfPresent([VocabSetSummary].self, forKey: .sets)) as? [VocabSetSummary] ?? []
    }
}

public struct VocabSetDetail: Decodable, Sendable, Equatable, Identifiable {
    public struct SectionRef: Decodable, Sendable, Equatable {
        public let id: Int
        public let title: String
    }

    public let id: Int
    public let title: String
    public let isCustom: Bool
    public let section: SectionRef?
    public let wordCount: Int
    public let completed: Bool
    public let words: [VocabWord]

    private enum CodingKeys: String, CodingKey {
        case id, title, section, words, completed
        case isCustom = "is_custom"
        case wordCount = "word_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        isCustom = (try? c.decodeIfPresent(Bool.self, forKey: .isCustom)) as? Bool ?? false
        section = try? c.decodeIfPresent(SectionRef.self, forKey: .section)
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool ?? false
        words = (try? c.decodeIfPresent([VocabWord].self, forKey: .words)) as? [VocabWord] ?? []
    }
}

/// The four study modes the platform defines. The app ships two of them; see `StudyMode`
/// in the app target for which and why.
public enum VocabStudyMode: String, Codable, Sendable, CaseIterable {
    case flashcard
    case matching
    case speed
    case test
}

public struct VocabSession: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let setId: Int
    public let mode: VocabStudyMode

    private enum CodingKeys: String, CodingKey {
        case id, mode
        case setId = "set_id"
    }
}

/// What one study run came to.
public struct VocabSessionSummary: Decodable, Sendable, Equatable {
    public let id: Int
    public let mode: VocabStudyMode?
    public let correctCount: Int
    public let totalCount: Int
    public let accuracy: Double?
    public let setCompleted: Bool

    private enum CodingKeys: String, CodingKey {
        case id, mode, accuracy
        case correctCount = "correct_count"
        case totalCount = "total_count"
        case setCompleted = "set_completed"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        mode = try? c.decodeIfPresent(VocabStudyMode.self, forKey: .mode)
        correctCount = (try? c.decodeIfPresent(Int.self, forKey: .correctCount)) as? Int ?? 0
        totalCount = (try? c.decodeIfPresent(Int.self, forKey: .totalCount)) as? Int ?? 0
        accuracy = try? c.decodeIfPresent(Double.self, forKey: .accuracy)
        setCompleted = (try? c.decodeIfPresent(Bool.self, forKey: .setCompleted)) as? Bool ?? false
    }
}

/// One word's outcome in a study run.
public struct VocabResult: Encodable, Sendable, Equatable {
    public let wordId: Int
    public let correct: Bool

    public init(wordId: Int, correct: Bool) {
        self.wordId = wordId
        self.correct = correct
    }

    private enum CodingKeys: String, CodingKey {
        case correct
        case wordId = "word_id"
    }
}

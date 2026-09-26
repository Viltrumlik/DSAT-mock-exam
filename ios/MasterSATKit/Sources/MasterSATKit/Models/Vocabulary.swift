import Foundation

/// How well the student knows a word, as the server tracks it.
///
/// Two buckets, not three. A word is mastered once it has been answered correctly in ALL
/// FOUR games — the per-word form of the rule that masters a set — and until then it is
/// simply not mastered yet. The old middle bucket ("learning", three right in a row) is gone
/// from the server; anything that is not "mastered", that one included, reads as new.
public enum VocabWordStatus: String, Codable, Sendable {
    case new
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
    /// Which section this row belongs to. Only the bank search sends it — and it has to
    /// be shown there, because the same word exists as a separate row in every section
    /// that teaches it, so a search for "abate" returns three identical-looking results.
    public let sectionTitle: String?

    private enum CodingKeys: String, CodingKey {
        case id, word, definition, example, synonyms, status
        case partOfSpeech = "part_of_speech"
        case sectionTitle = "section_title"
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
        sectionTitle = try? c.decodeIfPresent(String.self, forKey: .sectionTitle)
    }

    public init(
        id: Int,
        word: String,
        definition: String,
        partOfSpeech: String? = nil,
        example: String? = nil,
        synonyms: [String] = [],
        status: VocabWordStatus = .new,
        sectionTitle: String? = nil
    ) {
        self.id = id
        self.word = word
        self.definition = definition
        self.partOfSpeech = partOfSpeech
        self.example = example
        self.synonyms = synonyms
        self.status = status
        self.sectionTitle = sectionTitle
    }
}

/// One set inside a vocabulary homework (`GET /vocabulary/homework/`).
public struct VocabSetSummary: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let sectionTitle: String?
    public let wordCount: Int
    /// Any one game finished here — weaker than mastery, and never the bar.
    public let completed: Bool
    /// The same four-game block the set page shows, so the homework card can say how many
    /// of the four games are still owed.
    public let mastery: VocabSetMastery

    private enum CodingKeys: String, CodingKey {
        case id, title, completed, mastery
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
        mastery = ((try? c.decodeIfPresent(VocabSetMastery.self, forKey: .mastery)) ?? nil) ?? .empty
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
    /// Any one game finished — "completed" and "mastered" answer different questions and a
    /// set can be the first and 0% the second.
    public let completed: Bool
    public let mastery: VocabSetMastery
    public let words: [VocabWord]

    private enum CodingKeys: String, CodingKey {
        case id, title, section, words, completed, mastery
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
        mastery = ((try? c.decodeIfPresent(VocabSetMastery.self, forKey: .mastery)) ?? nil) ?? .empty
        words = (try? c.decodeIfPresent([VocabWord].self, forKey: .words)) as? [VocabWord] ?? []
    }
}

/// The four study games the platform defines, in the order every "n of 4" reads. All four
/// ship on the phone.
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
    /// 0–100, one decimal place.
    public let accuracy: Double?
    /// How many different words of the set this run answered.
    public let distinctWords: Int
    /// How much of the set this run reached, 0–1. Speed only reports what was answered
    /// before its clock ran out, so a 100% run over two words is worth what it covered.
    public let coverage: Double?
    public let durationMs: Int?
    /// Any one game finished on the set — the completion rule.
    public let setCompleted: Bool
    /// Did THIS run master its game? A clean sweep: every word answered, none wrong. The
    /// server recomputes it from the stored row, so a replayed finish says the same thing.
    public let modeMastered: Bool
    /// The set's four-game bar as it stands after this run.
    public let mastery: VocabSetMastery
    /// New / mastered over the set's words, after this run.
    public let progress: VocabProgress?

    private enum CodingKeys: String, CodingKey {
        case id, mode, accuracy, coverage, mastery, progress
        case correctCount = "correct_count"
        case totalCount = "total_count"
        case distinctWords = "distinct_words"
        case durationMs = "duration_ms"
        case setCompleted = "set_completed"
        case modeMastered = "mode_mastered"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        mode = try? c.decodeIfPresent(VocabStudyMode.self, forKey: .mode)
        correctCount = (try? c.decodeIfPresent(Int.self, forKey: .correctCount)) as? Int ?? 0
        totalCount = (try? c.decodeIfPresent(Int.self, forKey: .totalCount)) as? Int ?? 0
        accuracy = VocabDecoding.double(c, .accuracy)
        distinctWords = (try? c.decodeIfPresent(Int.self, forKey: .distinctWords)) as? Int ?? 0
        coverage = VocabDecoding.double(c, .coverage)
        durationMs = (try? c.decodeIfPresent(Int.self, forKey: .durationMs)) ?? nil
        setCompleted = (try? c.decodeIfPresent(Bool.self, forKey: .setCompleted)) as? Bool ?? false
        modeMastered = (try? c.decodeIfPresent(Bool.self, forKey: .modeMastered)) as? Bool ?? false
        mastery = ((try? c.decodeIfPresent(VocabSetMastery.self, forKey: .mastery)) ?? nil) ?? .empty
        progress = (try? c.decodeIfPresent(VocabProgress.self, forKey: .progress)) ?? nil
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

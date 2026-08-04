import Foundation

/// How far through a set or section the student is.
///
/// The three buckets are a partition of `total` only for words the student has actually
/// answered — an untouched word is "new" — so the bar can be drawn straight from them.
public struct VocabProgress: Decodable, Sendable, Equatable {
    public let new: Int
    public let learning: Int
    public let mastered: Int
    public let total: Int

    public var studied: Int { learning + mastered }
    public var fractionMastered: Double { total > 0 ? Double(mastered) / Double(total) : 0 }

    public init(new: Int = 0, learning: Int = 0, mastered: Int = 0, total: Int = 0) {
        self.new = new
        self.learning = learning
        self.mastered = mastered
        self.total = total
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        new = (try? c.decodeIfPresent(Int.self, forKey: .new)) as? Int ?? 0
        learning = (try? c.decodeIfPresent(Int.self, forKey: .learning)) as? Int ?? 0
        mastered = (try? c.decodeIfPresent(Int.self, forKey: .mastered)) as? Int ?? 0
        total = (try? c.decodeIfPresent(Int.self, forKey: .total)) as? Int ?? 0
    }

    private enum CodingKeys: String, CodingKey { case new, learning, mastered, total }
}

/// One published section of the word bank.
public struct VocabSection: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let description: String?
    public let setCount: Int
    public let wordCount: Int
    public let progress: VocabProgress

    private enum CodingKeys: String, CodingKey {
        case id, title, description, progress
        case setCount = "set_count"
        case wordCount = "word_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        setCount = (try? c.decodeIfPresent(Int.self, forKey: .setCount)) as? Int ?? 0
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        progress = (try? c.decodeIfPresent(VocabProgress.self, forKey: .progress)) as? VocabProgress
            ?? VocabProgress()
    }
}

/// A section opened up: its sets, each with the student's progress.
public struct VocabSectionDetail: Decodable, Sendable, Equatable, Identifiable {
    public struct SetRow: Decodable, Sendable, Equatable, Identifiable {
        public let id: Int
        public let title: String
        public let order: Int
        public let wordCount: Int
        public let completed: Bool
        public let progress: VocabProgress

        private enum CodingKeys: String, CodingKey {
            case id, title, order, completed, progress
            case wordCount = "word_count"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(Int.self, forKey: .id)
            title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
            order = (try? c.decodeIfPresent(Int.self, forKey: .order)) as? Int ?? 0
            wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
            completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool ?? false
            progress = (try? c.decodeIfPresent(VocabProgress.self, forKey: .progress)) as? VocabProgress
                ?? VocabProgress()
        }
    }

    public let id: Int
    public let title: String
    public let description: String?
    public let wordCount: Int
    public let progress: VocabProgress
    public let sets: [SetRow]

    private enum CodingKeys: String, CodingKey {
        case id, title, description, progress, sets
        case wordCount = "word_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        progress = (try? c.decodeIfPresent(VocabProgress.self, forKey: .progress)) as? VocabProgress
            ?? VocabProgress()
        sets = (try? c.decodeIfPresent([SetRow].self, forKey: .sets)) as? [SetRow] ?? []
    }
}

/// A set the student built themselves.
public struct VocabMySet: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let wordCount: Int
    public let completed: Bool
    public let createdAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, completed
        case wordCount = "word_count"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool ?? false
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

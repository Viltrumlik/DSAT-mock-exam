import Foundation

/// How many of a set's or section's words the student has proved.
///
/// Two buckets: `mastered` (right in all four games) and `new` (everything else). The old
/// middle bucket, "learning", is gone from the server — a payload that still carries it is
/// simply ignored, because it can no longer mean anything.
public struct VocabProgress: Decodable, Sendable, Equatable {
    public let new: Int
    public let mastered: Int
    public let total: Int

    public var fractionMastered: Double { total > 0 ? Double(mastered) / Double(total) : 0 }
    /// Words mastered as a whole percentage — the ring on a section card.
    public var percentMastered: Int { Int((fractionMastered * 100).rounded()) }

    public init(new: Int = 0, mastered: Int = 0, total: Int = 0) {
        self.new = new
        self.mastered = mastered
        self.total = total
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        new = (try? c.decodeIfPresent(Int.self, forKey: .new)) as? Int ?? 0
        mastered = (try? c.decodeIfPresent(Int.self, forKey: .mastered)) as? Int ?? 0
        total = (try? c.decodeIfPresent(Int.self, forKey: .total)) as? Int ?? 0
    }

    private enum CodingKeys: String, CodingKey { case new, mastered, total }
}

/// One published section of the word bank.
public struct VocabSection: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let description: String?
    public let setCount: Int
    public let wordCount: Int
    /// Words — what the ring on the hub card counts.
    public let progress: VocabProgress
    /// Sets — what the bar on the hub card counts. The two are different questions and both
    /// are shown; drawing one number twice is what the web avoids.
    public let mastery: VocabSectionMastery

    private enum CodingKeys: String, CodingKey {
        case id, title, description, progress, mastery
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
        mastery = ((try? c.decodeIfPresent(VocabSectionMastery.self, forKey: .mastery)) ?? nil)
            ?? VocabSectionMastery(masteredSets: 0, totalSets: setCount)
    }
}

/// A section opened up: its sets, each with the student's progress.
public struct VocabSectionDetail: Decodable, Sendable, Equatable, Identifiable {
    public struct SetRow: Decodable, Sendable, Equatable, Identifiable {
        public let id: Int
        public let title: String
        public let order: Int
        public let wordCount: Int
        /// Any one game finished — "already started" on the section page.
        public let completed: Bool
        public let progress: VocabProgress
        public let mastery: VocabSetMastery

        private enum CodingKeys: String, CodingKey {
            case id, title, order, completed, progress, mastery
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
            mastery = ((try? c.decodeIfPresent(VocabSetMastery.self, forKey: .mastery)) ?? nil) ?? .empty
        }
    }

    public let id: Int
    public let title: String
    public let description: String?
    /// DISTINCT words in the section — the number the hub shows, and not the sum of the sets'
    /// counts: a word in two sets is one word here.
    public let wordCount: Int
    public let progress: VocabProgress
    /// Derived by the server from the very set cards below, so header and list agree.
    public let mastery: VocabSectionMastery
    public let sets: [SetRow]

    /// Sets with at least one game finished — "{k} already started".
    public var startedSets: Int { sets.filter(\.completed).count }
    /// Every set in the section mastered, and there is at least one.
    public var everySetMastered: Bool { !sets.isEmpty && sets.allSatisfy(\.mastery.isMastered) }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, progress, sets, mastery
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
        let sets = (try? c.decodeIfPresent([SetRow].self, forKey: .sets)) as? [SetRow] ?? []
        self.sets = sets
        mastery = ((try? c.decodeIfPresent(VocabSectionMastery.self, forKey: .mastery)) ?? nil)
            ?? VocabSectionMastery(
                masteredSets: sets.filter(\.mastery.isMastered).count,
                totalSets: sets.count
            )
    }
}

/// A set the student built themselves.
public struct VocabMySet: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let wordCount: Int
    public let completed: Bool
    public let mastery: VocabSetMastery
    public let createdAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, completed, mastery
        case wordCount = "word_count"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) as? String ?? ""
        wordCount = (try? c.decodeIfPresent(Int.self, forKey: .wordCount)) as? Int ?? 0
        completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool ?? false
        mastery = ((try? c.decodeIfPresent(VocabSetMastery.self, forKey: .mastery)) ?? nil) ?? .empty
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

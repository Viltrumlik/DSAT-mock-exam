import Foundation

/// One set's progress bar: the four games, and which of them have been played CLEAN.
///
/// A game is mastered by a single clean run — completed, every word of the set answered,
/// none of them wrong — and once earned it stays earned. Each game is a quarter of the
/// bar and there is no partial credit inside a game, so `percent` only ever reads 0, 25,
/// 50, 75 or 100. The rule is the server's (`vocabulary/serializers.py::mastery_out`);
/// the app only draws it.
public struct VocabSetMastery: Decodable, Sendable, Equatable {
    public let modes: [VocabStudyMode: Bool]
    public let masteredModes: Int
    public let totalModes: Int
    /// Whole games only.
    public let percent: Int
    /// All four games clean. Always false for a set with no words — it has nothing to master.
    public let isMastered: Bool

    /// What a set nobody has played looks like, and what a payload without the block reads as.
    public static let empty = VocabSetMastery(modes: [:])

    public init(
        modes: [VocabStudyMode: Bool],
        masteredModes: Int? = nil,
        totalModes: Int = VocabStudyMode.allCases.count,
        percent: Int? = nil,
        isMastered: Bool? = nil
    ) {
        let earned = masteredModes ?? VocabStudyMode.allCases.filter { modes[$0] == true }.count
        let total = max(0, totalModes)
        self.modes = modes
        self.masteredModes = earned
        self.totalModes = total
        self.percent = percent ?? (total > 0 ? Int((Double(earned) / Double(total) * 100).rounded()) : 0)
        self.isMastered = isMastered ?? (total > 0 && earned >= total)
    }

    /// Has this game been played clean on this set?
    public func isMastered(_ mode: VocabStudyMode) -> Bool { modes[mode] ?? false }

    private enum CodingKeys: String, CodingKey {
        case modes, percent
        case masteredModes = "mastered_modes"
        case totalModes = "total_modes"
        case isMastered = "is_mastered"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = (try? c.decodeIfPresent([String: Bool].self, forKey: .modes)) ?? nil
        var modes: [VocabStudyMode: Bool] = [:]
        // A game the app has never heard of is skipped rather than failing the block: a
        // fifth game on the server must not blank every bar on a phone that knows four.
        for (key, value) in raw ?? [:] {
            if let mode = VocabStudyMode(rawValue: key) { modes[mode] = value }
        }
        self.init(
            modes: modes,
            masteredModes: (try? c.decodeIfPresent(Int.self, forKey: .masteredModes)) ?? nil,
            totalModes: ((try? c.decodeIfPresent(Int.self, forKey: .totalModes)) ?? nil)
                ?? VocabStudyMode.allCases.count,
            percent: VocabDecoding.wholeNumber(c, .percent),
            isMastered: (try? c.decodeIfPresent(Bool.self, forKey: .isMastered)) ?? nil
        )
    }
}

/// A section's bar, one scale up: how many of its sets are fully mastered.
///
/// It rolls up the SETS rather than re-counting words, so every bar in the feature answers
/// the same question — "how much of this is finished" — at its own scale.
public struct VocabSectionMastery: Decodable, Sendable, Equatable {
    public let masteredSets: Int
    public let totalSets: Int
    public let percent: Int

    public static let empty = VocabSectionMastery(masteredSets: 0, totalSets: 0)

    public init(masteredSets: Int, totalSets: Int, percent: Int? = nil) {
        self.masteredSets = masteredSets
        self.totalSets = totalSets
        self.percent = percent
            ?? (totalSets > 0 ? Int((Double(masteredSets) / Double(totalSets) * 100).rounded()) : 0)
    }

    /// Every set in the section mastered — and there is at least one.
    public var isComplete: Bool { totalSets > 0 && masteredSets >= totalSets }

    private enum CodingKeys: String, CodingKey {
        case percent
        case masteredSets = "mastered_sets"
        case totalSets = "total_sets"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            masteredSets: ((try? c.decodeIfPresent(Int.self, forKey: .masteredSets)) ?? nil) ?? 0,
            totalSets: ((try? c.decodeIfPresent(Int.self, forKey: .totalSets)) ?? nil) ?? 0,
            percent: VocabDecoding.wholeNumber(c, .percent)
        )
    }
}

enum VocabDecoding {
    /// An integer the server computes with Python's `round()`, read defensively: a float or
    /// a numeric string must not zero out a bar.
    static func wholeNumber<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Int? {
        if let i = (try? c.decodeIfPresent(Int.self, forKey: key)) ?? nil { return i }
        if let d = (try? c.decodeIfPresent(Double.self, forKey: key)) ?? nil, d.isFinite {
            return Int(d.rounded())
        }
        if let s = (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil, let d = Double(s), d.isFinite {
            return Int(d.rounded())
        }
        return nil
    }

    static func double<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Double? {
        if let d = (try? c.decodeIfPresent(Double.self, forKey: key)) ?? nil { return d }
        if let s = (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil { return Double(s) }
        return nil
    }
}

// MARK: - Colour identity

/// Which of the six colour slots a published section owns — the web's `sectionTone`.
///
/// Keyed on the section **id**, never its position in a list: the section page has only an
/// id, and a section keeps its colour when a newer one is published above it. The order is
/// deliberately not grouped by family — sections are published in a run, so consecutive ids
/// must land far apart in hue (blue, orange, purple, green, pink, cyan). The palette itself
/// is UI and lives in the app; this is only the rule that picks a slot.
public enum VocabSectionTone: String, CaseIterable, Sendable {
    case primary, amber, violet, emerald, rose, sky

    /// The slot order. `allCases` is this order too, but the rule is spelled out because the
    /// sequence IS the rule — reordering the cases would repaint every section.
    public static let order: [VocabSectionTone] = [.primary, .amber, .violet, .emerald, .rose, .sky]

    public static func of(sectionId: Int) -> VocabSectionTone {
        // `magnitude`, not `abs`: `abs(Int.min)` traps, and an id is never worth a crash.
        order[Int(sectionId.magnitude % UInt(order.count))]
    }
}

// MARK: - Hub arithmetic

/// The four totals on the vocabulary hub's hero, summed across every published section.
public struct VocabHubTotals: Equatable, Sendable {
    public let words: Int
    public let wordsMastered: Int
    public let sets: Int
    public let setsMastered: Int

    public init(sections: [VocabSection]) {
        var words = 0, wordsMastered = 0, sets = 0, setsMastered = 0
        for section in sections {
            words += section.wordCount
            wordsMastered += section.progress.mastered
            sets += section.setCount
            setsMastered += section.mastery.masteredSets
        }
        self.words = words
        self.wordsMastered = wordsMastered
        self.sets = sets
        self.setsMastered = setsMastered
    }
}

extension VocabHomeworkGroup {
    /// Sets in this homework with at least one game finished — the "{done} / {n}" pill.
    /// Weaker than mastery on purpose: it tells a student they have started.
    public var doneCount: Int { sets.filter(\.completed).count }

    /// Sets still owed: a homework set is owed until all four games are clean, so counting
    /// the ones merely started would tell a student they were finished when the homework
    /// still scores three quarters.
    public var outstandingCount: Int { sets.filter { !$0.mastery.isMastered }.count }

    /// What the Homework tab badges. Zero is not shown.
    public static func outstanding(in groups: [VocabHomeworkGroup]) -> Int {
        groups.reduce(0) { $0 + $1.outstandingCount }
    }
}

// MARK: - Word list

/// The All / New / Mastered control on a set's word list.
public enum VocabWordFilter: String, CaseIterable, Sendable, Identifiable {
    case all, new, mastered

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: return "All"
        case .new: return "New"
        case .mastered: return "Mastered"
        }
    }

    public func matches(_ word: VocabWord) -> Bool {
        switch self {
        case .all: return true
        case .new: return word.status == .new
        case .mastered: return word.status == .mastered
        }
    }

    public func apply(_ words: [VocabWord]) -> [VocabWord] {
        self == .all ? words : words.filter(matches)
    }

    /// How many words each tab would show — the counts on the filter pills and the New /
    /// Mastered tiles on the set page, which the web derives from the words rather than the
    /// API so the tiles can never disagree with the list right under them.
    public static func counts(_ words: [VocabWord]) -> [VocabWordFilter: Int] {
        var out: [VocabWordFilter: Int] = [.all: words.count, .new: 0, .mastered: 0]
        for word in words { out[word.status == .mastered ? .mastered : .new, default: 0] += 1 }
        return out
    }
}

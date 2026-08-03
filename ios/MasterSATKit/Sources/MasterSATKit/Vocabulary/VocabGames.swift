import Foundation

/// Pure game logic for the study modes — shuffling, round chunking, distractor picking.
///
/// A direct port of the web's `features/vocabulary/modes/utils.ts`, deliberately free of
/// any UI so the same rules can be unit-tested. Every helper takes an injectable random
/// source so a test can pin the shuffle.
public enum VocabGames {

    /// Matching deals six words per round…
    public static let matchingChunkSize = 6
    /// …unless the leftovers would make a round of fewer than three, which is no fun.
    public static let matchingMinTail = 3
    /// A speed round is sixty seconds.
    public static let speedRoundSeconds = 60
    /// Ticks of the 3-2-1 lead-in before a speed round starts.
    public static let speedLeadInTicks = 3

    public typealias Rng = () -> Double

    /// Fisher–Yates. Returns a new array; the input is never mutated.
    public static func shuffle<T>(_ items: [T], rng: Rng = { Double.random(in: 0..<1) }) -> [T] {
        var out = items
        guard out.count > 1 else { return out }
        for i in stride(from: out.count - 1, to: 0, by: -1) {
            // Clamped: a stubbed rng returning exactly 1 in a test must not index past
            // the end.
            let j = min(i, Int(rng() * Double(i + 1)))
            out.swapAt(i, max(0, j))
        }
        return out
    }

    /// Split a set into matching rounds. A trailing group holding fewer than `minTail`
    /// merges into the one before it, so 25 words deal as 6, 6, 6, 7 — not 6, 6, 6, 6, 1.
    public static func chunkForMatching<T>(
        _ items: [T],
        size: Int = matchingChunkSize,
        minTail: Int = matchingMinTail
    ) -> [[T]] {
        guard !items.isEmpty, size > 0 else { return [] }
        var chunks: [[T]] = []
        var i = 0
        while i < items.count {
            chunks.append(Array(items[i..<min(i + size, items.count)]))
            i += size
        }
        if chunks.count > 1, let tail = chunks.last, tail.count < minTail {
            chunks.removeLast()
            chunks[chunks.count - 1] += tail
        }
        return chunks
    }

    private static func normalise(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Wrong answers for matching and speed.
    ///
    /// Never the target word itself, never a same-spelled duplicate from another section,
    /// and never a word that *means* the same thing: every mode asks the student to tell a
    /// definition from the word it belongs to, so a same-definition candidate is a second
    /// correct answer rather than a distractor.
    public static func pickDistractors(
        from pool: [VocabWord],
        excluding target: VocabWord,
        count: Int,
        rng: Rng = { Double.random(in: 0..<1) }
    ) -> [VocabWord] {
        guard count > 0 else { return [] }
        var seenWords: Set<String> = [normalise(target.word)]
        let excludedDefinition = normalise(target.definition)
        var candidates: [VocabWord] = []
        for candidate in pool {
            if candidate.id == target.id { continue }
            let key = normalise(candidate.word)
            if seenWords.contains(key) { continue }
            // Checked BEFORE `key` is reserved: a twin dropped here must not block a
            // genuinely different word that happens to share its spelling.
            if normalise(candidate.definition) == excludedDefinition { continue }
            seenWords.insert(key)
            candidates.append(candidate)
        }
        return Array(shuffle(candidates, rng: rng).prefix(count))
    }

    // MARK: - Matching

    public struct MatchCard: Sendable, Equatable, Identifiable {
        public enum Face: Sendable { case word, definition }

        /// Stable per-card id — a word and its definition share a `wordId`.
        public let id: String
        public let wordId: Int
        public let face: Face
        public let text: String
    }

    /// One round's worth of cards: every word and every definition, shuffled together.
    public static func matchCards(
        for words: [VocabWord],
        rng: Rng = { Double.random(in: 0..<1) }
    ) -> [MatchCard] {
        var cards: [MatchCard] = []
        for w in words {
            cards.append(MatchCard(id: "w-\(w.id)", wordId: w.id, face: .word, text: w.word))
            cards.append(MatchCard(id: "d-\(w.id)", wordId: w.id, face: .definition, text: w.definition))
        }
        return shuffle(cards, rng: rng)
    }

    /// Two cards pair up when they describe the same word from opposite faces.
    public static func isPair(_ a: MatchCard, _ b: MatchCard) -> Bool {
        a.wordId == b.wordId && a.face != b.face
    }

    // MARK: - Speed

    public struct SpeedOption: Sendable, Equatable, Identifiable {
        public let id: Int
        public let text: String
        public let isCorrect: Bool
    }

    public struct SpeedPrompt: Sendable, Equatable, Identifiable {
        public let id: Int
        public let word: String
        public let options: [SpeedOption]

        public var wordId: Int { id }
    }

    /// One prompt per word: the word, its definition, and one decoy definition.
    public static func speedPrompts(
        for words: [VocabWord],
        pool: [VocabWord],
        rng: Rng = { Double.random(in: 0..<1) }
    ) -> [SpeedPrompt] {
        shuffle(words, rng: rng).map { w in
            var texts: [(String, Bool)] = [(w.definition, true)]
            // A one-word set has nothing to contrast against; show the single option
            // rather than inventing a decoy.
            if let decoy = pickDistractors(from: pool, excluding: w, count: 1, rng: rng).first {
                texts.append((decoy.definition, false))
            }
            let ordered = shuffle(texts, rng: rng)
            return SpeedPrompt(
                id: w.id,
                word: w.word,
                options: ordered.enumerated().map { SpeedOption(id: $0.offset, text: $0.element.0, isCorrect: $0.element.1) }
            )
        }
    }
}

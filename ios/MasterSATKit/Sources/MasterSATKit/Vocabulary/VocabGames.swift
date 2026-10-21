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

    // MARK: - Spelling

    /// Which letter of `word` is given away. `nil` when there is no letter to reveal.
    public static func revealIndex(
        in word: String,
        rng: Rng = { Double.random(in: 0..<1) }
    ) -> Int? {
        let letters = Array(word).enumerated().filter { $0.element.isLetter }.map(\.offset)
        guard !letters.isEmpty else { return nil }
        return letters[min(letters.count - 1, Int(rng() * Double(letters.count)))]
    }

    /// One tile of the spelling question's well.
    public struct SpellingTile: Sendable, Equatable {
        public enum Kind: Sendable, Equatable {
            /// The letter given away (`TestQuestion.revealIndex`), shown as the hint until the
            /// student types on its position.
            case given
            /// A character the student typed, at the position it landed on: a letter, or any
            /// other character (a digit, a hyphen) — a wrong one looks exactly like a right one.
            case typed
            /// A letter position still to type.
            case blank
            /// A space, hyphen or apostrophe the student has not typed over yet, shown as a
            /// faint placeholder. It is a placeholder, not a free pass: the grader compares the
            /// whole string, so these characters have to be typed too.
            case structure
        }

        public let kind: Kind
        /// What the tile shows, as typed (the view sets the case); empty for a blank.
        public let character: String

        public init(kind: Kind, character: String) {
            self.kind = kind
            self.character = character
        }
    }

    /// The well as the student has filled it so far: what was typed, position by position.
    ///
    /// The n-th typed character sits on the n-th position of the word — EVERY character, spaces,
    /// hyphens, apostrophes and anything else included — because the grader (`spellingIsCorrect`)
    /// compares the whole string, shape and all. A word with a hyphen is therefore not finished
    /// when its letters are in: "wellbeing" leaves "well-being" one position short, and the well
    /// shows it. A position the student has not reached shows what it holds for them: the given
    /// letter (the hint), a faint placeholder for a space/hyphen/apostrophe, or an empty well.
    /// Typing on the given letter's position replaces the hint with what was typed. Characters
    /// typed past the end of the word are not shown. Leading or trailing spaces are not trimmed
    /// here, though the grader trims them.
    ///
    /// Nothing here compares a typed character with the word's: a tile's kind never depends on
    /// whether it is right. The test says nothing until its end.
    public static func spellingTiles(word: String, revealing index: Int?, typed: String) -> [SpellingTile] {
        let entered = Array(typed)
        return Array(word).enumerated().map { offset, character in
            if offset < entered.count { return SpellingTile(kind: .typed, character: String(entered[offset])) }
            if !character.isLetter { return SpellingTile(kind: .structure, character: String(character)) }
            if offset == index { return SpellingTile(kind: .given, character: String(character)) }
            return SpellingTile(kind: .blank, character: "")
        }
    }

    /// The word as blanks with one position filled in.
    ///
    /// Non-letters — spaces, hyphens, apostrophes — stay visible, so the shape of the word is not
    /// part of what the student has to guess. They are still part of the answer: the grader
    /// compares the whole string, so the student types them too.
    public static func maskWord(_ word: String, revealing index: Int?) -> [String] {
        Array(word).enumerated().map { offset, character in
            offset == index || !character.isLetter ? String(character) : "_"
        }
    }

    /// Trimmed and case-insensitive — the platform's comparison rule, in one place.
    public static func spellingIsCorrect(_ input: String, _ word: String) -> Bool {
        let target = normalise(word)
        return !target.isEmpty && normalise(input) == target
    }

    // MARK: - Test

    /// A test walks every word once, cycling through the three kinds in this order.
    ///
    /// The cycle is the point: one word gets recognised from four candidates, the next is
    /// judged against a claim, the next has to be produced from memory. Three difficulties
    /// of the same knowledge, and a student cannot coast on one of them.
    public enum TestQuestionKind: String, Sendable, CaseIterable {
        case mcq, trueFalse, spelling
    }

    public static let testKindCycle: [TestQuestionKind] = [.mcq, .trueFalse, .spelling]
    /// Options on a multiple-choice test question.
    public static let testOptionCount = 4

    public struct TestQuestion: Sendable, Equatable, Identifiable {
        public let id: Int
        public let kind: TestQuestionKind
        public let wordId: Int
        public let word: String
        public let definition: String
        /// MCQ only: the candidate WORDS, one of them right.
        public let options: [String]
        public let answerIndex: Int
        /// True/False only: the definition the statement claims belongs to `word`.
        public let shownDefinition: String
        public let isGenuine: Bool
        /// Spelling only: which letter is given away.
        public let revealIndex: Int?
    }

    public static func buildTestQuestions(
        for words: [VocabWord],
        pool: [VocabWord],
        rng: Rng = { Double.random(in: 0..<1) }
    ) -> [TestQuestion] {
        shuffle(words, rng: rng).enumerated().map { position, w in
            let kind = testKindCycle[position % testKindCycle.count]
            switch kind {
            case .mcq:
                let decoys = pickDistractors(from: pool, excluding: w, count: testOptionCount - 1, rng: rng)
                let options = shuffle([w.word] + decoys.map(\.word), rng: rng)
                return TestQuestion(
                    id: position,
                    kind: .mcq,
                    wordId: w.id,
                    word: w.word,
                    definition: w.definition,
                    options: options,
                    answerIndex: options.firstIndex(of: w.word) ?? 0,
                    shownDefinition: w.definition,
                    isGenuine: true,
                    revealIndex: nil
                )
            case .trueFalse:
                let wantsGenuine = rng() < 0.5
                let decoy = wantsGenuine ? nil : pickDistractors(from: pool, excluding: w, count: 1, rng: rng).first
                // No usable decoy — a tiny set — falls back to a genuine pairing rather
                // than claiming a word means itself and calling that false.
                return TestQuestion(
                    id: position,
                    kind: .trueFalse,
                    wordId: w.id,
                    word: w.word,
                    definition: w.definition,
                    options: [],
                    answerIndex: 0,
                    shownDefinition: decoy?.definition ?? w.definition,
                    isGenuine: decoy == nil,
                    revealIndex: nil
                )
            case .spelling:
                return TestQuestion(
                    id: position,
                    kind: .spelling,
                    wordId: w.id,
                    word: w.word,
                    definition: w.definition,
                    options: [],
                    answerIndex: 0,
                    shownDefinition: w.definition,
                    isGenuine: true,
                    revealIndex: revealIndex(in: w.word, rng: rng)
                )
            }
        }
    }

    /// Accuracy as a whole percentage. Nothing answered is 0, never a division by zero.
    public static func accuracyPercent(correct: Int, of total: Int) -> Int {
        total <= 0 ? 0 : Int((Double(correct) / Double(total) * 100).rounded())
    }
}

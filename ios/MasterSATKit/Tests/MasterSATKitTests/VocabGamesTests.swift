import Foundation
import Testing
@testable import MasterSATKit

private func word(_ id: Int, _ text: String, _ definition: String) -> VocabWord {
    VocabWord(id: id, word: text, definition: definition)
}

/// A deterministic "random" source: always picks the first candidate.
///
/// A function, not a `let`: a global closure is not `Sendable`, and Swift 6 refuses to
/// let one be shared across the suites that run in parallel.
private func pinned() -> Double { 0 }

@Suite struct VocabGamesTests {

    @Test("A short tail merges into the round before it")
    func tailMerges() {
        // 25 words deal as 6, 6, 6, 7 — never 6, 6, 6, 6, 1, which is not a round.
        let rounds = VocabGames.chunkForMatching(Array(1...25))

        #expect(rounds.map(\.count) == [6, 6, 6, 7])
    }

    @Test("A tail that is long enough stands on its own")
    func tailStands() {
        #expect(VocabGames.chunkForMatching(Array(1...9)).map(\.count) == [6, 3])
    }

    @Test("A single short set is one round, not zero")
    func singleShortRound() {
        #expect(VocabGames.chunkForMatching(Array(1...2)).map(\.count) == [2])
        #expect(VocabGames.chunkForMatching([Int]()).isEmpty)
    }

    @Test("Every word deals two cards, and only opposite faces pair")
    func cardsPairByFace() throws {
        let words = [word(1, "abate", "to lessen"), word(2, "wary", "cautious")]
        let cards = VocabGames.matchCards(for: words, rng: pinned)

        #expect(cards.count == 4)
        let abateWord = try #require(cards.first { $0.id == "w-1" })
        let abateDef = try #require(cards.first { $0.id == "d-1" })
        let waryWord = try #require(cards.first { $0.id == "w-2" })
        #expect(VocabGames.isPair(abateWord, abateDef))
        // Same face never pairs, even for the same word.
        #expect(VocabGames.isPair(abateWord, abateWord) == false)
        #expect(VocabGames.isPair(abateWord, waryWord) == false)
    }

    @Test("A distractor is never a word that means the same thing")
    func distractorsAreNotSynonyms() {
        // A same-definition candidate is a SECOND CORRECT ANSWER, not a wrong one.
        let target = word(1, "abate", "to lessen")
        let pool = [target, word(2, "subside", "to lessen"), word(3, "wary", "cautious")]

        let picked = VocabGames.pickDistractors(from: pool, excluding: target, count: 2, rng: pinned)

        #expect(picked.map(\.id) == [3])
    }

    @Test("The same word from another section is not its own distractor")
    func duplicateSpellingExcluded() {
        // The bank stores a word once per section, so the pool routinely holds twins.
        let target = word(1, "wary", "cautious")
        let pool = [target, word(9, "wary", "feeling caution"), word(3, "abate", "to lessen")]

        let picked = VocabGames.pickDistractors(from: pool, excluding: target, count: 2, rng: pinned)

        #expect(picked.map(\.id) == [3])
    }

    @Test("Each speed prompt has exactly one correct option")
    func speedPromptsHaveOneAnswer() {
        let words = [word(1, "abate", "to lessen"), word(2, "wary", "cautious")]
        let prompts = VocabGames.speedPrompts(for: words, pool: words, rng: pinned)

        #expect(prompts.count == 2)
        for prompt in prompts {
            #expect(prompt.options.count == 2)
            #expect(prompt.options.filter(\.isCorrect).count == 1)
        }
    }

    @Test("A one-word set gets one option rather than an invented decoy")
    func lonelyWordGetsNoDecoy() {
        let prompts = VocabGames.speedPrompts(
            for: [word(1, "abate", "to lessen")],
            pool: [word(1, "abate", "to lessen")],
            rng: pinned
        )

        #expect(prompts.first?.options.count == 1)
        #expect(prompts.first?.options.first?.isCorrect == true)
    }

    @Test("Shuffling keeps every element and mutates nothing")
    func shuffleIsAPermutation() {
        let input = Array(1...20)
        let out = VocabGames.shuffle(input)

        #expect(out.sorted() == input)
    }
}

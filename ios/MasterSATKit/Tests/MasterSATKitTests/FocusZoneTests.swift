import Foundation
import Testing
@testable import MasterSATKit

@Suite struct SpellingTilesTests {

    /// `[x]` the given letter, a bare character one the student typed, `_` an empty well,
    /// `(x)` a structure placeholder not typed over yet.
    private func show(_ tiles: [VocabGames.SpellingTile]) -> String {
        tiles.map { tile in
            switch tile.kind {
            case .given: return "[\(tile.character)]"
            case .typed: return tile.character
            case .blank: return "_"
            case .structure: return "(\(tile.character))"
            }
        }.joined()
    }

    private func well(_ word: String, _ index: Int? = nil, typed: String) -> String {
        show(VocabGames.spellingTiles(word: word, revealing: index, typed: typed))
    }

    @Test("Nothing typed: the given letter among the wells, the shape as placeholders")
    func nothingTyped() {
        #expect(well("brisk", 2, typed: "") == "__[i]__")
        #expect(well("brisk", typed: "") == "_____")
        #expect(well("well-being", 0, typed: "") == "[w]___(-)_____")
        #expect(well("ad hoc", typed: "") == "__( )___")
    }

    @Test("Typed characters fill the word's positions in order; the hint stays until typed over")
    func filling() {
        #expect(well("brisk", 2, typed: "br") == "br[i]__")
        #expect(well("brisk", 2, typed: "bri") == "bri__")
        #expect(well("brisk", 2, typed: "brisk") == "brisk")
        #expect(well("brisk", 2, typed: "brask") == "brask", "typing on the given letter's position shows what was typed")
    }

    @Test("Characters typed past the end of the word are not shown")
    func overflow() {
        #expect(well("brisk", typed: "briskly") == "brisk")
        #expect(well("brisk", 2, typed: "brisk ") == "brisk")
        #expect(well("brisk", typed: "brasks") == "brask")
    }

    @Test("Shape is typed too: the well mirrors every character, so letters alone leave a hyphen's slot wrong")
    func structureIsTyped() {
        // The grader compares the whole string — "wellbeing" is not "well-being" — so the well must
        // not look finished when only the letters are in.
        #expect(well("well-being", 0, typed: "wellbeing") == "wellbeing_")
        #expect(well("well-being", 0, typed: "well-being") == "well-being")
        #expect(well("well-being", 0, typed: "well-b") == "well-b____")
        #expect(well("well-being", 0, typed: "well") == "well(-)_____")
        #expect(well("ad hoc", typed: "adhoc") == "adhoc_")
        #expect(well("ad hoc", typed: "ad hoc") == "ad hoc")
    }

    @Test("Anything typed lands on its position: a space, a digit, a mark")
    func everyCharacterLands() {
        #expect(well("well-being", 0, typed: "w e") == "w e_(-)_____")
        #expect(well("brisk", typed: "b1!") == "b1!__")
        #expect(well("brisk", typed: "b-r") == "b-r__")
    }

    @Test("An apostrophe is a slot like a hyphen")
    func apostrophe() {
        #expect(well("don't", typed: "don") == "don(')_")
        #expect(well("don't", typed: "don't") == "don't")
        #expect(well("don't", typed: "dont") == "dont_")
    }

    @Test("An accented letter is one letter, however it was typed")
    func accentedLetters() {
        #expect(well("café", 3, typed: "caf") == "caf[é]")
        #expect(well("café", typed: "café") == "café")
        // Typed as "e" + combining acute, it is still ONE character, so it fills one position.
        let decomposed = VocabGames.spellingTiles(word: "café", revealing: nil, typed: "cafe\u{301}")
        #expect(decomposed.count == 4)
        #expect(decomposed.allSatisfy { $0.kind == .typed })
    }

    @Test("A word with nothing in it has no tiles, however much is typed")
    func emptyWord() {
        #expect(VocabGames.spellingTiles(word: "", revealing: nil, typed: "").isEmpty)
        #expect(VocabGames.spellingTiles(word: "", revealing: 0, typed: "abc").isEmpty)
    }

    @Test("A given position outside the word is ignored")
    func givenOutsideTheWord() {
        #expect(well("brisk", 9, typed: "") == "_____")
        #expect(well("brisk", -1, typed: "") == "_____")
    }

    @Test("Never a verdict: a wrong character is a typed character like any other, as typed")
    func noVerdict() {
        let tiles = VocabGames.spellingTiles(word: "brisk", revealing: nil, typed: "Xq")
        #expect(tiles[0] == VocabGames.SpellingTile(kind: .typed, character: "X"))
        #expect(tiles[1] == VocabGames.SpellingTile(kind: .typed, character: "q"))
        #expect(tiles[2] == VocabGames.SpellingTile(kind: .blank, character: ""))

        // Right, wrong and nonsense typed into the same word differ in WHAT is shown, never in
        // what kind of tile shows it — not on a letter, not on a given position, not on a
        // structure slot.
        for word in ["brisk", "well-being", "don't"] {
            let right = VocabGames.spellingTiles(word: word, revealing: 1, typed: word)
            let wrong = VocabGames.spellingTiles(word: word, revealing: 1, typed: String(repeating: "z", count: word.count))
            let nonsense = VocabGames.spellingTiles(word: word, revealing: 1, typed: String(repeating: "7", count: word.count))
            #expect(right.map(\.kind) == wrong.map(\.kind))
            #expect(right.map(\.kind) == nonsense.map(\.kind))
            #expect(right.allSatisfy { $0.kind == .typed })
        }
    }

    @Test("The grader's real rule: trimmed and case-insensitive, nothing else — shape included")
    func graderRule() {
        #expect(!VocabGames.spellingIsCorrect("wellbeing", "well-being"))
        #expect(VocabGames.spellingIsCorrect("Well-being ", "well-being"))
        #expect(!VocabGames.spellingIsCorrect("dont", "don't"))
    }

    @Test("Whatever the grader accepts, the well shows full: no empty well, no placeholder left")
    func acceptedAnswerFillsTheWell() {
        for (word, typed) in [("brisk", "BRISK"), ("well-being", "Well-being "), ("ad hoc", "ad hoc"), ("don't", "don't")] {
            #expect(VocabGames.spellingIsCorrect(typed, word))
            let tiles = VocabGames.spellingTiles(word: word, revealing: 1, typed: typed)
            #expect(tiles.allSatisfy { $0.kind == .typed }, "\(typed) is accepted for \(word), so its well must be full")
        }
    }
}

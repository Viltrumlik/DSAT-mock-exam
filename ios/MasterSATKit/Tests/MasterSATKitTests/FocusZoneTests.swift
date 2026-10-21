import Foundation
import Testing
@testable import MasterSATKit

@Suite struct SpellingTilesTests {

    /// `[x]` a given letter, a bare letter a typed one, `_` a blank, anything else structure.
    private func show(_ tiles: [VocabGames.SpellingTile]) -> String {
        tiles.map { tile in
            switch tile.kind {
            case .given: return "[\(tile.character)]"
            case .typed, .structure: return tile.character
            case .blank: return "_"
            }
        }.joined()
    }

    @Test("Nothing typed: the given letter among the wells")
    func nothingTyped() {
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "")) == "__[i]__")
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: nil, typed: "")) == "_____")
    }

    @Test("Typed letters fill the word's letters in order; the given letter keeps its place")
    func filling() {
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "br")) == "br[i]__")
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "brisk")) == "br[i]sk")
        #expect(
            show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "brasks")) == "br[i]sk",
            "the given letter is never written over, and letters past the end are not shown"
        )
    }

    @Test("Shape is never typed into: a hyphen or a space stays, the letters line up around it")
    func structure() {
        #expect(show(VocabGames.spellingTiles(word: "well-being", revealing: 0, typed: "wellbeing")) == "[w]ell-being")
        #expect(show(VocabGames.spellingTiles(word: "well-being", revealing: 0, typed: "well-b")) == "[w]ell-b____")
        #expect(show(VocabGames.spellingTiles(word: "well-being", revealing: 0, typed: "w e")) == "[w]e__-_____")
    }

    @Test("Never a verdict: a wrong letter is a typed letter like any other, as typed")
    func noVerdict() {
        let tiles = VocabGames.spellingTiles(word: "brisk", revealing: nil, typed: "Xq")
        #expect(tiles[0] == VocabGames.SpellingTile(kind: .typed, character: "X"))
        #expect(tiles[1] == VocabGames.SpellingTile(kind: .typed, character: "q"))
        #expect(tiles[2] == VocabGames.SpellingTile(kind: .blank, character: ""))
    }
}

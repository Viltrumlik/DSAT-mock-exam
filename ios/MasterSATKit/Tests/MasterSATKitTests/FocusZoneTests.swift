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

/// What VoiceOver says for the marks a spelling answer can hold, against what the grade folds.
///
/// A student who types a curly quote or an en dash is graded as if they had typed the plain one
/// (`foldTypography`), so the well must not read it as silence: VoiceOver skips most bare
/// punctuation, and a mark that is graded but never heard is a mistake nobody can find.
@Suite struct SpellingSpokenTests {

    private func tile(_ kind: VocabGames.SpellingTile.Kind, _ character: String) -> VocabGames.SpellingTile {
        VocabGames.SpellingTile(kind: kind, character: character)
    }

    /// What `spoken` says for one typed character.
    private func said(_ character: String) -> String {
        VocabGames.spoken([tile(.typed, character)])
    }

    /// A character `spoken` has no name for comes back as itself, lowercased.
    private func isNamed(_ character: String) -> Bool {
        let heard = said(character)
        return !heard.isEmpty && heard != character.lowercased()
    }

    @Test("Every character the grade folds is named, and so is the plain form it folds to")
    func everyFoldedMarkIsNamed() {
        // Swept over the whole BMP rather than a hand-written list, so a mark added to the fold
        // and forgotten here fails this test instead of passing it by omission.
        var folded: [String] = []
        for value in UInt32(0x20)...UInt32(0xFFFF) {
            guard let scalar = Unicode.Scalar(value) else { continue }
            let text = String(Character(scalar))
            let plain = VocabGames.foldTypography(text)
            guard plain != text else { continue }
            folded.append(text)
            #expect(isNamed(text), "U+\(String(value, radix: 16, uppercase: true)) is folded to \(plain) but VoiceOver says \(said(text))")
            #expect(isNamed(plain), "\(plain) is what U+\(String(value, radix: 16, uppercase: true)) folds to, and VoiceOver says \(said(plain))")
        }
        #expect(folded.count >= 11, "the sweep found the marks the fold knows about")
    }

    @Test("The shared list is what both sides use: each mark folds to its plain form and is spoken by its name")
    func theListDrivesBothSides() {
        #expect(!VocabGames.spellingMarks.isEmpty)
        for mark in VocabGames.spellingMarks {
            #expect(VocabGames.foldTypography(String(mark.character)) == String(mark.plain), "\(mark.name)")
            #expect(said(String(mark.character)) == mark.name)
            // The plain form is a listed mark too: a folded answer is still heard.
            #expect(VocabGames.spellingMarks.contains { $0.character == mark.plain }, "\(mark.name) folds to an unlisted character")
        }
        // No character is listed twice with two meanings.
        let characters = VocabGames.spellingMarks.map(\.character)
        #expect(Set(characters).count == characters.count)
    }

    @Test("The marks are named the way a person would say them")
    func names() {
        #expect(said(" ") == "space")
        #expect(said("-") == "hyphen")
        #expect(said("\u{2011}") == "hyphen")
        #expect(said("\u{2013}") == "dash")
        #expect(said("\u{2014}") == "dash")
        #expect(said("'") == "apostrophe")
        #expect(said("\u{2019}") == "apostrophe")
        #expect(said("\u{02BC}") == "apostrophe")
        #expect(said("\"") == "quote")
        #expect(said("\u{201C}") == "quote")
        #expect(said("\u{201D}") == "quote")
    }

    @Test("A mark is read the same whether it is the placeholder, the hint or what was typed")
    func kindDoesNotChangeTheName() {
        for mark in VocabGames.spellingMarks {
            let heard = [VocabGames.SpellingTile.Kind.typed, .given, .structure].map {
                VocabGames.spoken([tile($0, String(mark.character))])
            }
            #expect(Set(heard) == [mark.name])
        }
    }

    @Test("Letters are read as they are, an empty position is a blank, and the line is one list")
    func lettersAndBlanks() {
        #expect(VocabGames.spoken([tile(.typed, "B"), tile(.given, "R"), tile(.blank, "")]) == "b, r, blank")
        #expect(VocabGames.spoken([]) == "")

        let tiles = VocabGames.spellingTiles(word: "don't well-being", revealing: 0, typed: "don\u{2019}t w")
        #expect(VocabGames.spoken(tiles).hasPrefix("d, o, n, apostrophe, t, space, w, blank"))
        #expect(VocabGames.spoken(tiles).contains("hyphen"))
    }
}

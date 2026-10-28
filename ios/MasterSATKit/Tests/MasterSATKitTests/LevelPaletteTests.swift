import Foundation
import Testing
@testable import MasterSATKit

@Suite struct LevelPaletteTests {

    @Test("mix() is the design's: a straight blend, rounded as JavaScript rounds")
    func mix() {
        #expect(RGB(0, 0, 0).mix(.white, 0.5) == RGB(128, 128, 128))
        // Halves go up: 1.5 → 2, 2.5 → 3, 3.5 → 4. Banker's rounding would give 2, 2, 4.
        #expect(RGB(1, 2, 3).mix(RGB(2, 3, 4), 0.5) == RGB(2, 3, 4))
        // Mixing down: 7.5 → 8, 22.5 → 23 — towards +∞, not to even.
        #expect(RGB(10, 20, 30).mix(RGB(0, 0, 0), 0.25) == RGB(8, 15, 23))
        #expect(RGB(42, 104, 192).mix(.dark, 0) == RGB(42, 104, 192))
        #expect(RGB(42, 104, 192).mix(.dark, 1) == .dark)
        #expect(RGB.jsRound(-2.5) == -2)
        #expect(RGB.jsRound(2.4999) == 2)
    }

    @Test("Colours read off the design's hex, and channels stay in 0…255")
    func hex() {
        #expect(RGB(hex: 0x2A68C0) == RGB(42, 104, 192))
        #expect(RGB(hex: 0x2A68C0).description == "#2A68C0")
        #expect(RGB(300, -4, 255) == RGB(255, 0, 255))
        #expect(RGB(255, 0, 51).unit == (red: 1, green: 0, blue: 0.2))
    }

    @Test("Seven gradients, as the design's PALETTE lists them")
    func palette() {
        #expect(LevelPalette.allCases.map(\.start.description) == [
            "#0E8F84", "#2A68C0", "#3B4FC4", "#1D3A7A", "#6A4BC4", "#B8457A", "#9A6432",
        ])
        #expect(LevelPalette.allCases.map(\.end.description) == [
            "#2BB3A3", "#4A8BE0", "#5D71E0", "#33579E", "#8C6EE2", "#D8689A", "#C2915F",
        ])
    }

    @Test("A level picks its palette; one the subject has no colour for falls back to its Junior")
    func keys() {
        #expect(LevelPalette(subject: .math, level: "foundation") == .mathFoundation)
        #expect(LevelPalette(subject: .math, level: "Senior") == .mathSenior)
        #expect(LevelPalette(subject: .english, level: "middle") == .englishMiddle)
        #expect(LevelPalette(subject: .english, level: "foundation") == .englishJunior)
        #expect(LevelPalette(subject: .math, level: "") == .mathJunior)
    }

    @Test("Math Junior's theme, unit for unit as the design's T computes it")
    func mathJuniorTheme() {
        let t = LevelPalette.mathJunior.theme
        #expect(t.c1 == RGB(42, 104, 192))
        #expect(t.c2 == RGB(74, 139, 224))
        #expect(t.background == [
            GradientStop(RGB(40, 99, 183), at: 0),
            GradientStop(RGB(33, 80, 149), at: 0.32),
            GradientStop(RGB(22, 51, 97), at: 0.68),
            GradientStop(RGB(13, 29, 58), at: 1),
        ])
        #expect(t.strip == RGB(51, 110, 195))
        #expect(t.topFade == RGB(35, 85, 158))
        #expect(t.bottomFade == RGB(13, 29, 58))
        #expect(t.deep == RGB(33, 80, 149))
        #expect(t.l1 == RGB(137, 180, 235))
        #expect(t.l2 == RGB(192, 214, 244))
        #expect(t.l3 == RGB(237, 243, 252))
        #expect(t.mid == RGB(74, 139, 224))
        #expect(t.base1 == RGB(29, 70, 132))
        #expect(t.base2 == RGB(25, 61, 115))
        #expect(t.base3 == RGB(22, 51, 97))
    }

    @Test("English Senior's theme — a warm palette mixes the same way")
    func englishSeniorTheme() {
        let t = LevelPalette.englishSenior.theme
        #expect(t.background.map(\.color) == [RGB(147, 95, 49), RGB(117, 77, 43), RGB(72, 49, 34), RGB(38, 28, 27)])
        #expect(t.strip == RGB(158, 106, 58))
        #expect(t.topFade == RGB(124, 82, 44))
        #expect(t.l1 == RGB(215, 184, 151))
        #expect(t.l2 == RGB(234, 217, 199))
        #expect(t.l3 == RGB(249, 244, 239))
        #expect([t.base1, t.base2, t.base3] == [RGB(102, 68, 40), RGB(87, 59, 37), RGB(72, 49, 34)])
    }
}

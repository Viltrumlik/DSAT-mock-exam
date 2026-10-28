import Foundation
import Testing
@testable import MasterSATKit

private func outline(_ count: Int) -> [RoadmapLesson] {
    (0..<count).map { RoadmapLesson(lessonNumber: $0 + 1, title: "Lesson \($0 + 1)") }
}

private func own(_ states: [RoadmapLessonState]) -> [RoadmapLesson] {
    states.enumerated().map { RoadmapLesson(lessonNumber: $0.offset + 1, title: "Lesson \($0.offset + 1)", state: $0.element, deliveryId: 900 + $0.offset) }
}

/// Math at Middle: Foundation outlined, Junior unpublished, Middle half done, Senior ahead.
private func mathTrack() -> RoadmapTrack {
    RoadmapTrack(
        subject: "math", subjectLabel: "Math", ownLevel: "middle", ownLevelLabel: "Middle", ownClassroomId: 34,
        levels: [
            RoadmapLevel(level: "foundation", levelLabel: "Foundation", lessons: outline(24)),
            RoadmapLevel(level: "junior", levelLabel: "Junior", journalPublished: false),
            RoadmapLevel(level: "middle", levelLabel: "Middle", isOwnLevel: true, lessons: own([.completed, .completed, .available, .upcoming])),
            RoadmapLevel(level: "senior", levelLabel: "Senior", lessons: outline(24)),
        ]
    )
}

/// English with no own level — a class whose level is not set.
private func englishTrack() -> RoadmapTrack {
    RoadmapTrack(
        subject: "english", subjectLabel: "English",
        levels: [
            RoadmapLevel(level: "junior", levelLabel: "Junior", lessons: outline(36)),
            RoadmapLevel(level: "middle", levelLabel: "Middle", lessons: outline(24)),
            RoadmapLevel(level: "senior", levelLabel: "Senior", lessons: outline(24)),
        ]
    )
}

@Suite struct ClassLevelCardsTests {

    @Test("Below the own level is completed, the own level current, above it locked")
    func states() {
        let cards = ClassLevelCards.cards(for: mathTrack())
        #expect(cards.map(\.state) == [.completed, .completed, .current, .locked])
        #expect(cards.map(\.state.pillText) == ["Completed", "Completed", "Current", "Locked"])
        #expect(cards.map(\.opensClassPage) == [true, true, true, false])
        #expect(cards.map(\.id) == ["math-foundation", "math-junior", "math-middle", "math-senior"])
    }

    @Test("Covered: a completed level whole, the current one by its finished lessons, a locked one none")
    func covered() {
        let cards = ClassLevelCards.cards(for: mathTrack())
        #expect(cards.map(\.covered) == [24, 0, 2, 0])
        #expect(cards.map(\.total) == [24, 0, 4, 24])
        #expect(cards.map(\.percent) == [100, 100, 50, 0])
        // A rung below that was never published is still behind the student: 0 / 0, done.
        #expect(!cards[1].lessonsPublished)
        #expect(cards[1].state == .completed)
    }

    @Test("A locked card names the rung it unlocks after; no other card does")
    func unlocksAfter() {
        #expect(ClassLevelCards.cards(for: mathTrack()).map(\.unlocksAfter) == [nil, nil, nil, "Middle"])
        // The first rung has nothing below it to unlock after.
        #expect(ClassLevelCards.cards(for: englishTrack()).map(\.unlocksAfter) == [nil, "Junior", "Middle"])
    }

    @Test("Each card carries its section score and its palette")
    func scoreAndPalette() {
        let math = ClassLevelCards.cards(for: mathTrack())
        #expect(math.map(\.sectionScore) == [450, 550, 650, 750])
        #expect(math.map(\.palette) == [.mathFoundation, .mathJunior, .mathMiddle, .mathSenior])
        let english = ClassLevelCards.cards(for: englishTrack())
        #expect(english.map(\.sectionScore) == [550, 650, 750])
        #expect(english.map(\.palette) == [.englishJunior, .englishMiddle, .englishSenior])
    }

    @Test("No own level: every card locked, and the pager opens on the first")
    func noOwnLevel() throws {
        let pager = try #require(ClassLevelCards.pagers(for: [englishTrack()]).first)
        #expect(pager.cards.allSatisfy { $0.state == .locked && $0.covered == 0 && $0.percent == 0 })
        #expect(pager.currentIndex == nil)
        #expect(pager.openingIndex == 0)
    }

    @Test("The ladder position wins over the lessons: a finished own level is still current")
    func positionWins() {
        let track = RoadmapTrack(
            subject: "math", subjectLabel: "Math", ownLevel: "junior",
            levels: [
                RoadmapLevel(level: "foundation", levelLabel: "Foundation", lessons: outline(3)),
                RoadmapLevel(level: "junior", levelLabel: "Junior", isOwnLevel: true, lessons: own([.completed, .completed])),
            ]
        )
        let cards = ClassLevelCards.cards(for: track)
        #expect(cards.map(\.state) == [.completed, .current])
        #expect(cards[1].covered == 2)
        #expect(cards[1].percent == 100)
    }

    @Test("Percent rounds as the design does: half up")
    func percent() {
        #expect(ClassLevelCards.percent(28, of: 36) == 78)
        #expect(ClassLevelCards.percent(1, of: 8) == 13)
        #expect(ClassLevelCards.percent(1, of: 3) == 33)
        #expect(ClassLevelCards.percent(0, of: 0) == 0)
        #expect(ClassLevelCards.percent(9, of: 4) == 100)
    }

    @Test("Pagers: Math first, one per known subject, opening on the current card")
    func pagers() {
        let pagers = ClassLevelCards.pagers(for: [
            englishTrack(),
            RoadmapTrack(subject: "physics", subjectLabel: "Physics", levels: [RoadmapLevel(level: "junior", levelLabel: "Junior")]),
            mathTrack(),
            RoadmapTrack(subject: "math", subjectLabel: "Math again", levels: [RoadmapLevel(level: "junior", levelLabel: "Junior")]),
        ])
        #expect(pagers.map(\.subject) == [.math, .english])
        #expect(pagers[0].subjectLabel == "Math")
        #expect(pagers[0].classroomId == 34)
        #expect(pagers[0].currentIndex == 2)
        #expect(pagers[0].openingIndex == 2)
        #expect(ClassLevelCards.pagers(for: []).isEmpty)
        #expect(ClassLevelCards.pagers(for: [RoadmapTrack(subject: "math", subjectLabel: "Math")]).isEmpty)
    }

    @Test("An English class mis-tagged Foundation keeps its rung: Junior's colours, no score")
    func misTagged() {
        let track = RoadmapTrack(
            subject: "english", subjectLabel: "English", ownLevel: "foundation",
            levels: [
                RoadmapLevel(level: "foundation", levelLabel: "Foundation", isOwnLevel: true, lessons: own([.available])),
                RoadmapLevel(level: "junior", levelLabel: "Junior", lessons: outline(36)),
            ]
        )
        let cards = ClassLevelCards.cards(for: track)
        #expect(cards[0].state == .current)
        #expect(cards[0].palette == .englishJunior)
        #expect(cards[0].sectionScore == nil)
        #expect(cards[1].unlocksAfter == "Foundation")
    }
}

@Suite struct ClassPageTargetTests {
    private func room(subject: String?, level: String?) throws -> Classroom {
        var json: [String: Any] = ["id": 7, "name": "Math G12"]
        if let subject { json["subject"] = subject }
        if let level { json["level"] = level }
        return try JSONCoding.decoder.decode(Classroom.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test("A class with a known subject and level opens that class page")
    func known() throws {
        let math = try #require(ClassPageTarget.key(for: room(subject: "MATH", level: "junior")))
        #expect(math.subject == .math)
        #expect(math.level == "junior")
        let english = try #require(ClassPageTarget.key(for: room(subject: "english", level: " Senior ")))
        #expect(english.subject == .english)
        #expect(english.level == "senior")
    }

    @Test("No level, an unknown level or an unknown subject: no class page — the classroom page stays")
    func unknown() throws {
        #expect(ClassPageTarget.key(for: try room(subject: "MATH", level: nil)) == nil)
        #expect(ClassPageTarget.key(for: try room(subject: "MATH", level: "")) == nil)
        #expect(ClassPageTarget.key(for: try room(subject: "MATH", level: "advanced")) == nil)
        #expect(ClassPageTarget.key(for: try room(subject: "PHYSICS", level: "junior")) == nil)
        #expect(ClassPageTarget.key(for: try room(subject: nil, level: "junior")) == nil)
    }
}

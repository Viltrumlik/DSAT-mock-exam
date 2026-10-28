import Foundation
import Testing
@testable import MasterSATKit

private func track(_ subject: String, own: String?) -> RoadmapTrack {
    RoadmapTrack(subject: subject, subjectLabel: subject.capitalized, ownLevel: own)
}

@Suite struct LevelScoreTests {

    @Test("The owner's ladder: Math 450–750 from Foundation, English 550–750 from Junior")
    func ladder() {
        #expect(["foundation", "junior", "middle", "senior"].map { LevelScoreLadder.sectionScore(subject: .math, level: $0) }
            == [450, 550, 650, 750])
        #expect(["junior", "middle", "senior"].map { LevelScoreLadder.sectionScore(subject: .english, level: $0) }
            == [550, 650, 750])
        // English teaches no Foundation: a mis-tagged class is unpriced, not guessed at.
        #expect(LevelScoreLadder.sectionScore(subject: .english, level: "foundation") == nil)
        #expect(LevelScoreLadder.sectionScore(subject: .math, level: "Junior") == 550)
        #expect(LevelScoreLadder.sectionScore(subject: .math, level: "") == nil)
    }

    @Test("Subjects read off the track's key, Math first")
    func subjects() {
        #expect(ClassSubject(trackSubject: "math") == .math)
        #expect(ClassSubject(trackSubject: "English") == .english)
        #expect(ClassSubject(trackSubject: "physics") == nil)
        #expect([ClassSubject.english, .math].sorted() == [.math, .english])
    }

    @Test("Both subjects: the whole SAT on 400–1600, Junior + Junior = 1100, target_score as the ring")
    func bothSubjects() throws {
        let gauge = try #require(SATGauge(
            tracks: [track("math", own: "junior"), track("english", own: "junior")],
            targetScore: 1500, targetMath: 790, targetEnglish: 710
        ))
        #expect(gauge.subject == nil)
        #expect(gauge.title == "SAT SCORE")
        #expect(gauge.score == 1100)
        #expect(gauge.range == 400...1600)
        #expect(gauge.target == 1500)
        #expect(abs(gauge.scoreFraction - 700.0 / 1200.0) < 1e-9)
        #expect(abs((gauge.targetFraction ?? -1) - 1100.0 / 1200.0) < 1e-9)
        // The design's arc: 180 * (1100 - 400) / 1200.
        #expect(abs(gauge.scoreAngle - 105) < 1e-9)

        let top = try #require(SATGauge(levels: [.math: "senior", .english: "senior"], targetScore: nil, targetMath: nil, targetEnglish: nil))
        #expect(top.score == 1500)
        #expect(top.target == nil)
        #expect(top.targetFraction == nil)
    }

    @Test("One subject: that section alone on 200–800, with that section's own target")
    func oneSubject() throws {
        let math = try #require(SATGauge(
            tracks: [track("math", own: "foundation"), track("english", own: nil)],
            targetScore: 1400, targetMath: 700, targetEnglish: 650
        ))
        #expect(math.subject == .math)
        #expect(math.title == "MATH SCORE")
        #expect(math.score == 450)
        #expect(math.range == 200...800)
        #expect(math.target == 700)
        #expect(abs(math.scoreFraction - 250.0 / 600.0) < 1e-9)
        #expect(abs((math.targetFraction ?? -1) - 500.0 / 600.0) < 1e-9)

        let english = try #require(SATGauge(levels: [.english: "middle"], targetScore: 1400, targetMath: 700, targetEnglish: nil))
        #expect(english.title == "ENGLISH SCORE")
        #expect(english.score == 650)
        // No section target: no ring — the whole-SAT target means nothing on a section gauge.
        #expect(english.target == nil)
    }

    @Test("A level the ladder does not price leaves its subject out; with nothing priced there is no gauge")
    func unpriced() throws {
        let gauge = try #require(SATGauge(levels: [.math: "middle", .english: "foundation"], targetScore: 1200, targetMath: 600, targetEnglish: 600))
        #expect(gauge.subject == .math)
        #expect(gauge.score == 650)

        #expect(SATGauge(tracks: [], targetScore: 1500, targetMath: nil, targetEnglish: nil) == nil)
        #expect(SATGauge(tracks: [track("math", own: nil), track("english", own: "")], targetScore: 1500, targetMath: nil, targetEnglish: nil) == nil)
        #expect(SATGauge(tracks: [track("physics", own: "junior")], targetScore: 1500, targetMath: nil, targetEnglish: nil) == nil)
    }

    @Test("Targets are clamped into the range, and 0 or less is no target")
    func targetClamp() throws {
        let high = try #require(SATGauge(levels: [.math: "junior", .english: "junior"], targetScore: 1700, targetMath: nil, targetEnglish: nil))
        #expect(high.target == 1600)
        #expect(high.targetFraction == 1)

        let low = try #require(SATGauge(levels: [.math: "junior"], targetScore: nil, targetMath: 150, targetEnglish: nil))
        #expect(low.target == 200)
        #expect(low.targetFraction == 0)

        let unset = try #require(SATGauge(levels: [.math: "junior"], targetScore: nil, targetMath: 0, targetEnglish: nil))
        #expect(unset.target == nil)
    }

    @Test("The maths clamps: fractions 0…1, angles 0…180, and the marker rides the arc")
    func maths() {
        #expect(SATGauge.fraction(400, in: 400...1600) == 0)
        #expect(SATGauge.fraction(1600, in: 400...1600) == 1)
        #expect(SATGauge.fraction(100, in: 400...1600) == 0)
        #expect(SATGauge.fraction(2000, in: 400...1600) == 1)
        #expect(SATGauge.fraction(5, in: 5...5) == 0)
        #expect(SATGauge.angle(0.25) == 45)
        #expect(SATGauge.angle(-1) == 0)
        #expect(SATGauge.angle(3) == 180)

        let left = SATGauge.point(0, radius: 100)
        #expect(abs(left.x + 100) < 1e-9 && abs(left.y) < 1e-9)
        let top = SATGauge.point(0.5, radius: 100)
        #expect(abs(top.x) < 1e-9 && abs(top.y + 100) < 1e-9)
        let right = SATGauge.point(1, radius: 100)
        #expect(abs(right.x - 100) < 1e-9 && abs(right.y) < 1e-9)
        // The design's ring for "Target 1500": 15° up from the right end, on a 137 pt radius.
        let target = SATGauge.point(SATGauge.fraction(1500, in: 400...1600), radius: 137)
        #expect(abs(target.x - 132.3) < 0.2 && abs(target.y + 35.5) < 0.2)
    }
}

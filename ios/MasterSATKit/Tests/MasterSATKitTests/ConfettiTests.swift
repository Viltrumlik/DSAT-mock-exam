import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ConfettiTests {

    private let start = Date(timeIntervalSince1970: 1_000)

    @Test("The same seed throws the same confetti")
    func deterministic() {
        let a = ConfettiBurst.make(x: 100, y: 200, count: 20, start: start, seed: 42)
        let b = ConfettiBurst.make(x: 100, y: 200, count: 20, start: start, seed: 42)
        #expect(a.particles == b.particles)
        #expect(a.particles.count == 20)
    }

    @Test("Every particle leaves upward")
    func upward() {
        let burst = ConfettiBurst.make(x: 0, y: 0, count: 60, start: start, seed: 7)
        #expect(burst.particles.allSatisfy { $0.vy < 0 })
    }

    @Test("A particle starts at the origin and gravity pulls it down")
    func motion() throws {
        let burst = ConfettiBurst.make(x: 100, y: 300, count: 1, start: start, seed: 1)
        let p = try #require(burst.particles.first)
        let atZero = burst.position(of: p, at: 0)
        #expect(atZero.x == 100)
        #expect(atZero.y == 300)
        // After two seconds the fall has beaten the upward throw.
        #expect(burst.position(of: p, at: 2).y > 300)
    }

    @Test("A different seed throws different confetti")
    func seedsDiffer() throws {
        let a = ConfettiBurst.make(x: 100, y: 200, count: 20, start: start, seed: 42)
        let b = ConfettiBurst.make(x: 100, y: 200, count: 20, start: start, seed: 43)
        #expect(a.particles.count == b.particles.count)
        #expect(a.particles != b.particles)
        let first = try #require(a.particles.first)
        let other = try #require(b.particles.first)
        #expect(first.vx != other.vx || first.vy != other.vy, "even the first piece leaves differently")
    }

    @Test("Pieces differ within one throw, and cycle the palette and the three shapes")
    func variety() {
        let burst = ConfettiBurst.make(x: 0, y: 0, count: 12, start: start, palette: 4, seed: 9)
        #expect(Set(burst.particles.map(\.vx)).count == 12)
        #expect(burst.particles.map(\.colorIndex) == [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3])
        #expect(burst.particles.map(\.shape) == [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2])
    }

    @Test("No pieces, and one piece, are bursts too")
    func smallCounts() throws {
        let none = ConfettiBurst.make(x: 5, y: 6, count: 0, start: start, seed: 3)
        #expect(none.particles.isEmpty)
        #expect(none.originX == 5 && none.originY == 6)
        #expect(none.isFinished(at: start.addingTimeInterval(ConfettiBurst.lifetime)), "and it ends like any other")

        let negative = ConfettiBurst.make(x: 0, y: 0, count: -4, start: start, seed: 3)
        #expect(negative.particles.isEmpty, "a count below zero throws nothing rather than trapping")

        let one = ConfettiBurst.make(x: 0, y: 0, count: 1, start: start, seed: 3)
        let piece = try #require(one.particles.first)
        #expect(one.particles.count == 1)
        #expect(piece.colorIndex == 0)
        #expect(piece.shape == 0)

        let noPalette = ConfettiBurst.make(x: 0, y: 0, count: 3, start: start, palette: 0, seed: 3)
        #expect(noPalette.particles.map(\.colorIndex) == [0, 0, 0], "an empty palette is one colour, not a division by zero")
    }

    @Test("The fall is the t² term: it quadruples when the time doubles, at half the pull")
    func halfGravity() throws {
        #expect(ConfettiBurst.halfGravity == 520, "the t² coefficient is g/2, so the pull is 1,040 pt/s²")
        let burst = ConfettiBurst.make(x: 100, y: 300, count: 1, start: start, seed: 1)
        let p = try #require(burst.particles.first)
        // What is left of the height once the throw (thrown up, slowed by drag) is taken off.
        func fall(at t: TimeInterval) -> Double {
            let travel = (1 - exp(-ConfettiBurst.drag * t)) / ConfettiBurst.drag
            return burst.position(of: p, at: t).y - 300 - p.vy * travel
        }
        #expect(abs(fall(at: 1) - ConfettiBurst.halfGravity) < 1e-9)
        #expect(abs(fall(at: 2) - 4 * ConfettiBurst.halfGravity) < 1e-9)
    }

    @Test("Opaque until 1.5 s, gone at the end of its life")
    func fade() {
        let burst = ConfettiBurst.make(x: 0, y: 0, count: 1, start: start, seed: 1)
        #expect(burst.opacity(at: 1.0) == 1)
        #expect(abs(burst.opacity(at: 1.9) - 0.5) < 0.001)
        #expect(burst.opacity(at: ConfettiBurst.lifetime) == 0)
        #expect(burst.isFinished(at: start.addingTimeInterval(ConfettiBurst.lifetime)))
        #expect(!burst.isFinished(at: start.addingTimeInterval(1)))
    }

    @Test("Reduce Motion throws nothing; Low Power throws half")
    func budget() {
        #expect(MotionBudget(reduceMotion: false, lowPower: false).confetti(44) == 44)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).confetti(44) == 22)
        #expect(MotionBudget(reduceMotion: true, lowPower: false).confetti(44) == 0)
        #expect(!MotionBudget(reduceMotion: true, lowPower: false).allowsFlights)
        #expect(!MotionBudget(reduceMotion: true, lowPower: false).allowsLoopingLottie)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).allowsFlights)
    }

    @Test("A loop plays only with neither Reduce Motion nor Low Power on; Low Power still flies")
    func loopingBudget() {
        #expect(MotionBudget(reduceMotion: false, lowPower: false).allowsLoopingLottie)
        #expect(!MotionBudget(reduceMotion: false, lowPower: true).allowsLoopingLottie, "a loop never ends, so Low Power rests it")
        #expect(!MotionBudget(reduceMotion: true, lowPower: false).allowsLoopingLottie)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).allowsFlights, "a flight is short: Low Power keeps it")
    }

    @Test("Reduce Motion and Low Power together: Reduce Motion is a promise, so nothing is thrown or flown")
    func combinedBudgets() {
        let both = MotionBudget(reduceMotion: true, lowPower: true)
        #expect(both.confetti(44) == 0, "not half of 44 — none")
        #expect(!both.allowsFlights)
        #expect(!both.allowsLoopingLottie)
        #expect(both != MotionBudget(reduceMotion: true, lowPower: false))
    }

    @Test("Counts of 0 and 1 under every setting: nothing from nothing, and one piece is halved to none")
    func smallBudgets() {
        for (reduce, low) in [(false, false), (false, true), (true, false), (true, true)] {
            #expect(MotionBudget(reduceMotion: reduce, lowPower: low).confetti(0) == 0)
        }
        #expect(MotionBudget(reduceMotion: false, lowPower: false).confetti(1) == 1)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).confetti(1) == 0, "half of one piece, rounded down")
        #expect(MotionBudget(reduceMotion: true, lowPower: false).confetti(1) == 0)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).confetti(3) == 1)
    }
}

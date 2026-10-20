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
}

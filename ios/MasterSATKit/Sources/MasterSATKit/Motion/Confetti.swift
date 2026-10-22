import Foundation

/// SplitMix64 — a tiny deterministic generator, so a burst can be replayed in a test.
public struct SeededGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64

    public init(seed: UInt64) { state = seed }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

public struct ConfettiParticle: Sendable, Equatable {
    public let vx: Double
    public let vy: Double
    public let spin: Double
    public let size: Double
    /// Index into the app's palette; the kit knows no colours.
    public let colorIndex: Int
    /// 0 strip, 1 dot, 2 ribbon.
    public let shape: Int
}

/// One throw of confetti: where it started, when, and how each piece moves.
///
/// Physics, not keyframes, so pieces thrown from a small row and from the whole screen
/// behave the same: thrown up and out, slowed by drag, pulled down by gravity, faded at
/// the end of a fixed life.
public struct ConfettiBurst: Sendable, Identifiable {
    public let id: UUID
    public let originX: Double
    public let originY: Double
    public let start: Date
    public let particles: [ConfettiParticle]

    public static let lifetime: TimeInterval = 2.3
    static let fadeStart: TimeInterval = 1.5
    static let drag = 2.4
    /// The t² coefficient of the fall — g/2, not g: a piece that falls for `t` seconds has dropped
    /// `halfGravity · t²`, so the pull itself is twice this, 1,040 pt/s² (`position`).
    static let halfGravity = 520.0

    public static func make(
        x: Double, y: Double, count: Int, power: Double = 1, start: Date = .now,
        palette: Int = 6, seed: UInt64 = .random(in: 0...UInt64.max)
    ) -> ConfettiBurst {
        var rng = SeededGenerator(seed: seed)
        let particles = (0..<max(0, count)).map { index -> ConfettiParticle in
            let angle = Double.random(in: (-Double.pi * 0.97)...(-Double.pi * 0.03), using: &rng)
            let speed = Double.random(in: 380...900, using: &rng) * power
            return ConfettiParticle(
                vx: cos(angle) * speed,
                vy: sin(angle) * speed,
                spin: Double.random(in: -14...14, using: &rng),
                size: Double.random(in: 6...11, using: &rng),
                colorIndex: index % max(1, palette),
                shape: index % 3
            )
        }
        return ConfettiBurst(id: UUID(), originX: x, originY: y, start: start, particles: particles)
    }

    /// Where `particle` is `t` seconds after the throw.
    public func position(of particle: ConfettiParticle, at t: TimeInterval) -> (x: Double, y: Double) {
        let travel = (1 - exp(-Self.drag * t)) / Self.drag
        return (originX + particle.vx * travel,
                originY + particle.vy * travel + Self.halfGravity * t * t)
    }

    /// 1 until `fadeStart`, then down to 0 at `lifetime`.
    public func opacity(at t: TimeInterval) -> Double {
        guard t >= 0 else { return 0 }
        return max(0, min(1, 1 - (t - Self.fadeStart) / (Self.lifetime - Self.fadeStart)))
    }

    public func isFinished(at date: Date) -> Bool {
        // Compare Dates, not `timeIntervalSince(start)`: Date stores seconds since 2001, so
        // `start + lifetime` round-trips a few ten-millionths short of `lifetime`.
        date >= start.addingTimeInterval(Self.lifetime)
    }
}

/// What the student's settings allow the celebrations to do.
///
/// Reduce Motion is a promise: nothing flies, nothing loops, nothing is thrown. Low Power
/// Mode keeps the celebration but halves the work.
public struct MotionBudget: Sendable, Equatable {
    public var reduceMotion: Bool
    public var lowPower: Bool

    public init(reduceMotion: Bool, lowPower: Bool) {
        self.reduceMotion = reduceMotion
        self.lowPower = lowPower
    }

    public func confetti(_ base: Int) -> Int {
        if reduceMotion { return 0 }
        return lowPower ? base / 2 : base
    }

    public var allowsFlights: Bool { !reduceMotion }
    public var allowsLoopingLottie: Bool { !reduceMotion }
}

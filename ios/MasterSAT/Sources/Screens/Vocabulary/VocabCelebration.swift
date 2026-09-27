import SwiftUI
import MasterSATKit

/// The confetti the end-of-round screen fires when a game or a whole set is mastered — the
/// web's `CelebrationLayer`: three popper cannons from the bottom, then a short rain.
///
/// Generated from a fixed seed so a re-render never reshuffles it mid-flight, drawn in one
/// `Canvas` so forty-odd flecks cost one view, and gone entirely under Reduce Motion rather
/// than frozen on screen. It never takes a touch.
struct VocabCelebration: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var finished = false

    private static let pieces = build()
    private static let lifetime: TimeInterval = 4.6

    var body: some View {
        if !reduceMotion && !finished {
            TimelineView(.animation) { timeline in
                let elapsed = timeline.date.timeIntervalSince(start)
                Canvas { context, size in
                    for piece in Self.pieces {
                        piece.draw(in: &context, size: size, elapsed: elapsed)
                    }
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task {
                try? await Task.sleep(for: .seconds(Self.lifetime))
                finished = true
            }
        }
    }

    // MARK: - The flecks

    private struct Piece {
        enum Kind { case popper, confetti }

        let kind: Kind
        /// Start, as fractions of the canvas.
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let colour: Color
        let duration: TimeInterval
        let delay: TimeInterval
        /// Popper only: where the burst carries it, in points.
        let dx: CGFloat
        let dy: CGFloat
        let spin: Double

        func draw(in context: inout GraphicsContext, size: CGSize, elapsed: TimeInterval) {
            let t = (elapsed - delay) / duration
            guard t > 0, t < 1 else { return }
            let p = CGFloat(t)
            var point: CGPoint
            let opacity: Double
            switch kind {
            case .popper:
                // Out fast, then gravity takes it back down.
                let ease = 1 - (1 - p) * (1 - p)
                point = CGPoint(
                    x: x * size.width + dx * ease,
                    y: y * size.height + dy * ease + 260 * p * p
                )
                opacity = t < 0.75 ? 1 : max(0, 1 - (t - 0.75) / 0.25)
            case .confetti:
                point = CGPoint(
                    x: x * size.width + sin(Double(p) * 6 + Double(x) * 10) * 18,
                    y: y * size.height + (size.height + 40) * p
                )
                opacity = t < 0.85 ? 1 : max(0, 1 - (t - 0.85) / 0.15)
            }
            var fleck = context
            fleck.opacity = opacity
            fleck.translateBy(x: point.x, y: point.y)
            fleck.rotate(by: .degrees(spin * Double(p)))
            let rect = CGRect(x: -width / 2, y: -height / 2, width: width, height: height)
            fleck.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(colour))
        }
    }

    private static func build() -> [Piece] {
        var seed: UInt32 = 0x5a7c0de
        func rnd() -> CGFloat {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return CGFloat(seed) / 4_294_967_296
        }
        let colours: [Color] = VocabSectionToneColours.all
        var pieces: [Piece] = []
        let cannons: [(x: CGFloat, y: CGFloat, aim: CGFloat)] = [(0.06, 0.94, 1), (0.94, 0.94, -1), (0.5, 0.98, 0)]
        for cannon in cannons {
            for _ in 0..<12 {
                let spread = 90 + rnd() * 220
                pieces.append(Piece(
                    kind: .popper,
                    x: cannon.x, y: cannon.y,
                    width: 6 + (rnd() * 5).rounded(), height: 6 + (rnd() * 5).rounded(),
                    colour: colours[Int(rnd() * CGFloat(colours.count)) % colours.count],
                    duration: 1.1 + Double(rnd()) * 0.9,
                    delay: Double(rnd()) * 0.22,
                    dx: cannon.aim * spread + (rnd() - 0.5) * 120,
                    dy: -(180 + rnd() * 260),
                    spin: Double((rnd() - 0.5) * 900)
                ))
            }
        }
        for _ in 0..<26 {
            pieces.append(Piece(
                kind: .confetti,
                x: rnd(), y: -0.04,
                width: 5 + (rnd() * 5).rounded(), height: 9 + (rnd() * 8).rounded(),
                colour: colours[Int(rnd() * CGFloat(colours.count)) % colours.count],
                duration: 2.4 + Double(rnd()) * 1.8,
                delay: Double(rnd()) * 1.6,
                dx: 0, dy: 0,
                spin: Double((rnd() - 0.5) * 540)
            ))
        }
        return pieces
    }
}

/// The six section hues, as the flecks' colours — the web draws them from its chart ramp,
/// which is the same six.
private enum VocabSectionToneColours {
    static let all: [Color] = VocabSectionTone.order.map { VocabPalette.section($0).solid }
}

import SwiftUI
import MasterSATKit

/// The SAT SCORE gauge: a 300 × 152 semicircle whose arc fills from the left to the score the
/// student's current levels stand for, with the target as a green ring on the arc.
///
/// Every number is the kit's `SATGauge` — the score, the range (400–1600, or one section's
/// 200–800 for a student with one subject), the title and where the target sits. This draws
/// it the way the design does: a conic gradient up to the score's angle, a pale track after
/// it, cut to a ring 26 pt wide.
struct ClassScoreGaugeView: View {
    let gauge: SATGauge
    /// The intro has run: the score has counted up from the bottom of the range. True from the
    /// start under Reduce Motion.
    let counted: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            ClassGaugeFace(progress: counted ? 1 : 0, gauge: gauge)
                .animation(reduceMotion ? nil : ClassTabMotion.count.delay(0.26), value: counted)
            HStack {
                Text(verbatim: "\(gauge.range.lowerBound)")
                Spacer(minLength: 0)
                Text(verbatim: "\(gauge.range.upperBound)")
            }
            .appFont(11, weight: .bold, monospacedDigits: true)
            .foregroundStyle(ClassTabPalette.gaugeEnds)
            .padding(.horizontal, 4)
            .padding(.top, 4)
        }
        .frame(width: ClassGaugeFace.size)
        // A drawing of a fixed size: its type stops growing where it still fits the arc.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("On a scale of \(gauge.range.lowerBound) to \(gauge.range.upperBound)")
    }

    /// "SAT score 1100, target 1500" — or one section's, "Math score 550, target 700".
    private var accessibilityText: String {
        let title: String
        if gauge.subject == nil {
            title = "SAT score"
        } else {
            let words = gauge.title.lowercased()
            title = words.prefix(1).uppercased() + words.dropFirst()
        }
        var text = "\(title) \(gauge.score)"
        if let target = gauge.target { text += ", target \(target)" }
        return text
    }
}

/// The arc and the figures inside it, drawn for one moment of the count: `progress` 0 is the
/// bottom of the range, 1 the score. Animatable, so the arc and the number move together.
private struct ClassGaugeFace: View, Animatable {
    var progress: Double
    let gauge: SATGauge

    /// The design's box: a 300-pt circle, its top 152 pt showing.
    static let size: CGFloat = 300
    private static let shownHeight: CGFloat = 152
    /// The ring's mask runs `transparent 82%, #000 83%` of the radius.
    private static let innerRatio: CGFloat = 0.825
    /// The target ring sits on the middle of the ring.
    private static let markerRadius: Double = 136.5

    // `nonisolated`: `Animatable` is, and a `View`'s members are main-actor otherwise.
    nonisolated var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    private var shownScore: Int {
        let lower = Double(gauge.range.lowerBound)
        return Int((lower + (Double(gauge.score) - lower) * min(1, max(0, progress))).rounded())
    }

    var body: some View {
        let score = shownScore
        let fraction = SATGauge.fraction(score, in: gauge.range)
        ZStack(alignment: .top) {
            ZStack {
                ClassGaugeBand(from: 0, to: fraction, innerRatio: Self.innerRatio)
                    .fill(AngularGradient(
                        colors: [ClassTabPalette.gaugeFrom, ClassTabPalette.gaugeTo],
                        center: .center,
                        startAngle: .degrees(180),
                        endAngle: .degrees(180 + SATGauge.angle(fraction))
                    ))
                ClassGaugeBand(from: fraction, to: 1, innerRatio: Self.innerRatio)
                    .fill(ClassTabPalette.gaugeTrack)
                if let target = gauge.targetFraction {
                    let point = SATGauge.point(target, radius: Self.markerRadius)
                    targetMarker
                        .position(x: Self.size / 2 + point.x, y: Self.size / 2 + point.y)
                }
            }
            .frame(width: Self.size, height: Self.size)
            .frame(width: Self.size, height: Self.shownHeight, alignment: .top)
            .clipped()

            VStack(spacing: 2) {
                Text(gauge.title)
                    .appFont(10.5, weight: .heavy)
                    .tracking(1.26)
                    .foregroundStyle(ClassTabPalette.gaugeTitle)
                Text(verbatim: "\(score)")
                    .appDisplayFont(46, monospacedDigits: true)
                    .tracking(-1)
                    .foregroundStyle(ClassTabPalette.gaugeScore)
                if let target = gauge.target {
                    HStack(spacing: 4) {
                        Circle()
                            .stroke(ClassTabPalette.targetRing, lineWidth: 2)
                            .frame(width: 10, height: 10)
                        Text(verbatim: "Target \(target)")
                            .appFont(12, weight: .bold)
                            .foregroundStyle(ClassTabPalette.gaugeTarget)
                    }
                }
            }
            .lineLimit(1)
            .padding(.top, 62)
        }
        .frame(width: Self.size, height: Self.shownHeight, alignment: .top)
    }

    /// A 14-pt disc in a 3-pt green ring.
    private var targetMarker: some View {
        Circle()
            .fill(ClassTabPalette.targetFill)
            .frame(width: 14, height: 14)
            .overlay(
                Circle()
                    .stroke(ClassTabPalette.targetRing, lineWidth: 3)
                    .frame(width: 17, height: 17)
            )
    }
}

/// A piece of the gauge's ring between two points along the top half, 0 the left end and 1 the
/// right, with square ends — what the design's mask leaves of its conic gradient.
private struct ClassGaugeBand: Shape {
    var from: Double
    var to: Double
    let innerRatio: CGFloat

    func path(in rect: CGRect) -> Path {
        let start = min(1, max(0, from))
        let end = min(1, max(0, to))
        guard end > start else { return Path() }
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * innerRatio
        // 180° is the left end; on a y-down screen the angle grows clockwise, over the top.
        let a0 = Angle.degrees(180 + 180 * start)
        let a1 = Angle.degrees(180 + 180 * end)
        var path = Path()
        path.addArc(center: center, radius: outer, startAngle: a0, endAngle: a1, clockwise: false)
        path.addArc(center: center, radius: inner, startAngle: a1, endAngle: a0, clockwise: true)
        path.closeSubpath()
        return path
    }
}

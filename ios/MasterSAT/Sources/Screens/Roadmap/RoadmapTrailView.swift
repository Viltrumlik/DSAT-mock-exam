import SwiftUI
import MasterSATKit

/// One open level: a numbered circle per lesson on a winding trail.
///
/// The circles swing centre → right → centre → left down the stage (the web's rhythm), and
/// the trail is a vertical-tangent curve through their centres — it leaves and enters each
/// circle straight up and down, which is what makes the zig-zag read as one road rather than
/// a row of diagonal sticks. The walked part is drawn over it in green, up to the first gap
/// (`RoadmapRules.walkedThrough`).
struct RoadmapStage: View {
    let subject: String
    let level: RoadmapLevel
    let levelLocked: Bool
    let onTapLesson: (Int) -> Void

    /// Vertical distance between two circles.
    static let rowHeight: CGFloat = 96
    /// A circle's diameter; the current lesson is drawn a little larger.
    static let nodeSize: CGFloat = 62
    /// Room above the first circle — more when it carries the "START" bubble.
    static let topInset: CGFloat = 64
    static let topInsetWithBubble: CGFloat = 108
    static let bottomInset: CGFloat = 58
    static let cornerRadius: CGFloat = 22

    var body: some View {
        if level.lessons.isEmpty {
            emptyStage
        } else {
            trail
        }
    }

    // MARK: - The trail

    private var trail: some View {
        let lessons = level.lessons
        let states = lessons.map { RoadmapRules.nodeState(for: $0, levelLocked: levelLocked) }
        let reached = RoadmapRules.walkedThrough(states.map { $0 == .done })
        let top = states.first == .current ? Self.topInsetWithBubble : Self.topInset
        let height = top + CGFloat(max(0, lessons.count - 1)) * Self.rowHeight + Self.bottomInset

        return GeometryReader { geometry in
            let points = Self.points(count: lessons.count, width: geometry.size.width, top: top)
            ZStack(alignment: .topLeading) {
                RoadmapTrailShape(points: points, through: lessons.count - 1)
                    .stroke(Theme.separator, style: StrokeStyle(lineWidth: 14, lineCap: .round, lineJoin: .round))
                if reached > 0 {
                    RoadmapTrailShape(points: points, through: reached)
                        .stroke(Theme.success, style: StrokeStyle(lineWidth: 14, lineCap: .round, lineJoin: .round))
                }
                ForEach(Array(lessons.enumerated()), id: \.offset) { index, lesson in
                    RoadmapNode(lesson: lesson, state: states[index], size: Self.nodeSize) {
                        onTapLesson(index)
                    }
                    .id(RoadmapView.nodeID(subject: subject, level: level.level, index: index))
                    .position(points[index])
                }
            }
        }
        .frame(height: height)
        .overlay {
            if levelLocked { veil(count: lessons.count) }
        }
        .background(stageBackground)
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }

    /// Circle centres for a stage of this width.
    static func points(count: Int, width: CGFloat, top: CGFloat) -> [CGPoint] {
        // The swing narrows on a narrow phone so a circle never leaves the stage.
        let amplitude = min(width * 0.26, 120)
        return (0..<count).map { index in
            CGPoint(
                x: width / 2 + CGFloat(RoadmapRules.wave(at: index)) * amplitude,
                y: top + CGFloat(index) * rowHeight
            )
        }
    }

    private var stageBackground: some View {
        // A pale sky at the top, where the web has its painted one.
        LinearGradient(colors: [Theme.accentSoft, Theme.card.opacity(0)], startPoint: .top, endPoint: .bottom)
            .background(Theme.card)
    }

    /// The lock over a level the student has not reached. It takes every tap, so a padlocked
    /// circle cannot be opened from under it.
    private func veil(count: Int) -> some View {
        let message = "Finish the level before it to open these \(count) lessons."
        return ZStack(alignment: .top) {
            Rectangle().fill(Theme.card.opacity(0.62))
            VStack(spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Theme.textLabel)
                Text("Locked")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                Text(message)
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: 280)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.card))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 6)
            .padding(.top, 24)
            .padding(.horizontal, 16)
            .accessibilityElement(children: .combine)
        }
        .contentShape(Rectangle())
    }

    // MARK: - Nothing on it yet

    private var emptyStage: some View {
        VStack(spacing: 0) {
            VStack(spacing: 22) {
                ghost
                ghost.offset(x: 64)
                ghost.offset(x: -56)
            }
            .opacity(0.7)
            .padding(.bottom, 26)
            .accessibilityHidden(true)

            Text(levelLocked ? "Locked" : "Lessons are being prepared")
                .font(.system(size: 19, weight: .heavy, design: .rounded))
                .multilineTextAlignment(.center)
                .padding(.bottom, 6)
            Text(
                levelLocked
                    ? "Finish the level before it to open this one."
                    : "As soon as the first lesson is ready it appears here as a step on your path."
            )
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 400)
        }
        .padding(.horizontal, 20)
        .padding(.top, 44)
        .padding(.bottom, 56)
        .frame(maxWidth: .infinity)
        .background(stageBackground)
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }

    private var ghost: some View {
        Circle()
            .fill(Theme.card.opacity(0.72))
            .overlay(Circle().strokeBorder(Theme.separator, style: StrokeStyle(lineWidth: 3, dash: [7, 6])))
            .frame(width: 64, height: 64)
    }
}

/// The road through the circles, as far as `through` (an index into `points`).
struct RoadmapTrailShape: Shape {
    let points: [CGPoint]
    let through: Int

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard let first = points.first, through > 0, points.count > 1 else { return path }
        path.move(to: first)
        for index in 1...min(through, points.count - 1) {
            let a = points[index - 1]
            let b = points[index]
            let midY = (a.y + b.y) / 2
            path.addCurve(to: b, control1: CGPoint(x: a.x, y: midY), control2: CGPoint(x: b.x, y: midY))
        }
        return path
    }
}

// MARK: - A circle

/// One lesson on the path.
///
/// Green once finished, brand blue for the one in front of the student (a little larger, with
/// a dashed ring and a "START" bubble), gold and squared-off for a midterm still ahead, pale
/// for a lesson not reached, and a padlock on a locked level.
struct RoadmapNode: View {
    let lesson: RoadmapLesson
    let state: RoadmapNodeState
    let size: CGFloat
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var diameter: CGFloat {
        switch state {
        case .current: return size * 1.12
        case .milestone: return size * 1.06
        default: return size
        }
    }

    private var face: Color {
        switch state {
        case .done: return Theme.success
        case .current: return Theme.accent
        case .milestone: return Theme.amber
        case .upcoming, .locked: return Theme.surface2
        }
    }

    private var isColoured: Bool { state == .done || state == .current || state == .milestone }

    private var accessibilityText: String { "Lesson \(lesson.lessonNumber): \(lesson.title)" }

    private var shape: AnyShape {
        state == .milestone
            ? AnyShape(RoundedRectangle(cornerRadius: diameter * 0.3, style: .continuous))
            : AnyShape(Circle())
    }

    private var stateWords: String {
        switch state {
        case .done: return "Finished"
        case .current: return "Open now"
        case .milestone: return "Big test"
        case .upcoming: return "Coming soon"
        case .locked: return "Locked"
        }
    }

    var body: some View {
        Button(action: onTap) {
            ZStack {
                if state == .current { currentHalo }
                // The card-coloured disc under every circle breaks the road around it.
                shape.fill(Theme.card).frame(width: diameter + 12, height: diameter + 12)
                raisedFace
                label
            }
            .frame(width: diameter + 12, height: diameter + 12)
            .contentShape(Circle())
        }
        .buttonStyle(RoadmapNodePressStyle())
        .disabled(state == .locked)
        .overlay(alignment: .top) {
            if state == .current {
                RoadmapStartBubble()
                    // Its tail sits just clear of the dashed ring.
                    .alignmentGuide(.top) { $0[.bottom] + 12 }
                    .allowsHitTesting(false)
            }
        }
        .accessibilityLabel(accessibilityText)
        .accessibilityValue(stateWords)
    }

    /// The face, raised: a darker copy under it gives the site's pressed-button depth.
    private var raisedFace: some View {
        ZStack {
            shape.fill(Theme.card).offset(y: diameter * 0.08)
            shape.fill(face).brightness(-0.14).offset(y: diameter * 0.08)
            shape.fill(Theme.card)
            shape.fill(face)
            if isColoured {
                shape
                    .fill(LinearGradient(colors: [.white.opacity(0.4), .white.opacity(0)], startPoint: .top, endPoint: .center))
                    .padding(diameter * 0.08)
            }
        }
        .frame(width: diameter, height: diameter)
        .shadow(color: .black.opacity(0.14), radius: 8, x: 0, y: 6)
    }

    @ViewBuilder
    private var label: some View {
        if state == .locked {
            Image(systemName: "lock.fill")
                .font(.system(size: diameter * 0.36, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
        } else {
            Text(ScoreText.string(lesson.lessonNumber))
                .font(.system(size: diameter * (state == .current ? 0.44 : 0.4), weight: .heavy, design: .rounded))
                .foregroundStyle(isColoured ? Color.white : Theme.textSecondary)
                .shadow(color: .black.opacity(isColoured ? 0.13 : 0), radius: 0, x: 0, y: 2)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
    }

    /// The site's pulse (2.2s, out to 1.5× and gone by 70%) and slow-turning dashed ring
    /// (18s a turn), drawn from the clock rather than from a `repeatForever` state change.
    /// A state-driven forever-animation started while the level is expanding also captures
    /// the circle's move into place, and the circle then drifts up and down for good.
    /// Still under Reduce Motion: the ring is drawn, nothing moves.
    private var currentHalo: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
            let phase = t.truncatingRemainder(dividingBy: 2.2) / 2.2
            // ease-out over the first 70%, invisible for the rest
            let grow = phase < 0.7 ? 1 - pow(1 - phase / 0.7, 2) : 1
            ZStack {
                Circle()
                    .fill(Theme.accent.opacity(0.2))
                    .frame(width: diameter + 12, height: diameter + 12)
                    .scaleEffect(1 + 0.5 * grow)
                    .opacity(reduceMotion ? 0 : 0.6 * (1 - grow))
                Circle()
                    .strokeBorder(Theme.accent.opacity(0.42), style: StrokeStyle(lineWidth: 4, dash: [9, 7]))
                    .frame(width: diameter + 26, height: diameter + 26)
                    .rotationEffect(.degrees(t.truncatingRemainder(dividingBy: 18) / 18 * 360))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

}

/// "START", floating over the lesson in front of the student.
struct RoadmapStartBubble: View {
    var body: some View {
        VStack(spacing: 0) {
            Text("START")
                .font(.system(size: 14.5, weight: .heavy, design: .rounded))
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 16)
                .padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.card))
            RoadmapBubbleTail()
                .fill(Theme.card)
                .frame(width: 16, height: 8)
        }
        .compositingGroup()
        .shadow(color: .black.opacity(0.12), radius: 8, x: 0, y: 4)
        .fixedSize()
        .accessibilityHidden(true)
    }
}

/// The little pointer under the bubble.
struct RoadmapBubbleTail: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// A circle presses down, the way the site's raised buttons do.
struct RoadmapNodePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(y: configuration.isPressed ? 4 : 0)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

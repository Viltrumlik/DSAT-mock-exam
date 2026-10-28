import SwiftUI
import MasterSATKit

// One session card and the winding three-step trail inside it — Topic → Classwork → Homework,
// bottom to top — exactly as the owner's "Class Detail v4" lays it out (`PW/PH/COLS/YS`, `curve()`,
// `CARD`, `NODE`). The rules for which step is where come from the kit's `SessionTrail`; this file
// only draws them.

// MARK: - Geometry

/// Where a session's nodes sit. The design's area is 342 × 224 with the nodes at x 78 / 264
/// alternating and y 190 / 112 / 34 — 78 pt apart, 34 from either edge. A session can lack a step
/// (no reading written, no classwork handed out), and a step that is not set is not drawn, so the
/// area holds as many rows as the session has steps and the columns follow the card's width.
enum TrailGeometry {
    static let columnInset: CGFloat = 78
    static let rowStep: CGFloat = 78
    static let edgeInset: CGFloat = 34

    /// 224 for three steps, 146 for two, 68 for one.
    static func height(steps: Int) -> CGFloat {
        steps <= 0 ? 0 : edgeInset * 2 + rowStep * CGFloat(steps - 1)
    }

    /// The node centres, bottom first: left, right, left.
    static func points(steps: Int, width: CGFloat) -> [CGPoint] {
        let height = height(steps: steps)
        return (0..<max(0, steps)).map { index in
            CGPoint(
                x: index % 2 == 0 ? columnInset : width - columnInset,
                y: height - edgeInset - rowStep * CGFloat(index)
            )
        }
    }

    /// The design's `curve()`: from each node to the next, a cubic whose two handles sit level with
    /// the half-way height, one over each node — an S between the columns.
    static func curve(through points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        for (p, q) in zip(points, points.dropFirst()) {
            let mid = (p.y + q.y) / 2
            path.addCurve(to: q, control1: CGPoint(x: p.x, y: mid), control2: CGPoint(x: q.x, y: mid))
        }
        return path
    }

    /// How far up the trail is lit: through the last done step of an unbroken run from the bottom,
    /// and through the now step that ends it. Nil when not even the first is done — the design then
    /// lights nothing.
    static func litIndex(_ steps: [SessionStep]) -> Int? {
        var lit: Int?
        for (index, step) in steps.enumerated() {
            switch step.state {
            case .done: lit = index
            case .now: return index
            default: return lit
            }
        }
        return lit
    }
}

/// The trail's curve through a set of points, as a `Shape` so it can be trimmed as it draws in.
private struct TrailCurve: Shape {
    let points: [CGPoint]

    func path(in rect: CGRect) -> Path { TrailGeometry.curve(through: points) }
}

// MARK: - Session card

/// One session: its number, its state, how much of it is done, what it pays, and its trail.
struct ClassSessionCard: View {
    let session: TrailSession
    let theme: ClassTheme
    /// Nil when the rules did not load: no pill.
    let xpCeiling: Int?
    /// Where the steps' work lives (`ClassPageContent.workClassroomId`).
    let classroomId: Int?
    /// The page's entrance has run: the bar fills and, on the now session, the lit path draws in.
    let entered: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var drawn: [SessionStep] { session.steps.filter(\.exists) }
    private var fraction: Double {
        // A finished session that had nothing to do is finished all the same.
        if session.existingCount == 0 { return session.state == .completed ? 1 : 0 }
        return Double(session.doneCount) / Double(session.existingCount)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            heading
            progress.padding(.top, 10)
            if drawn.isEmpty {
                // Only a session the class has moved on from can have nothing at all: a released one
                // still waiting always shows its homework as "Not set yet" (`SessionTrail`).
                Text("Nothing was handed out in this session.")
                    .appFont(12.5, weight: .semibold)
                    .foregroundStyle(.white.opacity(0.62))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
            } else {
                SessionTrailArea(
                    session: session,
                    steps: drawn,
                    theme: theme,
                    classroomId: classroomId,
                    drawsIn: session.state == .now,
                    entered: entered
                )
                .padding(.top, 6)
            }
        }
        .padding(.top, 16)
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
        .background(cardShape.fill(.white.opacity(cardFill)))
        .overlay(cardShape.strokeBorder(cardRing, lineWidth: 1))
        .background {
            GlassShadow(shape: cardShape, color: ClassPageInk.shade.opacity(shadowOpacity), radius: shadowRadius, y: shadowY)
            // The now card's own halo: `0 0 44px rgba(mid, 0.28)`.
            GlassShadow(shape: cardShape, color: Color(theme.mid, opacity: session.state == .now ? 0.28 : 0), radius: 22)
        }
    }

    private var cardShape: RoundedRectangle { RoundedRectangle(cornerRadius: 24, style: .continuous) }

    // The design's `CARD`: done, now, lock. An open session — released and unfinished, but not the
    // one in front of the student — wears the done card's glass under an In progress badge.
    private var cardFill: Double {
        switch session.state {
        case .now: return 0.12
        case .completed, .open: return 0.07
        case .locked: return 0.05
        }
    }

    private var cardRing: Color {
        switch session.state {
        case .now: return Color(theme.l2, opacity: 0.5)
        case .completed, .open: return .white.opacity(0.14)
        case .locked: return .white.opacity(0.10)
        }
    }

    private var shadowOpacity: Double {
        switch session.state {
        case .now: return 0.35
        case .completed, .open: return 0.22
        case .locked: return 0
        }
    }

    private var shadowRadius: CGFloat { session.state == .now ? 25 : 15 }
    private var shadowY: CGFloat { session.state == .now ? 20 : 12 }

    private var badge: ClassPageBadge {
        switch session.state {
        case .completed: return .completed()
        case .now, .open: return .inProgress(session.state.badgeText)
        case .locked: return .locked()
        }
    }

    private var heading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Session \(session.lesson.lessonNumber)")
                    .appFont(18, weight: .heavy)
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                // The schedule's date for this session — the old Schedule segment, on the trail.
                if let date = session.lesson.scheduledDate {
                    Text(LearnMoreDateText.shortDay(date))
                        .appFont(12, weight: .semibold)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            badge
        }
    }

    private var progress: some View {
        HStack(spacing: 10) {
            Capsule()
                .fill(.white.opacity(0.12))
                .frame(height: 5)
                .overlay(alignment: .leading) {
                    GeometryReader { proxy in
                        Capsule()
                            .fill(LinearGradient(colors: [Color(theme.mid), Color(theme.l2)], startPoint: .leading, endPoint: .trailing))
                            .shadow(color: Color(theme.l1, opacity: 0.7), radius: 4)
                            .frame(width: proxy.size.width * (reduceMotion || entered ? fraction : 0))
                            // `transition: width 1s cubic-bezier(.2,.8,.2,1) 400ms`. None under
                            // Reduce Motion: the bar is simply full to where it stands.
                            .animation(reduceMotion ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: 1).delay(0.4), value: entered)
                    }
                }
                .accessibilityHidden(true)
            if session.existingCount > 0 {
                Text("\(session.doneCount)/\(session.existingCount) done")
                    .appFont(12, weight: .bold, monospacedDigits: true)
                    .foregroundStyle(.white.opacity(0.78))
                    .fixedSize()
                    .accessibilityLabel("\(session.doneCount) of \(session.existingCount) done")
            }
            // No rules, no number: hidden rather than defaulted. A ceiling of 0 says nothing either.
            if let xpCeiling, xpCeiling > 0 {
                SessionXPPill(amount: xpCeiling, dimmed: session.state == .locked)
            }
        }
    }
}

/// "Up to +N XP" (owner's Q2): what attending and the homework pay at most, read off the live
/// rules. The design's bronze coin pill, carrying XP — a bolt on the bronze disc, never a coin. A
/// locked session's is dimmed, as the design dims its pill.
private struct SessionXPPill: View {
    let amount: Int
    let dimmed: Bool

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(ClassPageInk.bronzeDisc)
                .overlay(Circle().strokeBorder(ClassPageInk.bronzeRing, lineWidth: 1.5))
                .frame(width: 18, height: 18)
                .overlay {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 9, weight: .black))
                        .foregroundStyle(ClassPageInk.bronzeInk)
                }
            Text("Up to +\(amount) XP")
                .appFont(12, weight: .heavy, monospacedDigits: true)
                .foregroundStyle(ClassPageInk.bronzeInk)
                .lineLimit(1)
        }
        .padding(.leading, 3)
        .padding(.trailing, 9)
        .frame(minHeight: 24)
        .background(Capsule().fill(ClassPageInk.bronzeGlass.opacity(0.14)))
        .overlay(Capsule().strokeBorder(ClassPageInk.bronzeRing.opacity(0.50), lineWidth: 1))
        .opacity(dimmed ? 0.55 : 1)
        .fixedSize()
        .capDynamicType()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Worth up to \(amount) XP")
    }
}

// MARK: - The trail

/// The trail area: the faint full path, the lit part with its glow, and the nodes with their labels.
private struct SessionTrailArea: View {
    let session: TrailSession
    /// The steps the session has, bottom first — at most three.
    let steps: [SessionStep]
    let theme: ClassTheme
    let classroomId: Int?
    /// The now session's lit path draws in on the page's entrance; every other one is drawn as it is.
    let drawsIn: Bool
    let entered: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var width: CGFloat = 342

    var body: some View {
        let points = TrailGeometry.points(steps: steps.count, width: width)
        let lit = TrailGeometry.litIndex(steps)
        // One tree whatever the setting: Reduce Motion only picks the trim's end and drops the beat.
        let drawn = reduceMotion || !drawsIn || entered
        ZStack(alignment: .topLeading) {
            path(points: points, lit: lit, drawn: drawn)
            ForEach(Array(steps.enumerated()), id: \.element.kind) { index, step in
                SessionStepNode(
                    step: step,
                    session: session,
                    theme: theme,
                    link: ClassPageLinks.link(step.kind, in: session, classroomId: classroomId),
                    leftColumn: index % 2 == 0,
                    center: points[index],
                    areaWidth: width
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .frame(height: TrailGeometry.height(steps: steps.count), alignment: .topLeading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private func path(points: [CGPoint], lit: Int?, drawn: Bool) -> some View {
        let litPoints = lit.map { Array(points.prefix($0 + 1)) } ?? []
        let litCurve = TrailCurve(points: litPoints.count > 1 ? litPoints : [])
        let round = StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round)
        return ZStack {
            // The whole trail, faint: `rgba(255,255,255,0.10)` 12 wide under `0.06` 5 wide.
            TrailCurve(points: points).stroke(.white.opacity(0.10), style: round.width(12))
            TrailCurve(points: points).stroke(.white.opacity(0.06), style: round.width(5))
            // The lit part, three strokes deep: a wide halo, a glow, a bright core.
            Group {
                litCurve.trim(from: 0, to: drawn ? 1 : 0).stroke(Color(theme.mid, opacity: 0.18), style: round.width(22))
                litCurve.trim(from: 0, to: drawn ? 1 : 0).stroke(Color(theme.l1, opacity: 0.38), style: round.width(12))
                litCurve.trim(from: 0, to: drawn ? 1 : 0).stroke(Color(theme.l3, opacity: 0.95), style: round.width(3))
            }
            // `stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1) 500ms`, the now card only.
            .animation(reduceMotion || !drawsIn ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: 1.3).delay(0.5), value: drawn)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private extension StrokeStyle {
    func width(_ value: CGFloat) -> StrokeStyle {
        var copy = self
        copy.lineWidth = value
        return copy
    }
}

// MARK: - A node

/// What a step says beside its node. The design's `PARTS`, in this app's words: the Topic is the
/// roadmap's reading, not a video.
private extension SessionStepKind {
    var icon: String {
        switch self {
        case .topic: return "book.pages.fill"
        case .classwork: return "pencil.and.list.clipboard"
        case .homework: return "house.fill"
        }
    }

    var waitingLine: String {
        switch self {
        case .topic: return "Read before class"
        case .classwork: return "In-class practice"
        case .homework: return "Due before next session"
        }
    }

    var doneLine: String {
        switch self {
        case .topic: return "Read"
        case .classwork: return "Completed"
        case .homework: return "Submitted"
        }
    }

    /// The homework of the latest session, before the teacher sets it (`SessionStepState.notYet`).
    static let notYetLine = "Not set yet"
}

/// One step: its node on the trail and, beside it, its label — or, for the step in front of the
/// student, the white "Resume" popover. Placed by alignment guides so the node's centre lands on its
/// point whichever side the words are on: right of a left-column node, left of a right-column one.
///
/// The words take the design's width (196 for a label, 206 for the popover) when the trail area has
/// it beside the node, and the room there when it has not — a 375-pt phone leaves 200 — so they end
/// at the area's edge and the node stays on its point.
private struct SessionStepNode: View {
    let step: SessionStep
    let session: TrailSession
    let theme: ClassTheme
    let link: AppLink?
    let leftColumn: Bool
    let center: CGPoint
    /// The trail area's width, for the room beside the node.
    let areaWidth: CGFloat

    /// The design's gap between a node and its words.
    private static let gap: CGFloat = 10

    private var isNow: Bool { step.state == .now }
    /// done 44, now 54, to do and locked 40.
    private var size: CGFloat {
        switch step.state {
        case .now: return 54
        case .done: return 44
        default: return 40
        }
    }

    /// The design's `width`, or the room between the node and the area's edge on the words' side.
    private func wordsWidth(_ design: CGFloat) -> CGFloat {
        let room = leftColumn
            ? areaWidth - (center.x + size / 2 + Self.gap)
            : center.x - size / 2 - Self.gap
        return max(0, min(design, room))
    }

    private var meta: String {
        switch step.state {
        case .done: return step.kind.doneLine
        case .notYet: return SessionStepKind.notYetLine
        default: return step.kind.waitingLine
        }
    }

    /// A step that cannot be walked yet reads quieter.
    private var dimmed: Bool { step.state == .locked || step.state == .notYet }

    var body: some View {
        // Taken out first: the guides' closures are Sendable and may not read the view.
        let center = center
        let half = size / 2
        let leftColumn = leftColumn
        Group {
            if let link {
                NavigationLink(value: link) { row }
                    .buttonStyle(PressBounce())
            } else {
                row
            }
        }
        .alignmentGuide(VerticalAlignment.top) { $0[VerticalAlignment.center] - center.y }
        .alignmentGuide(HorizontalAlignment.leading) { d in
            leftColumn ? -(center.x - half) : d.width - (center.x + half)
        }
    }

    /// The disc and its words as one element — inside the link's label, so the link stays the
    /// button VoiceOver activates.
    private var row: some View {
        HStack(alignment: .center, spacing: Self.gap) {
            if leftColumn {
                StepDisc(state: step.state, kind: step.kind, theme: theme)
                words
            } else {
                words
                StepDisc(state: step.state, kind: step.kind, theme: theme)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    @ViewBuilder private var words: some View {
        if isNow {
            ResumePopover(title: step.kind.title, meta: meta, theme: theme, width: wordsWidth(206))
        } else {
            VStack(alignment: leftColumn ? .leading : .trailing, spacing: 1) {
                Text(step.kind.title)
                    .appFont(13.5, weight: .bold)
                    .foregroundStyle(dimmed ? .white.opacity(0.62) : .white)
                Text(meta)
                    .appFont(11.5, weight: .semibold)
                    .foregroundStyle(.white.opacity(0.62))
            }
            .multilineTextAlignment(leftColumn ? .leading : .trailing)
            .lineLimit(2)
            .frame(width: wordsWidth(196), alignment: leftColumn ? .leading : .trailing)
            .capDynamicType()
        }
    }

    private var accessibilityText: String {
        let state: String
        switch step.state {
        case .done: state = "done"
        case .now: state = "up next"
        case .todo: state = "to do"
        case .locked: state = "locked"
        case .notYet: state = "not set yet"
        case .notSet: state = ""
        }
        let what = isNow ? "Resume \(step.kind.title)" : step.kind.title
        return "Session \(session.lesson.lessonNumber), \(what), \(meta), \(state)"
    }
}

/// The node's disc, in the design's four looks (`NODE`), glyphs at the design's sizes: done 22,
/// to do 18, locked 16 (now 26, in `NowDisc`).
private struct StepDisc: View {
    let state: SessionStepState
    let kind: SessionStepKind
    let theme: ClassTheme

    var body: some View {
        switch state {
        case .now:
            NowDisc(kind: kind, theme: theme)
        case .done:
            disc(size: 44, base: theme.base1, tint: Color(theme.l1, opacity: 0.30), ring: Color(theme.l2, opacity: 0.8), ringWidth: 1.5) {
                Image(systemName: "checkmark")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .shadow(color: Color(theme.l2, opacity: 0.9), radius: 4)
            }
            .shadow(color: ClassPageInk.shade.opacity(0.3), radius: 8, y: 6)
            .shadow(color: Color(theme.l1, opacity: 0.3), radius: 7)
        case .locked:
            disc(size: 40, base: theme.base3, tint: .white.opacity(0.06), ring: .white.opacity(0.18), ringWidth: 1) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.5))
            }
        case .notYet:
            // The to-do disc, fainter: the step will come, and is not there to do yet.
            disc(size: 40, base: theme.base2, tint: .white.opacity(0.05), ring: .white.opacity(0.20), ringWidth: 1.5) {
                Image(systemName: kind.icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.45))
            }
        case .todo, .notSet:
            disc(size: 40, base: theme.base2, tint: .white.opacity(0.08), ring: .white.opacity(0.30), ringWidth: 1.5) {
                Image(systemName: kind.icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.75))
            }
        }
    }

    private func disc(
        size: CGFloat, base: RGB, tint: Color, ring: Color, ringWidth: CGFloat,
        @ViewBuilder icon: () -> some View
    ) -> some View {
        Circle()
            .fill(Color(base))
            .overlay(Circle().fill(tint))
            .overlay(Circle().strokeBorder(ring, lineWidth: ringWidth))
            .frame(width: size, height: size)
            .overlay { icon() }
    }
}

/// The step in front of the student: a white disc carrying the step's glyph in the level's colour,
/// a soft ring around it, and a ring that pulses outwards (`msRing`: 1 → 1.7, 0.75 → 0, 2.2 s).
///
/// The pulse is the app's loop idiom (`XPWindowView`): a flag flipped on appearance and a
/// `repeatForever` scoped to the two properties it drives, so nothing else in an update is caught in
/// it, and a closed budget — Reduce Motion, Low Power — hands it no animation and the resting values.
private struct NowDisc: View {
    let kind: SessionStepKind
    let theme: ClassTheme

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var breathes: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }

    var body: some View {
        Circle()
            .fill(.white)
            .frame(width: 54, height: 54)
            // `0 0 0 6px rgba(l2, 0.22)`: a flat ring 6 pt wide around the disc.
            .background(Circle().fill(Color(theme.l2, opacity: 0.22)).frame(width: 66, height: 66))
            .shadow(color: ClassPageInk.shade.opacity(0.45), radius: 13, y: 10)
            .shadow(color: Color(theme.l1, opacity: 0.65), radius: 15)
            .overlay {
                Circle()
                    .strokeBorder(Color(theme.l2, opacity: 0.85), lineWidth: 2)
                    .animation(breathes ? .easeOut(duration: 2.2).repeatForever(autoreverses: false) : nil) {
                        $0.scaleEffect(breathes && pulsing ? 1.7 : 1).opacity(breathes ? (pulsing ? 0 : 0.75) : 1)
                    }
            }
            .overlay {
                Image(systemName: kind.icon)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Color(theme.c1))
            }
            .onAppear { pulsing = breathes }
            .onChange(of: breathes) { _, now in pulsing = now }
    }
}

/// The white card beside the now node: the step, a line about it, and the gradient "Resume" button
/// (`width:206px; border-radius:16px`). The whole row is the link, so the button is drawn, not wired.
/// `width` is 206, or the room the node leaves on a narrower phone (`SessionStepNode`).
private struct ResumePopover: View {
    let title: String
    let meta: String
    let theme: ClassTheme
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .appFont(14, weight: .heavy)
                .tracking(-0.1)
                .foregroundStyle(ClassPageInk.popoverTitle)
            HStack(spacing: 8) {
                Text(meta)
                    .appFont(12, weight: .semibold)
                    .foregroundStyle(ClassPageInk.popoverMeta)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 2) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text("Resume")
                        .appFont(13, weight: .bold)
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(.leading, 8)
                .padding(.trailing, 12)
                .frame(height: 30)
                .background(
                    Capsule().fill(LinearGradient(colors: [Color(theme.c2), Color(theme.c1)], startPoint: .topLeading, endPoint: .bottomTrailing))
                )
                .shadow(color: Color(theme.c1, opacity: 0.45), radius: 8, y: 6)
                .fixedSize()
            }
        }
        .padding(.leading, 12)
        .padding([.trailing, .vertical], 10)
        .frame(width: width, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white))
        .shadow(color: ClassPageInk.shade.opacity(0.20), radius: 3, y: 2)
        .shadow(color: ClassPageInk.shade.opacity(0.45), radius: 18, y: 16)
        .capDynamicType()
    }
}

// MARK: - Between the cards

/// A midterm on the trail: a compact glass card — the word, its state, and the way to the midterm.
/// It is sat in the centre on a laptop, so it has no steps of its own.
struct ClassMidtermCard: View {
    let midterm: TrailMidterm
    let theme: ClassTheme

    var body: some View {
        if let link = ClassPageLinks.link(midterm) {
            NavigationLink(value: link) { card(opens: true) }
                .buttonStyle(PressBounce())
                .accessibilityHint("Opens your midterms")
        } else {
            card(opens: false)
        }
    }

    private func card(opens: Bool) -> some View {
        HStack(spacing: 12) {
            disc.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Midterm")
                    .appFont(16, weight: .heavy)
                    .foregroundStyle(midterm.state == .locked ? .white.opacity(0.62) : .white)
                Text(subtitle)
                    .appFont(12, weight: .semibold)
                    .foregroundStyle(.white.opacity(0.62))
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            badge
            if opens {
                Image(systemName: "chevron.right")
                    .appFont(12, weight: .bold)
                    .foregroundStyle(.white.opacity(0.5))
                    .accessibilityHidden(true)
            }
        }
        .padding(14)
        .background(shape.fill(.white.opacity(midterm.state == .locked ? 0.05 : 0.08)))
        .overlay(shape.strokeBorder(.white.opacity(midterm.state == .locked ? 0.10 : 0.16), lineWidth: 1))
        .background(GlassShadow(shape: shape, color: ClassPageInk.shade.opacity(midterm.state == .locked ? 0 : 0.22), radius: 15, y: 12))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 20, style: .continuous) }

    /// The trail's own discs: a sat midterm wears the done node's lit check, a scheduled one the
    /// cap on the to-do glass, a locked one the lock.
    private var disc: some View {
        let sat = midterm.state == .completed
        let locked = midterm.state == .locked
        return Circle()
            .fill(Color(locked ? theme.base3 : theme.base1))
            .overlay(Circle().fill(sat ? Color(theme.l1, opacity: 0.30) : .white.opacity(0.08)))
            .overlay(Circle().strokeBorder(
                sat ? Color(theme.l2, opacity: 0.8) : .white.opacity(locked ? 0.18 : 0.30),
                lineWidth: 1.5
            ))
            .frame(width: 40, height: 40)
            .overlay {
                Image(systemName: sat ? "checkmark" : (locked ? "lock.fill" : "graduationcap.fill"))
                    .font(.system(size: sat ? 20 : (locked ? 16 : 18), weight: .semibold))
                    .foregroundStyle(.white.opacity(locked ? 0.5 : (sat ? 1 : 0.85)))
                    .shadow(color: Color(theme.l2, opacity: sat ? 0.9 : 0), radius: 4)
            }
            .shadow(color: Color(theme.l1, opacity: sat ? 0.3 : 0), radius: 7)
    }

    /// The paper's own title when it has one, and its date.
    private var subtitle: String {
        var parts: [String] = []
        let title = midterm.lesson.title
        if title != "Midterm \(midterm.lesson.lessonNumber)" { parts.append(title) }
        if let date = midterm.lesson.scheduledDate { parts.append(LearnMoreDateText.shortDay(date)) }
        if parts.isEmpty { parts.append(midterm.state == .locked ? "After the sessions before it" : "Sat in the centre") }
        return parts.joined(separator: " · ")
    }

    private var badge: ClassPageBadge {
        switch midterm.state {
        case .completed: return .completed()
        case .open, .now: return .inProgress("Scheduled", icon: "calendar")
        case .locked: return .locked()
        }
    }
}

/// The 3 × 20 link between two cards, glowing from the bottom of the stack up to the now session
/// (`linkBg`/`linkGlow`).
struct ClassTrailLink: View {
    let lit: Bool
    let theme: ClassTheme

    var body: some View {
        Capsule()
            .fill(lit ? Color(theme.l2, opacity: 0.9) : .white.opacity(0.18))
            .frame(width: 3, height: 20)
            .shadow(color: Color(theme.l1, opacity: lit ? 0.8 : 0), radius: 5)
            .padding(.vertical, 4)
            .accessibilityHidden(true)
    }
}

import SwiftUI
import MasterSATKit

// The pieces of the owner's Leaderboard design (`Rewards Tab.dc.html`, 2026-10-29): the page's
// wash, the blue podium card, the tinted rows, the student's own blue row and the filter sheet.
// `LeaderboardView` puts them together and owns the data.

// MARK: - Palette

enum LeaderboardPalette {
    /// The page, top to bottom: `#E3ECFA` → `#EEF0F8` → `#F7EFE7`.
    static let pageTop = dynamic(light: 0xE3ECFA, dark: 0x0E1528)
    static let pageMiddle = dynamic(light: 0xEEF0F8, dark: 0x111827)
    static let pageBottom = dynamic(light: 0xF7EFE7, dark: 0x1A1714)
    /// The two glows over it: blue at the right, bronze at the left.
    static let blueGlow = dynamic(light: 0x2A68C0, lightAlpha: 0.14, dark: 0x2A68C0, darkAlpha: 0.22)
    static let bronzeGlow = dynamic(light: 0x9A6432, lightAlpha: 0.10, dark: 0x9A6432, darkAlpha: 0.16)

    /// The podium card, the same in either appearance: `#173F86` → `#2A68C0` → `#3A7AD4`.
    static let podiumTop = Color(RGB(hex: 0x173F86))
    static let podiumMiddle = Color(RGB(hex: 0x2A68C0))
    static let podiumBottom = Color(RGB(hex: 0x3A7AD4))
    static let gold = Color(RGB(hex: 0xF2C230))
    static let goldEdge = Color(RGB(hex: 0xD9A514))

    /// The student's own row: `#2A68C0` → `#3A7AD4` at 135°.
    static let mineFrom = Color(RGB(hex: 0x2A68C0))
    static let mineTo = Color(RGB(hex: 0x3A7AD4))

    /// One of the three medals the podium is dressed in.
    struct Medal {
        let ringFrom: Color
        let ringTo: Color
        let badge: Color
        let badgeInk: Color
        let pill: Color
        let pillInk: Color
        let stepEdge: Color
        let shadow: Color
    }

    static let first = Medal(
        ringFrom: Color(RGB(hex: 0xFFE08A)), ringTo: Color(RGB(hex: 0xE2A50E)),
        badge: Color(RGB(hex: 0xF2C230)), badgeInk: Color(RGB(hex: 0x5A3A00)),
        pill: Color(RGB(hex: 0xFFE7A3)), pillInk: Color(RGB(hex: 0x7A4F00)),
        stepEdge: Color(RGB(hex: 0xF2C230)), shadow: Color(RGB(hex: 0x966400))
    )
    static let second = Medal(
        ringFrom: Color(RGB(hex: 0xF1F4F8)), ringTo: Color(RGB(hex: 0xA9B4C6)),
        badge: Color(RGB(hex: 0xC5CEDB)), badgeInk: Color(RGB(hex: 0x2E3A4F)),
        pill: Color(RGB(hex: 0xE5E9F0)), pillInk: Color(RGB(hex: 0x4E5A6B)),
        stepEdge: Color(RGB(hex: 0xC5CEDB)), shadow: Color(RGB(hex: 0x0E2450))
    )
    static let third = Medal(
        ringFrom: Color(RGB(hex: 0xD9AE84)), ringTo: Color(RGB(hex: 0x9A6432)),
        badge: Color(RGB(hex: 0x9A6432)), badgeInk: .white,
        pill: Color(RGB(hex: 0xF7DCC8)), pillInk: Color(RGB(hex: 0x7E431B)),
        stepEdge: Color(RGB(hex: 0xC2915F)), shadow: Color(RGB(hex: 0x5A3214))
    )

    static func medal(_ place: Int) -> Medal {
        switch place {
        case 1: first
        case 2: second
        default: third
        }
    }

    /// The design's eight row tints, `(fill, ink)`, picked by the student's id so a name keeps
    /// its colour from board to board. At night the ink becomes a wash and the pastel the ink.
    private static let tints: [(fill: Int, ink: Int)] = [
        (0xFCE3EC, 0xA8174F), (0xDCF2E3, 0x17703D), (0xEAE4FB, 0x553BAE), (0xFFEFD3, 0x9A5800),
        (0xDAF1F3, 0x16707C), (0xE7EEF9, 0x2A5AA3), (0xFFE4DE, 0xAE3D27), (0xF3E9DF, 0x6B4220),
    ]

    /// `light`: the daytime pair whatever the phone's setting — the podium card is the same blue
    /// in either appearance, and its faces sit in white rings.
    static func tint(forStudent id: Int, light: Bool = false) -> (fill: Color, ink: Color) {
        let tint = tints[abs(id) % tints.count]
        if light { return (Color(RGB(hex: UInt32(tint.fill))), Color(RGB(hex: UInt32(tint.ink)))) }
        return (
            dynamic(light: tint.fill, dark: tint.ink, darkAlpha: 0.38),
            dynamic(light: tint.ink, dark: tint.fill)
        )
    }

    private static func dynamic(
        light: Int, lightAlpha: CGFloat = 1, dark: Int, darkAlpha: CGFloat = 1
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let night = traits.userInterfaceStyle == .dark
            let hex = night ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: night ? darkAlpha : lightAlpha
            )
        })
    }
}

// MARK: - Motion

/// The design's curves, and the delays that stage the board. Every one is only handed the values
/// Reduce Motion picks; none decides whether a view exists.
enum LeaderboardMotion {
    /// `cubic-bezier(.3,1.3,.5,1)` over 0.6 s: a person rising onto the podium, overshooting a
    /// little.
    static func rise(_ delay: Double) -> Animation {
        .timingCurve(0.3, 1.3, 0.5, 1, duration: 0.6).delay(delay)
    }

    /// `cubic-bezier(.3,1.25,.5,1)` over 0.65 s: a step growing up from the floor.
    static func grow(_ delay: Double) -> Animation {
        .timingCurve(0.3, 1.25, 0.5, 1, duration: 0.65).delay(delay)
    }

    /// `cubic-bezier(.2,.8,.2,1)` over 0.45 s: a row sliding up into place.
    static func slide(_ delay: Double) -> Animation {
        .timingCurve(0.2, 0.8, 0.2, 1, duration: 0.45).delay(delay)
    }

    /// The board leaving before a new one comes in: 0.16 s, ease.
    static let leave = Animation.easeOut(duration: 0.16)

    /// How long the old board is gone before the new one starts in.
    static let swapGap: Duration = .milliseconds(170)
}

/// Where the board's entrance stands. The first time the page opens the podium waits for the
/// band (320 ms); a filter change brings the new board in sooner (40 ms).
struct LeaderboardStage: Equatable {
    var visible: Bool
    var swap: Bool

    /// A podium column's delay — third first, the winner last, 90 ms apart.
    func podium(place: Int) -> Double {
        (swap ? 0.04 : 0.32) + Double(3 - min(max(place, 1), 3)) * 0.09
    }

    /// A row's delay, 35 ms apart, the ninth and later together.
    func row(_ index: Int) -> Double {
        (swap ? 0.12 : 0.56) + Double(min(index, 8)) * 0.035
    }

    /// The student's own row.
    var mine: Double { swap ? 0.10 : 0.52 }
}

// MARK: - The page

/// The page's wash with its two glows. Fixed to the screen: the design paints it on the phone,
/// not on the scrolling column.
struct LeaderboardBackground: View {
    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let height = geo.size.height
            ZStack {
                LinearGradient(
                    colors: [LeaderboardPalette.pageTop, LeaderboardPalette.pageMiddle, LeaderboardPalette.pageBottom],
                    startPoint: .top,
                    endPoint: .bottom
                )
                RadialGradient(
                    colors: [LeaderboardPalette.blueGlow, LeaderboardPalette.blueGlow.opacity(0)],
                    center: UnitPoint(x: 1, y: 0.36),
                    startRadius: 0,
                    endRadius: 0.45 * hypot(width, height * 0.64)
                )
                RadialGradient(
                    colors: [LeaderboardPalette.bronzeGlow, LeaderboardPalette.bronzeGlow.opacity(0)],
                    center: UnitPoint(x: 0, y: 0.72),
                    startRadius: 0,
                    endRadius: 0.45 * hypot(width, height * 0.72)
                )
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// A disc with a student's initials in their tint — or their photo — inside a white ring.
struct LeaderboardFace: View {
    let row: LeaderboardRow
    var size: CGFloat = 40
    /// Text in the design's display face (the podium), or the body face (a row).
    var display = false

    var body: some View {
        let tint = LeaderboardPalette.tint(forStudent: row.studentId, light: display)
        ZStack {
            Circle().fill(tint.fill)
            Text(row.initials)
                .font(display && ScaledDisplayFont.isAvailable
                    ? .custom(ScaledDisplayFont.faceName, fixedSize: size * 0.29)
                    : .system(size: size * (display ? 0.29 : 0.33), weight: .heavy))
                .tracking(0.3)
                .foregroundStyle(tint.ink)
            // Signed and expiring: loaded, never stored. A failure leaves the initials showing.
            if let url = row.profileImage {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// The strike board's mark: a white flame on a blue disc with a lighter ring.
struct LeaderboardStrikeDot: View {
    var size: CGFloat = 18

    var body: some View {
        Image(systemName: "flame.fill")
            .font(.system(size: size * 0.6, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(NewLook.blue))
            .overlay(Circle().strokeBorder(NewLook.blueRing, lineWidth: 1.5))
            .accessibilityHidden(true)
    }
}

// MARK: - The podium

/// The top three on the design's deep-blue card: three beams of light, a gold glow over the
/// winner, a few sparkles, and a step under each — tallest in the middle.
struct LeaderboardPodiumCard: View {
    /// In rank order: first, second, third.
    let rows: [LeaderboardRow]
    let metric: LeaderboardMetric
    let stage: LeaderboardStage

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        PodiumColumns {
            column(rows[1], place: 2)
            column(rows[0], place: 1)
            column(rows[2], place: 3)
        }
        .padding(.horizontal, 10)
        .padding(.top, 22)
        .frame(maxWidth: .infinity)
        .background { LeaderboardPodiumStage() }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: LeaderboardPalette.podiumTop.opacity(0.28), radius: 15, y: 12)
        // Rank order for VoiceOver: 1, 2, 3 — not the 2, 1, 3 the eye reads.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rows.map { row in
            "Rank \(row.rank), \(row.displayName)\(row.isMe ? ", you" : ""), \(LeaderboardValueText.spoken(row, metric: metric))"
        }.joined(separator: ". "))
    }

    /// The column's shape — the middle step tallest, one crown — is its place on the podium; its
    /// medal and the number on it are the rank the server gave. Two students tied first stand
    /// on the first and second steps, both in gold, both numbered 1.
    private func column(_ row: LeaderboardRow, place: Int) -> some View {
        LeaderboardPodiumColumn(
            row: row,
            position: place,
            medal: LeaderboardPalette.medal((1...3).contains(row.rank) ? row.rank : place),
            metric: metric,
            visible: stage.visible,
            delay: stage.podium(place: place),
            reduceMotion: reduceMotion
        )
    }
}

/// The design's `1fr 1.18fr 1fr` grid, 8 apart, every column standing on the same floor.
private struct PodiumColumns: Layout {
    private let weights: [CGFloat] = [1, 1.18, 1]
    private let spacing: CGFloat = 8

    private func widths(_ total: CGFloat) -> [CGFloat] {
        let free = max(0, total - spacing * 2)
        let sum = weights.reduce(0, +)
        return weights.map { free * $0 / sum }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 340
        let columns = widths(width)
        let height = zip(subviews, columns).map { $0.sizeThatFits(ProposedViewSize(width: $1, height: nil)).height }.max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        for (subview, width) in zip(subviews, widths(bounds.width)) {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            subview.place(at: CGPoint(x: x, y: bounds.maxY - size.height), proposal: ProposedViewSize(width: width, height: size.height))
            x += width + spacing
        }
    }
}

/// The card's lighting: the gradient, the three beams, the winner's glow, the sparkles.
private struct LeaderboardPodiumStage: View {
    private static let sparkles: [(x: CGFloat, y: CGFloat, size: CGFloat, gold: Bool, opacity: Double)] = [
        (0.08, 14, 10, false, 0.7), (0.88, 30, 12, false, 0.8), (0.30, 70, 8, false, 0.6),
        (0.70, 8, 9, true, 1), (0.16, 110, 7, false, 0.5),
    ]

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let height = geo.size.height
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    stops: [
                        .init(color: LeaderboardPalette.podiumTop, location: 0),
                        .init(color: LeaderboardPalette.podiumMiddle, location: 0.72),
                        .init(color: LeaderboardPalette.podiumBottom, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                beam(Beam(points: [(0.43, 0), (0.57, 0), (1, 1), (0, 1)]), opacity: 0.30, fade: 0.85)
                    .frame(width: 200, height: height)
                    .offset(x: width / 2 - 100)
                beam(Beam(points: [(0.20, 0), (0.32, 0), (1, 1), (0.30, 1)]), opacity: 0.18, fade: 0.80)
                    .frame(width: 150, height: height)
                    .offset(x: -0.04 * width)
                beam(Beam(points: [(0.68, 0), (0.80, 0), (0.70, 1), (0, 1)]), opacity: 0.18, fade: 0.80)
                    .frame(width: 150, height: height)
                    .offset(x: width * 1.04 - 150)
                Ellipse()
                    .fill(RadialGradient(
                        colors: [LeaderboardPalette.gold.opacity(0.30), LeaderboardPalette.gold.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: 85
                    ))
                    .frame(width: 200, height: 170)
                    .offset(x: width / 2 - 100, y: 10)
                ForEach(Array(Self.sparkles.enumerated()), id: \.offset) { _, spark in
                    SparkleShape()
                        .fill(spark.gold ? LeaderboardPalette.gold : Color.white)
                        .opacity(spark.opacity)
                        .frame(width: spark.size, height: spark.size)
                        .offset(x: width * spark.x, y: spark.y)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func beam(_ shape: Beam, opacity: Double, fade: Double) -> some View {
        shape.fill(LinearGradient(
            stops: [.init(color: .white.opacity(opacity), location: 0), .init(color: .white.opacity(0), location: fade)],
            startPoint: .top,
            endPoint: .bottom
        ))
    }
}

/// A beam of light: a polygon in fractions of its frame (the design's `clip-path`).
private struct Beam: Shape {
    let points: [(CGFloat, CGFloat)]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for (index, point) in points.enumerated() {
            let p = CGPoint(x: rect.minX + rect.width * point.0, y: rect.minY + rect.height * point.1)
            if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }
}

/// A four-point star.
struct SparkleShape: Shape {
    func path(in rect: CGRect) -> Path {
        Beam(points: [
            (0.5, 0), (0.61, 0.39), (1, 0.5), (0.61, 0.61),
            (0.5, 1), (0.39, 0.61), (0, 0.5), (0.39, 0.39),
        ]).path(in: rect)
    }
}

/// One place on the podium: the person (crown, ringed face, rank badge, first name, value pill)
/// over their step.
private struct LeaderboardPodiumColumn: View {
    let row: LeaderboardRow
    /// Where it stands: 1 in the middle, 2 on the left, 3 on the right.
    let position: Int
    let medal: LeaderboardPalette.Medal
    let metric: LeaderboardMetric
    let visible: Bool
    let delay: Double
    let reduceMotion: Bool

    private var winner: Bool { position == 1 }
    private var face: CGFloat { winner ? 76 : 62 }
    private var stepHeight: CGFloat { [76, 56, 42][position - 1] }

    var body: some View {
        VStack(spacing: 0) {
            person
                .opacity(visible ? 1 : 0)
                .offset(y: visible ? 0 : 12)
                .animation(reduceMotion ? nil : (visible ? LeaderboardMotion.rise(delay) : LeaderboardMotion.leave), value: visible)
            step
                .padding(.top, 10)
                .scaleEffect(x: 1, y: visible ? 1 : 0.12, anchor: .bottom)
                .animation(reduceMotion ? nil : (visible ? LeaderboardMotion.grow(delay) : LeaderboardMotion.leave), value: visible)
        }
        .frame(maxWidth: .infinity)
    }

    private var person: some View {
        VStack(spacing: 0) {
            if winner {
                LeaderboardCrown()
                    .frame(height: 22)
                    .padding(.bottom, -2)
            }
            ZStack(alignment: .bottom) {
                LeaderboardFace(row: row, size: face - 10, display: true)
                    .padding(2)
                    .background(Circle().fill(.white))
                    .padding(3)
                    .background(Circle().fill(LinearGradient(colors: [medal.ringFrom, medal.ringTo], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    .shadow(color: medal.shadow.opacity(winner ? 0.22 : 0.15), radius: winner ? 10 : 8, y: winner ? 8 : 6)
                Text(String(row.rank))
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(medal.badgeInk)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(medal.badge))
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                    .offset(y: 10)
            }
            .frame(width: face, height: face)
            Text(LeaderboardName.firstName(row.displayName))
                .font(.system(size: winner ? 14.5 : 13.5, weight: winner ? .heavy : .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.top, 16)
            LeaderboardValuePill(row: row, metric: metric, medal: medal)
                .padding(.top, 4)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    /// Glass with a coloured top edge, the numeral inside.
    private var step: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16, style: .continuous)
        return ZStack(alignment: .top) {
            shape.fill(LinearGradient(
                colors: [.white.opacity(winner ? 0.34 : 0.22), .white.opacity(winner ? 0.14 : 0.08)],
                startPoint: .top,
                endPoint: .bottom
            ))
            shape.strokeBorder(.white.opacity(winner ? 0.30 : 0.22), lineWidth: 1)
            Rectangle().fill(medal.stepEdge).frame(height: 3).clipShape(shape)
            Text(String(row.rank))
                .appDisplayFont(winner ? 30 : (position == 2 ? 26 : 24))
                .foregroundStyle(.white)
                .padding(.top, winner ? 10 : (position == 2 ? 8 : 5))
                .capDynamicType()
        }
        .clipShape(shape)
        .frame(maxWidth: .infinity)
        .frame(height: stepHeight)
        .accessibilityHidden(true)
    }
}

/// "712 XP", or a flame and "21", in the medal's pill.
private struct LeaderboardValuePill: View {
    let row: LeaderboardRow
    let metric: LeaderboardMetric
    let medal: LeaderboardPalette.Medal

    var body: some View {
        HStack(spacing: 4) {
            if metric == .strikes { LeaderboardStrikeDot(size: 16) }
            Text(metric == .strikes ? ScoreText.string(row.value(on: metric)) : "\(ScoreText.string(row.xp)) XP")
                .font(.system(size: 12.5, weight: .heavy).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .foregroundStyle(medal.pillInk)
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(Capsule().fill(medal.pill))
    }
}

/// The winner's crown, bobbing 4 pt over 2.8 s. Still under Reduce Motion and in Low Power.
private struct LeaderboardCrown: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bobbing = false

    private var bobs: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 30, size.height / 22)
            context.scaleBy(x: scale, y: scale)
            var crown = Path()
            crown.move(to: CGPoint(x: 3.5, y: 7.5))
            crown.addLine(to: CGPoint(x: 9, y: 12.5))
            crown.addLine(to: CGPoint(x: 15, y: 3.5))
            crown.addLine(to: CGPoint(x: 21, y: 12.5))
            crown.addLine(to: CGPoint(x: 26.5, y: 7.5))
            crown.addLine(to: CGPoint(x: 24.2, y: 18.5))
            crown.addLine(to: CGPoint(x: 5.8, y: 18.5))
            crown.closeSubpath()
            context.fill(crown, with: .color(LeaderboardPalette.gold))
            context.stroke(crown, with: .color(LeaderboardPalette.goldEdge), style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))
            for (x, y, r) in [(3.5, 6.5, 2.0), (15, 2.4, 2.2), (26.5, 6.5, 2.0)] {
                let tip = Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
                context.fill(tip, with: .color(LeaderboardPalette.gold))
                context.stroke(tip, with: .color(LeaderboardPalette.goldEdge), lineWidth: 1.2)
            }
            context.fill(Path(roundedRect: CGRect(x: 5.8, y: 18.2, width: 18.4, height: 2.8), cornerRadius: 1.4), with: .color(LeaderboardPalette.goldEdge))
        }
        .frame(width: 30, height: 22)
        .shadow(color: LeaderboardPalette.first.shadow.opacity(0.25), radius: 1.5, y: 2)
        .animation(bobs ? .easeInOut(duration: 1.4).repeatForever(autoreverses: true) : nil) {
            $0.offset(y: bobbing ? -4 : 0)
        }
        .onAppear { bobbing = bobs }
        .onChange(of: bobs) { _, now in bobbing = now }
        .accessibilityHidden(true)
    }
}

// MARK: - Rows

/// What a row's number says, written and spoken.
enum LeaderboardValueText {
    static func spoken(_ row: LeaderboardRow, metric: LeaderboardMetric) -> String {
        let value = row.value(on: metric)
        return metric == .strikes ? "\(value) \(value == 1 ? "strike" : "strikes")" : "\(value) XP"
    }
}

/// A place from fourth down: rank, face, the full name, the value — on the student's tint
/// fading to white.
struct LeaderboardPlaceRow: View {
    let row: LeaderboardRow
    let metric: LeaderboardMetric

    var body: some View {
        let tint = LeaderboardPalette.tint(forStudent: row.studentId)
        HStack(spacing: 12) {
            Text(String(row.rank))
                .appDisplayFont(22, monospacedDigits: true)
                .foregroundStyle(tint.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(minWidth: 30)
                .capDynamicType()
            LeaderboardFace(row: row, size: 40)
                .padding(2)
                .background(Circle().fill(NewLook.card))
                .shadow(color: Color(RGB(hex: 0x0E2450)).opacity(0.12), radius: 4, y: 3)
            Text(row.displayName)
                .appFont(15, weight: .semibold)
                .foregroundStyle(NewLook.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if metric == .strikes { LeaderboardStrikeDot().alignmentGuide(.firstTextBaseline) { $0[.bottom] - 4 } }
                Text(ScoreText.string(row.value(on: metric)))
                    .appFont(15, weight: .heavy, monospacedDigits: true)
                    .foregroundStyle(NewLook.ink)
                if metric == .xp {
                    Text("XP")
                        .appFont(12, weight: .bold)
                        .foregroundStyle(NewLook.muted)
                }
            }
            .fixedSize()
        }
        .padding(.leading, 12)
        .padding(.trailing, 16)
        .frame(minHeight: 62)
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(LinearGradient(
                    stops: [.init(color: tint.fill, location: 0), .init(color: NewLook.card, location: 0.62)],
                    startPoint: .leading,
                    endPoint: .trailing
                ))
                .newLookShadow(.tile)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rank \(row.rank), \(row.displayName), \(LeaderboardValueText.spoken(row, metric: metric))")
    }
}

/// The student's own row, in blue: "#14", their face, their name over the next place to take,
/// and their number.
struct LeaderboardMyRow: View {
    let row: LeaderboardRow
    let metric: LeaderboardMetric
    let climb: LeaderboardClimb?

    private var line: String? {
        if let climb { return climb.text }
        return row.rank == 1 ? "Top of the board" : nil
    }

    var body: some View {
        HStack(spacing: 12) {
            Text("#\(row.rank)")
                .font(.system(size: 13.5, weight: .heavy).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 8)
                .frame(minWidth: 40, minHeight: 28)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.18)))
                .capDynamicType()
            Text(row.initials)
                .appDisplayFont(13)
                .tracking(0.3)
                .foregroundStyle(LeaderboardPalette.mineFrom)
                .frame(width: 38, height: 38)
                .background(Circle().fill(.white))
                .capDynamicType()
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.displayName)
                    .appFont(15, weight: .bold)
                    .lineLimit(1)
                if let line {
                    HStack(spacing: 4) {
                        Image(systemName: "chart.line.uptrend.xyaxis")
                            .font(.system(size: 11, weight: .bold))
                            .accessibilityHidden(true)
                        Text(line)
                            .appFont(12, weight: .semibold)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(.white.opacity(0.9))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(ScoreText.string(row.value(on: metric)))
                    .appDisplayFont(19, monospacedDigits: true)
                    .tracking(-0.3)
                Text(metric == .xp ? "XP" : "Strikes")
                    .appFont(12, weight: .bold)
                    .foregroundStyle(.white.opacity(0.88))
            }
            .fixedSize()
        }
        .foregroundStyle(.white)
        .padding(.leading, 10)
        .padding(.trailing, 16)
        .frame(minHeight: 64)
        .background {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(LinearGradient(colors: [LeaderboardPalette.mineFrom, LeaderboardPalette.mineTo], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 1))
                .shadow(color: LeaderboardPalette.mineFrom.opacity(0.38), radius: 13, y: 10)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            ["Your rank \(row.rank)", LeaderboardValueText.spoken(row, metric: metric), line].compactMap { $0 }.joined(separator: ", ")
        )
    }
}

// MARK: - Filters

/// The design's filter sheet: Metric, Time and Scope, then Done. A choice applies at once — the
/// board behind the sheet changes while it is open.
struct LeaderboardFilterSheet: View {
    @Binding var query: LeaderboardQuery
    let onDone: () -> Void

    static let windows: [(value: String, title: String)] = [
        (LeaderboardQuery.thisWeek, "This Week"),
        (LeaderboardQuery.thisMonth, "This Month"),
        (LeaderboardQuery.allTime, "All Time"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                NewLookSheetHeader(title: "Filters", onClose: onDone) { EmptyView() }
                    .padding(.top, 16)

                Text("Metric").newLookCaps().padding(.top, 20)
                NewLookSegmented(options: [(LeaderboardMetric.xp, "XP"), (LeaderboardMetric.strikes, "Strikes")], selection: $query.metric)
                    .padding(.top, 8)

                Text("Time").newLookCaps().padding(.top, 20)
                timeChips.padding(.top, 8)
                if query.metric == .strikes {
                    Text("Strikes count the lessons you've attended in a row right now, so they have no time range.")
                        .appFont(12.5, weight: .medium)
                        .foregroundStyle(NewLook.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }

                Text("Scope").newLookCaps().padding(.top, 20)
                NewLookSegmented(options: [(LeaderboardScope.global, "Global"), (LeaderboardScope.group, "My Class")], selection: $query.scope)
                    .padding(.top, 8)

                Button("Done", action: onDone)
                    .buttonStyle(NewLookButtonStyle(kind: .primary, size: .block))
                    .padding(.top, 24)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(NewLook.sheet)
        .presentationBackground(NewLook.sheet)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
    }

    private var timeChips: some View {
        let ranged = query.metric == .xp
        return HStack(spacing: 8) {
            ForEach(Self.windows, id: \.value) { window in
                let on = ranged && query.window == window.value
                Button {
                    query.window = window.value
                } label: {
                    Text(window.title)
                        .appFont(13.5, weight: .bold)
                        .lineLimit(1)
                        .foregroundStyle(on ? Color.white : NewLook.ink2)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 32)
                        .background {
                            Capsule()
                                .fill(on ? NewLook.blue : NewLook.card)
                                .shadow(color: on ? NewLook.blue.opacity(0.28) : Color(RGB(hex: 0x0E2450)).opacity(0.06), radius: on ? 6 : 1, y: on ? 4 : 1)
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(!ranged)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .opacity(ranged ? 1 : 0.45)
    }
}

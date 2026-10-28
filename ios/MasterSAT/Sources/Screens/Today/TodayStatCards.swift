import SwiftUI
import MasterSATKit

/// The four stat cards over Today's band (mockup 10): Coins · XP · Strike · Leaderboard rank.
///
/// They take over from the header's pills on this tab, so they take over their jobs too:
/// - the XP card is where an XP flight lands (`CelebrationCenter.setXPTarget`), and it pulses
///   when one does, exactly as `XPPill` does on the other tabs;
/// - the Strike card is a flame on screen for the celebrations (`flameAppeared`), and it grows
///   and glows when a longer run is shown (`streakGrowth`), as `StrikeChip` does.
/// Taps: Coins and XP open the XP and points window (what the XP pill opens), Strike opens the
/// Strikes window (#317), the rank opens the leaderboard sheet (mockup 13).
struct TodayStatCards: View {
    /// The place on the hero board, and whether that board has been read.
    let rank: Int?
    let rankRead: Bool
    let onRank: () -> Void

    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // XP still in the air is not on the card yet: it rolls up when the flight lands.
        let xp = rewards.xp.map { max(0, $0 - celebrations.heldXP) }
        // While a longer run waits to be shown, the run last seen; it rolls up when the rise plays.
        let run = celebrations.streakShown(rewards.streak)
        StatCardsGrid(spacing: 10, columns: typeSize.isAccessibilitySize ? 1 : 2) {
            TodayStatCard(
                figure: TodayStats.coins(rewards.coins), number: rewards.coins,
                medal: RewardMedallion(kind: .coin, phase: 0),
                hint: "Opens your XP, points and coins"
            ) { router.openHeaderWindow(.xp) }

            TodayStatCard(
                figure: TodayStats.xp(xp), number: xp,
                medal: RewardMedallion(kind: .xp, phase: 1.4),
                hint: "Opens your XP and points"
            ) { router.openHeaderWindow(.xp) }
            .modifier(XPFlightTarget())

            TodayStatCard(
                figure: TodayStats.strike(run), number: run,
                medal: RewardMedallion(kind: .strike, phase: 2.8),
                hint: "Opens your strikes"
            ) { router.openHeaderWindow(.strikes) }
            .modifier(StrikeFlameSpot())

            TodayStatCard(
                figure: TodayStats.rank(rank, read: rankRead), number: rank, prefix: "#",
                medal: RewardMedallion(kind: .rank, phase: 4.2),
                hint: "Opens the leaderboard",
                action: onRank
            )
        }
    }
}

/// One card: the medallion in its tile, the figure (Archivo 21) and its caps caption.
///
/// The figure counts up — ease-out over 1.1 s, the Class tab's count — but only when the number
/// really changes: the first figure a card is given is simply drawn, and under Reduce Motion
/// every change is. The same `Text` is on screen in every case; only the animation is picked.
struct TodayStatCard: View {
    let figure: TodayStatFigure
    let number: Int?
    var prefix: String = ""
    let medal: RewardMedallion
    let hint: String
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// A number has been on the card: from now on a change is a real one, and it counts.
    @State private var hasShownNumber = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                medal
                VStack(alignment: .leading, spacing: 2) {
                    CountingNumber(value: Double(number ?? 0)) { value in
                        Text(number == nil ? figure.value : prefix + String(Int(value.rounded())))
                    }
                    .appDisplayFont(21, monospacedDigits: true)
                    .tracking(-0.4)
                    .foregroundStyle(NewLook.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .animation(hasShownNumber && !reduceMotion ? ClassTabMotion.count : nil, value: number)
                    Text(figure.caption)
                        .newLookCaps()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(NewLook.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .newLookShadow(.card)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressBounce())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(figure.spoken)
        .accessibilityHint(hint)
        .accessibilityAddTraits(.isButton)
        .onAppear { if number != nil, !hasShownNumber { hasShownNumber = true } }
        .onChange(of: number) { _, now in
            if now != nil, !hasShownNumber { hasShownNumber = true }
        }
    }
}

/// Two equal columns, each row as tall as its taller card; one column at the accessibility text
/// sizes. A `Layout`, not an `if`, so the cards keep their state (a rolling count, a flight's
/// target) when the setting changes.
struct StatCardsGrid: Layout {
    var spacing: CGFloat
    /// 2, or 1 at the accessibility text sizes — a property, not a second layout type, so the
    /// cards stay the same views when it changes.
    var columns: Int = 2

    private func rows(_ subviews: Subviews, width: CGFloat, columns: Int) -> [(indices: [Int], height: CGFloat)] {
        let cell = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        return stride(from: 0, to: subviews.count, by: columns).map { start in
            let indices = Array(start..<min(start + columns, subviews.count))
            let height = indices.map { subviews[$0].sizeThatFits(ProposedViewSize(width: cell, height: nil)).height }.max() ?? 0
            return (indices, height)
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 360
        let laid = rows(subviews, width: width, columns: columns)
        let height = laid.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(laid.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let cell = (bounds.width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width, columns: columns) {
            for (offset, index) in row.indices.enumerated() {
                subviews[index].place(
                    at: CGPoint(x: bounds.minX + CGFloat(offset) * (cell + spacing), y: y),
                    proposal: ProposedViewSize(width: cell, height: row.height)
                )
            }
            y += row.height + spacing
        }
    }
}

// MARK: - The jobs the header pills did

private struct CardPulse { var scale = 1.0 }

/// Where an XP flight lands on Today — the XP card. `XPPill`'s reporting, on a card: one target
/// per view (`owner`), reported only while on screen and showing, handed back when it scrolls off
/// the top or the tab goes. It pulses and buzzes when a flight lands on it.
///
/// The pulse's keyframes are only triggered with motion on (`motionPulses`): a
/// `keyframeAnimator` does not hold still under Reduce Motion. The buzz always plays.
struct XPFlightTarget: ViewModifier {
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var owner = UUID()
    @State private var frame = CGRect.zero
    @State private var showing = false
    @State private var pulses = 0
    @State private var motionPulses = 0

    func body(content: Content) -> some View {
        content
            .keyframeAnimator(initialValue: CardPulse(), trigger: motionPulses) { view, pulse in
                view.scaleEffect(pulse.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.06, duration: 0.14, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.5, spring: .bouncy(duration: 0.5, extraBounce: 0.3))
                }
            }
            .sensoryFeedback(.increase, trigger: pulses)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
                frame = $0
                report()
            }
            .onAppear {
                showing = true
                celebrations.pillAppeared()
                report()
            }
            .onDisappear {
                showing = false
                celebrations.clearXPTarget(owner: owner)
            }
            .onChange(of: celebrations.landing) { _, landing in
                guard landing?.owner == owner else { return }
                pulses += 1
                if !reduceMotion { motionPulses += 1 }
            }
    }

    private func report() {
        if showing, frame != .zero, frame.maxY > 0 {
            celebrations.setXPTarget(frame, owner: owner)
        } else {
            celebrations.clearXPTarget(owner: owner)
        }
    }
}

private struct CardGrow {
    var scale = 1.0
    var glow = 0.0
}

/// The Strike card as the flame on screen — `StrikeChip`'s reporting: it tells the celebrations
/// when it is showing and on screen (in pairs), and when a longer run is shown it grows, glows
/// orange (mockup 16) and buzzes. Keyframes only with motion on, as above.
struct StrikeFlameSpot: ViewModifier {
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showing = false
    @State private var onScreen = false
    @State private var counted = false
    @State private var grows = 0
    @State private var motionGrows = 0

    func body(content: Content) -> some View {
        content
            .keyframeAnimator(initialValue: CardGrow(), trigger: motionGrows) { view, grow in
                view
                    .scaleEffect(grow.scale)
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(NewLook.orange, lineWidth: 2.5)
                            .shadow(color: NewLook.orange.opacity(0.5), radius: 8)
                            .opacity(grow.glow)
                            .allowsHitTesting(false)
                    }
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.07, duration: 0.22, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.6, spring: .bouncy(duration: 0.6, extraBounce: 0.3))
                }
                KeyframeTrack(\.glow) {
                    LinearKeyframe(1, duration: 0.2)
                    LinearKeyframe(1, duration: 0.9)
                    LinearKeyframe(0, duration: 0.5)
                }
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: grows)
            .onGeometryChange(for: Bool.self) { proxy in
                let frame = proxy.frame(in: .global)
                return frame != .zero && frame.maxY > 0
            } action: {
                onScreen = $0
                report()
            }
            .onAppear {
                showing = true
                report()
            }
            .onDisappear {
                showing = false
                report()
            }
            .onChange(of: celebrations.streakGrowth) { _, _ in
                guard counted else { return }
                grows += 1
                if !reduceMotion { motionGrows += 1 }
            }
    }

    private func report() {
        let visible = showing && onScreen
        guard visible != counted else { return }
        counted = visible
        if visible { celebrations.flameAppeared() } else { celebrations.flameDisappeared() }
    }
}

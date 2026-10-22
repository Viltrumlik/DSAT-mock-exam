import SwiftUI
import MasterSATKit

/// Every tab's header: a line of context, streak, XP, (bell), avatar — then the title.
struct AppHeader: View {
    let title: String
    var subtitle: String?
    /// The same line, shorter, for a phone that cannot fit `subtitle` beside the pills. The
    /// pills never give way, so the line is what changes shape: wide if it fits, else this.
    var shortSubtitle: String?
    /// What VoiceOver reads for the line, when it is more than the line shows.
    var subtitleLabel: String?
    var showsBell: Bool

    init(
        title: String,
        subtitle: String? = nil,
        shortSubtitle: String? = nil,
        subtitleLabel: String? = nil,
        showsBell: Bool = false
    ) {
        self.title = title
        self.subtitle = subtitle
        self.shortSubtitle = shortSubtitle
        self.subtitleLabel = subtitleLabel
        self.showsBell = showsBell
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let subtitle {
                    if let shortSubtitle {
                        ViewThatFits(in: .horizontal) {
                            line(subtitle)
                            line(shortSubtitle)
                        }
                    } else {
                        line(subtitle)
                    }
                }
                Spacer(minLength: 0)
                // Fixed: when the row is tight it is the line of context that gives way.
                StrikeChip().fixedSize()
                XPPill().fixedSize()
                if showsBell {
                    // RootTabView routes what the inbox opens, the same way it routes a push.
                    NotificationBell(onOpen: { NotificationRouter.shared.open($0) })
                }
                AvatarButton()
            }
            PageTitle(title)
        }
    }

    private func line(_ text: String) -> some View {
        Text(text)
            .appFont(13, weight: .semibold)
            .foregroundStyle(Theme.textSecondary)
            .lineLimit(1)
            .accessibilityLabel(subtitleLabel ?? text)
    }
}

private struct FlameGrow { var scale = 1.0 }

struct StrikeChip: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var showing = false
    /// Not scrolled off the top: the header scrolls with its page, and a flame that grows out of
    /// sight is a celebration nobody saw.
    @State private var onScreen = false
    /// Whether the celebrations have been told this flame is on screen — told once each way.
    @State private var counted = false
    /// This chip's own growth count: only a chip on screen grows and buzzes.
    @State private var grows = 0

    var body: some View {
        // While a longer streak waits to be shown, the number last seen; it rolls up when the
        // rise plays (`CelebrationCenter.streakRose`).
        if let streak = celebrations.streakShown(rewards.streak) {
            HStack(spacing: 2) {
                LottieClip(.strikeFlame)
                    .frame(width: 22, height: 22)
                    .keyframeAnimator(initialValue: FlameGrow(), trigger: grows) { flame, grow in
                        flame.scaleEffect(grow.scale, anchor: .bottom)
                    } keyframes: { _ in
                        KeyframeTrack(\.scale) {
                            SpringKeyframe(1.7, duration: 0.22, spring: .snappy)
                            SpringKeyframe(1.0, duration: 0.6, spring: .bouncy(duration: 0.6, extraBounce: 0.3))
                        }
                    }
                Text(String(streak))
                    .appFont(13, weight: .heavy, design: .rounded)
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak)))
            }
            .padding(.leading, 5)
            .padding(.trailing, 10)
            .padding(.vertical, 3)
            .background(Theme.card, in: Capsule())
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
                if counted { grows += 1 }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(streak == 1 ? "1 lesson in a row" : "\(streak) lessons in a row")
        }
    }

    /// Only a flame that is showing and on screen can play the rise; it tells the celebrations
    /// when that changes, in pairs.
    private func report() {
        let visible = showing && onScreen
        guard visible != counted else { return }
        counted = visible
        if visible { celebrations.flameAppeared() } else { celebrations.flameDisappeared() }
    }
}

private struct PillPulse { var scale = 1.0 }

struct XPPill: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    /// Which pill this is. Every tab has its own header, so there are several; a flight lands on
    /// the one on screen, and only that one pulses and buzzes.
    @State private var owner = UUID()
    @State private var frame = CGRect.zero
    @State private var showing = false
    @State private var pulses = 0

    var body: some View {
        if let xp = rewards.xp {
            // XP still in the air is not on the pill yet: it rolls up when the flight lands.
            let shown = max(0, xp - celebrations.heldXP)
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill").appFont(11, weight: .black)
                Text("\(shown) XP").contentTransition(.numericText(value: Double(shown)))
            }
            .appFont(13, weight: .heavy, design: .rounded)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.card, in: Capsule())
            .keyframeAnimator(initialValue: PillPulse(), trigger: pulses) { content, pulse in
                content.scaleEffect(pulse.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.4, duration: 0.14, spring: .snappy)
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
                if landing?.owner == owner { pulses += 1 }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(shown) XP")
        }
    }

    /// Only a pill that is showing and on screen can catch a flight. Scrolled up off the top,
    /// it hands the job back, and a flight waits until a pill is in view again.
    private func report() {
        if showing, frame != .zero, frame.maxY > 0 {
            celebrations.setXPTarget(frame, owner: owner)
        } else {
            celebrations.clearXPTarget(owner: owner)
        }
    }
}

struct AvatarButton: View {
    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router

    private var initials: String {
        if case .signedIn(let user) = session.phase { return user.initials }
        return ""
    }

    var body: some View {
        Button { router.openMe() } label: {
            Text(initials)
                .appFont(13, weight: .heavy, design: .rounded)
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(Theme.accent, in: Circle())
                // The only way into Me, so it gets the 44-pt minimum target — drawn 34, tappable
                // 44. The negative padding hands the extra 5 pt back to layout, so the header
                // does not shift; hit testing is not clipped to the layout frame.
                .padding(5)
                .contentShape(Rectangle())
                .padding(-5)
        }
        .buttonStyle(PressBounce())
        .accessibilityLabel("Your profile")
    }
}

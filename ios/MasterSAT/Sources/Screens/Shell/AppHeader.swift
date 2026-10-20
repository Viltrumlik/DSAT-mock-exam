import SwiftUI
import MasterSATKit

/// Every tab's header: a line of context, streak, XP, (bell), avatar — then the title.
struct AppHeader: View {
    let title: String
    var subtitle: String?
    var showsBell: Bool

    init(title: String, subtitle: String? = nil, showsBell: Bool = false) {
        self.title = title
        self.subtitle = subtitle
        self.showsBell = showsBell
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                StrikeChip()
                XPPill()
                if showsBell {
                    // RootTabView routes what the inbox opens, the same way it routes a push.
                    NotificationBell(onOpen: { NotificationRouter.shared.open($0) })
                }
                AvatarButton()
            }
            PageTitle(title)
        }
    }
}

struct StrikeChip: View {
    @Environment(RewardsStore.self) private var rewards

    var body: some View {
        if let streak = rewards.streak {
            HStack(spacing: 2) {
                LottieClip(.strikeFlame).frame(width: 22, height: 22)
                Text(String(streak))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak)))
            }
            .padding(.leading, 5)
            .padding(.trailing, 10)
            .padding(.vertical, 3)
            .background(Theme.card, in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(streak == 1 ? "1 lesson in a row" : "\(streak) lessons in a row")
        }
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
                Image(systemName: "bolt.fill").font(.system(size: 11, weight: .black))
                Text("\(shown) XP").contentTransition(.numericText(value: Double(shown)))
            }
            .font(.system(size: 13, weight: .heavy, design: .rounded))
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
                .font(.system(size: 13, weight: .heavy, design: .rounded))
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

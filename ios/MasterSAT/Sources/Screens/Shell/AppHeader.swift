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
            .accessibilityLabel("\(streak) lessons in a row")
        }
    }
}

private struct PillPulse { var scale = 1.0 }

struct XPPill: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations

    var body: some View {
        if let xp = rewards.xp {
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill").font(.system(size: 11, weight: .black))
                Text("\(xp) XP").contentTransition(.numericText(value: Double(xp)))
            }
            .font(.system(size: 13, weight: .heavy, design: .rounded))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.card, in: Capsule())
            .keyframeAnimator(initialValue: PillPulse(), trigger: celebrations.landedCount) { content, pulse in
                content.scaleEffect(pulse.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.4, duration: 0.14, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.5, spring: .bouncy(duration: 0.5, extraBounce: 0.3))
                }
            }
            .sensoryFeedback(.increase, trigger: celebrations.landedCount)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { celebrations.setXPTarget($0) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(xp) XP")
            #if DEBUG
            // Motion check only: a long-press throws a celebration so the kit can be seen
            // before phase 2 wires the real triggers. Compiled out of release builds; phase 2
            // deletes it.
            .onLongPressGesture {
                celebrations.confetti(at: CGPoint(x: 200, y: 420), size: .everything)
                celebrations.flyXP(15, from: CGPoint(x: 200, y: 520))
            }
            #endif
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
        }
        .buttonStyle(PressBounce())
        .accessibilityLabel("Your profile")
    }
}

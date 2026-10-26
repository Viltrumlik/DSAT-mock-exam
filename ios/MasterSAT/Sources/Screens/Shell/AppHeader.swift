import SwiftUI
import MasterSATKit

/// Every tab's header: a line of context, streak, XP, bell, avatar — then the title.
///
/// The bell is on every tab (the owner's call), not only Today: a student who is deep in Words
/// should not have to go home to see that something is waiting. Only the tab on screen polls —
/// a tab left behind gets `onDisappear`, which cancels the bell's `.task` — so five headers are
/// still one poll a minute, the cadence Today had alone.
///
/// Room on the narrowest phone, with nothing cut: the actions are 84 pt (bell 42 + 8 + avatar 34)
/// and the pills stop growing at `xxxLarge`, where the widest honest pair is about 210 pt — 302 pt
/// of the iPhone SE's 343 pt of content. What gives way first is the line of context, which only
/// Today has (`HeaderLayout`), and at the accessibility sizes the header stacks instead.
struct AppHeader: View {
    let title: String
    var subtitle: String?
    /// The same line, shorter, for a phone that cannot fit `subtitle` beside the pills. The
    /// pills never give way, so the line is what changes shape: wide if it fits, else this.
    var shortSubtitle: String?
    /// What VoiceOver reads for the line, when it is more than the line shows.
    var subtitleLabel: String?

    init(
        title: String,
        subtitle: String? = nil,
        shortSubtitle: String? = nil,
        subtitleLabel: String? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.shortSubtitle = shortSubtitle
        self.subtitleLabel = subtitleLabel
    }

    @Environment(\.dynamicTypeSize) private var typeSize

    /// One instance of each part, whatever the arrangement (`HeaderLayout`): the pills and the bell
    /// keep their state — a flight's landing, a rolling count, an open inbox — when a digit or the
    /// text size moves the header between its row and its stacked form. Only the line of context
    /// ever swaps, and it holds nothing.
    ///
    /// The title is laid out last, so VoiceOver read it last too: the header is its own container
    /// and the title sorts first in it, so a tab announces which page it is before its pills.
    /// Both are modifiers on the parts, never a wrapper, so the instances above stay put.
    var body: some View {
        HeaderLayout(stacked: typeSize.isAccessibilitySize) {
            if let subtitle { contextLine(subtitle) }
            // Fixed: when the row is tight it is the line of context that gives way, not these.
            HStack(spacing: 8) {
                StrikeChip().fixedSize()
                XPPill().fixedSize()
            }
            .headerPart(.pills)
            HStack(spacing: 8) {
                // RootTabView routes what the inbox opens, the same way it routes a push.
                NotificationBell(onOpen: { NotificationRouter.shared.open($0) })
                AvatarButton()
            }
            .headerPart(.actions)
            PageTitle(title)
                .accessibilitySortPriority(1)
                .headerPart(.title)
        }
        .accessibilityElement(children: .contain)
    }

    /// The line of context: wide if it fits beside the pills, else the short one, else nothing —
    /// the empty last alternative is how the layout learns there is no room and stacks. At the
    /// accessibility sizes it has a row of its own and wraps instead.
    @ViewBuilder private func contextLine(_ subtitle: String) -> some View {
        if typeSize.isAccessibilitySize {
            line(subtitle, wraps: true).headerPart(.line)
        } else {
            ViewThatFits(in: .horizontal) {
                line(subtitle, wraps: false)
                if let shortSubtitle { line(shortSubtitle, wraps: false) }
                Color.clear.frame(width: 0, height: 0)
            }
            .headerPart(.line)
        }
    }

    private func line(_ text: String, wraps: Bool) -> some View {
        Text(text)
            .appFont(13, weight: .semibold)
            .foregroundStyle(Theme.textSecondary)
            // One line while it shares a row; once it has a row to itself it wraps rather than
            // cut a date or a lesson to "…".
            .lineLimit(wraps ? nil : 1)
            .fixedSize(horizontal: false, vertical: wraps)
            .accessibilityLabel(subtitleLabel ?? text)
    }
}

private struct FlameGrow { var scale = 1.0 }

struct StrikeChip: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router
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
            // The whole chip is the button, and its body is untouched: the flame's on-screen
            // report, its keyframe rise and the large content viewer all have to keep working.
            Button {
                router.openHeaderWindow(.strikes)
            } label: {
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
                // Header chrome: the pills sit beside the avatar on every tab, so they stop growing at
                // `xxxLarge`; the large content viewer shows them bigger while they are pressed.
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
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
                .accessibilityShowsLargeContentViewer {
                    Label(streak == 1 ? "1 lesson in a row" : "\(streak) lessons in a row", systemImage: "flame.fill")
                }
            }
            .buttonStyle(PressBounce())
            .accessibilityHint("Opens your strikes")
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
    @Environment(AppRouter.self) private var router
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
            // As the flame: the body is untouched inside the button — the XP flight lands on
            // the frame this pill measures, so its geometry report must keep working.
            Button {
                router.openHeaderWindow(.xp)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill").appFont(11, weight: .black)
                    Text("\(shown) XP").contentTransition(.numericText(value: Double(shown)))
                }
                .appFont(13, weight: .heavy, design: .rounded)
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.card, in: Capsule())
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
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
                .accessibilityShowsLargeContentViewer { Label("\(shown) XP", systemImage: "bolt.fill") }
            }
            .buttonStyle(PressBounce())
            .accessibilityHint("Opens your XP and points")
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
                // Initials in a fixed 34-pt disc: they stop growing at `xxxLarge` (the disc does not).
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                // The only way into Me, so it gets the 44-pt minimum target — drawn 34, tappable 44.
                .hitTarget(44)
        }
        .buttonStyle(PressBounce())
        .accessibilityLabel("Your profile")
        .accessibilityShowsLargeContentViewer { Label("Your profile", systemImage: "person.crop.circle") }
    }
}

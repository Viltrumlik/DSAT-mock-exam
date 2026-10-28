import SwiftUI
import MasterSATKit

// The Class tab's page furniture, from the owner's "Class Tab" design (`Class Tab.dc.html`):
// the blue band with its floating shield, the lavender → peach page under it, the cover over
// the status bar, the fade behind the tab bar, and the curves everything on the tab moves on.
// The level cards and the gauge are in their own files.

// MARK: - Colours

/// The design's colours. Light mode is the design to the unit; dark mode is the same page at
/// night — the design has no dark version yet, so these keep its hues on a dark ground.
enum ClassTabPalette {
    /// The band, the status bar's cover and the bell badge's ring — `#2A68C0`.
    static let band = dynamic(light: 0x2A68C0, dark: 0x1F4F96)

    /// The page, top to bottom: `#E3ECFA` → `#ECE8FA` → `#F7EFE7`.
    static let pageTop = dynamic(light: 0xE3ECFA, dark: 0x0E1528)
    static let pageMiddle = dynamic(light: 0xECE8FA, dark: 0x15122A)
    static let pageBottom = dynamic(light: 0xF7EFE7, dark: 0x1C1714)
    /// The two glows over it: violet at the left, blue at the right.
    static let violetGlow = dynamic(light: 0x6A4BC4, lightAlpha: 0.14, dark: 0x6A4BC4, darkAlpha: 0.22)
    static let blueGlow = dynamic(light: 0x2A68C0, lightAlpha: 0.16, dark: 0x2A68C0, darkAlpha: 0.24)

    /// A pager's dots: the subject's colour for the level on show, grey for the rest.
    static let dotIdle = dynamic(light: 0xCDD3DE, dark: 0xFFFFFF, darkAlpha: 0.22)
    static func dot(_ subject: ClassSubject) -> Color {
        subject == .math ? Color(RGB(hex: 0x2A68C0)) : Color(RGB(hex: 0x6A4BC4))
    }

    /// The gauge's ink, all of it the design's navy `rgba(14,36,80,…)` at different strengths.
    static let gaugeTitle = dynamic(light: 0x0E2450, lightAlpha: 0.38, dark: 0xFFFFFF, darkAlpha: 0.5)
    static let gaugeScore = dynamic(light: 0x2A68C0, lightAlpha: 0.62, dark: 0x5B8DEF, darkAlpha: 0.95)
    static let gaugeTarget = dynamic(light: 0x0E2450, lightAlpha: 0.45, dark: 0xFFFFFF, darkAlpha: 0.6)
    static let gaugeEnds = dynamic(light: 0x0E2450, lightAlpha: 0.32, dark: 0xFFFFFF, darkAlpha: 0.42)
    /// The arc after the score.
    static let gaugeTrack = dynamic(light: 0x2A68C0, lightAlpha: 0.12, dark: 0x5B8DEF, darkAlpha: 0.2)
    /// The filled arc runs from this blue at the left end to this bronze at the score.
    static let gaugeFrom = Color(.sRGB, red: 42 / 255, green: 104 / 255, blue: 192 / 255, opacity: 0.60)
    static let gaugeTo = Color(.sRGB, red: 154 / 255, green: 100 / 255, blue: 50 / 255, opacity: 0.70)
    /// The target: a green ring, on the arc and beside "Target N".
    static let targetRing = Color(.sRGB, red: 30 / 255, green: 158 / 255, blue: 90 / 255, opacity: 0.75)
    static let targetFill = dynamic(light: 0xF3ECEF, dark: 0x1C1F33)

    private static func dynamic(
        light: Int, lightAlpha: CGFloat = 1, dark: Int, darkAlpha: CGFloat = 1
    ) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(classHex: dark, alpha: darkAlpha)
                : UIColor(classHex: light, alpha: lightAlpha)
        })
    }
}

private extension UIColor {
    convenience init(classHex hex: Int, alpha: CGFloat) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

// MARK: - Motion

/// The design's curves, named once. Every one of them is only ever handed the values Reduce
/// Motion picks — it never decides whether a view exists.
enum ClassTabMotion {
    /// CSS `ease`.
    static func fade(_ seconds: Double) -> Animation {
        .timingCurve(0.25, 0.1, 0.25, 1, duration: seconds)
    }

    /// `cubic-bezier(.2,.8,.2,1)`: the rise, the pager's slide, the bars filling.
    static func glide(_ seconds: Double) -> Animation {
        .timingCurve(0.2, 0.8, 0.2, 1, duration: seconds)
    }

    /// The count-up's ease-out quartic (`1 - (1 - p)^4`) over 1.1 s.
    static let count = Animation.timingCurve(0.25, 1, 0.5, 1, duration: 1.1)

    /// What a fade becomes under Reduce Motion: quick and plain.
    static let calmFade = Animation.easeOut(duration: 0.2)
}

/// A number that counts: an animated change of `value` runs `content` again for every value in
/// between, so the digits roll with the bar or the arc they belong to.
struct CountingNumber<Content: View>: View, Animatable {
    var value: Double
    @ViewBuilder let content: (Double) -> Content

    // `nonisolated`: `Animatable` is, and a `View`'s members are main-actor otherwise.
    nonisolated var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View { content(value) }
}

// MARK: - The page

/// The lavender → peach page with its two glows. Fixed to the screen: the design paints it on
/// the phone, not on the scrolling column.
struct ClassTabBackground: View {
    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let height = geo.size.height
            ZStack {
                LinearGradient(
                    colors: [ClassTabPalette.pageTop, ClassTabPalette.pageMiddle, ClassTabPalette.pageBottom],
                    startPoint: .top,
                    endPoint: .bottom
                )
                // `radial-gradient(circle at x y, colour, transparent 45%)`: a circle sized to
                // the farthest corner, so 45 % of the way to it.
                RadialGradient(
                    colors: [ClassTabPalette.violetGlow, ClassTabPalette.violetGlow.opacity(0)],
                    center: UnitPoint(x: 0, y: 0.48),
                    startRadius: 0,
                    endRadius: 0.45 * hypot(width, height * 0.52)
                )
                RadialGradient(
                    colors: [ClassTabPalette.blueGlow, ClassTabPalette.blueGlow.opacity(0)],
                    center: UnitPoint(x: 1, y: 0.3),
                    startRadius: 0,
                    endRadius: 0.45 * hypot(width, height * 0.7)
                )
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// The page fading out behind the floating tab bar: the bottom 130 pt, clear → 92 % of the
/// page's last colour from 60 % of the way down. It takes no touch.
struct ClassTabBottomFade: View {
    /// The page's last colour: the Class tab's peach, or the new look's grey-blue on Today.
    var color: Color = ClassTabPalette.pageBottom

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            LinearGradient(
                stops: [
                    .init(color: color.opacity(0), location: 0),
                    .init(color: color.opacity(0.92), location: 0.6),
                    .init(color: color.opacity(0.92), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 130)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - The band

/// The blue band: "Class", the bell and the avatar, a big shield floating behind them, and the
/// bottom corners rounded 34. The level cards ride up over its lower edge.
///
/// No streak or XP pills: the design gives this tab none.
struct ClassBandHeader: View {
    /// The tab has appeared: the row has faded and dropped into place.
    let shown: Bool

    var body: some View {
        TabBand(shown: shown) {
            Text("Class")
                .appDisplayFont(32)
                .tracking(-0.8)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
                .accessibilitySortPriority(1)
        }
    }
}

/// A tab root's blue band (the kit's `.band`): what leads the row (the page's title, or Today's
/// wordmark), the bell and the avatar on the right, a big shield floating behind them, and the
/// bottom corners rounded 34. `below` sits under the row inside the band — Today's stories — and
/// what follows the band rides up over its lower edge (`bottomPadding` is the room left for it).
struct TabBand<Leading: View, Below: View>: View {
    /// The tab has appeared: the row has faded and dropped into place.
    let shown: Bool
    var bottomPadding: CGFloat = TabBandMetrics.rowBottom
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let below: () -> Below

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // `SlotStack`: a `below` that has nothing to show is zero points tall, and leaves no gap.
        SlotStack(spacing: 16) {
            HStack(spacing: 10) {
                leading()
                Spacer(minLength: 8)
                // RootTabView routes what the inbox opens, the same way it routes a push.
                NotificationBell(onOpen: { NotificationRouter.shared.open($0) }, look: .glass(band: ClassTabPalette.band))
                BandAvatar()
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 16)
            // The design's entrance: the row fades in and drops 12 pt into place, 60 ms in.
            .animation(reduceMotion ? ClassTabMotion.calmFade : ClassTabMotion.fade(0.6).delay(0.06)) {
                $0.opacity(shown ? 1 : 0)
            }
            .animation(ClassTabMotion.glide(0.8).delay(0.06)) {
                $0.offset(y: reduceMotion || shown ? 0 : -12)
            }
            below()
        }
        .padding(.top, TabBandMetrics.rowTop)
        .padding(.bottom, bottomPadding)
        .frame(maxWidth: .infinity)
        .background { band }
        .accessibilityElement(children: .contain)
    }

    /// Painted a long way up as well: under the status bar, and under a pull that drags the
    /// page down, it is still the band.
    private var band: some View {
        let reach: CGFloat = 1000
        return ZStack(alignment: .topTrailing) {
            ClassTabPalette.band
            ShieldWatermark()
                .offset(x: 58, y: reach - 28)
        }
        .padding(.top, -reach)
        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 34, bottomTrailingRadius: 34, style: .continuous))
    }
}

extension TabBand where Below == EmptyView {
    init(shown: Bool, bottomPadding: CGFloat = TabBandMetrics.rowBottom, @ViewBuilder leading: @escaping () -> Leading) {
        self.init(shown: shown, bottomPadding: bottomPadding, leading: leading, below: { EmptyView() })
    }
}

/// The band's top is the safe area's; the design measures from the phone's top edge, under a
/// 54-pt status bar. So its 72 pt above the row is 18 here, and the shield's 26 is -28.
enum TabBandMetrics {
    static let rowTop: CGFloat = 18
    /// The room under the row the cards overlapping the band's edge ride up into.
    static let rowBottom: CGFloat = 76
}

/// The MasterSAT shield, white at 9 %, 270 pt tall, drifting: up 10 pt and 3° to the left and
/// back over nine seconds. Still under Reduce Motion and in Low Power, as every endless loop
/// in the app is (`MotionBudget.allowsLoopingLottie`).
struct ShieldWatermark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drifting = false

    private var drifts: Bool {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            .allowsLoopingLottie
    }

    var body: some View {
        Image("BrandMark")
            .resizable()
            .renderingMode(.template)
            .aspectRatio(contentMode: .fit)
            .frame(height: 270)
            .foregroundStyle(.white)
            .opacity(0.09)
            // Scoped to the drift alone, as `LoadingSkeleton` scopes its pulse: a repeating
            // animation applied to the whole update would repeat whatever else changed in it.
            .animation(drifts ? .easeInOut(duration: 4.5).repeatForever(autoreverses: true) : nil) {
                $0.offset(y: drifting ? -10 : 0).rotationEffect(.degrees(drifting ? -3 : 0))
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { drifting = drifts }
            .onChange(of: drifts) { _, now in drifting = now }
    }
}

/// The avatar on the band: a white 42-pt disc with the initials in the band's blue. Opens Me,
/// the same way every other header's avatar does.
struct BandAvatar: View {
    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router

    private var initials: String {
        if case .signedIn(let user) = session.phase { return user.initials }
        return ""
    }

    var body: some View {
        Button { router.openMe() } label: {
            Text(initials)
                .appFont(15, weight: .heavy, design: .rounded)
                .tracking(0.3)
                .foregroundStyle(Color(RGB(hex: 0x2A68C0)))
                .frame(width: 42, height: 42)
                .background(.white, in: Circle())
                // Initials in a fixed disc: they stop growing at `xxxLarge` (the disc does not).
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .hitTarget(44)
        }
        .buttonStyle(PressBounce())
        .accessibilityLabel("Your profile")
        .accessibilityShowsLargeContentViewer { Label("Your profile", systemImage: "person.crop.circle") }
    }
}

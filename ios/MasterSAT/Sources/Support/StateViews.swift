import SwiftUI
import MasterSATKit

// The three things a page or a section shows besides its content: nothing in it, a request that
// did not land, and the wait. One vocabulary, so a student learns each look once. The screens'
// own state components (`RetryNotice`, `VocabEmptyState`, `LearnMoreSkeleton`, …) keep their
// names and render through these.

/// A state's picture (mockups 91–92, the kit's `.art`): a 96-pt tinted tile, r30, with a 56-pt
/// medal in its middle — the state's glyph, white, inside a lighter ring — and three small dots.
/// Green and a tick for all caught up, blue for an empty list, amber for a failure, slate for
/// offline. Never red: nothing a student did is wrong.
///
/// It settles once: the medal springs up from 70 % when it first appears; under Reduce Motion it
/// is simply there (the same views — only the scale's start differs). Decorative: the words beside
/// it say everything, so VoiceOver skips it. At most one per screen — page-level states carry it,
/// section-level ones do not.
///
/// It keeps the `LottieAsset` names the screens already pass: they name the state, and the new
/// look draws each as its medal.
struct StateArt: View {
    let asset: LottieAsset
    var size: CGFloat = 96

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settled = false

    init(_ asset: LottieAsset, size: CGFloat = 96) {
        self.asset = asset
        self.size = size
    }

    var body: some View {
        let look = StateMedal.look(for: asset)
        RoundedRectangle(cornerRadius: size * 0.31, style: .continuous)
            .fill(look.tile)
            .frame(width: size, height: size)
            .overlay(alignment: .topTrailing) { dot(look, 8).padding(.top, size * 0.104).padding(.trailing, size * 0.125) }
            .overlay(alignment: .bottomLeading) { dot(look, 6).padding(.bottom, size * 0.146).padding(.leading, size * 0.104) }
            .overlay(alignment: .topLeading) { dot(look, 5).padding(.top, size * 0.23).padding(.leading, size * 0.167) }
            .overlay {
                StateMedal(look: look, diameter: size * 0.58)
                    .scaleEffect(settled || reduceMotion ? 1 : 0.7)
            }
            .accessibilityHidden(true)
            .onAppear {
                guard !settled else { return }
                if reduceMotion { settled = true } else { withAnimation(Motion.pop.delay(0.05)) { settled = true } }
            }
    }

    private func dot(_ look: StateMedal.Look, _ side: CGFloat) -> some View {
        Circle().fill(look.dots).frame(width: side * size / 96, height: side * size / 96)
    }
}

/// The medal at the heart of a state's picture and of a front-door screen's tile: a filled disc,
/// a 3-pt lighter ring inside its edge, a soft shadow in its own hue, and one white glyph.
struct StateMedal: View {
    struct Look {
        let glyph: String
        let fill: Color
        let ring: Color
        let tile: Color
        let dots: Color
    }

    let look: Look
    var diameter: CGFloat = 56

    var body: some View {
        Circle()
            .fill(look.fill)
            .overlay(Circle().strokeBorder(look.ring, lineWidth: 3))
            .shadow(color: look.fill.opacity(0.32), radius: 5, y: 4)
            .frame(width: diameter, height: diameter)
            .overlay {
                Image(systemName: look.glyph)
                    .font(.system(size: diameter * 0.48, weight: .bold))
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)
    }

    static let slate = Color(RGB(hex: 0x6B7891))
    static let slateRing = Color(RGB(hex: 0x97A3B9))

    static func blue(_ glyph: String) -> Look {
        Look(glyph: glyph, fill: NewLook.blue, ring: NewLook.blueRing, tile: NewLook.blue50, dots: NewLook.blueRing.opacity(0.55))
    }

    static func green(_ glyph: String) -> Look {
        Look(glyph: glyph, fill: NewLook.green, ring: Color(RGB(hex: 0x5CC58C)), tile: NewLook.green50, dots: Color(RGB(hex: 0x8ED6AE)))
    }

    static func amber(_ glyph: String) -> Look {
        Look(glyph: glyph, fill: NewLook.orange, ring: NewLook.orangeRing, tile: NewLook.orange50, dots: NewLook.ink.opacity(0.12))
    }

    static func slate(_ glyph: String) -> Look {
        Look(glyph: glyph, fill: slate, ring: slateRing, tile: NewLook.skeleton, dots: NewLook.ink.opacity(0.12))
    }

    /// The kit's picture for each state the screens name.
    static func look(for asset: LottieAsset) -> Look {
        switch asset {
        case .allDone, .taskComplete: green("checkmark")
        case .noTasks: blue("tray.fill")
        case .noWords: blue("book.closed.fill")
        case .error: amber("exclamationmark.arrow.triangle.2.circlepath")
        case .offline: slate("wifi.slash")
        case .strikeFlame: amber("flame.fill")
        case .trophy, .starBurst: blue("trophy.fill")
        case .coinBurst: blue("star.fill")
        }
    }
}

/// A list that loaded with nothing in it, said plainly, with the way forward when there is one.
///
/// Never a failure's face, so it never offers a retry: nothing went wrong, and "Try again" on an
/// honest empty answer teaches a student that the app is unsure of itself.
struct EmptyState<Accessory: View>: View {
    let art: LottieAsset?
    let title: String
    let message: String?
    let action: (title: String, run: @MainActor () -> Void)?
    /// A way forward that is not a plain button — a link that pushes a page. Only the screens'
    /// own empty cards hand one in.
    let accessory: Accessory

    init(
        art: LottieAsset? = nil,
        title: String,
        message: String? = nil,
        action: (title: String, run: @MainActor () -> Void)? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.art = art
        self.title = title
        self.message = message
        self.action = action
        self.accessory = accessory()
    }

    var body: some View {
        VStack(spacing: 10) {
            if let art {
                StateArt(art).padding(.bottom, 2)
            }
            StateText(title: title, message: message)
            if let action {
                Button(action.title) { action.run() }
                    .buttonStyle(StateButtonStyle())
                    .padding(.top, 6)
            }
            // Checked by type, not left to `EmptyView` swallowing the padding: no accessory must
            // add no space at all.
            if Accessory.self != EmptyView.self {
                accessory.padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
    }
}

extension EmptyState where Accessory == EmptyView {
    init(
        art: LottieAsset? = nil,
        title: String,
        message: String? = nil,
        action: (title: String, run: @MainActor () -> Void)? = nil
    ) {
        self.init(art: art, title: title, message: message, action: action) { EmptyView() }
    }
}

/// A request that did not land, said as one: what did not load, that nothing is lost, and a way
/// to try again. Never "nothing here" — a failure drawn as empty tells a student their work or
/// their points are gone, when only the network is.
///
/// `.page` stands for the whole page and carries the art; `.inline` sits inside a section, with a
/// glyph instead, so a page whose sections all fail still shows at most one animation. While the
/// phone is offline a page says that instead of the generic failure, and still offers the retry:
/// the path monitor can be wrong (`Connectivity.noteServerReached`).
struct ErrorState: View {
    enum Style { case page, inline }

    let title: String
    let message: String
    let style: Style
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    /// Optional so a view drawn without a session (a preview) still renders: it simply never
    /// reads as offline.
    @Environment(Session.self) private var session: Session?
    @State private var retrying = false

    /// What a failure says when its caller has nothing more particular to say.
    static let nothingLost = "Nothing is lost — try again in a moment."

    init(
        title: String,
        message: String = ErrorState.nothingLost,
        style: Style = .page,
        retry: @escaping @MainActor () async -> Void
    ) {
        self.title = title
        self.message = message
        self.style = style
        self.retry = retry
    }

    private var offline: Bool { style == .page && session?.connectivity.isOnline == false }

    var body: some View {
        VStack(spacing: style == .page ? 10 : 8) {
            switch style {
            case .page:
                StateArt(offline ? .offline : .error).padding(.bottom, 2)
            case .inline:
                Image(systemName: "exclamationmark.triangle.fill")
                    .appFont(20, weight: .semibold)
                    .foregroundStyle(NewLook.orange)
                    .accessibilityHidden(true)
            }
            StateText(
                title: offline ? "You're offline" : title,
                message: offline ? "This loads again once you're back online." : message,
                compact: style == .inline
            )
            retryButton.padding(.top, style == .page ? 6 : 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, style == .page ? 28 : 16)
        .padding(.horizontal, style == .page ? 20 : 12)
    }

    private var retryButton: some View {
        Button {
            // Flipped here, not inside the task: a second tap in the gap before the task starts
            // would otherwise send a second request.
            guard !retrying else { return }
            retrying = true
            Task {
                await retry()
                retrying = false
            }
        } label: {
            HStack(spacing: 8) {
                if retrying {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise").accessibilityHidden(true)
                }
                Text("Try again")
            }
        }
        .buttonStyle(StateButtonStyle())
        .disabled(retrying)
        // The spinner says nothing to VoiceOver; the label does.
        .accessibilityLabel(retrying ? "Trying again" : "Try again")
    }
}

/// Blocks shaped like what is about to arrive, standing where it will be — never a zero, and never
/// a spinner in the middle of a page that has nothing to say yet.
///
/// `.cards` takes the card's own shape (mockup 90): a white card with a tile, two lines and a chip
/// for a row; a tile, two lines and a wide bar under them for a taller card. `.rows` is plain
/// blocks. Each block wears the kit's soft shimmer (`SkeletonBlock`), a sheen that sweeps across
/// and moves nothing; still under Reduce Motion or with `pulse` off — the same views, only the
/// clock is paused. VoiceOver hears one "Loading", not a run of empty blocks.
struct LoadingSkeleton: View {
    enum Style { case rows, cards }

    let rows: Int
    let height: CGFloat
    let style: Style
    let pulse: Bool
    /// What VoiceOver hears for the whole run of blocks.
    let label: String

    init(rows: Int = 3, height: CGFloat = 56, style: Style = .rows, pulse: Bool = true, label: String = "Loading") {
        self.rows = rows
        self.height = height
        self.style = style
        self.pulse = pulse
        self.label = label
    }

    var body: some View {
        SkeletonClock(running: pulse) {
            VStack(spacing: style == .cards ? 12 : 8) {
                ForEach(0..<max(rows, 1), id: \.self) { _ in
                    switch style {
                    case .cards:
                        SkeletonCard(height: height)
                    case .rows:
                        SkeletonBlock(height: height, radius: Theme.Radius.control)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// One card's worth of shape. Under 64 pt: a one-line row (small tile, a line, a chip). Under
/// 100: a row with two lines. Taller: the class card's form — a row, then a wide bar.
private struct SkeletonCard: View {
    let height: CGFloat

    var body: some View {
        Group {
            if height < 64 {
                HStack(spacing: 12) {
                    SkeletonBlock(width: 34, height: 34, radius: 11)
                    SkeletonLine(fraction: 0.62, height: 13)
                    SkeletonBlock(width: 58, height: 24, radius: 12)
                }
                .padding(.horizontal, 14)
            } else if height < 100 {
                HStack(spacing: 12) {
                    SkeletonBlock(width: 44, height: 44, radius: 14)
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonLine(fraction: 0.72, height: 14)
                        SkeletonLine(fraction: 0.46, height: 11)
                    }
                    SkeletonBlock(width: 58, height: 26, radius: 13)
                }
                .padding(.horizontal, 14)
            } else {
                VStack(spacing: 14) {
                    HStack(spacing: 12) {
                        SkeletonBlock(width: 44, height: 44, radius: 14)
                        VStack(alignment: .leading, spacing: 8) {
                            SkeletonLine(fraction: 0.62, height: 16)
                            SkeletonLine(fraction: 0.84, height: 12)
                        }
                    }
                    SkeletonBlock(height: 40, radius: 20)
                }
                .padding(16)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: max(height, 48))
        .newLookSurface(NewLook.card, radius: 20, shadow: .tile)
    }
}

/// A line of text still on its way: `fraction` of the room it stands in.
struct SkeletonLine: View {
    let fraction: CGFloat
    let height: CGFloat

    var body: some View {
        GeometryReader { proxy in
            SkeletonBlock(width: proxy.size.width * fraction, height: height, radius: min(10, height / 2))
        }
        .frame(height: height)
    }
}

/// The kit's `.skel`: a soft block with a sheen sweeping across it every 1.4 s (each block its
/// own sweep, as in the kit). It reads the sweep from the nearest `SkeletonClock`; with none —
/// or a paused one — it is still, the sheen resting at its edge.
struct SkeletonBlock: View {
    var width: CGFloat?
    let height: CGFloat
    var radius: CGFloat = 10

    @Environment(\.skeletonPhase) private var phase

    var body: some View {
        // The gradient is twice the block's width and slides from [-w, w] to [w, 3w]: the kit's
        // `background-size: 200%` moving from 100 % to -100 %.
        let start = -1 + 2 * phase
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(LinearGradient(
                colors: [NewLook.skeleton, NewLook.skeletonSheen, NewLook.skeleton],
                startPoint: UnitPoint(x: start, y: 0.5),
                endPoint: UnitPoint(x: start + 2, y: 0.5)
            ))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .accessibilityHidden(true)
    }
}

/// Drives the shimmer of every `SkeletonBlock` inside it. One clock, so a page of blocks redraws
/// once a frame, not once per block. Paused — not removed — under Reduce Motion: the tree is the
/// same either way.
struct SkeletonClock<Content: View>: View {
    var running = true
    @ViewBuilder let content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var moves: Bool { running && !reduceMotion }

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: !moves)) { context in
            content().environment(\.skeletonPhase, moves ? Self.phase(at: context.date) : 0.5)
        }
    }

    /// 0 → 1 over 1.4 s, eased in and out (the kit's `skel 1.4s ease-in-out infinite`).
    static func phase(at date: Date) -> CGFloat {
        let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.4) / 1.4
        return CGFloat(0.5 - cos(.pi * t) / 2)
    }
}

private struct SkeletonPhaseKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0.5
}

extension EnvironmentValues {
    var skeletonPhase: CGFloat {
        get { self[SkeletonPhaseKey.self] }
        set { self[SkeletonPhaseKey.self] = newValue }
    }
}

extension View {
    /// For a `LoadingSkeleton` standing in for a whole pushed page: pinned to the top inside the
    /// page's own 16 pt margin, where its content will start, rather than centred like the spinner
    /// it replaces.
    func skeletonPage() -> some View {
        padding(16).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// The line under a list whose refresh failed while its rows were already on screen. The rows stay —
/// a failure never blanks what loaded — and this says they may be old. Not a retry: the next pull
/// or return reads again, and the caller stops drawing it on the first success.
struct StaleNote: View {
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "wifi.exclamationmark")
                .appFont(13, weight: .semibold)
                .foregroundStyle(NewLook.muted)
                .accessibilityHidden(true)
            Text("Couldn't refresh — showing what last loaded")
                .appFont(12.5, weight: .semibold)
                .foregroundStyle(NewLook.ink4)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Shared pieces

/// A state's words: VoiceOver reads the title and the sentence under it as one element.
private struct StateText: View {
    let title: String
    let message: String?
    var compact = false

    var body: some View {
        // The kit's state words: the title in Archivo (`.h-card`, 18), the sentence under it in
        // ink-4 at 14; a section's compact form is one size down and in the text face.
        VStack(spacing: compact ? 4 : 6) {
            if compact {
                Text(title)
                    .appFont(15, weight: .bold)
                    .foregroundStyle(NewLook.ink)
            } else {
                Text(title)
                    .appDisplayFont(18)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
            }
            if let message {
                Text(message)
                    .appFont(compact ? 13 : 14, weight: .medium)
                    .foregroundStyle(NewLook.ink4)
                    .frame(maxWidth: compact ? nil : 300)
            }
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

/// The states' one button — the kit's `.btn.tint`: the blue tint, deep-blue words, a capsule never
/// less than 44 pt tall — a thumb's target even inside a small section.
private struct StateButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(15, weight: .bold)
            .foregroundStyle(NewLook.blueDeep)
            .padding(.horizontal, 20)
            .frame(minHeight: 44)
            .background(Capsule().fill(NewLook.blue50).overlay(Capsule().fill(NewLook.blue.opacity(configuration.isPressed ? 0.12 : 0))))
            .contentShape(Capsule())
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.94)
    }
}

/// A second list that loaded empty (mockup 91): a quiet dashed box — a bold line, a muted one, and
/// the way forward when there is one. No art: the page's one picture belongs to its main list.
struct QuietEmptyNote<Accessory: View>: View {
    let title: String
    let message: String?
    let accessory: Accessory

    init(title: String, message: String? = nil, @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.message = message
        self.accessory = accessory()
    }

    var body: some View {
        VStack(spacing: 3) {
            Text(title)
                .appFont(14, weight: .bold)
                .foregroundStyle(NewLook.ink4)
            if let message {
                Text(message)
                    .appFont(13, weight: .medium)
                    .foregroundStyle(NewLook.muted)
            }
            if Accessory.self != EmptyView.self {
                accessory.padding(.top, 9)
            }
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(NewLook.dots, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        )
    }
}

extension QuietEmptyNote where Accessory == EmptyView {
    init(title: String, message: String? = nil) {
        self.init(title: title, message: message) { EmptyView() }
    }
}

/// The states' button, for a way forward drawn outside this file (a quiet note's action).
struct StateTintButton: View {
    let title: String
    let action: @MainActor () -> Void

    var body: some View {
        Button(title) { action() }.buttonStyle(StateButtonStyle())
    }
}

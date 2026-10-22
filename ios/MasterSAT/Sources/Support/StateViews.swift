import SwiftUI
import MasterSATKit

// The three things a page or a section shows besides its content: nothing in it, a request that
// did not land, and the wait. One vocabulary, so a student learns each look once. The screens'
// own state components (`RetryNotice`, `VocabEmptyState`, `LearnMoreSkeleton`, …) keep their
// names and render through these.

/// A state's small animation. It plays once and settles on its finished picture; under Reduce
/// Motion it is that picture, still. Decorative: the words beside it say everything, so VoiceOver
/// skips it. At most one per screen — page-level states carry it, section-level ones do not.
struct StateArt: View {
    let asset: LottieAsset
    var size: CGFloat = 96

    init(_ asset: LottieAsset, size: CGFloat = 96) {
        self.asset = asset
        self.size = size
    }

    var body: some View {
        LottieClip(asset, playback: .settle)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
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
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.warning)
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
/// It breathes (opacity 1 → 0.55 over 1.1 s and back): a pulse that moves nothing, which is why it
/// stays out of the focus zones, where a quiet spinner holds the place. Still under Reduce Motion
/// or with `pulse` off. VoiceOver hears one "Loading", not a run of empty blocks.
struct LoadingSkeleton: View {
    enum Style { case rows, cards }

    let rows: Int
    let height: CGFloat
    let style: Style
    let pulse: Bool
    /// What VoiceOver hears for the whole run of blocks.
    let label: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    init(rows: Int = 3, height: CGFloat = 56, style: Style = .rows, pulse: Bool = true, label: String = "Loading") {
        self.rows = rows
        self.height = height
        self.style = style
        self.pulse = pulse
        self.label = label
    }

    private var breathes: Bool { pulse && !reduceMotion }

    var body: some View {
        let block = RoundedRectangle(
            cornerRadius: style == .cards ? Theme.Radius.card : Theme.Radius.control,
            style: .continuous
        )
        VStack(spacing: style == .cards ? 14 : 8) {
            ForEach(0..<max(rows, 1), id: \.self) { _ in
                block
                    .fill(Theme.surface2)
                    .frame(maxWidth: .infinity)
                    .frame(height: height)
            }
        }
        // Scoped to the opacity alone. Started from `onAppear`, a repeating animation applied to
        // the whole update would also carry whatever else changed in it — the first layout, a
        // push — and repeat that forever too.
        .animation(breathes ? .easeInOut(duration: 1.1).repeatForever(autoreverses: true) : nil) {
            $0.opacity(dimmed ? 0.55 : 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .onAppear { dimmed = breathes }
        .onChange(of: breathes) { _, now in dimmed = now }
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
        Label("Couldn't refresh — showing what last loaded", systemImage: "wifi.exclamationmark")
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
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
        VStack(spacing: compact ? 4 : 6) {
            Text(title)
                .font(.system(size: compact ? 15 : 16, weight: compact ? .bold : .heavy))
            if let message {
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

/// The states' one button: soft accent, never less than 44 pt tall — a thumb's target even inside
/// a small section.
private struct StateButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            // Pressed: the soft fill doubles, behind the label.
            .background(shape.fill(Theme.accentSoft).overlay(shape.fill(Theme.accentSoft).opacity(configuration.isPressed ? 1 : 0)))
            .contentShape(shape)
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.94)
    }
}

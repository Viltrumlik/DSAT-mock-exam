import SwiftUI

/// The app's motion vocabulary — level 3, "playful everywhere" (owner, 2026-10-20).
///
/// Every animated thing picks one of these rather than inventing a curve; the focus zones
/// (runner, vocab test, upload, review) use `focus`, `focusTap` and `focusStep` and nothing else.
enum Motion {
    /// A tap: quick squash, lively return.
    static let press = Animation.spring(response: 0.22, dampingFraction: 0.45)
    /// Something appearing, popping, or changing state.
    static let pop = Animation.spring(response: 0.32, dampingFraction: 0.45)
    /// Layout moving: tabs, chips, segments, filters.
    static let snappy = Animation.spring(response: 0.38, dampingFraction: 0.62)
    /// Whole blocks entering a screen.
    static let bouncy = Animation.spring(response: 0.55, dampingFraction: 0.56)
    /// How long `focus` runs. Named so a screen that must wait out a turn (hit testing off while
    /// a question arrives) waits for the length the animation really has.
    static let focusSeconds = 0.2
    /// How long `focusTap` runs — the beat a last tick is given before its screen is replaced.
    static let focusTapSeconds = 0.12
    /// How long a question turning in is in flight: `focus` and a frame of slack. Until it has
    /// passed, a tap must not reach the question that is arriving.
    static let focusTurnSeconds = focusSeconds + 0.03
    /// Focus zones: short and without overshoot, so nothing moves over the content.
    static let focus = Animation.easeOut(duration: focusSeconds)
    /// Focus zones, the shortest beat: a press, a tick, a pulse.
    static let focusTap = Animation.easeOut(duration: focusTapSeconds)
    /// The beat between blocks of a focus-zone entrance (`focusReveal`) — at most three of them,
    /// so the whole entrance is over within 250 ms.
    static let focusStep = 0.03
    /// The beat between blocks of a staggered entrance.
    static let staggerStep = 0.07
}

/// The one place a press is shown. Squashes and springs back; with Reduce Motion on, nothing
/// moves and the control only dips in opacity, quickly.
struct PressFeedback: ViewModifier {
    let isPressed: Bool
    let scale: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(!reduceMotion && isPressed ? scale : 1)
            .opacity(reduceMotion && isPressed ? 0.7 : 1)
            .animation(reduceMotion ? .easeOut(duration: 0.12) : Motion.press, value: isPressed)
    }
}

extension View {
    /// Press feedback that respects Reduce Motion — see `PressFeedback`.
    func pressFeedback(isPressed: Bool, scale: CGFloat) -> some View {
        modifier(PressFeedback(isPressed: isPressed, scale: scale))
    }
}

/// Every tappable squashes when pressed.
struct PressBounce: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.92)
    }
}

private struct Stagger: ViewModifier {
    let index: Int
    let shown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .opacity(shown ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: shown)
        } else {
            content
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : 44)
                .scaleEffect(shown ? 1 : 0.86, anchor: .top)
                .animation(Motion.bouncy.delay(Double(index) * Motion.staggerStep), value: shown)
        }
    }
}

extension View {
    /// Springs the block up from below, `index` beats after the screen appears.
    func stagger(_ index: Int, shown: Bool) -> some View {
        modifier(Stagger(index: index, shown: shown))
    }
}

// MARK: - Card → page zoom (iOS 18+)

private struct ZoomSource<ID: Hashable>: ViewModifier {
    let id: ID
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

private struct ZoomDestination<ID: Hashable>: ViewModifier {
    let id: ID
    let namespace: Namespace.ID
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            if reduceMotion {
                content
            } else {
                content.navigationTransition(.zoom(sourceID: id, in: namespace))
            }
        } else {
            content
        }
    }
}

extension View {
    /// The card a page zooms out of. A plain push before iOS 18.
    func zoomSource(id: some Hashable, in namespace: Namespace.ID) -> some View {
        modifier(ZoomSource(id: id, namespace: namespace))
    }

    /// The page that zooms out of its card. A plain push before iOS 18 and under Reduce Motion.
    func zoomDestination(id: some Hashable, in namespace: Namespace.ID) -> some View {
        modifier(ZoomDestination(id: id, namespace: namespace))
    }
}

// MARK: - Focus zones

/// Which way a focus zone turned its page: on to the next question, or back.
enum FocusTurn: Equatable {
    case forward, back

    /// The way from one position to another — a jump from the question map included.
    static func from(_ old: Int, to new: Int) -> FocusTurn { new >= old ? .forward : .back }
}

extension AnyTransition {
    /// A question arriving: it comes 24 pt in from the side it is coming from as it fades in,
    /// in one `Motion.focus` beat; the one leaving only fades, in half the time, so two texts
    /// never sit over each other for long. Both carry their own animation, so the 250 ms rule
    /// holds whatever the caller animates the change with — nothing overshoots. Set the turn in
    /// the same update as the change, before it: the arriving view reads it as it is inserted.
    /// Under Reduce Motion, a crossfade in the same beat.
    static func focusTurn(_ turn: FocusTurn, reduceMotion: Bool) -> AnyTransition {
        guard !reduceMotion else { return .opacity.animation(Motion.focus) }
        return .asymmetric(
            insertion: .offset(x: turn == .forward ? 24 : -24).combined(with: .opacity).animation(Motion.focus),
            removal: .opacity.animation(.easeOut(duration: 0.1))
        )
    }
}

/// A press on an answer inside a focus zone: it dips a little and comes straight back — no
/// spring, nothing grows past its size, and every answer presses alike (a press never hints at
/// right or wrong). Under Reduce Motion it only dims.
struct FocusPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(FocusPressEffect(isPressed: configuration.isPressed))
    }
}

private struct FocusPressEffect: ViewModifier {
    let isPressed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(!reduceMotion && isPressed ? 0.98 : 1)
            .opacity(isPressed ? 0.85 : 1)
            .animation(Motion.focusTap, value: isPressed)
    }
}

private struct FocusReveal: ViewModifier {
    let index: Int
    let shown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// One structure whatever the setting — a live Reduce Motion toggle must not rebuild the
    /// subtree (descendant state, scroll position, the first responder). Under Reduce Motion the
    /// block has no offset and no beats: it only fades.
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: reduceMotion || shown ? 0 : 8)
            .animation(
                .easeOut(duration: 0.15).delay(reduceMotion ? 0 : Double(min(max(index, 0), 3)) * Motion.focusStep),
                value: shown
            )
    }
}

private struct FocusShake: ViewModifier {
    let trigger: Int
    let cornerRadius: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// One structure whatever the setting — a live Reduce Motion toggle must not rebuild the
    /// subtree (descendant state, scroll position, the first responder). Both tracks always
    /// exist; the setting only decides which one is seen: the shake moves nothing under Reduce
    /// Motion, and the pulse is invisible without it.
    func body(content: Content) -> some View {
        // Read here: the animators' content closures are Sendable and may not touch the environment.
        let calm = reduceMotion
        return content
            .keyframeAnimator(initialValue: CGFloat(0), trigger: trigger) { view, x in
                view.offset(x: calm ? 0 : x)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(-8, duration: 0.04)
                    LinearKeyframe(8, duration: 0.06)
                    LinearKeyframe(-6, duration: 0.05)
                    LinearKeyframe(4, duration: 0.05)
                    LinearKeyframe(0, duration: 0.04)
                }
            }
            .overlay {
                // Under Reduce Motion nothing moves: a red pulse over the refused box instead,
                // in and out — 240 ms, the length of the shake it stands in for.
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Theme.danger.opacity(0.18))
                    .keyframeAnimator(initialValue: 0.0, trigger: trigger) { pulse, value in
                        pulse.opacity(calm ? value : 0)
                    } keyframes: { _ in
                        KeyframeTrack {
                            LinearKeyframe(1.0, duration: 0.08)
                            LinearKeyframe(1.0, duration: 0.04)
                            LinearKeyframe(0.0, duration: 0.12)
                        }
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
    }
}

extension View {
    /// One block of a focus zone settling in: up 8 pt and in, `index` beats after the first (at
    /// most three beats of `Motion.focusStep`), so the whole entrance is over within 250 ms and
    /// nothing overshoots. Under Reduce Motion it only fades, all at once.
    func focusReveal(_ index: Int, shown: Bool) -> some View {
        modifier(FocusReveal(index: index, shown: shown))
    }

    /// A refusal — a wrong password, a pair that is not one: a 240 ms shake, side to side, that
    /// comes to rest where it started, each time `trigger` changes. Under Reduce Motion nothing
    /// moves: a red pulse over the box (`cornerRadius` is the box's) instead. The caller adds the
    /// warning haptic and says what was refused in words.
    func focusShake(_ trigger: Int, cornerRadius: CGFloat) -> some View {
        modifier(FocusShake(trigger: trigger, cornerRadius: cornerRadius))
    }

    /// `focusReveal` that runs by itself the first time the block appears — for blocks that
    /// arrive with their data (a report's rows) or with a new question (a reviewed card's rows).
    func focusEntrance(_ index: Int) -> some View {
        modifier(FocusEntrance(index: index))
    }
}

private struct FocusEntrance: ViewModifier {
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .focusReveal(index, shown: shown)
            .onAppear { if !shown { shown = true } }
    }
}

/// A score that counts up from 0 when it appears: its digits roll once, in one `Motion.focus`
/// beat — ticking through every number would break the focus zones' 250 ms. A later change rolls
/// the same way. Under Reduce Motion it is simply there; VoiceOver hears the final number.
struct RollingNumber: View {
    let value: Double
    var suffix = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    var body: some View {
        Text(verbatim: "\(ScoreText.string(reduceMotion ? value : shown))\(suffix)")
            .monospacedDigit()
            .contentTransition(reduceMotion ? .identity : .numericText(value: shown))
            .accessibilityLabel(Text(verbatim: "\(ScoreText.string(value))\(suffix)"))
            .onAppear { withAnimation(Motion.focus) { shown = value } }
            .onChange(of: value) { _, new in withAnimation(Motion.focus) { shown = new } }
    }
}

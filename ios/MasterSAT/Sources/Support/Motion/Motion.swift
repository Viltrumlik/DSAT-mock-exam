import SwiftUI

/// The app's motion vocabulary — level 3, "playful everywhere" (owner, 2026-10-20).
///
/// Every animated thing picks one of these rather than inventing a curve; the focus zones
/// (runner, vocab test, upload, review) use `focus` and nothing else.
enum Motion {
    /// A tap: quick squash, lively return.
    static let press = Animation.spring(response: 0.22, dampingFraction: 0.45)
    /// Something appearing, popping, or changing state.
    static let pop = Animation.spring(response: 0.32, dampingFraction: 0.45)
    /// Layout moving: tabs, chips, segments, filters.
    static let snappy = Animation.spring(response: 0.38, dampingFraction: 0.62)
    /// Whole blocks entering a screen.
    static let bouncy = Animation.spring(response: 0.55, dampingFraction: 0.56)
    /// Focus zones: short and without overshoot, so nothing moves over the content.
    static let focus = Animation.easeOut(duration: 0.2)
    /// The beat between blocks of a staggered entrance.
    static let staggerStep = 0.07
}

/// Every tappable squashes when pressed.
struct PressBounce: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(Motion.press, value: configuration.isPressed)
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

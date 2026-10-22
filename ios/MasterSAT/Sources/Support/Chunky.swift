import SwiftUI

/// Look "B": chunky, with a thick lower edge in the surface's own colour — the owner's
/// "pressable" look. ONLY on motivation surfaces: the Rewards hero, the streak and coins cards,
/// the student's own leaderboard row, celebration moments. Everything else is look A
/// (`cardStyle`), so B keeps meaning "this is yours, and it's worth something".
///
/// The edge is drawn below the face and the bottom padding makes room for it, so a chunky card
/// never overlaps what follows it. The hit region is the whole padded shape, so it does not move
/// while the face sinks.
///
/// It only draws the surface: it does not clip the content to the shape (keep the content's own
/// padding inside the corners) and it does not claim the full width — apply
/// `.frame(maxWidth: .infinity)` to the content BEFORE `.chunky` when the card should span.
struct ChunkySurface: ViewModifier {
    static let edge: CGFloat = 4

    let tint: Color
    var radius: CGFloat = Theme.Radius.card
    /// Pressed: the face sinks onto its edge.
    var pressed = false

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(Theme.card, in: shape)
            .overlay(shape.strokeBorder(tint.opacity(0.35), lineWidth: 2))
            .offset(y: pressed ? Self.edge : 0)
            .background(shape.fill(tint.opacity(0.42)).offset(y: Self.edge))
            .padding(.bottom, Self.edge)
            .contentShape(shape)
    }
}

extension View {
    /// Look "B". See `ChunkySurface` for where it may be used.
    func chunky(_ tint: Color, radius: CGFloat = Theme.Radius.card) -> some View {
        modifier(ChunkySurface(tint: tint, radius: radius))
    }
}

/// A chunky surface that is a button: pressing sinks the face onto its edge instead of the
/// squash every other control does. Under Reduce Motion nothing moves; it dips in opacity.
struct ChunkyButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        Pressable(label: configuration.label, isPressed: configuration.isPressed, tint: tint)
    }

    private struct Pressable<Label: View>: View {
        let label: Label
        let isPressed: Bool
        let tint: Color
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            label
                .modifier(ChunkySurface(tint: tint, pressed: isPressed && !reduceMotion))
                .opacity(reduceMotion && isPressed ? 0.7 : 1)
                .animation(reduceMotion ? .easeOut(duration: 0.12) : Motion.press, value: isPressed)
        }
    }
}

import SwiftUI

extension View {
    /// Tappable at least `size` pt each way, drawn and laid out exactly as it is.
    ///
    /// Apply it to a button's LABEL, not to the button: a control's hit area is its label's
    /// content shape. The extra reach is padding that is handed straight back with negative
    /// padding, so neighbours do not move and the card does not grow; hit testing is not clipped
    /// to the layout frame. The drawn size is measured, so a 12 pt link and a 38 pt square each
    /// get just what they lack — and a view already `size` pt each way gets nothing.
    func hitTarget(_ size: CGFloat = 44) -> some View {
        modifier(HitTarget(size: size))
    }
}

private struct HitTarget: ViewModifier {
    let size: CGFloat
    /// Zero until the first measure, which only makes the reach too generous for a frame: the
    /// padding and its negative cancel, so the layout is the same either way.
    @State private var drawn = CGSize.zero

    func body(content: Content) -> some View {
        let across = max(0, (size - drawn.width) / 2)
        let down = max(0, (size - drawn.height) / 2)
        content
            .onGeometryChange(for: CGSize.self) { $0.size } action: { measured in
                if measured != drawn { drawn = measured }
            }
            .padding(.horizontal, across)
            .padding(.vertical, down)
            .contentShape(Rectangle())
            .padding(.horizontal, -across)
            .padding(.vertical, -down)
    }
}

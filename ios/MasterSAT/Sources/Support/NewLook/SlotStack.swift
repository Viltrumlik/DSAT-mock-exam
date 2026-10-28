import SwiftUI

/// `VStack(alignment: .leading, spacing:)` that puts no gap around a subview with no height.
///
/// Today's optional slots — the stories rail, the live-quiz banner, the survey card — load
/// themselves, so they stay in the stack while they have nothing to show, as zero-height views.
/// A `VStack` still spaced each of them, and the page opened on a 54-pt hole under the header.
/// Everything with a height lays out as it did in that `VStack`: each child is offered the
/// stack's width and its own height, and sits at the leading edge.
struct SlotStack: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil)) }
        let shown = sizes.filter { $0.height > 0 }
        let height = shown.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(shown.count - 1, 0))
        return CGSize(width: sizes.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let width = proposal.width ?? bounds.width
        var y = bounds.minY
        var placedOne = false
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if size.height > 0 {
                if placedOne { y += spacing }
                placedOne = true
            }
            subview.place(
                at: CGPoint(x: bounds.minX, y: y), anchor: .topLeading,
                proposal: ProposedViewSize(width: width, height: size.height)
            )
            y += size.height
        }
    }
}

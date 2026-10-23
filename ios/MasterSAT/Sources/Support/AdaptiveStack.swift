import SwiftUI

/// A row that becomes a column at the accessibility text sizes.
///
/// Three things side by side fit a phone at the default setting. At the largest sizes each of
/// them needs a line of its own, and a row squeezes the words into a sliver and cuts them to
/// "…". The switch is an `AnyLayout`, not an `if`: the children are the same views either way,
/// so whatever they hold — a count that is rolling, a Lottie, a field being typed in — survives
/// a change of the setting instead of being rebuilt under the student's thumb.
///
/// Below the accessibility sizes it lays out exactly as the `HStack` it replaces.
struct AdaptiveStack<Content: View>: View {
    private let rowAlignment: VerticalAlignment
    private let columnAlignment: HorizontalAlignment
    private let spacing: CGFloat?
    private let columnSpacing: CGFloat?
    private let content: Content

    @Environment(\.dynamicTypeSize) private var typeSize

    /// `columnSpacing` is the gap once stacked; left out, it is the row's.
    init(
        rowAlignment: VerticalAlignment = .center,
        columnAlignment: HorizontalAlignment = .leading,
        spacing: CGFloat? = nil,
        columnSpacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.rowAlignment = rowAlignment
        self.columnAlignment = columnAlignment
        self.spacing = spacing
        self.columnSpacing = columnSpacing
        self.content = content()
    }

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: columnAlignment, spacing: columnSpacing ?? spacing))
            : AnyLayout(HStackLayout(alignment: rowAlignment, spacing: spacing))
        layout { content }
    }
}

/// The `Spacer` of an `AdaptiveStack` row: it pushes what follows to the trailing edge, and is
/// not there once the row is a column — a spacer between two stacked lines would only add the
/// column's gap twice.
struct AdaptiveSpacer: View {
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
    }
}

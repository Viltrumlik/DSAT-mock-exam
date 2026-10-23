import SwiftUI

/// What a view in the header is, so one layout can put the same views in a row or a column.
enum HeaderPart {
    /// The line of context ("Tue, 28 Oct"). Optional.
    case line
    /// Streak and XP.
    case pills
    /// Bell and avatar.
    case actions
    case title
}

private struct HeaderPartKey: LayoutValueKey {
    static let defaultValue: HeaderPart? = nil
}

extension View {
    func headerPart(_ part: HeaderPart) -> some View {
        layoutValue(key: HeaderPartKey.self, value: part)
    }
}

/// The header's placement, in a layout rather than in two view trees.
///
/// The pills carry state — the XP pill's owner id a flight lands on, a count that is rolling, the
/// bell's open inbox — so they must be ONE view however the header is arranged. A header built as
/// `if row { … } else { … }` (or a `ViewThatFits` of whole headers) builds them again whenever the
/// width or the text size moves the choice. Here every part is a child once, and only where each
/// goes changes:
///
/// - **Row** (as it has always been): the line of context at the leading edge, the pills and the
///   actions at the trailing edge, the title under them. The line is what gives way.
/// - **Stacked**: the title, the line under it, then the pills (leading) and the actions
///   (trailing) on a row of their own.
///
/// It stacks when asked to (`stacked`, at the accessibility text sizes) or when the line has no
/// room: the line is a `ViewThatFits` of its full and short wordings ending in an empty view, so
/// "neither fits beside the pills" comes back as a zero size.
struct HeaderLayout: Layout {
    var stacked: Bool

    private static let pillGap: CGFloat = 8
    /// The row is `HStack(spacing: 8) { line, Spacer(minLength: 0), pills… }`, and a spacer takes
    /// the gap on both sides: 16 pt is the least the line ever sits from the pills.
    private static let lineGap: CGFloat = 16
    private static let rowGap: CGFloat = 6

    private struct Parts {
        var line: LayoutSubview?
        var pills: LayoutSubview?
        var actions: LayoutSubview?
        var title: LayoutSubview?
    }

    private struct Plan {
        var row = true
        var line = CGSize.zero
        var pills = CGSize.zero
        var actions = CGSize.zero
        var title = CGSize.zero

        /// The pills and the actions side by side, as one block.
        var chipsWidth: CGFloat {
            pills.width + (pills.width > 0 && actions.width > 0 ? HeaderLayout.pillGap : 0) + actions.width
        }
        var chipsHeight: CGFloat { max(pills.height, actions.height) }
    }

    private func parts(_ subviews: Subviews) -> Parts {
        var parts = Parts()
        for subview in subviews {
            switch subview[HeaderPartKey.self] {
            case .line: parts.line = subview
            case .pills: parts.pills = subview
            case .actions: parts.actions = subview
            case .title: parts.title = subview
            case nil: break
            }
        }
        return parts
    }

    /// `width` is nil when the parent has no opinion: everything at its ideal size, as a row.
    private func plan(_ parts: Parts, width: CGFloat?) -> Plan {
        var plan = Plan()
        plan.pills = parts.pills?.sizeThatFits(.unspecified) ?? .zero
        plan.actions = parts.actions?.sizeThatFits(.unspecified) ?? .zero
        plan.title = parts.title?.sizeThatFits(ProposedViewSize(width: width, height: nil)) ?? .zero
        plan.row = !stacked
        guard let line = parts.line else { return plan }
        if plan.row {
            if let width {
                let room = width - plan.chipsWidth - Self.lineGap
                plan.line = room > 0 ? line.sizeThatFits(ProposedViewSize(width: room, height: nil)) : .zero
            } else {
                plan.line = line.sizeThatFits(.unspecified)
            }
            if plan.line.width <= 0 { plan.row = false }
        }
        if !plan.row { plan.line = line.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
        return plan
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let plan = plan(parts(subviews), width: proposal.width)
        if plan.row {
            let rowWidth = plan.line.width + (plan.line.width > 0 ? Self.lineGap : 0) + plan.chipsWidth
            return CGSize(
                width: proposal.width ?? max(rowWidth, plan.title.width),
                height: max(plan.line.height, plan.chipsHeight) + Self.rowGap + plan.title.height
            )
        }
        let lineHeight = plan.line.height > 0 ? plan.line.height + Self.rowGap : 0
        return CGSize(
            width: proposal.width ?? max(plan.title.width, plan.line.width, plan.chipsWidth),
            height: plan.title.height + Self.rowGap + lineHeight + plan.chipsHeight
        )
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let parts = parts(subviews)
        let plan = plan(parts, width: bounds.width)
        let top = ProposedViewSize.unspecified

        func place(_ subview: LayoutSubview?, x: CGFloat, y: CGFloat, proposing proposal: ProposedViewSize) {
            subview?.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: proposal)
        }

        if plan.row {
            let rowHeight = max(plan.line.height, plan.chipsHeight)
            let room = bounds.width - plan.chipsWidth - Self.lineGap
            place(parts.line, x: bounds.minX, y: bounds.minY + (rowHeight - plan.line.height) / 2,
                  proposing: ProposedViewSize(width: room, height: nil))
            let actionsX = bounds.maxX - plan.actions.width
            place(parts.actions, x: actionsX, y: bounds.minY + (rowHeight - plan.actions.height) / 2, proposing: top)
            let pillsX = actionsX - (plan.actions.width > 0 && plan.pills.width > 0 ? Self.pillGap : 0) - plan.pills.width
            place(parts.pills, x: pillsX, y: bounds.minY + (rowHeight - plan.pills.height) / 2, proposing: top)
            place(parts.title, x: bounds.minX, y: bounds.minY + rowHeight + Self.rowGap,
                  proposing: ProposedViewSize(width: bounds.width, height: nil))
            return
        }

        var y = bounds.minY
        place(parts.title, x: bounds.minX, y: y, proposing: ProposedViewSize(width: bounds.width, height: nil))
        y += plan.title.height + Self.rowGap
        place(parts.line, x: bounds.minX, y: y, proposing: ProposedViewSize(width: bounds.width, height: nil))
        if plan.line.height > 0 { y += plan.line.height + Self.rowGap }
        place(parts.pills, x: bounds.minX, y: y + (plan.chipsHeight - plan.pills.height) / 2, proposing: top)
        place(parts.actions, x: bounds.maxX - plan.actions.width,
              y: y + (plan.chipsHeight - plan.actions.height) / 2, proposing: top)
    }
}

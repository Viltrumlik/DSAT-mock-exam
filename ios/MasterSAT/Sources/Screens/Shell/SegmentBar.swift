import SwiftUI
import MasterSATKit

/// Equal segments under a sliding capsule — the Class tab's Tasks · Schedule · People · Files.
/// Chips (`PillTabs`) narrow what is shown; this switches what kind of thing is shown.
///
/// At the accessibility sizes the segments stand one above another, each the bar's whole width,
/// and the capsule slides down rather than across. Side by side, a quarter of the phone held
/// "Sch / edul" and "Peo / ple" — words broken mid-way. A column, not a scrolling row: every
/// segment stays in view, with nothing to find by swiping, and a 2×2 grid would still be too
/// narrow for "Schedule" at the largest size. The switch is an `AnyLayout`, so the segments are
/// the same views either way and the capsule keeps sliding between them.
struct SegmentBar<Segment: Hashable>: View {
    struct Item: Identifiable {
        let segment: Segment
        let title: String
        var id: Segment { segment }
    }

    let items: [Item]
    @Binding var selection: Segment

    @Namespace private var pill
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var typeSize
    /// Taps that moved the segment — the haptic's trigger, not `selection`: the screen writes the
    /// binding too (Today's "See all" sets Class back to Tasks), and that has no thumb on it.
    @State private var tapped = 0

    /// The chosen segment's capsule. In light mode a white card on the grey track; in dark mode
    /// the card colour is almost the track's own, so it takes a lighter fill and a hairline edge.
    private var activeFill: Color { colorScheme == .dark ? Color(.systemGray4) : Theme.card }
    private var activeEdge: Color { colorScheme == .dark ? Color.white.opacity(0.14) : .clear }

    private var stacked: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        let layout = stacked ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
        // Stacked, the track is a rounded panel: a capsule as tall as four rows would be an oval.
        let track = stacked ? AnyShape(RoundedRectangle(cornerRadius: 22, style: .continuous)) : AnyShape(Capsule())
        layout {
            ForEach(items) { item in
                let active = item.segment == selection
                Button {
                    guard !active else { return }
                    tapped += 1
                    withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { selection = item.segment }
                } label: {
                    Text(item.title)
                        .appFont(14, weight: .bold, design: .rounded)
                        // Never broken over two lines: it shrinks a little first, as at the
                        // largest standard size, where "Schedule" is a point too wide for a quarter.
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(active ? Color.primary : Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background {
                            if active {
                                Capsule()
                                    .fill(activeFill)
                                    .overlay(Capsule().strokeBorder(activeEdge, lineWidth: 1))
                                    .shadow(color: .black.opacity(0.08), radius: 4, y: 1)
                                    .matchedGeometryEffect(id: "segment", in: pill)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(PressBounce())
                .accessibilityLabel(item.title.spokenSeparators)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.surface2, in: track)
        .sensoryFeedback(.selection, trigger: tapped)
    }
}

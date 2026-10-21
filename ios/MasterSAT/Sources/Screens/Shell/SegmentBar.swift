import SwiftUI
import MasterSATKit

/// Equal segments under a sliding capsule — the Class tab's Tasks · Schedule · People · Files.
/// Chips (`PillTabs`) narrow what is shown; this switches what kind of thing is shown.
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

    /// The chosen segment's capsule. In light mode a white card on the grey track; in dark mode
    /// the card colour is almost the track's own, so it takes a lighter fill and a hairline edge.
    private var activeFill: Color { colorScheme == .dark ? Color(.systemGray4) : Theme.card }
    private var activeEdge: Color { colorScheme == .dark ? Color.white.opacity(0.14) : .clear }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                let active = item.segment == selection
                Button {
                    guard !active else { return }
                    withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { selection = item.segment }
                } label: {
                    Text(item.title)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
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
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.surface2, in: Capsule())
        .sensoryFeedback(.selection, trigger: selection)
    }
}

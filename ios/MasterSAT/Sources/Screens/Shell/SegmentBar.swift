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
                                    .fill(Theme.card)
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

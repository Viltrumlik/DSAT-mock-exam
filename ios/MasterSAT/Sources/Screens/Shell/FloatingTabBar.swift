import SwiftUI
import MasterSATKit

extension AppTab {
    var title: String {
        switch self {
        case .today: return "Today"
        case .classes: return "Class"
        case .words: return "Words"
        case .rewards: return "Rewards"
        case .explore: return "Explore"
        }
    }

    var icon: String {
        switch self {
        case .today: return "house.fill"
        case .classes: return "person.3.fill"
        case .words: return "character.book.closed.fill"
        case .rewards: return "trophy.fill"
        case .explore: return "safari.fill"
        }
    }
}

/// The floating capsule: a sliding pill under the open tab, a bounce on the tapped icon.
struct FloatingTabBar: View {
    @Binding var selection: AppTab
    let onReselect: (AppTab) -> Void

    @Namespace private var pill
    @State private var taps: [AppTab: Int] = [:]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                    taps[tab, default: 0] += 1
                    if selection == tab {
                        onReselect(tab)
                    } else {
                        withAnimation(Motion.snappy) { selection = tab }
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 19, weight: .semibold))
                            .symbolEffect(.bounce.up, value: taps[tab, default: 0])
                        Text(tab.title)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(selection == tab ? Theme.accent : Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        if selection == tab {
                            Capsule().fill(Theme.accent.opacity(0.13))
                                .matchedGeometryEffect(id: "pill", in: pill)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressBounce())
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(6)
        .background(.ultraThinMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.13), radius: 18, y: 6)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

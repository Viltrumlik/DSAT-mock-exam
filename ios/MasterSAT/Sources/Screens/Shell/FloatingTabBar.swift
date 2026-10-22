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
///
/// Its text stops growing at `xxxLarge`: five labels share a phone's width and a capsule that
/// follows the accessibility sizes would be wider than the phone. Past that the system's large
/// content viewer names the tab a student is pressing, as it does for its own tab bar.
struct FloatingTabBar: View {
    @Binding var selection: AppTab
    let onReselect: (AppTab) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var pill
    @State private var taps: [AppTab: Int] = [:]
    /// Taps that opened another tab — the haptic's trigger. `selection` is also written by deep
    /// links, "See all" and `showFresh`, which have no thumb on the glass and stay silent.
    @State private var tapped = 0

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                    // No bounce under Reduce Motion: the icon's trigger simply never changes.
                    if !reduceMotion { taps[tab, default: 0] += 1 }
                    if selection == tab {
                        onReselect(tab)
                    } else {
                        tapped += 1
                        withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { selection = tab }
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon)
                            .appFont(19, weight: .semibold)
                            .symbolEffect(.bounce.up, value: taps[tab, default: 0])
                            .accessibilityHidden(true)
                        Text(tab.title)
                            .appFont(10, weight: .bold, design: .rounded)
                            // Five names share a 375-pt phone: at the cap "Rewards" is wider than
                            // its fifth of the bar, and shrinks a little rather than reading "Rewa…".
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
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
                .accessibilityShowsLargeContentViewer { Label(tab.title, systemImage: tab.icon) }
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
                // The open tab's own tap is "back to the top" (`onReselect`); the others open.
                .accessibilityHint(selection == tab ? "Double-tap to go back to the top" : "")
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .padding(6)
        .background(.ultraThinMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.13), radius: 18, y: 6)
        .sensoryFeedback(.selection, trigger: tapped)
        // One tab bar to VoiceOver, with its five tabs inside it.
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }
}

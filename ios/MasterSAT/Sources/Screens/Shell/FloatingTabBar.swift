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

/// What the floating bar wears, asked for by the page on screen.
///
/// Most pages leave it alone. The class page is dark all over, and asks for the design's dark
/// glass while it is up (`ClassPageView`). The bar is drawn over the whole `TabView`, far from any
/// page, and a preference does not travel out of a tab or a pushed page — so the request is a value
/// in an object the root hands down by environment: the page writes it, the bar reads it.
///
/// A request names the tab it was made on, and holds only while that tab is open — a tab switch
/// that hides the page without its `onDisappear` cannot strand the dark bar over another tab. And it
/// names its owner, so the page leaving withdraws its own request and never a newer one.
@MainActor
@Observable
final class TabBarChrome {
    enum Style: Equatable {
        case standard
        /// The design's dark glass: white at 12 % with an inner ring, the open tab's pill white,
        /// its ink `ink` — the class page's deep colour (`ClassTheme.deep`).
        case darkGlass(ink: RGB)
    }

    private struct Request: Equatable {
        let style: Style
        let tab: AppTab
        let owner: UUID
    }

    private var request: Request?

    /// The style for the bar while `tab` is open.
    func style(on tab: AppTab) -> Style {
        guard let request, request.tab == tab else { return .standard }
        return request.style
    }

    func ask(_ style: Style, on tab: AppTab, owner: UUID) {
        let next = Request(style: style, tab: tab, owner: owner)
        if request != next { request = next }
    }

    func release(owner: UUID) {
        if request?.owner == owner { request = nil }
    }
}

/// The floating capsule: a sliding pill under the open tab, a bounce on the tapped icon.
///
/// Its text stops growing at `xxxLarge`: five labels share a phone's width and a capsule that
/// follows the accessibility sizes would be wider than the phone. Past that the system's large
/// content viewer names the tab a student is pressing, as it does for its own tab bar.
///
/// It wears what `TabBarChrome` says: the standard frosted capsule, or the class page's dark glass.
/// The two are one tree — only colours change — so the pill keeps its place and its slide.
struct FloatingTabBar: View {
    @Binding var selection: AppTab
    let onReselect: (AppTab) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    /// Optional: a bar drawn without the root's chrome (a preview) is simply the standard one.
    @Environment(TabBarChrome.self) private var chrome: TabBarChrome?
    @Namespace private var pill
    @State private var taps: [AppTab: Int] = [:]
    /// Taps that opened another tab — the haptic's trigger. `selection` is also written by deep
    /// links, "See all" and `showFresh`, which have no thumb on the glass and stay silent.
    @State private var tapped = 0

    private var style: TabBarChrome.Style { chrome?.style(on: selection) ?? .standard }

    private var darkInk: Color? {
        if case .darkGlass(let ink) = style { return Color(ink) }
        return nil
    }

    private var isDark: Bool { darkInk != nil }

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
                    // The style's colours change with a short fade of their own, scoped to the
                    // colours (`animation(_:body:)`): a trigger modifier over the label would also
                    // wrap the pill's `if` below, and the pill would be caught in it.
                    .animation(styleAnimation) { $0.foregroundStyle(ink(selected: selection == tab)) }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        if selection == tab {
                            // The design's solid blue pill (`#2A68C0`, `0 4px 12px` at 30 %); under
                            // the dark glass a white one lifted off it (`0 6px 16px`). Its colours
                            // fade inside the branch; its slide is the selection's own.
                            Capsule()
                                .animation(styleAnimation) { capsule in
                                    capsule
                                        .foregroundStyle(isDark ? Color.white : Theme.accent)
                                        .shadow(
                                            color: isDark
                                                ? Color(.sRGB, red: 10 / 255, green: 12 / 255, blue: 40 / 255).opacity(0.30)
                                                : Theme.accent.opacity(0.30),
                                            radius: isDark ? 8 : 6,
                                            y: isDark ? 6 : 4
                                        )
                                }
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
        .background { glass }
        .sensoryFeedback(.selection, trigger: tapped)
        // One tab bar to VoiceOver, with its five tabs inside it.
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }

    /// How a change of style recolours the bar: a short fade, or none under Reduce Motion. Scoped
    /// to colours wherever it is used, so nothing moves with it.
    private var styleAnimation: Animation? { reduceMotion ? nil : Motion.focus }

    private func ink(selected: Bool) -> Color {
        if let darkInk { return selected ? darkInk : .white.opacity(0.72) }
        return selected ? .white : Theme.textSecondary
    }

    /// The capsule behind the tabs. The same layers in both styles, so a change of style is a change
    /// of colours: the frost (dark under the dark glass), the design's 12 % white and 20 % ring on top
    /// of it, and the shadow — `0 14px 34px rgba(5,8,30,0.45)` under the dark glass.
    private var glass: some View {
        ZStack {
            Capsule()
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, isDark ? .dark : colorScheme)
            Capsule().animation(styleAnimation) { $0.foregroundStyle(.white.opacity(isDark ? 0.12 : 0)) }
            Capsule().strokeBorder(lineWidth: 1).animation(styleAnimation) { $0.foregroundStyle(.white.opacity(isDark ? 0.20 : 0)) }
        }
        .animation(styleAnimation) { capsules in
            capsules.shadow(
                color: isDark ? Color(.sRGB, red: 5 / 255, green: 8 / 255, blue: 30 / 255).opacity(0.45) : .black.opacity(0.13),
                radius: isDark ? 17 : 18,
                y: isDark ? 14 : 6
            )
        }
    }
}

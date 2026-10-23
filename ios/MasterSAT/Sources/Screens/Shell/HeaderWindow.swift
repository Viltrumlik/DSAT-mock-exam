import SwiftUI
import MasterSATKit

/// Which of the two header windows is up. The header's pills only write this on the router; the
/// window itself is drawn once, at the root.
enum HeaderWindowKind: Hashable {
    case strikes, xp
}

/// The floating window the header pills open — the flame opens Strikes, the XP pill opens XP and
/// points.
///
/// One overlay at the root, beside `RankUpOverlay`, not a sheet and not an overlay on the header:
/// a header lives inside a scroll view, so an overlay there is clipped, and a third sheet would
/// fight the router's one-sheet rule and the Me sheet's queue. A full-screen cover slides up, and
/// this entrance has to be calm. Drawn above the tabs and the bar, under the two sheets.
///
/// Takes touches only while a window is open, so the tabs below keep working the rest of the time.
struct HeaderWindowOverlay: View {
    @Environment(AppRouter.self) private var router
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if let kind = router.headerWindow {
                Color.black.opacity(0.38)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { router.closeHeaderWindow() }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                HeaderWindowCard(onClose: { router.closeHeaderWindow() }) {
                    content(for: kind)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 40)
                // The page behind is dimmed but still drawn and still alive, so a celebration
                // started under the window waits for it exactly as it waits under a cover.
                .coversCelebrations(celebrations)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // One animation for both tracks, and the setting picks the curve rather than the tree:
        // ≤250 ms and no overshoot over content either way (W-R6).
        .animation(reduceMotion ? Motion.focus : .easeOut(duration: 0.24), value: router.headerWindow)
        .allowsHitTesting(router.headerWindow != nil)
    }

    /// The seam Tasks 3 and 4 fill: each window's content, inside the shared chrome.
    @ViewBuilder private func content(for kind: HeaderWindowKind) -> some View {
        switch kind {
        case .strikes:
            StrikesWindowView()
        case .xp:
            // Task 4 — the bolt, the XP, the place, the points box and Convert.
            Text("XP and points").appFont(22, weight: .heavy, design: .rounded)
        }
    }
}

/// The chrome both windows share: the card, the ✕, the scrolling content and the modal semantics.
///
/// The content scrolls inside the card (and only when it has to — `.basedOnSize`), so the
/// accessibility text sizes and the iPhone SE never run it off the screen, and the card's width is
/// capped so iPad does not stretch it into a banner. The ✕ sits outside the scroll view: at AX5 a
/// close button that has scrolled away is a window VoiceOver and thumbs both struggle to leave.
struct HeaderWindowCard<Content: View>: View {
    let onClose: () -> Void
    @ViewBuilder var content: Content

    /// What the content wants. The scroll view is capped to it, so the card hugs short content and
    /// only grows to the room it has been offered — then scrolls inside that.
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .appFont(15, weight: .heavy)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 26, height: 26)
                        .background(Theme.surface2, in: Circle())
                        .hitTarget(44)
                }
                .buttonStyle(PressBounce())
                .accessibilityLabel("Close")
            }
            .padding(.top, 12)
            .padding(.trailing, 12)

            ScrollView {
                content
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measured in
                        if measured != contentHeight { contentHeight = measured }
                    }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: contentHeight == 0 ? nil : contentHeight)
        }
        .frame(maxWidth: 420)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        // VoiceOver's two-finger scrub puts it away, as it does a sheet.
        .accessibilityAction(.escape, onClose)
    }
}

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
                // The kit's `.dim`: navy at 36 %, lighter than black (mockup 12).
                Color(.sRGB, red: 10 / 255, green: 22 / 255, blue: 50 / 255, opacity: 0.36)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    // `closeHeaderWindow` refuses while the open window declares itself busy, so
                    // the tap the dimming invites cannot destroy a window with a request still
                    // out and take every word of its answer with it.
                    .onTapGesture { router.closeHeaderWindow() }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                HeaderWindowCard(
                    canClose: !router.headerWindowBusy,
                    onClose: { router.closeHeaderWindow() }
                ) {
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
            XPWindowView()
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
    /// False while the content has work out that would be lost with it — the XP window's
    /// conversion. The ✕ is then held off (and says why), as the dim's tap and `.escape` are by
    /// the router's own guard: this card is destroyed on close, so a dismissal mid-request drops
    /// every write that was going to say what happened.
    var canClose = true
    let onClose: () -> Void
    @ViewBuilder var content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// **How the card learns its height.** A `ScrollView` takes every point of height it is
    /// offered, whatever is inside it, so a card built around one opens as tall as the screen and
    /// then jumps short. So the content is measured — a scroll view proposes its content the
    /// content's own ideal height along the scroll axis, whatever the scroll view's own frame is —
    /// and the scroll view is capped to what came back. The card then hugs short content and grows
    /// only to the room it has been offered, scrolling inside that.
    ///
    /// Zero until the first measure, which is also the cap, so the card cannot open screen-tall;
    /// it is hidden for that one frame (`opacity`) rather than shown at a height nobody chose. The
    /// entrance is the only motion there (W-R6).
    ///
    /// Why not `ViewThatFits(in: .vertical)`, which needs no measuring: its candidates are
    /// separate identities, and both windows hold their read in `@State` and read once on
    /// appearance. A content that outgrew the plain candidate would be rebuilt as the scrolling
    /// one with empty state, read again, come back short, and flap between the two.
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .appFont(13, weight: .heavy)
                        .foregroundStyle(NewLook.ink4)
                        .frame(width: 30, height: 30)
                        .background(NewLook.line, in: Circle())
                        .hitTarget(44)
                }
                .buttonStyle(PressBounce())
                .disabled(!canClose)
                .accessibilityLabel("Close")
                // A button held off says why — "dimmed" is not a reason — and it is held off for
                // at most one request.
                .accessibilityHint(canClose ? "" : "Available once this finishes")
            }
            .padding(.top, 12)
            .padding(.trailing, 12)
            // Above the scroll view, which is a later sibling in this stack and would otherwise
            // win the ~9 pt where the ✕'s 44-pt reach hangs below its 26-pt row (`hitTarget`
            // keeps the reach outside the layout frame on purpose, so neighbours do not move).
            .zIndex(1)

            ScrollView {
                content
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measured in
                        guard measured != contentHeight else { return }
                        // The first measure lands under the hidden frame, so it must not animate:
                        // the entrance is the only motion a window opens with. Every later one is
                        // a skeleton becoming numbers, which both windows do on every open — the
                        // card's bottom edge moves, and that is worth a short curve, not a snap.
                        guard contentHeight > 0 else {
                            contentHeight = measured
                            return
                        }
                        // Under Reduce Motion the edge simply moves, as the status-bar inset does
                        // (`TabRootScroll`): the value is picked, the tree is the same either way.
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                            contentHeight = measured
                        }
                    }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: contentHeight)
        }
        .frame(maxWidth: 420)
        // The kit's `.pop`: white, r26, `--sh-pop`.
        .newLookSurface(NewLook.card, radius: 26, shadow: .pop)
        // After the background and the shadow, so the one unmeasured frame hides the whole card
        // and not only what is inside it.
        .opacity(contentHeight == 0 ? 0 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        // VoiceOver's two-finger scrub puts it away, as it does a sheet. It goes through the same
        // `onClose` as the ✕ and the dim, so the busy guard holds for it too — there is no second
        // door out of the card.
        .accessibilityAction(.escape, onClose)
    }
}

import SwiftUI
import MasterSATKit

/// A tab root's scroll view. Tapping the open tab again with nothing pushed brings it back to
/// the top, as every iOS tab does (`AppRouter.reselect`).
///
/// A tab that is already open at its root can be asked to read again (`AppRouter.showFresh`,
/// `reloadIfShowing`): it runs the same detached `onRefresh` as a pull, once per ask.
///
/// Pull-to-refresh lives here, not on the roots: `onRefresh` runs DETACHED from the refresh's
/// own task. SwiftUI cancels that task whenever the root re-renders and re-installs the action
/// — and a refresh writes state all the way through — so a refresh that ran inside it cancelled
/// its own requests half way (and `APIClient` turns a cancellation into a transport failure,
/// which the screen then showed as "didn't load").
struct TabRootScroll<Content: View>: View {
    let tab: AppTab
    let onRefresh: (@MainActor @Sendable () async -> Void)?
    @ViewBuilder let content: () -> Content

    init(
        tab: AppTab,
        onRefresh: (@MainActor @Sendable () async -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.tab = tab
        self.onRefresh = onRefresh
        self.content = content
    }

    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The page has been scrolled up under the status bar. Only this flip is kept, never the
    /// offset: a scroll would otherwise rebuild the whole page (`content` is built in this body).
    @State private var underStatusBar = false
    /// Where the status bar ends, on screen: the spot the top marker rests at, unscrolled.
    @State private var statusBarBottom: CGFloat = 0

    private static var topID: String { "tab-root-top" }
    /// How far the page must have moved before the status bar gets its material: a hair of
    /// overscroll or a settling bounce is not "scrolled".
    private static var scrollThreshold: CGFloat { 8 }

    var body: some View {
        // Read once, so the measuring closure below holds values, not `self`.
        let restingEdge = statusBarBottom
        let threshold = Self.scrollThreshold
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id(Self.topID)
                    content()
                }
                // iOS 17 has no `onScrollGeometryChange`: the offset is how far the top of the
                // content has left the edge it rests at. Pulling down (a refresh) moves it the
                // other way, so it never counts. Read on the content, not the zero-height marker.
                .onGeometryChange(for: Bool.self) { top in
                    restingEdge - top.frame(in: .global).minY > threshold
                } action: { scrolled in
                    if underStatusBar != scrolled { underStatusBar = scrolled }
                }
            }
            // Content scrolled under the status bar would run into the clock. A zero-height inset
            // whose background is a material reaches up into the safe area, so what the page
            // passes behind there is blurred. It belongs to this page: every sheet, cover and the
            // floating bar sit above it, and it takes no touch.
            .safeAreaInset(edge: .top, spacing: 0) {
                Color.clear.frame(height: 0)
                    .background(.bar)
                    .opacity(underStatusBar ? 1 : 0)
                    // Instant under Reduce Motion: the value is picked, the tree is the same.
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: underStatusBar)
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { statusBarBottom = $0 }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .detachedRefresh(onRefresh)
            .onChange(of: router.reloadRequest) { _, request in
                guard request?.tab == tab, let onRefresh else { return }
                Task { @MainActor in await onRefresh() }
            }
            .onChange(of: router.scrollToTop) { _, request in
                guard request?.tab == tab else { return }
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) {
                    proxy.scrollTo(Self.topID, anchor: .top)
                }
            }
        }
    }
}

extension View {
    /// `.refreshable`, with the work run on its own task so the refresh's cancellation never
    /// reaches the requests (see `TabRootScroll`). The spinner still waits for the work to end.
    /// Without an action there is no pull-to-refresh at all.
    @ViewBuilder
    func detachedRefresh(_ action: (@MainActor @Sendable () async -> Void)?) -> some View {
        if let action {
            refreshable { await Task { @MainActor in await action() }.value }
        } else {
            self
        }
    }
}

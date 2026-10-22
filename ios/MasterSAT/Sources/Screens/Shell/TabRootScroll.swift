import SwiftUI
import MasterSATKit

/// A tab root's scroll view. Tapping the open tab again with nothing pushed brings it back to
/// the top, as every iOS tab does (`AppRouter.reselect`).
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

    private static var topID: String { "tab-root-top" }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id(Self.topID)
                    content()
                }
            }
            .detachedRefresh(onRefresh)
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

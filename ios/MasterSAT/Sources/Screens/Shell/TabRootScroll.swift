import SwiftUI
import MasterSATKit

/// A tab root's scroll view. Tapping the open tab again with nothing pushed brings it back to
/// the top, as every iOS tab does (`AppRouter.reselect`).
struct TabRootScroll<Content: View>: View {
    let tab: AppTab
    @ViewBuilder let content: () -> Content

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
            .onChange(of: router.scrollToTop) { _, request in
                guard request?.tab == tab else { return }
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) {
                    proxy.scrollTo(Self.topID, anchor: .top)
                }
            }
        }
    }
}

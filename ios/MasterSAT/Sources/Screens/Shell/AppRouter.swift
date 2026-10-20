import SwiftUI
import MasterSATKit

struct CertificateCode: Identifiable {
    let code: String
    var id: String { code }
}

/// Which tab is open, each tab's stack, and the two sheets.
///
/// One `NavigationPath` per tab, as separate properties: an `@Observable` notifies per
/// property, so a push on Words does not re-evaluate the Today stack. Pages are pushed as
/// `AppLink` values and every tab root declares `navigationDestination(for: AppLink.self)` —
/// value routes declared at the stack root, the only kind that does not drop a push.
@MainActor
@Observable
final class AppRouter {
    var selection: AppTab = .today
    var today = NavigationPath()
    var classes = NavigationPath()
    var words = NavigationPath()
    var rewards = NavigationPath()
    var explore = NavigationPath()
    var me = NavigationPath()
    var showingMe = false
    var certificate: CertificateCode?

    func open(_ link: AppLink, baseURL: URL, openURL: (URL) -> Void) {
        switch link.placement {
        case .tab(let tab):
            showingMe = false
            select(tab)
            popToRoot(tab)
        case .push(let tab, let page):
            showingMe = false
            select(tab)
            popToRoot(tab)
            push(page, on: tab)
        case .me(let page):
            me = NavigationPath()
            if let page { me.append(page) }
            showingMe = true
        case .certificate(let code):
            certificate = CertificateCode(code: code)
        case .web:
            if let url = link.webURL(base: baseURL) { openURL(url) }
        }
    }

    func openMe() {
        if !me.isEmpty { me = NavigationPath() }
        showingMe = true
    }

    /// Tapping the open tab again goes back to its top, as everywhere on iOS.
    func reselect(_ tab: AppTab) { popToRoot(tab) }

    private func select(_ tab: AppTab) {
        if selection != tab { selection = tab }
    }

    private func popToRoot(_ tab: AppTab) {
        switch tab {
        case .today: if !today.isEmpty { today = NavigationPath() }
        case .classes: if !classes.isEmpty { classes = NavigationPath() }
        case .words: if !words.isEmpty { words = NavigationPath() }
        case .rewards: if !rewards.isEmpty { rewards = NavigationPath() }
        case .explore: if !explore.isEmpty { explore = NavigationPath() }
        }
    }

    private func push(_ link: AppLink, on tab: AppTab) {
        switch tab {
        case .today: today.append(link)
        case .classes: classes.append(link)
        case .words: words.append(link)
        case .rewards: rewards.append(link)
        case .explore: explore.append(link)
        }
    }
}

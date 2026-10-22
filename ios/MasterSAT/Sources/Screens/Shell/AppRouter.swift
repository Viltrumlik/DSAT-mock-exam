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
///
/// One sheet at a time: the Me sheet and the certificate sheet never stand together. Asking
/// for one while the other is up closes the other and holds the request until the root calls
/// `sheetDismissed`. Every write is guarded so a no-op never notifies the root.
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

    /// A sheet asked for while the other sheet was up; opened once that one has gone.
    /// Nothing renders from it, so it stays out of observation.
    @ObservationIgnored private var queued: AppLink?

    func open(_ link: AppLink, baseURL: URL, openURL: (URL) -> Void) {
        switch link.placement {
        case .tab(let tab):
            queued = nil
            closeSheets()
            select(tab)
            popToRoot(tab)
        case .push(let tab, let page):
            queued = nil
            closeSheets()
            select(tab)
            popToRoot(tab)
            push(page, on: tab)
        case .me(let page):
            if certificate != nil {
                certificate = nil
                queued = link
                return
            }
            if !me.isEmpty { me = NavigationPath() }
            if let page { me.append(page) }
            if !showingMe { showingMe = true }
        case .certificate(let code):
            if showingMe {
                showingMe = false
                queued = link
                return
            }
            if certificate?.code != code { certificate = CertificateCode(code: code) }
        case .web:
            if let url = link.webURL(base: baseURL) { openURL(url) }
        }
    }

    func openMe() {
        if certificate != nil {
            certificate = nil
            queued = .profile
            return
        }
        if !me.isEmpty { me = NavigationPath() }
        if !showingMe { showingMe = true }
    }

    /// The root calls this from BOTH sheets' `onDismiss`, so a sheet asked for while another
    /// was up opens once the first has gone (SwiftUI cannot present a second sheet from the
    /// same view while one is dismissing).
    func sheetDismissed(baseURL: URL, openURL: (URL) -> Void) {
        guard let next = queued else { return }
        queued = nil
        open(next, baseURL: baseURL, openURL: openURL)
    }

    /// Tapping the open tab again goes back to its top, as everywhere on iOS.
    func reselect(_ tab: AppTab) { popToRoot(tab) }

    private func closeSheets() {
        if showingMe { showingMe = false }
        if certificate != nil { certificate = nil }
    }

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

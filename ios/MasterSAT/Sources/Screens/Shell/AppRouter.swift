import SwiftUI
import MasterSATKit

struct CertificateCode: Identifiable {
    let code: String
    var id: String { code }
}

/// "Scroll this tab's root to its top" — a fresh nonce each time, so a second tap asks again.
struct ScrollRequest: Equatable {
    let tab: AppTab
    let nonce: Int
}

/// "Read again what this tab's root shows" — a fresh nonce each time, so a second ask is seen.
struct ReloadRequest: Equatable {
    let tab: AppTab
    let nonce: Int
}

/// The Me sheet's three tabs — the web profile's.
enum MeTab: Hashable {
    case overview, classes, settings
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
///
/// The Me sheet's tab lives here too (`meTab`), not in the page: the sheet's page is built
/// afresh every time it opens, and it reopens on the tab the student last had open.
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
    /// The tab the Me sheet shows — and reopens on, for the rest of this launch.
    var meTab: MeTab = .overview
    var certificate: CertificateCode?
    private(set) var scrollToTop: ScrollRequest?
    private(set) var reloadRequest: ReloadRequest?
    /// Today's "See all" asked for Class on Tasks → To do, across every class. Held until the
    /// Class root has applied it (`classToDoShown`), so it lands whether Class was already built
    /// or is built by this very tap, and applies exactly once.
    private(set) var wantsClassToDo = false

    /// What was asked for while the other sheet was up: a link, or the Me sheet itself (on a
    /// given tab, or the last one).
    private enum Queued {
        case link(AppLink)
        case me(MeTab?)
    }

    /// A sheet asked for while the other sheet was up; opened once that one has gone.
    /// Nothing renders from it, so it stays out of observation.
    @ObservationIgnored private var queued: Queued?

    func open(_ link: AppLink, baseURL: URL, openURL: (URL) -> Void) {
        switch link.placement {
        case .tab(let tab):
            show(tab)
        case .push(let tab, let page):
            queued = nil
            closeSheets()
            select(tab)
            popToRoot(tab)
            push(page, on: tab)
        case .me(let page):
            if certificate != nil {
                certificate = nil
                queued = .link(link)
                return
            }
            if !me.isEmpty { me = NavigationPath() }
            // `/profile` is the profile's front page, Overview. A page that lives inside Me (My
            // progress) is pushed over whichever tab was open, and Back lands on that tab.
            if page == nil { selectMeTab(.overview) }
            if let page { me.append(page) }
            if !showingMe { showingMe = true }
        case .certificate(let code):
            if showingMe {
                showingMe = false
                queued = .link(link)
                return
            }
            if certificate?.code != code { certificate = CertificateCode(code: code) }
        case .web:
            if let url = link.webURL(base: baseURL) { openURL(url) }
        }
    }

    /// The avatar opens Me where the student left it; `tab` is for a caller that needs one in
    /// particular — Today's SAT countdown wants Overview, where the date is set.
    func openMe(on tab: MeTab? = nil) {
        if certificate != nil {
            certificate = nil
            queued = .me(tab)
            return
        }
        if let tab { selectMeTab(tab) }
        if !me.isEmpty { me = NavigationPath() }
        if !showingMe { showingMe = true }
    }

    /// The root calls this from BOTH sheets' `onDismiss`, so a sheet asked for while another
    /// was up opens once the first has gone (SwiftUI cannot present a second sheet from the
    /// same view while one is dismissing).
    func sheetDismissed(baseURL: URL, openURL: (URL) -> Void) {
        guard let next = queued else { return }
        queued = nil
        switch next {
        case .link(let link): open(link, baseURL: baseURL, openURL: openURL)
        case .me(let tab): openMe(on: tab)
        }
    }

    /// Switch to a tab at its root, closing any sheet — a link to the tab itself, or "See all".
    func show(_ tab: AppTab) {
        queued = nil
        closeSheets()
        select(tab)
        popToRoot(tab)
    }

    /// `show`, and the tab's root reads again, from its top. A root that comes into view reloads
    /// itself as it appears; one already on screen at its root has nothing appear, so it is asked
    /// (the trophy card's "See the board" lands on a hero that must show the place the card just
    /// named). Either way the hero is what the student is sent to, so the root scrolls back up.
    func showFresh(_ tab: AppTab) {
        let onScreen = selection == tab && isAtRoot(tab)
        show(tab)
        if onScreen { requestReload(tab) }
        requestScrollToTop(tab)
    }

    /// The app came back to the front: a tab root on screen reads again, since nothing about the
    /// return makes it appear. A tab that is not open reloads when it is opened.
    func reloadIfShowing(_ tab: AppTab) {
        if selection == tab, isAtRoot(tab) { requestReload(tab) }
    }

    /// Today's "See all": Class, on Tasks → To do for every class — not wherever it was last left.
    func showClassToDo() {
        if !wantsClassToDo { wantsClassToDo = true }
        show(.classes)
        // At the top of the list, not wherever Class was last scrolled to.
        requestScrollToTop(.classes)
    }

    /// The Class root has put itself on Tasks → To do.
    func classToDoShown() {
        if wantsClassToDo { wantsClassToDo = false }
    }

    /// Tapping the open tab again goes back to its top, as everywhere on iOS: a pushed page pops
    /// to the root; a root already showing scrolls back up.
    func reselect(_ tab: AppTab) {
        if isAtRoot(tab) {
            requestScrollToTop(tab)
        } else {
            popToRoot(tab)
        }
    }

    private func requestReload(_ tab: AppTab) {
        reloadRequest = ReloadRequest(tab: tab, nonce: (reloadRequest?.nonce ?? 0) + 1)
    }

    private func requestScrollToTop(_ tab: AppTab) {
        scrollToTop = ScrollRequest(tab: tab, nonce: (scrollToTop?.nonce ?? 0) + 1)
    }

    private func closeSheets() {
        if showingMe { showingMe = false }
        if certificate != nil { certificate = nil }
    }

    private func select(_ tab: AppTab) {
        if selection != tab { selection = tab }
    }

    private func selectMeTab(_ tab: MeTab) {
        if meTab != tab { meTab = tab }
    }

    private func isAtRoot(_ tab: AppTab) -> Bool {
        switch tab {
        case .today: return today.isEmpty
        case .classes: return classes.isEmpty
        case .words: return words.isEmpty
        case .rewards: return rewards.isEmpty
        case .explore: return explore.isEmpty
        }
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

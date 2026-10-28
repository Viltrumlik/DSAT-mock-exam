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
/// One sheet at a time: the Me sheet, the certificate sheet and the event invitation never
/// stand together. Asking for one while another is up closes that one and holds the request
/// until the root calls `sheetDismissed`. Every write is guarded so a no-op never notifies
/// the root.
///
/// The invitation is here for the same reason as the other two, and it was not always: shown
/// from its own view, it was a third host presenting at the same time, so a deep link that
/// arrived while it was up set `showingMe` against a view already presenting — the Me sheet
/// never appeared and the flag stayed true, which left every later tap on the avatar doing
/// nothing. It is also what lets the celebrations know the stage is taken.
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
    /// Which header window is up, if any — the flame's or the XP pill's. Not a sheet: it is one
    /// overlay at the root (`HeaderWindowOverlay`), so it stands beside the sheets rather than
    /// queueing with them.
    private(set) var headerWindow: HeaderWindowKind?
    /// The open window is in the middle of something that must not be interrupted. Today that is
    /// exactly one thing: the XP window's conversion.
    ///
    /// **Why the flag lives here and not in the window.** The Rewards hub runs the same conversion
    /// inside a tab a `TabView` never tears down, so every `@State` write after the request still
    /// lands. This window is destroyed the instant `headerWindow` becomes nil — and a tap on the
    /// dim, which the dimming itself invites, does exactly that. Every later write is then dropped:
    /// no note, nothing announced on the two failure branches, and a coin bursting at the
    /// coordinates of a card that is gone. So the window declares itself busy and the close paths a
    /// student can take refuse until it settles. It is at most one request, and it is the promise
    /// the hub already makes: the button is off from the press until the read-back settles.
    private(set) var headerWindowBusy = false
    /// The event the invitation is offering a seat at, and nil the rest of the time. Set by
    /// `EventInvitePrompt` only once it has found the stage clear; presented by the root
    /// beside the other two sheets.
    var eventInvite: LearningEvent?
    /// The leaderboard sheet (mockup 13): Today's rank card opens it. A sheet like the other
    /// three, presented from the same root and serialised with them here.
    var showingLeaderboard = false
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
        case leaderboard
    }

    /// A sheet asked for while the other sheet was up; opened once that one has gone.
    /// Nothing renders from it, so it stays out of observation.
    @ObservationIgnored private var queued: Queued?

    /// A header pill was tapped. Opening the other window while one is up just swaps the contents.
    func openHeaderWindow(_ kind: HeaderWindowKind) {
        if headerWindow != kind { headerWindow = kind }
    }

    /// Whether work that outlives its window is still in flight — a conversion, which spends real
    /// points and is not idempotent.
    ///
    /// **The flag belongs to the work, not to the window.** It is raised before the request and
    /// lowered when that request settles, by the unstructured task that owns it, which a dismissal
    /// does not cancel. So it stays up across a forced close, and a window reopened in those few
    /// hundred milliseconds offers no second Convert.
    func setHeaderWindowBusy(_ busy: Bool) {
        if headerWindowBusy != busy { headerWindowBusy = busy }
    }

    /// ✕, a tap outside, or anywhere the student is sent somewhere else.
    ///
    /// `force` is for the second kind. A student's own dismissal waits for
    /// `headerWindowBusy`, but a route — a deep link, a notification tap — must take the window
    /// with it whatever it is doing: a window left over the tab the student has just been sent to
    /// would have nothing left to close it.
    /// A forced close takes the window and leaves the flag alone: the request it stands for is
    /// still out, and the task that raised it will lower it when it settles. Clearing it here
    /// would let the student reopen the window and start a second conversion over the first.
    func closeHeaderWindow(force: Bool = false) {
        guard force || !headerWindowBusy else { return }
        if headerWindow != nil { headerWindow = nil }
    }

    /// Whether any of the root's sheets is up — what the celebrations wait for.
    var anySheetUp: Bool { showingMe || certificate != nil || eventInvite != nil || showingLeaderboard }

    /// Today's rank card. Asked for while another sheet is up, it closes that one and opens once
    /// it has gone, as the Me sheet does.
    func openLeaderboardSheet() {
        closeHeaderWindow(force: true)
        if showingMe || certificate != nil || eventInvite != nil {
            if showingMe { showingMe = false }
            closeSheetsOtherThanMe()
            queued = .leaderboard
            return
        }
        if !showingLeaderboard { showingLeaderboard = true }
    }

    func open(_ link: AppLink, baseURL: URL, openURL: (URL) -> Void) {
        // A window must never stay over a tab the student has just been sent to — and the windows'
        // own Shop and Leaderboard buttons route through here, so this is the one place it closes.
        closeHeaderWindow(force: true)
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
            if certificate != nil || eventInvite != nil || showingLeaderboard {
                closeSheetsOtherThanMe()
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
            if showingMe || eventInvite != nil || showingLeaderboard {
                if showingMe { showingMe = false }
                if eventInvite != nil { eventInvite = nil }
                if showingLeaderboard { showingLeaderboard = false }
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
        closeHeaderWindow(force: true)
        if certificate != nil || eventInvite != nil || showingLeaderboard {
            closeSheetsOtherThanMe()
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
        case .leaderboard: openLeaderboardSheet()
        }
    }

    /// Switch to a tab at its root, closing any sheet — a link to the tab itself, or "See all".
    func show(_ tab: AppTab) {
        closeHeaderWindow(force: true)
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
        closeHeaderWindow(force: true)
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
        closeHeaderWindow(force: true)
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
        closeSheetsOtherThanMe()
    }

    /// The certificate and the invitation, which are never the sheet being asked for by name
    /// here. Kept apart from `closeSheets` because a push into Me while Me is already up is a
    /// page change, not a second presentation, and must not close it.
    private func closeSheetsOtherThanMe() {
        if certificate != nil { certificate = nil }
        if eventInvite != nil { eventInvite = nil }
        if showingLeaderboard { showingLeaderboard = false }
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

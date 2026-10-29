import SwiftUI
import MasterSATKit

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        content
            // Both overlays read their own state in their own bodies. If this body read
            // connectivity or the release gate, every change to either would rebuild the tab
            // view below — and with it the navigation stacks, popping open screens.
            .overlay(alignment: .top) { OfflineOverlay() }
            // Above everything, including the sign-in form: a build below the minimum can do
            // nothing useful, and signing in to it would only meet a refusal.
            .overlay { UpdateGateOverlay() }
    }

    @ViewBuilder
    private var content: some View {
        switch session.phase {
        case .launching:
            ProgressView().controlSize(.large)
        case .signedOut(let message):
            AuthView(notice: message)
        case .unreachable:
            UnreachableView()
        case .signedIn(let user):
            if user.isFrozen {
                FrozenAccountView()
            } else if user.mustCompleteProfile {
                // The web's gate, on the server's word (`profile_complete` + `missing_fields`):
                // name, username and a confirmed email before anything else. It lifts itself —
                // finishing refreshes the user, which moves `phase` on.
                CompleteProfileView(user: user, onDone: {})
            } else {
                // One router, rewards store and celebration queue per signed-in identity: another
                // account signing in gets fresh ones, never the last account's.
                RootTabView(user: user)
                    .id(user.id)
            }
        }
    }
}

/// Offline is said once, here, rather than by every screen failing on its own.
private struct OfflineOverlay: View {
    @Environment(Session.self) private var session

    var body: some View {
        // A stable container that stays, with the banner coming and going inside it: an animation
        // keyed to a value, set on a `Group` whose branch flips in that same update, is applied to
        // the view being inserted or removed and can miss it.
        ZStack(alignment: .top) {
            if !session.connectivity.isOnline {
                OfflineBanner()
            }
        }
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.25), value: session.connectivity.isOnline)
        // Said on a change of the connection only (and once at launch if it starts offline), never
        // on the banner's own appearing: that also follows the screen below being rebuilt.
        .onChange(of: session.connectivity.isOnline, initial: true) { wasOnline, isOnline in
            if !isOnline {
                AccessibilityNotification.Announcement("You're offline").post()
            } else if !wasOnline {
                AccessibilityNotification.Announcement("Back online").post()
            }
        }
    }
}

private struct UpdateGateOverlay: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.releaseGate.isBlocked {
            UpdateRequiredView(config: session.releaseGate.config) {
                await session.recheckRelease()
            }
            .transition(.opacity)
        }
    }
}

/// Keeps the header's XP and streak current after launch, and runs "while you were away": the
/// check each time the app comes back to the front (launch runs it from `RootTabView`) and when
/// the phone comes back online — a launch check that could not reach the server finds its answer
/// then, from the same baseline. It also keeps the baseline equal to what the header shows: written
/// whenever the pill or the flame settles on a new number, and when the app leaves the front.
///
/// Its own view, so reading `scenePhase`, connectivity and the header's numbers rebuilds this
/// empty view and not `RootTabView` — whose body would rebuild the tab view and its navigation
/// stacks with it.
private struct RewardsRefresher: View {
    let userID: Int
    let away: AwayCheck

    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    /// What the header and the trophy card show right now: XP still in the air, a streak waiting
    /// to roll and a place not yet shown are not on it yet.
    private struct Shown: Equatable {
        var xp: Int?
        var streak: Int?
        var rankUp: Rise?
    }

    var body: some View {
        let shown = Shown(
            xp: rewards.xp.map { max(0, $0 - celebrations.heldXP) },
            streak: celebrations.streakShown(rewards.streak),
            rankUp: celebrations.rankUp
        )
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: scenePhase) { old, new in
                if new == .active, old != .active { check() }
                if new == .background { remember() }
            }
            .onChange(of: session.connectivity.isOnline) { old, new in
                // Only at the front: coming back from the background runs the check itself, and
                // a check made while the app is away would celebrate to no one.
                if new, !old, scenePhase == .active { check() }
            }
            // The baseline never lags the header: a gain celebrated as a task's, or a flight that
            // has just landed, is written the moment the pill shows it, not at the next
            // background — a relaunch in between would celebrate it again.
            .onChange(of: shown) { _, _ in remember() }
    }

    private func check() {
        // Taken now: the task runs on after this view value has been rebuilt.
        let router = router
        let celebrations = celebrations
        Task {
            let outcome = await away.run(userID: userID, session: session, rewards: rewards, celebrations: celebrations)
            // Coming back brings nothing into view, so a Rewards root left open (its hero, its
            // ledger) reads again — but only after the check actually read, and only once the
            // stage is quiet: flight, flame and trophy card first, so the hub never shows a total
            // or a place the header has not rolled to. A check that was skipped or failed read
            // nothing new. Any other tab reloads as it is opened.
            guard outcome == .read else { return }
            celebrations.whenQuiet("welcome-back.reload") { router.reloadIfShowing(.rewards) }
        }
    }

    private func remember() {
        away.remember(userID: userID, rewards: rewards, celebrations: celebrations)
    }
}

/// Tells the celebrations when a sheet covers the tabs, so a task finished under the Me sheet
/// waits to be celebrated. Its own view for `RewardsRefresher`'s reason: reading the router
/// here rebuilds this empty view, not the tab view.
private struct CelebrationSheetWatcher: View {
    @Environment(AppRouter.self) private var router
    @Environment(CelebrationCenter.self) private var celebrations

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            // The invitation counts as much as the other two: a sheet it does not know about is
            // one confetti, an XP flight or the rank-up card can play behind, where nobody sees
            // it and the queue records that it was shown.
            .onChange(of: router.anySheetUp) { _, up in
                // Up at once. Down only from the sheets' onDismiss (`RootTabView.sheetDismissed`),
                // once the sheet has actually left the screen.
                if up { celebrations.setSheetUp(true) }
            }
    }
}

/// Five tabs — Today, Class, Words, Rewards, Explore — under a floating bar; Me is a sheet
/// behind the avatar in every header.
///
/// The app still does not host the timed sittings: mocks, midterms, past papers and the
/// question bank are sat on a laptop, under exam conditions.
struct RootTabView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var router = AppRouter()
    @State private var rewards = RewardsStore()
    @State private var celebrations = CelebrationCenter()
    @State private var away = AwayCheck()
    /// Which full-screen prompt has the stage, so the ones that can wait do (`AppPrompts`).
    @State private var prompts = AppPrompts()
    /// The floating bar's measured height, so the room left for it is never a guess.
    @State private var barHeight: CGFloat = 0
    /// What the bar wears, as the page on screen asks (`TabBarChrome`). Handed down, never read
    /// here: a read in this body would rebuild the tab view, and its stacks, on every request.
    @State private var tabBarChrome = TabBarChrome()
    /// The status bar's text, asked for the same way (`StatusBarChrome`); read by `StatusBarHost`.
    @State private var statusBarChrome = StatusBarChrome()

    /// Space between the bar and the home indicator, and between the bar and the last thing
    /// a page shows. One place, so the bar and the room made for it cannot drift apart.
    private enum Bar {
        static let bottomPadding: CGFloat = 4
        static let contentGap: CGFloat = 8
    }

    /// How far above the bottom safe area a scroll view's content must stop to end above the bar.
    private var barClearance: CGFloat { barHeight + Bar.bottomPadding + Bar.contentGap }

    private var notifications: NotificationRouter { .shared }

    var body: some View {
        @Bindable var router = router
        // The bar is an overlay, so content scrolls UNDER it, and each tab's scroll views get a
        // bottom content margin as tall as the bar. Set outside the tab's NavigationStack, the
        // margin reaches every page pushed inside it. Checked on a device: a `safeAreaInset` on
        // the `TabView` and `safeAreaPadding` on its children both left the last row under the
        // bar; `contentMargins` travels by environment and reaches the pushed pages too.
        TabView(selection: $router.selection) {
            TodayView(user: user, path: $router.today)
                .contentMargins(.bottom, barClearance)
                .tag(AppTab.today)
                .toolbar(.hidden, for: .tabBar)
            ClassView(path: $router.classes)
                .contentMargins(.bottom, barClearance)
                .tag(AppTab.classes)
                .toolbar(.hidden, for: .tabBar)
            VocabularyView(path: $router.words)
                .contentMargins(.bottom, barClearance)
                .tag(AppTab.words)
                .toolbar(.hidden, for: .tabBar)
            RewardsHubView(path: $router.rewards)
                .contentMargins(.bottom, barClearance)
                .tag(AppTab.rewards)
                .toolbar(.hidden, for: .tabBar)
            ExploreView(path: $router.explore)
                .contentMargins(.bottom, barClearance)
                .tag(AppTab.explore)
                .toolbar(.hidden, for: .tabBar)
        }
        // The same room as a number, for a page that pins something over the bar's top edge
        // (the Leaderboard's own row) rather than ending its scroll above it.
        .environment(\.tabBarClearance, barClearance)
        .overlay(alignment: .bottom) {
            FloatingTabBar(selection: $router.selection) { router.reselect($0) }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
                .padding(.horizontal, 18)
                .padding(.bottom, Bar.bottomPadding)
                // Like a system tab bar, it stays at the bottom of the screen and the keyboard
                // covers it; riding up on the keyboard would sit it over the field being typed in.
                // The frame comes first: `ignoresSafeArea` only moves a view that fills the
                // space it is offered, and a bar sized to its content would ignore nothing.
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .ignoresSafeArea(.keyboard, edges: .bottom)
        }
        .background {
            RewardsRefresher(userID: user.id, away: away)
            CelebrationSheetWatcher()
            EventInvitePrompt()
            StatusBarHost()
        }
        .overlay { CelebrationLayer().ignoresSafeArea() }
        .overlay { RankUpOverlay() }
        .overlay { HeaderWindowOverlay() }
        .environment(router)
        .environment(rewards)
        .environment(celebrations)
        .environment(prompts)
        .environment(tabBarChrome)
        .environment(statusBarChrome)
        .tint(Theme.accent)
        .sheet(isPresented: $router.showingMe, onDismiss: { sheetDismissed() }) {
            // The close button lives in the page's hero, on its root only: laid over the sheet,
            // it sat on every pushed page's toolbar too. The tab is the router's, so the sheet
            // reopens where it was left.
            ProfileView(user: user, path: $router.me, tab: $router.meTab) {
                if router.showingMe { router.showingMe = false }
            }
            .presentationDragIndicator(.visible)
            .environment(router)
            .environment(rewards)
            .environment(celebrations)
        }
        .sheet(item: $router.certificate, onDismiss: { sheetDismissed() }) {
            MidtermCertificateSheet(code: $0.code)
        }
        // The third sheet, presented from the same host as the other two so the router can
        // serialise all three: two sheets asked for at once from different views is how a
        // presentation gets dropped while the flag behind it stays set.
        .sheet(item: $router.eventInvite, onDismiss: { sheetDismissed() }) { event in
            EventInviteSheet(
                event: event,
                api: EventsAPI(client: session.client),
                // Through the router, as every route in this app is: landing on Events closes
                // this sheet on the way.
                onSeeAllEvents: { open(.events) },
                onClose: { if router.eventInvite != nil { router.eventInvite = nil } }
            )
        }
        // The fourth: Today's rank card opens the short board (mockup 13), from the same host.
        .sheet(isPresented: $router.showingLeaderboard, onDismiss: { sheetDismissed() }) {
            LeaderboardSheet(onClose: { if router.showingLeaderboard { router.showingLeaderboard = false } })
                .environment(router)
                .environment(rewards)
                .environment(celebrations)
        }
        // A tapped push, a reminder or an inbox row lands here. `onAppear` covers the tap
        // that launched the app from closed, which set the link before this view existed.
        .onAppear {
            celebrations.reduceMotion = reduceMotion
            celebrations.connect(rewards: rewards, api: session.rewards)
            if let link = notifications.consume() { open(link) }
            // The launch's header refresh IS the welcome-back check.
            Task { await away.run(userID: user.id, session: session, rewards: rewards, celebrations: celebrations) }
        }
        .onChange(of: reduceMotion) { _, value in celebrations.reduceMotion = value }
        .onChange(of: notifications.pendingLink) { _, link in
            if link != nil, let next = notifications.consume() { open(next) }
        }
    }

    private func open(_ link: AppLink) {
        router.open(link, baseURL: session.client.config.baseURL) { openURL($0) }
    }

    /// Both sheets call this when they close: a link that needed the other sheet opens now, and
    /// a celebration that waited under the sheet plays.
    private func sheetDismissed() {
        router.sheetDismissed(baseURL: session.client.config.baseURL) { openURL($0) }
        celebrations.setSheetUp(router.anySheetUp)
    }
}

extension EnvironmentValues {
    /// How far above the bottom safe area the floating tab bar's room ends — the margin every
    /// tab's scroll views are given. 0 where there is no bar (a cover, a preview).
    @Entry var tabBarClearance: CGFloat = 0
}

extension View {
    /// Put on a full-screen cover's content. The tab bar's room (`contentMargins(.bottom, …)` on
    /// each tab, above) travels by environment into anything presented from inside a tab, and a
    /// cover has no bar under it — its scroll views would end a bar's height short of the bottom.
    /// An inner margin replaces the inherited one (checked on the simulator, 2026-10-21).
    func noBarClearance() -> some View {
        contentMargins(.bottom, 0)
    }

    /// Put on a horizontal scroller — a row of pills, the stories. The tab's bottom margin reaches
    /// it too, and in a row it is not room for the bar but extra height under the content.
    func noBarClearanceInRow() -> some View {
        contentMargins(.bottom, 0, for: .scrollContent)
    }
}

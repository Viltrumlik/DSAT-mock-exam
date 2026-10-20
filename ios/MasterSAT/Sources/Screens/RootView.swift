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
                RootTabView(user: user)
            }
        }
    }
}

/// Offline is said once, here, rather than by every screen failing on its own.
private struct OfflineOverlay: View {
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            if !session.connectivity.isOnline {
                OfflineBanner().allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.connectivity.isOnline)
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

    private var notifications: NotificationRouter { .shared }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selection) {
            DashboardView(user: user, path: $router.today)
                .tag(AppTab.today)
                .toolbar(.hidden, for: .tabBar)
            ClassHubView(path: $router.classes)
                .tag(AppTab.classes)
                .toolbar(.hidden, for: .tabBar)
            VocabularyView(path: $router.words)
                .tag(AppTab.words)
                .toolbar(.hidden, for: .tabBar)
            RewardsHubView(path: $router.rewards)
                .tag(AppTab.rewards)
                .toolbar(.hidden, for: .tabBar)
            ExploreView(path: $router.explore)
                .tag(AppTab.explore)
                .toolbar(.hidden, for: .tabBar)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            FloatingTabBar(selection: $router.selection) { router.reselect($0) }
                .padding(.horizontal, 18)
                .padding(.bottom, 4)
        }
        .overlay { CelebrationLayer().ignoresSafeArea() }
        .environment(router)
        .environment(rewards)
        .environment(celebrations)
        .tint(Theme.accent)
        .sheet(isPresented: $router.showingMe, onDismiss: { sheetDismissed() }) {
            ProfileView(user: user, path: $router.me)
                .overlay(alignment: .topTrailing) {
                    Button { router.showingMe = false } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(Theme.surface2, in: Circle())
                    }
                    .buttonStyle(PressBounce())
                    .padding(16)
                    .accessibilityLabel("Close")
                }
                .presentationDragIndicator(.visible)
                .environment(router)
                .environment(rewards)
                .environment(celebrations)
        }
        .sheet(item: $router.certificate, onDismiss: { sheetDismissed() }) {
            MidtermCertificateSheet(code: $0.code)
        }
        // A tapped push, a reminder or an inbox row lands here. `onAppear` covers the tap
        // that launched the app from closed, which set the link before this view existed.
        .onAppear {
            celebrations.reduceMotion = reduceMotion
            if let link = notifications.consume() { open(link) }
            Task { await rewards.refresh(using: session.rewards) }
        }
        .onChange(of: reduceMotion) { _, value in celebrations.reduceMotion = value }
        .onChange(of: notifications.pendingLink) { _, link in
            if link != nil, let next = notifications.consume() { open(next) }
        }
    }

    private func open(_ link: AppLink) {
        router.open(link, baseURL: session.client.config.baseURL) { openURL($0) }
    }

    /// Both sheets call this when they close: a link that needed the other sheet opens now.
    private func sheetDismissed() {
        router.sheetDismissed(baseURL: session.client.config.baseURL) { openURL($0) }
    }
}

import SwiftUI
import MasterSATKit

/// The bell — the web's top-bar bell, sized for the header of Home.
///
/// A red count when something is unread ("9+" past nine), nothing when nothing is. Tapping it
/// opens the inbox as a sheet. The count is `session.notifications.unreadTotal`, which the
/// inbox and the app icon read too, so they never disagree.
///
/// While it is on screen and the app is in front, it polls the summary every 60 seconds — the
/// web's cadence — and at once on every return to the foreground or when a push lands while
/// the app is open. Polling one small aggregate is cheap and always right; nothing here holds
/// a connection open.
///
/// It also registers this phone for push whenever it appears (`PushRegistrar.activate`): the
/// bell is on the first screen a signed-in student sees, and activation is a no-op when
/// nothing changed.
struct NotificationBell: View {
    /// Where a tapped notification should go. Called after the inbox sheet has fully closed.
    let onOpen: @MainActor (AppLink) -> Void

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    @State private var showingInbox = false
    /// A destination chosen in the inbox, held until the sheet is gone.
    @State private var chosenLink: AppLink?

    private var count: Int { session.notifications.unreadTotal }
    private var router: NotificationRouter { .shared }

    var body: some View {
        Button {
            showingInbox = true
        } label: {
            Image(systemName: "bell")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 42, height: 42)
                .background(Circle().fill(Theme.card))
                .overlay(Circle().stroke(Theme.separator.opacity(0.5), lineWidth: 0.5))
                .overlay(alignment: .topTrailing) {
                    if let text = NotificationBadge.text(for: count) {
                        Text(text)
                            .font(.system(size: 10, weight: .heavy))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 17, minHeight: 17)
                            .background(Capsule().fill(Theme.danger))
                            // A ring in the page colour keeps the badge off the bell's outline.
                            .overlay(Capsule().stroke(Theme.background, lineWidth: 2))
                            .offset(x: 4, y: -3)
                            .allowsHitTesting(false)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(NotificationBadge.accessibilityLabel(for: count))
        .sheet(isPresented: $showingInbox, onDismiss: {
            if let link = chosenLink {
                chosenLink = nil
                onOpen(link)
            }
        }) {
            NotificationsInboxSheet { link in chosenLink = link }
        }
        // Restarted on every change of phase: polling runs only while the app is in front,
        // and a return to the foreground refreshes at once.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await activatePush()
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .onChange(of: router.arrivals) {
            Task { await refresh() }
        }
    }

    private func refresh() async {
        // A failed poll keeps the last count rather than dropping to zero: an absent badge
        // would say "nothing new" when the truth is "could not ask".
        guard let summary = try? await NotificationsAPI(client: session.client).summary() else { return }
        session.notifications.applyUnread(summary)
    }

    private func activatePush() async {
        guard case .signedIn(let user) = session.phase else { return }
        await PushRegistrar.shared.activate(client: session.client, userId: user.id)
    }
}

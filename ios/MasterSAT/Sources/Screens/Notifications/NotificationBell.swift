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
    /// How the disc is drawn.
    enum Look {
        /// On a card-coloured disc — every header that sits on the page.
        case card
        /// White glass over a coloured band (the Class tab's blue): the disc is white at 14 %
        /// with a 22 % rim, the glyph white, and the badge's ring the band's own colour.
        case glass(band: Color)
    }

    /// Where a tapped notification should go. Called after the inbox sheet has fully closed.
    let onOpen: @MainActor (AppLink) -> Void
    var look: Look = .card

    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    @State private var showingInbox = false
    /// A destination chosen in the inbox, held until the sheet is gone.
    @State private var chosenLink: AppLink?
    /// Whether this bell is the one on screen. Every tab's header carries a bell now, and a tab
    /// the student has visited stays built behind the one they are looking at — so a push landing
    /// while the app is open would otherwise have all five of them read the summary at once. The
    /// polling loop below already stops with its tab (a `.task` is cancelled when its view goes);
    /// this is the same rule for the arrival, which comes from shared observable state instead and
    /// so reaches every built bell.
    @State private var onScreen = false

    private var count: Int { session.notifications.unreadTotal }
    private var router: NotificationRouter { .shared }

    private var glyph: AnyShapeStyle {
        if case .glass = look { return AnyShapeStyle(.white) }
        return AnyShapeStyle(.primary)
    }

    private var disc: Color {
        if case .glass = look { return .white.opacity(0.14) }
        return Theme.card
    }

    private var rim: Color {
        if case .glass = look { return .white.opacity(0.22) }
        return Theme.separator.opacity(0.5)
    }

    private var rimWidth: CGFloat {
        if case .glass = look { return 1 }
        return 0.5
    }

    /// The ring that keeps the badge off the bell's outline is whatever the bell sits on.
    private var badgeRing: Color {
        if case .glass(let band) = look { return band }
        return Theme.background
    }

    var body: some View {
        Button {
            showingInbox = true
        } label: {
            Image(systemName: "bell")
                .appFont(17, weight: .semibold)
                .foregroundStyle(glyph)
                .frame(width: 42, height: 42)
                .background(Circle().fill(disc))
                .overlay(Circle().stroke(rim, lineWidth: rimWidth))
                .overlay(alignment: .topTrailing) {
                    if let text = NotificationBadge.text(for: count) {
                        Text(text)
                            .appFont(10, weight: .heavy, monospacedDigits: true)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 17, minHeight: 17)
                            .background(Capsule().fill(Theme.dangerFill))
                            // A ring in the page colour keeps the badge off the bell's outline.
                            .overlay(Capsule().stroke(badgeRing, lineWidth: 2))
                            .offset(x: 4, y: -3)
                            .allowsHitTesting(false)
                    }
                }
                .contentShape(Circle())
                // Header chrome: the bell is a fixed 42-pt disc, so its glyph and badge stop at
                // `xxxLarge` (the large content viewer shows it bigger while it is pressed). Set
                // on the label, not the button: the inbox sheet below is a page and keeps growing.
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(NotificationBadge.accessibilityLabel(for: count))
        .accessibilityShowsLargeContentViewer { Label(NotificationBadge.accessibilityLabel(for: count), systemImage: "bell") }
        .sheet(isPresented: $showingInbox, onDismiss: {
            if let link = chosenLink {
                chosenLink = nil
                onOpen(link)
            }
        }) {
            NotificationsInboxSheet { link in chosenLink = link }
                .noBarClearance()
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
        .onAppear { onScreen = true }
        .onDisappear { onScreen = false }
        .onChange(of: router.arrivals) {
            guard onScreen else { return }
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

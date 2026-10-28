import Network
import SwiftUI

/// Whether the phone has a route to the internet at all.
///
/// Not a promise the server will answer — only that trying is not pointless. Its one job is
/// the banner: without it, an offline student sees every screen fail separately, each with
/// its own error, and cannot tell a dead Wi-Fi from a broken app.
@MainActor
@Observable
final class Connectivity {
    private(set) var isOnline = true
    /// Fires when the phone comes back online, so queued work (crash reports) can go.
    var onReconnect: (() -> Void)?

    private let monitor = NWPathMonitor()
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                // Only on a real change. The monitor reports every interface wobble, and an
                // @Observable property notifies on EVERY assignment — equal or not. Each one
                // re-rendered the root, which rebuilt the tabs' navigation links and popped
                // whatever screen the student had open.
                guard let self, self.isOnline != online else { return }
                self.isOnline = online
                if online { self.onReconnect?() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "uz.mastersat.connectivity"))
    }

    /// The server just answered, so the phone is online whatever the path monitor last said.
    /// The monitor can report no route while requests go through (the simulator does after
    /// the Mac changes networks), and a banner saying "offline" over a page that is loading
    /// fine teaches the student to ignore it.
    func noteServerReached() {
        guard !isOnline else { return }
        isOnline = true
        onReconnect?()
    }
}

/// A thin strip at the top of the screen while offline.
///
/// VoiceOver hears it as two announcements, "You're offline" when it arrives and "Back online" when
/// it goes: a student who cannot see the strip would otherwise meet every screen failing on its
/// own. They are posted by its overlay (`OfflineOverlay`), from the connection itself: the strip's
/// own appearing and disappearing also happen when the screen under it is rebuilt — a sign-out
/// while offline said "Back online" when it never was. The ink pair keeps it the strongest thing
/// at the top of the screen in dark mode too.
struct OfflineBanner: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash").appFont(12, weight: .bold)
                .accessibilityHidden(true)
            Text("You're offline — what's on screen may be out of date.")
                .appFont(12, weight: .bold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(Theme.onInk)
        .padding(.horizontal, 14)
        .frame(minHeight: 32)
        // The kit's `.offline`: the ink capsule with its own shadow, so it stands off the band.
        .background(Capsule().fill(Theme.ink).shadow(color: .black.opacity(0.22), radius: 8, y: 6))
        .padding(.top, 4)
        // Reduce Motion picks the transition's value: it fades in place instead of sliding in.
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}

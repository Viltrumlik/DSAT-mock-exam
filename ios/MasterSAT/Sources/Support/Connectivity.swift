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
}

/// A thin strip at the top of the screen while offline.
struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash").font(.system(size: 12, weight: .bold))
            Text("You're offline — what's on screen may be out of date.")
                .font(.system(size: 12, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(Color.black.opacity(0.78)))
        .padding(.top, 4)
        .transition(.move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}

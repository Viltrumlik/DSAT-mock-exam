import SwiftUI
import Photos
import MasterSATKit

/// The ticket, full-screen, the way it is shown at the door: black around it, the screen at
/// full brightness so a scanner reads the QR, and two ways to keep it — Photos, or Share.
///
/// Needs `NSPhotoLibraryAddUsageDescription` in Info.plist: without it iOS terminates the app
/// the moment anything asks to add a photo, the share sheet's own "Save Image" included.
struct EventTicketView: View {
    let ticket: EventTicket

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var brightness = EventTicketBrightness()
    @State private var shareURL: URL?
    @State private var saveState: SaveState = .idle

    private enum SaveState: Equatable {
        case idle, saving, saved
        case failed(String)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 18) {
                HStack {
                    Button("Done") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)
                    Spacer()
                }

                Spacer(minLength: 0)

                Image(uiImage: ticket.image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityLabel(
                        ticket.code.isEmpty
                            ? "Your ticket for \(ticket.title)"
                            : "Your ticket for \(ticket.title), code \(ticket.code)"
                    )

                Spacer(minLength: 0)

                if case .failed(let message) = saveState {
                    Text(message)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 12) {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack(spacing: 7) {
                            if saveState == .saving {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: saveState == .saved ? "checkmark" : "square.and.arrow.down")
                            }
                            Text(saveTitle)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                    .disabled(saveState == .saving || saveState == .saved)

                    if let shareURL {
                        ShareLink(
                            item: shareURL,
                            preview: SharePreview(ticket.title, image: Image(uiImage: ticket.image))
                        ) {
                            HStack(spacing: 7) {
                                Image(systemName: "square.and.arrow.up")
                                Text("Share")
                            }
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                    }
                }
            }
            .padding(16)
        }
        .onAppear {
            brightness.raise()
            shareURL = writeShareFile()
        }
        .onDisappear { brightness.restore() }
        // iOS keeps an app's brightness until the phone is locked — so it goes back the
        // moment the app stops being in front, and comes up again when it returns.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                brightness.raise()
            } else {
                brightness.restore()
            }
        }
    }

    private var saveTitle: String {
        switch saveState {
        case .saving: return "Saving…"
        case .saved: return "Saved to Photos"
        case .idle, .failed: return "Save to Photos"
        }
    }

    private func save() async {
        saveState = .saving
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            saveState = .failed("MasterSAT isn't allowed to add photos. Turn it on in Settings, or use Share.")
            return
        }
        do {
            try await Self.addToPhotos(ticket.data)
            saveState = .saved
        } catch {
            saveState = .failed("Couldn't save the ticket. Try again, or use Share.")
        }
    }

    /// Photos runs the change block on its own queue. A block written inside the view is
    /// main-actor isolated, and Swift 6 traps the moment Photos calls it off the main thread —
    /// "Save to Photos" crashed the app on the first tap after "Allow". Built in a nonisolated
    /// function, the block carries no isolation.
    private nonisolated static func addToPhotos(_ data: Data) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
        }
    }

    /// The PNG as a file named the way the server names it, so a share keeps the name.
    private func writeShareFile() -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(ticket.fileName)
        do {
            try ticket.data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

/// Full brightness while the ticket is up, and the student's own setting back afterwards.
@MainActor
final class EventTicketBrightness {
    private var saved: CGFloat?

    func raise() {
        guard saved == nil, let screen else { return }
        saved = screen.brightness
        screen.brightness = 1
    }

    func restore() {
        guard let saved, let screen else { return }
        screen.brightness = saved
        self.saved = nil
    }

    private var screen: UIScreen? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.screen
    }
}

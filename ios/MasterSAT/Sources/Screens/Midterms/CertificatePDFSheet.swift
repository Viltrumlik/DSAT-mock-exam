import SwiftUI
import QuickLook
import MasterSATKit

/// A certificate (or a report sheet) as the PDF the centre prints, shown on the phone.
///
/// The file sits behind the student's session, so it cannot be handed to Safari as a link —
/// the browser has no token. The sheet opens at once saying "Preparing…", fetches the bytes
/// with the app's own client, writes them to a temporary file and shows them in QuickLook,
/// with Share for saving or sending. The temporary file goes when the sheet does.
struct CertificatePDFSheet: View {
    /// "Certificate", "Error report".
    let title: String
    /// What the file is called when shared.
    let fileName: String
    let load: @MainActor () async throws -> Data

    @Environment(\.dismiss) private var dismiss
    @State private var fileURL: URL?
    @State private var failure: Failure?
    @State private var attempt = 0

    struct Failure: Equatable {
        let message: String
        let retryable: Bool
    }

    var body: some View {
        NavigationStack {
            Group {
                if let fileURL {
                    VStack(spacing: 0) {
                        CertificateQuickLook(url: fileURL)
                        filePanel(fileURL)
                    }
                } else if let failure {
                    VStack(spacing: 14) {
                        NewLookTile(systemName: "doc.badge.clock", tone: .orange)
                        Text(failure.message)
                            .appFont(16, weight: .semibold)
                            .foregroundStyle(NewLook.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if failure.retryable {
                            Button("Try again") { attempt += 1 }
                                .buttonStyle(NewLookButtonStyle(kind: .tint))
                        }
                    }
                    .padding(28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.large)
                        Text("Preparing…")
                            .appFont(15, weight: .semibold)
                            .foregroundStyle(NewLook.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(NewLook.sheet)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .appFont(17, weight: .bold)
                        .foregroundStyle(NewLook.blueText)
                }
                ToolbarItem(placement: .primaryAction) {
                    if let fileURL {
                        ShareLink(item: fileURL) {
                            Image(systemName: "square.and.arrow.up")
                                .foregroundStyle(NewLook.blueText)
                        }
                        .accessibilityLabel("Share")
                    }
                }
            }
        }
        .task(id: attempt) { await fetch() }
        .onDisappear { removeFile() }
    }

    private var isCertificate: Bool { title == "Certificate" }

    /// Under the page: what the file is, and the toolbar's Share again, within thumb reach.
    private func filePanel(_ url: URL) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                NewLookTile(
                    systemName: isCertificate ? "rosette" : "doc.text.fill",
                    tone: isCertificate ? .bronze : .blue
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(url.lastPathComponent)
                        .appFont(16, weight: .bold)
                        .foregroundStyle(NewLook.ink)
                        .lineLimit(2)
                    Text("Pinch to zoom · Share to save or send")
                        .appFont(13, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                }
                Spacer(minLength: 0)
            }
            .newLookCard(padding: 14)
            .accessibilityElement(children: .combine)

            ShareLink(item: url) {
                Label("Share or save", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(NewLookButtonStyle(size: .large))
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .background(NewLook.sheet.ignoresSafeArea(edges: .bottom))
    }

    @MainActor
    private func fetch() async {
        failure = nil
        do {
            let data = try await load()
            let folder = FileManager.default.temporaryDirectory
                .appendingPathComponent("certificates", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(CertificatePath.fileName(fileName))
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            removeFile()
            fileURL = url
        } catch {
            failure = Self.failure(for: error)
        }
    }

    private func removeFile() {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
    }

    /// The words for each way this fails. A PDF that could not be rendered is not a lost
    /// result, and the sentence says so.
    static func failure(for error: Error) -> Failure {
        switch error as? APIError {
        case .unavailable?:
            return Failure(message: "The PDF couldn't be produced right now. Your result is safe.", retryable: true)
        case .forbidden(let detail, _)?:
            return Failure(message: detail.isEmpty ? "This certificate is not available." : detail, retryable: false)
        case .decoding?:
            return Failure(message: "This certificate is not available.", retryable: false)
        case .http(let status, let detail)?:
            if status >= 500 {
                return Failure(message: "The PDF couldn't be produced right now. Your result is safe.", retryable: true)
            }
            return Failure(message: detail.isEmpty ? "This certificate is not available." : detail, retryable: status == 429)
        case let apiError?:
            return Failure(message: apiError.errorDescription ?? "Could not open this file.", retryable: apiError.isRetryable)
        case nil:
            return Failure(message: error.localizedDescription, retryable: true)
        }
    }
}

/// A midterm certificate by its code — for a `/certificate/<code>` link, where there is no
/// `download_url` to hand.
struct MidtermCertificateSheet: View {
    let code: String
    var title: String = ""

    @Environment(Session.self) private var session

    var body: some View {
        CertificatePDFSheet(title: "Certificate", fileName: title.isEmpty ? "Certificate \(code)" : "Certificate — \(title)") {
            try await CertificateAPI(client: session.client).midtermCertificate(code: code)
        }
    }
}

/// A past paper's certificate for one finished sitting. The server issues it on the first
/// download if it was never issued, so the first open may take a moment longer.
struct PastPaperCertificateSheet: View {
    let attemptId: Int
    var title: String = ""

    @Environment(Session.self) private var session

    var body: some View {
        CertificatePDFSheet(title: "Certificate", fileName: title.isEmpty ? "Certificate" : "Certificate — \(title)") {
            try await CertificateAPI(client: session.client).pastPaperCertificate(attemptId: attemptId)
        }
    }
}

/// QuickLook's own viewer, for one local file.
struct CertificateQuickLook: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        guard context.coordinator.url != url else { return }
        context.coordinator.url = url
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL

        init(url: URL) { self.url = url }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}

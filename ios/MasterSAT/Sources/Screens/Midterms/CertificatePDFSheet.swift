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
                    CertificateQuickLook(url: fileURL)
                        .ignoresSafeArea(edges: .bottom)
                } else if let failure {
                    VStack(spacing: 14) {
                        Image(systemName: "doc.badge.clock")
                            .font(.system(size: 30))
                            .foregroundStyle(Theme.warning)
                        Text(failure.message)
                            .font(.system(size: 15, weight: .semibold))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if failure.retryable {
                            Button("Try again") { attempt += 1 }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                    .padding(28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.large)
                        Text("Preparing…")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    if let fileURL {
                        ShareLink(item: fileURL) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel("Share")
                    }
                }
            }
        }
        .task(id: attempt) { await fetch() }
        .onDisappear { removeFile() }
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
        case .http(404, _)?, .decoding?:
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

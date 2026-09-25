import Foundation
import MetricKit
import MasterSATKit

/// Where the app's crashes and errors go: a queue on disk, then the school's own server.
///
/// **Crashes come from MetricKit.** The system writes a diagnostic when the app dies, hangs,
/// or is killed for abusing CPU or disk, and hands it over on the next launch — call stacks
/// included. It is Apple's own, so there is no SDK in the app and no account anywhere else;
/// the reports land in `/api/mobile/diagnostics/` beside everything else the school runs.
/// MetricKit delivers nothing in the simulator; the turning of its JSON into a report is
/// tested in the kit (`MetricDiagnostics`) instead.
///
/// **Non-fatal errors come from the API client.** A response the app cannot decode is the
/// sign that the backend has moved and this build has not. Each is reported once per launch.
final class DiagnosticsCenter: NSObject, @unchecked Sendable {
    private let store: DiagnosticsStore
    private let lock = NSLock()
    private var mobile: MobileAPI?
    private var uploading = false

    init(directory: URL = DiagnosticsCenter.defaultDirectory) {
        store = DiagnosticsStore(directory: directory)
        super.init()
    }

    static var defaultDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Diagnostics", isDirectory: true)
    }

    /// Start listening. Called once at launch, before anything can go wrong worth reporting.
    func start(mobile: MobileAPI) {
        lock.withLock { self.mobile = mobile }
        MXMetricManager.shared.add(self)
        // Diagnostics delivered while this process was not yet subscribed.
        let past = MXMetricManager.shared.pastDiagnosticPayloads
        if !past.isEmpty { ingest(past) }
        Task { await uploadPending() }
    }

    // MARK: - Intake

    /// An event from the API client. Only the ones that mean "this build is out of step with
    /// the server" become reports.
    func record(_ event: APIClientEvent) {
        let report: DiagnosticReport
        switch event {
        case .decodingFailed(let path, let detail):
            report = makeReport(
                signature: DiagnosticSignature.decoding(path: path),
                message: "Could not read the response from \(DiagnosticSignature.normalise(path)): \(detail)"
            )
        case .serverError(let status, let path):
            report = makeReport(
                signature: DiagnosticSignature.server(status: status, path: path),
                message: "The server answered \(status) to \(DiagnosticSignature.normalise(path))."
            )
        case .upgradeRequired:
            // Not a fault — the release policy doing its job.
            return
        }
        Task {
            if await store.enqueue(report) {
                await uploadPending()
            }
        }
    }

    private func makeReport(signature: String, message: String) -> DiagnosticReport {
        DiagnosticReport(
            kind: .error,
            appVersion: AppInfo.version,
            build: AppInfo.build,
            osVersion: AppInfo.osVersion,
            deviceModel: AppInfo.deviceModel,
            signature: signature,
            message: message
        )
    }

    private func ingest(_ payloads: [MXDiagnosticPayload]) {
        let environment = MetricDiagnostics.Environment(
            appVersion: AppInfo.version,
            build: AppInfo.build,
            osVersion: AppInfo.osVersion,
            deviceModel: AppInfo.deviceModel
        )
        var reports: [DiagnosticReport] = []
        for payload in payloads {
            let when = payload.timeStampEnd
            func add(_ diagnostics: [MXDiagnostic]?, as kind: DiagnosticReport.Kind) {
                for diagnostic in diagnostics ?? [] {
                    if let report = MetricDiagnostics.report(
                        kind: kind,
                        json: diagnostic.jsonRepresentation(),
                        occurredAt: when,
                        environment: environment
                    ) {
                        reports.append(report)
                    }
                }
            }
            add(payload.crashDiagnostics, as: .crash)
            add(payload.hangDiagnostics, as: .hang)
            add(payload.cpuExceptionDiagnostics, as: .cpu)
            add(payload.diskWriteExceptionDiagnostics, as: .disk)
        }
        guard !reports.isEmpty else { return }
        let collected = reports
        Task {
            for report in collected { await store.enqueue(report) }
            await uploadPending()
        }
    }

    // MARK: - Upload

    /// Drain the queue in batches. Stops at the first failure — offline, or the server down —
    /// and leaves the rest for the next launch or foreground.
    func uploadPending() async {
        // One drain at a time: a foreground, a reconnect and a fresh crash can all ask at once.
        let claimed: MobileAPI? = lock.withLock {
            guard !uploading, let mobile else { return nil }
            uploading = true
            return mobile
        }
        guard let mobile = claimed else { return }
        defer { lock.withLock { uploading = false } }

        // Bounded: the queue holds at most `queueCapacity`, so this is a ceiling, not a limit
        // anyone should reach.
        for _ in 0..<(DiagnosticsLimits.queueCapacity / DiagnosticsLimits.batchSize + 1) {
            let batch = await store.pending()
            guard !batch.isEmpty else { return }
            do {
                _ = try await mobile.uploadDiagnostics(installId: AppInfo.installId, reports: batch)
                // The server answered. Whatever it did not list it refused as malformed, and
                // a report that is malformed now is malformed for ever — keeping it would jam
                // the head of the queue. So the whole batch goes either way.
                await store.remove(ids: batch.map(\.id))
            } catch let error as APIError where !error.isRetryable {
                // A refusal the server will repeat word for word (a 4xx, an unreadable
                // answer). Same reasoning: drop, don't jam.
                await store.remove(ids: batch.map(\.id))
            } catch {
                // Offline, deploying, throttled: keep everything and try again later.
                return
            }
        }
    }

    /// Forget everything queued. On sign-out a phone may be changing hands.
    func clear() async {
        await store.removeAll()
    }
}

extension DiagnosticsCenter: MXMetricManagerSubscriber {
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        ingest(payloads)
    }
}

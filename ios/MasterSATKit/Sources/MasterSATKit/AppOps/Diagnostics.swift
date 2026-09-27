import Foundation

/// One thing that went wrong on a phone, written down so it can reach the school's server.
///
/// Crashes are the obvious case, but not the most useful one. The reports that pay for this
/// are the *non-fatal* ones — above all a response the app could not decode. That is how a
/// native app quietly falls behind its backend: a field is renamed, the web ships the same
/// day, and the phone shows an error nobody hears about. Here it becomes a report with the
/// endpoint in its signature, grouped with every other install that hit it.
public struct DiagnosticReport: Codable, Sendable, Equatable, Identifiable {
    public enum Kind: String, Codable, Sendable, CaseIterable {
        /// MetricKit: the process died. Symbolicate against the build's dSYM.
        case crash
        /// MetricKit: the main thread stopped answering long enough for a student to notice.
        case hang
        /// MetricKit: the system killed the app for CPU or disk abuse.
        case cpu
        case disk
        /// The app itself noticed something the student would see as broken — an
        /// undecodable response, an unexpected server error.
        case error
    }

    /// Client-made, so a retried upload is recognised and stored once.
    public let id: String
    public let kind: Kind
    public let occurredAt: Date
    public let appVersion: String
    public let build: String
    public let osVersion: String
    public let deviceModel: String
    /// What reports are grouped by. Short, stable, free of per-user data.
    public let signature: String
    /// One human line.
    public let message: String
    /// Raw JSON — for a crash, MetricKit's own document, call stacks and all.
    public let payloadJSON: Data?

    public init(
        id: String = UUID().uuidString,
        kind: Kind,
        occurredAt: Date = Date(),
        appVersion: String,
        build: String,
        osVersion: String,
        deviceModel: String,
        signature: String,
        message: String,
        payloadJSON: Data? = nil
    ) {
        self.id = id
        self.kind = kind
        self.occurredAt = occurredAt
        self.appVersion = appVersion
        self.build = build
        self.osVersion = osVersion
        self.deviceModel = deviceModel
        // Clipped here, once, so every path into the queue obeys the server's limits.
        self.signature = String(signature.prefix(DiagnosticsLimits.signatureLength))
        self.message = String(message.prefix(DiagnosticsLimits.messageLength))
        if let payloadJSON, payloadJSON.count <= DiagnosticsLimits.payloadBytes {
            self.payloadJSON = payloadJSON
        } else {
            // Too big to send whole. Dropped rather than cut: half a JSON document is not
            // JSON, and the signature and message still say what happened.
            self.payloadJSON = nil
        }
    }

    /// The upload's JSON object for this report.
    func wireObject() -> [String: Any] {
        var object: [String: Any] = [
            "id": id,
            "kind": kind.rawValue,
            "occurred_at": DiagnosticsFormat.timestamp.string(from: occurredAt),
            "app_version": appVersion,
            "build": build,
            "os_version": osVersion,
            "device_model": deviceModel,
            "signature": signature,
            "message": message,
        ]
        if let payloadJSON, let payload = try? JSONSerialization.jsonObject(with: payloadJSON) {
            object["payload"] = payload
        }
        return object
    }
}

/// Sizes the server enforces too. Kept equal on both sides so a report is never accepted
/// by the phone's queue and then refused at the door.
public enum DiagnosticsLimits {
    public static let signatureLength = 200
    public static let messageLength = 500
    public static let payloadBytes = 96 * 1024
    /// Reports per upload request.
    public static let batchSize = 10
    /// Reports waiting on the device. Beyond this the OLDEST go: a phone that has been
    /// offline for a month should not spend its first minute back online uploading a
    /// month of the same hang.
    public static let queueCapacity = 40
    /// Non-fatal reports per launch, and per signature per launch. A decode failure on a
    /// list that refreshes every time the tab appears would otherwise report itself fifty
    /// times in one sitting.
    public static let errorsPerLaunch = 12
    public static let errorsPerSignaturePerLaunch = 1
}

enum DiagnosticsFormat {
    nonisolated(unsafe) static let timestamp: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

/// The queue on disk.
///
/// One JSON file per report in a directory the caller chooses, so a crash between "write
/// the report" and "upload it" loses nothing — and the kit can test the whole thing against
/// a temporary directory with no device involved.
public actor DiagnosticsStore {
    private let directory: URL
    private let fileManager = FileManager.default
    private var errorsThisLaunch = 0
    private var signaturesThisLaunch: [String: Int] = [:]

    public init(directory: URL) {
        self.directory = directory
    }

    /// Keep a report. Returns false when the per-launch budget for non-fatal errors refused it.
    @discardableResult
    public func enqueue(_ report: DiagnosticReport) -> Bool {
        if report.kind == .error {
            let seen = signaturesThisLaunch[report.signature, default: 0]
            guard errorsThisLaunch < DiagnosticsLimits.errorsPerLaunch,
                  seen < DiagnosticsLimits.errorsPerSignaturePerLaunch else { return false }
            errorsThisLaunch += 1
            signaturesThisLaunch[report.signature] = seen + 1
        }
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(report)
            try data.write(to: fileURL(for: report.id), options: .atomic)
        } catch {
            return false
        }
        trimToCapacity()
        return true
    }

    /// Oldest first, so a backlog drains in the order it happened.
    public func pending(limit: Int = DiagnosticsLimits.batchSize) -> [DiagnosticReport] {
        Array(allReports().prefix(limit))
    }

    public func count() -> Int { reportFiles().count }

    public func remove(ids: [String]) {
        for id in ids { try? fileManager.removeItem(at: fileURL(for: id)) }
    }

    /// Everything, gone. Nothing personal is in a report, but a sign-out is also the moment
    /// a phone changes hands, and a queue is not worth the question.
    public func removeAll() {
        for url in reportFiles() { try? fileManager.removeItem(at: url) }
    }

    private func allReports() -> [DiagnosticReport] {
        let decoder = JSONDecoder()
        var reports: [DiagnosticReport] = []
        for url in reportFiles() {
            guard let data = try? Data(contentsOf: url),
                  let report = try? decoder.decode(DiagnosticReport.self, from: data) else {
                // A file that no longer decodes (an older app's format, a torn write) would
                // block the queue forever if it were skipped and kept. It goes.
                try? fileManager.removeItem(at: url)
                continue
            }
            reports.append(report)
        }
        return reports.sorted { $0.occurredAt == $1.occurredAt ? $0.id < $1.id : $0.occurredAt < $1.occurredAt }
    }

    private func trimToCapacity() {
        let reports = allReports()
        guard reports.count > DiagnosticsLimits.queueCapacity else { return }
        for report in reports.prefix(reports.count - DiagnosticsLimits.queueCapacity) {
            try? fileManager.removeItem(at: fileURL(for: report.id))
        }
    }

    private func reportFiles() -> [URL] {
        let urls = (try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return urls.filter { $0.pathExtension == "json" }
    }

    private func fileURL(for id: String) -> URL {
        // Ids are UUIDs we minted, but a path is built from them, so keep it to a safe set.
        let safe = id.filter { $0.isLetter || $0.isNumber || $0 == "-" }
        return directory.appendingPathComponent("\(safe).json")
    }
}

/// Short, stable grouping keys.
///
/// Stable is the point: two installs hitting the same broken endpoint must produce the SAME
/// signature, so ids, counts and query strings are stripped out of paths
/// (`/classes/12/assignments/340/` → `/classes/:id/assignments/:id/`).
public enum DiagnosticSignature {
    public static func decoding(path: String) -> String {
        "decoding \(normalise(path))"
    }

    public static func server(status: Int, path: String) -> String {
        "http \(status) \(normalise(path))"
    }

    public static func normalise(_ path: String) -> String {
        let bare = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? path
        let parts = bare.split(separator: "/", omittingEmptySubsequences: false).map { part -> String in
            if part.isEmpty { return "" }
            if part.allSatisfy(\.isNumber) { return ":id" }
            // UUIDs and long hex tokens are ids too.
            if part.count >= 16, part.allSatisfy({ $0.isHexDigit || $0 == "-" }) { return ":id" }
            return String(part)
        }
        return parts.joined(separator: "/")
    }
}

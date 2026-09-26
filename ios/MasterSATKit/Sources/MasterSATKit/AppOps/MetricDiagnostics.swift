import Foundation

/// Turns one MetricKit diagnostic — as the JSON it serialises itself to — into a report.
///
/// MetricKit hands the app its own crashes, hangs and resource kills on the next launch,
/// with call stacks. It is Apple's, it needs no third-party SDK and no account, and it keeps
/// working when the crash happened somewhere this app's own code never got a say. What it
/// does not do is group anything; that is this file's job.
///
/// The work is done on the JSON rather than on `MXDiagnostic` objects so it can be tested
/// here, without a device: MetricKit delivers nothing in the simulator.
public enum MetricDiagnostics {
    /// Our own executable's name in call stacks. A frame in it is worth more to a signature
    /// than any frame in UIKit, because it is the one a fix goes into.
    public static let ownBinaryName = "MasterSAT"

    public struct Environment: Sendable {
        public let appVersion: String
        public let build: String
        public let osVersion: String
        public let deviceModel: String

        public init(appVersion: String, build: String, osVersion: String, deviceModel: String) {
            self.appVersion = appVersion
            self.build = build
            self.osVersion = osVersion
            self.deviceModel = deviceModel
        }
    }

    /// `json` is `MXDiagnostic.jsonRepresentation()`. `nil` when it is not an object.
    public static func report(
        kind: DiagnosticReport.Kind,
        json: Data,
        occurredAt: Date,
        environment: Environment
    ) -> DiagnosticReport? {
        guard let object = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any] else { return nil }
        let meta = object["diagnosticMetaData"] as? [String: Any] ?? [:]

        // The build that crashed, which is not necessarily the build now running: an update
        // installed between the crash and this launch delivers the old build's diagnostics.
        let version = (meta["appVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? environment.appVersion
        let build = (meta["appBuildVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? environment.build
        let os = (meta["osVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? environment.osVersion
        let device = (meta["deviceType"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? environment.deviceModel

        let cause = causeLabel(kind: kind, meta: meta)
        let frame = topFrame(in: object["callStackTree"] as? [String: Any])
        let signature = [kind.rawValue, cause, frame].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")

        return DiagnosticReport(
            kind: kind,
            occurredAt: occurredAt,
            appVersion: version,
            build: build,
            osVersion: os,
            deviceModel: device,
            signature: signature,
            message: message(kind: kind, meta: meta, cause: cause),
            payloadJSON: json
        )
    }

    // MARK: - What happened

    static func causeLabel(kind: DiagnosticReport.Kind, meta: [String: Any]) -> String? {
        switch kind {
        case .crash:
            if let reason = meta["objectiveCexceptionReason"] as? [String: Any],
               let name = reason["exceptionName"] as? String ?? reason["className"] as? String {
                return name
            }
            let exception = (meta["exceptionType"] as? NSNumber).map { machException($0.intValue) }
            let signal = (meta["signal"] as? NSNumber).map { signalName($0.intValue) }
            let parts = [exception, signal].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: "/")
        case .hang:
            if let duration = meta["hangDuration"] as? String { return "hang \(duration)" }
            return "hang"
        case .cpu:
            return "cpu"
        case .disk:
            return "disk writes"
        case .error:
            return nil
        }
    }

    static func message(kind: DiagnosticReport.Kind, meta: [String: Any], cause: String?) -> String {
        switch kind {
        case .crash:
            if let reason = meta["objectiveCexceptionReason"] as? [String: Any],
               let composed = reason["composedMessage"] as? String, !composed.isEmpty {
                return composed
            }
            if let termination = meta["terminationReason"] as? String, !termination.isEmpty {
                return termination
            }
            return "The app closed unexpectedly (\(cause ?? "unknown cause"))."
        case .hang:
            return "The app stopped responding (\(cause ?? "hang"))."
        case .cpu:
            return "The system stopped the app for using too much CPU."
        case .disk:
            return "The system flagged the app for writing too much to disk."
        case .error:
            return cause ?? "Error"
        }
    }

    /// The frame a person would look at first: the crashing thread's first frame in our own
    /// binary, else its top frame. Written as `binary+offset`, which is what `atos` wants.
    static func topFrame(in tree: [String: Any]?) -> String? {
        guard let stacks = tree?["callStacks"] as? [[String: Any]], !stacks.isEmpty else { return nil }
        let attributed = stacks.first { ($0["threadAttributed"] as? Bool) == true } ?? stacks[0]
        guard let roots = attributed["callStackRootFrames"] as? [[String: Any]], let root = roots.first else { return nil }

        // Root first, then down through the callers, stopping at the first frame of ours.
        var frame: [String: Any]? = root
        var depth = 0
        while let current = frame, depth < 64 {
            if (current["binaryName"] as? String) == ownBinaryName { return label(current) }
            frame = (current["subFrames"] as? [[String: Any]])?.first
            depth += 1
        }
        return label(root)
    }

    private static func label(_ frame: [String: Any]) -> String? {
        guard let binary = frame["binaryName"] as? String else { return nil }
        if let offset = frame["offsetIntoBinaryTextSegment"] as? NSNumber {
            return "\(binary)+\(offset.intValue)"
        }
        return binary
    }

    static func machException(_ code: Int) -> String {
        switch code {
        case 1: return "EXC_BAD_ACCESS"
        case 2: return "EXC_BAD_INSTRUCTION"
        case 3: return "EXC_ARITHMETIC"
        case 5: return "EXC_SOFTWARE"
        case 6: return "EXC_BREAKPOINT"
        case 10: return "EXC_CRASH"
        case 11: return "EXC_RESOURCE"
        case 12: return "EXC_GUARD"
        default: return "EXC_\(code)"
        }
    }

    static func signalName(_ signal: Int) -> String {
        switch signal {
        case 4: return "SIGILL"
        case 5: return "SIGTRAP"
        case 6: return "SIGABRT"
        case 8: return "SIGFPE"
        case 9: return "SIGKILL"
        case 10: return "SIGBUS"
        case 11: return "SIGSEGV"
        default: return "SIG\(signal)"
        }
    }
}

import Foundation
import UIKit

/// What this build is and what it is running on — for the API header, the update check and
/// crash reports. Nothing here identifies the student or the phone as a thing: the model
/// ("iPhone17,1") and the OS version are the whole of it.
enum AppInfo {
    static var version: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0.0"
    }

    static var build: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "0"
    }

    static var osVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "iOS \(v.majorVersion).\(v.minorVersion)"
    }

    /// The machine identifier ("iPhone17,1"), not the marketing name: it is exact, and it is
    /// what crash tooling groups by. The simulator reports the model it is pretending to be.
    static let deviceModel: String = {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated
        }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()

    /// `X-MasterSAT-Client`. The server reads `ios/<version>` from the front of it (the rest is
    /// for a person reading a log), so the version must stay first and unadorned.
    static var clientIdentifier: String {
        "ios/\(version) (\(build); \(osVersion); \(deviceModel))"
    }

    /// A random id for this installation, made once. It lets the crash console tell one phone
    /// crashing forty times from forty phones crashing once — and nothing else. It is not the
    /// vendor id and it does not survive a reinstall, on purpose.
    static var installId: String {
        let key = "diagnostics.installId"
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty { return existing }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
    }
}

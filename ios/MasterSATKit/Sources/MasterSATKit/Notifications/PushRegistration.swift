import Foundation

// The rules behind registering this phone for push. The UIKit half — asking iOS for a token,
// receiving it — lives in the app (`PushRegistrar`); what to send, when to send it again and
// which APNs host a build belongs to are rules, and they are tested here.

/// APNs device tokens, in the form the server stores them.
public enum DeviceToken {
    /// Lower-case hex, two digits per byte. iOS hands the token over as raw bytes; the server
    /// accepts `[0-9a-f]{32,200}` and nothing else.
    public static func hex(_ data: Data) -> String {
        let digits = Array("0123456789abcdef".utf8)
        var out = [UInt8]()
        out.reserveCapacity(data.count * 2)
        for byte in data {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }
}

/// What this phone last told the server, so an unchanged registration is not re-sent on every
/// launch. Stored on the device; wiped on sign-out.
public struct PushRegistrationRecord: Codable, Sendable, Equatable {
    public let token: String
    public let userId: Int
    public let environment: APNsEnvironment
    public let sentAt: Date

    public init(token: String, userId: Int, environment: APNsEnvironment, sentAt: Date) {
        self.token = token.lowercased()
        self.userId = userId
        self.environment = environment
        self.sentAt = sentAt
    }
}

public enum PushRegistrationPlan {
    /// Re-sent this often even when nothing changed. Re-registering clears a failure the server
    /// may have recorded against the token and refreshes its `last_seen_at`, so a row the
    /// server gave up on heals within a week rather than never.
    public static let refreshInterval: TimeInterval = 7 * 24 * 3600

    /// Whether the server needs to hear about this token now.
    ///
    /// Yes when nothing was ever sent, when the token changed (iOS rotates them), when a
    /// different student is signed in (the server moves the row to them — a phone handed to a
    /// sibling must stop buzzing for the first one), when the build's APNs host changed, and
    /// once the last send is a week old.
    public static func needsUpload(
        token: String,
        userId: Int,
        environment: APNsEnvironment,
        lastSent: PushRegistrationRecord?,
        now: Date = Date()
    ) -> Bool {
        guard let lastSent else { return true }
        if lastSent.token != token.lowercased() { return true }
        if lastSent.userId != userId { return true }
        if lastSent.environment != environment { return true }
        // A send "in the future" means the clock was moved; sending again is the safe answer.
        if lastSent.sentAt > now { return true }
        return now.timeIntervalSince(lastSent.sentAt) >= refreshInterval
    }
}

/// What a signed build's embedded provisioning profile says about push.
///
/// The APNs host a token belongs to is decided by how the build was SIGNED, not by whether it
/// was compiled for debugging: a Release build installed from Xcode still carries a
/// development profile and gets sandbox tokens, and an App Store build carries no profile at
/// all. So the profile is read rather than `#if DEBUG` guessed.
public enum ProvisioningProfile {
    /// The `aps-environment` entitlement in the raw bytes of `embedded.mobileprovision`.
    ///
    /// The file is a CMS (PKCS #7) envelope around an XML plist. The envelope is not parsed —
    /// the plist is cut out from between `<?xml` and `</plist>`. Nil when there is no readable
    /// plist, or it grants no push entitlement.
    public static func apnsEnvironment(fromProfile data: Data) -> APNsEnvironment? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.upperBound..<data.endIndex)
        else { return nil }
        let plistData = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let plist = (try? PropertyListSerialization.propertyList(from: plistData, format: nil)) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any],
              let value = entitlements["aps-environment"] as? String
        else { return nil }
        switch value.lowercased() {
        case "development": return .sandbox
        case "production": return .production
        default: return nil
        }
    }

    /// The APNs host this install's token belongs to.
    ///
    /// - The simulator is always sandbox.
    /// - No profile means the App Store (or TestFlight) stripped it: production.
    /// - Otherwise what the profile grants; production when it grants nothing readable (such
    ///   a build cannot receive push anyway, and the server retries the other host once).
    public static func apnsEnvironment(profileData: Data?, isSimulator: Bool) -> APNsEnvironment {
        if isSimulator { return .sandbox }
        guard let profileData else { return .production }
        return apnsEnvironment(fromProfile: profileData) ?? .production
    }
}

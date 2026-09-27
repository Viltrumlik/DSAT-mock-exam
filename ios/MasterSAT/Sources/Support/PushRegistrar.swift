import Foundation
import Observation
import UIKit
import UserNotifications
import MasterSATKit

/// This phone's registration for push (APNs).
///
/// The server writes every notification once and delivers it to the bell and, for the ones
/// that matter, to a phone. For the phone half it needs this install's device token, tied to
/// whoever is signed in. That is all this does: get the token from iOS, send it when the server
/// does not have it (`PushRegistrationPlan`), and take it back on sign-out.
///
/// **Only builds signed for push register.** A free Personal Team cannot sign the
/// `aps-environment` entitlement, so the build says whether it was (`MasterSATPushEnabled` in
/// Info.plist, from the `MASTERSAT_PUSH` build setting). With it off nothing here asks iOS for
/// anything, and local reminders — which need no server — carry on exactly as before.
///
/// Registration failing is expected on such a build and is silent: the bell and the local
/// reminders do not depend on it.
@MainActor
@Observable
final class PushRegistrar {
    static let shared = PushRegistrar()

    enum Status: Equatable {
        /// This build is not signed for push. Nothing is asked of iOS.
        case notInThisBuild
        /// Nobody signed in yet, or notifications are not allowed on this phone.
        case idle
        /// iOS has been asked for this install's token.
        case waitingForToken
        /// The server has this phone for the signed-in student.
        case registered
        /// iOS refused a token, or the server could not be told. Tried again on the next
        /// activation (the bell activates every time it appears).
        case unavailable
    }

    private(set) var status: Status

    /// Whether this build may register at all.
    static var isEnabledInThisBuild: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "MasterSATPushEnabled") as? String) == "YES"
    }

    /// The APNs host this install's token belongs to — read from how the build was SIGNED, not
    /// from how it was compiled. See `ProvisioningProfile`.
    static let environment: APNsEnvironment = {
        #if targetEnvironment(simulator)
        let isSimulator = true
        #else
        let isSimulator = false
        #endif
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
            .flatMap { try? Data(contentsOf: $0) }
        return ProvisioningProfile.apnsEnvironment(profileData: profile, isSimulator: isSimulator)
    }()

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var client: APIClient?
    @ObservationIgnored private var userId: Int?
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var uploading = false

    private enum Key {
        static let lastSent = "push.apns.lastSent"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        status = Self.isEnabledInThisBuild ? .idle : .notInThisBuild
    }

    // MARK: - Registering

    /// A signed-in student is on screen. Safe to call as often as a view appears: it asks iOS
    /// for the token (which iOS expects on every launch — tokens change) and sends it only when
    /// the server does not already have it for this student.
    func activate(client: APIClient, userId: Int) async {
        self.client = client
        self.userId = userId
        await registerIfAllowed()
    }

    /// Notification permission may just have been granted.
    func permissionChanged() async {
        await registerIfAllowed()
    }

    private func registerIfAllowed() async {
        guard Self.isEnabledInThisBuild else {
            status = .notInThisBuild
            return
        }
        guard client != nil, userId != nil else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            break
        default:
            // A token for a phone that will not show the banner is a promise nobody keeps.
            status = .idle
            return
        }
        if token == nil { status = .waitingForToken }
        UIApplication.shared.registerForRemoteNotifications()
        // A token already received this launch can go now; a new one arrives via AppDelegate.
        await uploadIfNeeded()
    }

    /// iOS's answer, via `AppDelegate`.
    func didRegister(deviceToken: Data) {
        token = DeviceToken.hex(deviceToken)
        Task { await uploadIfNeeded() }
    }

    /// iOS's refusal, via `AppDelegate`. Expected on a build without the push entitlement.
    func didFailToRegister(_ error: Error) {
        status = .unavailable
    }

    /// Send the token when the server needs it. One upload at a time; the loop re-checks after
    /// each send, so a student switch that lands mid-upload is caught rather than lost.
    private func uploadIfNeeded() async {
        guard !uploading else { return }
        uploading = true
        defer { uploading = false }

        while let client, let userId, let token {
            let environment = Self.environment
            guard PushRegistrationPlan.needsUpload(
                token: token,
                userId: userId,
                environment: environment,
                lastSent: lastSent
            ) else {
                status = .registered
                return
            }
            do {
                try await NotificationsAPI(client: client).registerAPNs(
                    token: token,
                    environment: environment,
                    bundleId: Bundle.main.bundleIdentifier ?? "",
                    appVersion: AppInfo.version
                )
            } catch {
                // Offline, or the server refused. Nothing is recorded, so the next activation
                // tries again.
                status = .unavailable
                return
            }
            // Signed out, or somebody else signed in, while that was on the wire: record
            // nothing for a registration that no longer describes this phone, and look again.
            guard self.userId == userId, self.token == token else { continue }
            lastSent = PushRegistrationRecord(token: token, userId: userId, environment: environment, sentAt: Date())
            status = .registered
        }
    }

    // MARK: - Signing out

    /// Stop this phone buzzing for the student who is leaving.
    ///
    /// **Call it before the tokens are cleared** — afterwards the request cannot be
    /// authenticated. Pass the session's client: the one from the last activation is used when
    /// none is given, and there may not have been one this launch.
    ///
    /// Bounded to a few seconds, so an offline sign-out is not held up. If the server could not
    /// be told, this install stops receiving remote notifications altogether until the next
    /// student signs in and registers again: a phone must never keep buzzing with somebody
    /// else's grades.
    func unregister(using client: APIClient? = nil) async {
        let client = client ?? self.client
        let record = lastSent
        // Forgotten first, so nothing re-registers the leaving student while the request is out.
        self.client = nil
        self.userId = nil
        lastSent = nil
        status = Self.isEnabledInThisBuild ? .idle : .notInThisBuild

        // Nothing was ever sent from this install, so the server has nothing to forget.
        guard let record else { return }

        var told = false
        if let client {
            let api = NotificationsAPI(client: client)
            let token = record.token
            told = await Self.withinSeconds(4) {
                (try? await api.unregisterAPNs(token: token)) != nil
            } ?? false
        }
        if !told, Self.isEnabledInThisBuild {
            UIApplication.shared.unregisterForRemoteNotifications()
            // iOS may issue a different token on the next registration; wait for it.
            token = nil
        }
    }

    // MARK: - Storage

    /// What was last sent, kept across launches so an unchanged token is not re-sent on each.
    private var lastSent: PushRegistrationRecord? {
        get {
            guard let data = defaults.data(forKey: Key.lastSent) else { return nil }
            return try? JSONDecoder().decode(PushRegistrationRecord.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: Key.lastSent)
            } else {
                defaults.removeObject(forKey: Key.lastSent)
            }
        }
    }

    /// The operation's answer, or nil if it took longer than `seconds` (it is then cancelled).
    private static func withinSeconds(
        _ seconds: Double,
        _ operation: @escaping @Sendable () async -> Bool
    ) async -> Bool? {
        await withTaskGroup(of: Bool?.self) { group in
            group.addTask { await operation() }
            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}

/// UIKit's half of notifications. SwiftUI has no way to receive a device token, so this class
/// exists for three callbacks. Wired in `MasterSATApp` with one line:
///
/// ```swift
/// @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
/// ```
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Before launch finishes, or the tap that launched the app is never delivered.
        UNUserNotificationCenter.current().delegate = NotificationCenterDelegate.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistrar.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistrar.shared.didFailToRegister(error)
    }
}

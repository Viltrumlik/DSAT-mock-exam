import Foundation
import Observation
import UserNotifications
import MasterSATKit

/// Where a tapped notification wants to take the student.
///
/// A notification can be tapped while the app is closed, in the background, or open on any
/// screen, and the object that hears about it — the notification centre's delegate — knows
/// nothing about navigation. So the tap is parked here as a destination, and whoever owns
/// navigation takes it:
///
/// ```swift
/// .onChange(of: NotificationRouter.shared.pendingLink) { _, link in
///     if link != nil, let next = NotificationRouter.shared.consume() { route(next) }
/// }
/// .onAppear { if let next = NotificationRouter.shared.consume() { route(next) } }  // cold launch
/// ```
///
/// Local reminders and pushes arrive the same way: both carry `link` in their `userInfo`, as a
/// site path, read by `AppLink`.
@MainActor
@Observable
final class NotificationRouter {
    static let shared = NotificationRouter()

    /// The destination waiting to be opened, or nil once it has been taken.
    private(set) var pendingLink: AppLink?

    /// Bumped each time a push arrives while the app is open, so the bell refetches at once
    /// instead of at its next poll. The value means nothing; the change does.
    private(set) var arrivals = 0

    func open(_ link: AppLink) {
        pendingLink = link
    }

    /// A notification's `link` as it arrived — a site path, a site URL or `mastersat://`.
    func open(linkURL: String) {
        pendingLink = AppLink.parse(linkURL)
    }

    /// Take the waiting destination, clearing it, so it is opened exactly once.
    @discardableResult
    func consume() -> AppLink? {
        defer { pendingLink = nil }
        return pendingLink
    }

    func noteArrival() {
        arrivals &+= 1
    }

    /// Sign-out: a destination from the last student's notification must not open for the next.
    func clear() {
        pendingLink = nil
    }
}

/// The app's one `UNUserNotificationCenterDelegate`, for local reminders and pushes alike.
///
/// Shared rather than owned by a screen or by `Session`, because iOS delivers the tap that
/// LAUNCHED the app only to a delegate set before launch finishes. `AppDelegate` sets it in
/// `didFinishLaunching`; `NotificationService` sets the same object again, which is harmless.
final class NotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate, Sendable {
    static let shared = NotificationCenterDelegate()

    /// Shows a notification that arrives while the app is open.
    ///
    /// Without this iOS drops foreground notifications entirely, and the "your score is ready"
    /// reminder — which fires a second after the app itself spots the score — would never once
    /// be seen.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        if notification.request.trigger is UNPushNotificationTrigger {
            await MainActor.run { NotificationRouter.shared.noteArrival() }
        }
        return [.banner, .sound, .badge]
    }

    /// The student tapped a notification: park where it leads.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        let link = Self.link(in: response.notification.request.content.userInfo)
        await MainActor.run { NotificationRouter.shared.open(linkURL: link) }
    }

    /// `link` from a notification's payload: top-level in an APNs payload (beside `aps`), and
    /// set by `NotificationService` on a local reminder. Missing means "open the app".
    static func link(in userInfo: [AnyHashable: Any]) -> String {
        (userInfo["link"] as? String) ?? ""
    }
}

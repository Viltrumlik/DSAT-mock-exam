import Foundation
import SwiftUI
import UserNotifications
import MasterSATKit

/// Reminders on the device.
///
/// **These are local notifications, not push.** There is no push transport on this platform
/// — the backend has no device-token store and no APNs sender — so nothing here depends on
/// the server reaching the phone. The app schedules against dates it already fetched: a
/// homework's due date, a midterm's opening time. That covers the two things worth being
/// interrupted for, works offline, and costs no infrastructure.
///
/// What it cannot do is tell a student something they could not have known when the app was
/// last open. A published score is the case in point: `announceResults` fires the moment the
/// app next runs and notices, which is honest but not instant. Real push is the fix, and it
/// is a server project before it is a client one.
@MainActor
@Observable
final class NotificationService {
    enum Permission: Equatable {
        /// Not asked yet — the soft prompt is worth showing.
        case notAsked
        case granted
        /// Refused. iOS will not ask twice; the only route back is Settings.
        case denied
        /// Before the first check.
        case unknown
    }

    private(set) var permission: Permission = .unknown
    /// How many reminders are actually waiting on the device. Shown in Profile, because
    /// "notifications are on" and "something is scheduled" are different facts.
    private(set) var pendingCount = 0

    private let centre = UNUserNotificationCenter.current()
    private let defaults: UserDefaults
    private let presenter = ForegroundPresenter()

    private enum Key {
        static let kinds = "notifications.enabledKinds"
        static let announced = "notifications.announcedResults"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Set before anything can arrive: without a delegate, a notification that fires
        // while the app is open is swallowed, and the "your score is ready" one always does.
        centre.delegate = presenter
    }

    // MARK: - Which reminders the student wants

    var enabledKinds: Set<StudentReminder.Kind> {
        get {
            guard let raw = defaults.array(forKey: Key.kinds) as? [String] else {
                // Default to all of them. A student who installs a homework app and gets no
                // homework reminders has to discover a setting to fix something that was
                // never broken for them.
                return Set(StudentReminder.Kind.allCases)
            }
            return Set(raw.compactMap(StudentReminder.Kind.init(rawValue:)))
        }
        set {
            defaults.set(newValue.map(\.rawValue).sorted(), forKey: Key.kinds)
        }
    }

    func setKind(_ kind: StudentReminder.Kind, enabled: Bool) {
        var kinds = enabledKinds
        if enabled { kinds.insert(kind) } else { kinds.remove(kind) }
        enabledKinds = kinds
    }

    // MARK: - Permission

    func refreshPermission() async {
        let settings = await centre.notificationSettings()
        permission = switch settings.authorizationStatus {
        case .notDetermined: .notAsked
        case .denied: .denied
        case .authorized, .provisional, .ephemeral: .granted
        @unknown default: .unknown
        }
        pendingCount = await centre.pendingNotificationRequests().count
    }

    /// Ask iOS. Only ever call this from a deliberate tap — the system asks once per install
    /// and a refusal is permanent, so a cold prompt at launch spends the single chance on a
    /// student who has no idea yet what they are agreeing to.
    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await centre.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshPermission()
        return granted
    }

    // MARK: - Scheduling

    /// Rebuild the whole schedule from what the student currently has.
    ///
    /// Everything pending is cleared first. That is not laziness: a homework handed in, a
    /// due date moved, a midterm cancelled all have to *remove* a reminder, and there is no
    /// signal for "this one no longer applies" other than its absence from the new plan.
    func reschedule(assignments: [AssignmentListing], midterms: [MidtermListing]) async {
        await refreshPermission()
        guard permission == .granted else { return }

        let plan = ReminderPlan.build(
            assignments: assignments,
            midterms: midterms,
            enabled: enabledKinds
        )

        centre.removeAllPendingNotificationRequests()
        for reminder in plan {
            let interval = reminder.fireAt.timeIntervalSinceNow
            guard interval > 0 else { continue }
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            try? await centre.add(request(for: reminder, trigger: trigger))
        }
        pendingCount = await centre.pendingNotificationRequests().count
    }

    /// Say once that a score has been published, then remember having said it.
    ///
    /// The record is kept per attempt, so republishing the same result stays quiet while a
    /// genuinely new paper still speaks up.
    func announceResults(midterms: [MidtermListing]) async {
        guard enabledKinds.contains(.results) else { return }
        await refreshPermission()
        guard permission == .granted else { return }

        var announced = Set(defaults.array(forKey: Key.announced) as? [Int] ?? [])
        let fresh = ReminderPlan.newlyPublished(midterms: midterms, announced: announced)
        guard !fresh.isEmpty else { return }

        for reminder in fresh {
            // A one-second delay rather than no trigger at all: a nil trigger delivers
            // immediately, which on a foregrounded app races the screen the student is
            // already looking at.
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            try? await centre.add(request(for: reminder, trigger: trigger))
            if let attemptId = Int(reminder.id.dropFirst("results-".count)) {
                announced.insert(attemptId)
            }
        }
        defaults.set(Array(announced).sorted(), forKey: Key.announced)
    }

    /// Wipe the schedule and the record of what has been announced. Called on sign-out —
    /// the next person to use this phone must not be told about someone else's midterm.
    func clearEverything() {
        centre.removeAllPendingNotificationRequests()
        centre.removeAllDeliveredNotifications()
        defaults.removeObject(forKey: Key.announced)
        pendingCount = 0
    }

    private func request(for reminder: StudentReminder, trigger: UNNotificationTrigger) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default
        content.userInfo = ["kind": reminder.kind.rawValue]
        return UNNotificationRequest(identifier: reminder.id, content: content, trigger: trigger)
    }
}

/// Shows a notification that arrives while the app is open.
///
/// Without this iOS drops foreground notifications entirely, and the "your score is ready"
/// reminder — which fires a second after the app itself spots the score — would never once
/// be seen.
private final class ForegroundPresenter: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

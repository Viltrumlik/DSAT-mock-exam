import Foundation
import SwiftUI
import UserNotifications
import MasterSATKit

/// Reminders on the device, and the bell's count.
///
/// **The reminders are local notifications, not push.** They are scheduled against dates the
/// app already fetched — a homework's due date, a midterm's opening time — so they work
/// offline and on a build that cannot receive push at all.
///
/// Push is separate (`PushRegistrar`): the server's own notifications — a grade, new homework
/// — reach a phone signed for it. Both kinds are tapped through the same delegate
/// (`NotificationCenterDelegate`) and routed by the same `link` (`NotificationRouter`).
///
/// This object also holds the unread count of the server inbox, because it is app-wide state
/// tied to the signed-in student: the bell, the inbox and the app icon's badge all read it, and
/// signing out has to wipe it along with the reminders.
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

    /// Unread in the server inbox — the bell's number. Written by every summary, list and
    /// mark-read answer (`applyUnread`), so the bell, the inbox and the app icon never disagree.
    private(set) var unreadTotal = 0
    /// Unread per section; a missing key means none.
    private(set) var unreadByCategory: [String: Int] = [:]

    private let centre = UNUserNotificationCenter.current()
    private let defaults: UserDefaults

    private enum Key {
        static let kinds = "notifications.enabledKinds"
        static let announced = "notifications.announcedResults"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Set before anything can arrive: without a delegate, a notification that fires
        // while the app is open is swallowed, and the "your score is ready" one always does.
        // The same shared object `AppDelegate` sets at launch — see `NotificationCenterDelegate`.
        centre.delegate = NotificationCenterDelegate.shared
    }

    // MARK: - The bell's count

    /// Take the server's counts as the truth, and put the total on the app icon.
    func applyUnread(_ summary: NotificationSummary) {
        unreadTotal = summary.total
        unreadByCategory = summary.byCategory
        setAppBadge(summary.total)
    }

    /// One row was just read here. Counted down at once so the dot and the badge move with the
    /// tap; the server's answer to the mark-read call then corrects it either way.
    func noteRead(category: String) {
        let code = category.uppercased()
        if let count = unreadByCategory[code] {
            unreadByCategory[code] = count > 1 ? count - 1 : nil
        }
        unreadTotal = max(0, unreadTotal - 1)
        setAppBadge(unreadTotal)
    }

    /// The app icon's badge is the inbox's unread total — the same number the server puts in
    /// each push. iOS refuses it without badge permission, which is fine: then there is no badge.
    private func setAppBadge(_ count: Int) {
        let centre = self.centre
        Task { try? await centre.setBadgeCount(max(0, count)) }
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
        let before = permission
        permission = switch settings.authorizationStatus {
        case .notDetermined: .notAsked
        case .denied: .denied
        case .authorized, .provisional, .ephemeral: .granted
        @unknown default: .unknown
        }
        pendingCount = await centre.pendingNotificationRequests().count
        // Turned on — here, or in Settings while the app was away. Push can register now.
        if permission == .granted, before != .granted {
            await PushRegistrar.shared.permissionChanged()
        }
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

    /// Wipe the schedule, the record of what has been announced, the bell's count and the
    /// badge. Called on sign-out — the next person to use this phone must not be told about
    /// someone else's midterm, or see their unread count on the icon.
    func clearEverything() {
        centre.removeAllPendingNotificationRequests()
        centre.removeAllDeliveredNotifications()
        defaults.removeObject(forKey: Key.announced)
        pendingCount = 0
        unreadTotal = 0
        unreadByCategory = [:]
        setAppBadge(0)
        NotificationRouter.shared.clear()
    }

    private func request(for reminder: StudentReminder, trigger: UNNotificationTrigger) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default
        // `link` is the key a push carries too, so a tap on either is routed the same way.
        content.userInfo = ["kind": reminder.kind.rawValue, "link": reminder.link]
        return UNNotificationRequest(identifier: reminder.id, content: content, trigger: trigger)
    }
}

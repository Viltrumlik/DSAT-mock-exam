import Foundation

/// When a notification arrived, in the bell's own words.
///
/// A port of `ago()` in the web's `NotificationPanel.tsx`, rounding included: "just now",
/// "12m ago", "3h ago", then a short date ("Sep 3"). It deliberately does not say
/// "yesterday" or "3 days ago" the way other lists in the app do — the bell reads the same
/// on the phone as in the browser.
public enum NotificationTime {
    public static func ago(
        _ iso: String,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> String {
        guard let then = JSONCoding.parseServerDate(iso) else { return "" }
        // `Math.round` on the web; `.rounded()` rounds halves the same way for positive values,
        // and anything at or below zero (a phone clock running behind) is "just now" in both.
        let minutes = Int((now.timeIntervalSince(then) / 60).rounded())
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = Int((Double(minutes) / 60).rounded())
        if hours < 24 { return "\(hours)h ago" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: then)
    }
}

/// The bell's red count.
public enum NotificationBadge {
    /// Nothing at zero, the number up to nine, then "9+" — the web's rule. A badge is a nudge
    /// to look, not a tally; past nine the exact figure is noise.
    public static func text(for count: Int) -> String? {
        guard count > 0 else { return nil }
        return count > 9 ? "9+" : String(count)
    }

    /// What VoiceOver reads for the bell — the web's `aria-label`, word for word.
    public static func accessibilityLabel(for count: Int) -> String {
        count > 0 ? "Notifications, \(count) unread" : "Notifications"
    }
}

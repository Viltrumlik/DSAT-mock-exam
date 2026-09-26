import SwiftUI
import UIKit

/// A face and a sentence for each inbox section — the web's `LOOK` and `HINTS` maps in
/// `NotificationPreferencesCard.tsx`, with the site's icons redrawn as SF Symbols.
///
/// The sections themselves are served by the server, so this only decorates them: a section
/// the platform adds later still gets a chip and a switch, with the bell and no hint.
enum NotificationCategoryLook {
    static func icon(for category: String) -> String {
        switch category.uppercased() {
        case "GRADES": return "rosette"
        case "HOMEWORK": return "checklist"
        case "EXAMS": return "doc.text"
        case "CLASSROOM": return "person.2"
        case "SUPPORT": return "lifepreserver"
        case "REWARDS": return "circle.circle"
        case "EVENTS": return "calendar"
        case "SYSTEM": return "megaphone"
        default: return "bell"
        }
    }

    static func tone(for category: String) -> Color {
        switch category.uppercased() {
        case "GRADES", "SUPPORT": return Theme.success
        case "HOMEWORK", "REWARDS": return Theme.warning
        case "CLASSROOM": return Theme.info
        case "SYSTEM": return systemViolet
        default: return Theme.accent
        }
    }

    /// Why a student might want the section — copy the server does not own. Word for word from
    /// the web, so a switch reads the same on the phone as in the browser.
    static func hint(for category: String) -> String? {
        switch category.uppercased() {
        case "GRADES": return "When your work has been marked, and when results are ready."
        case "HOMEWORK": return "New assignments, and a nudge while there's still time to finish."
        case "EXAMS": return "Midterms and mocks that have been scheduled for you."
        case "CLASSROOM": return "Announcements from your class, and replies to your comments."
        case "SUPPORT": return "Support sessions you've booked, changed or been reminded about."
        case "REWARDS": return "Points you've earned and shop orders ready to collect."
        case "EVENTS": return "New events at the learning center, and reminders for ones you've signed up for."
        case "SYSTEM": return "Occasional messages from the learning center itself."
        default: return nil
        }
    }

    /// The web's `--chart-6` (`#7c3aed`, `#a78bfa` in dark), which the System section wears
    /// there. Kept here rather than in `Theme`: nothing else in the app uses it.
    private static let systemViolet = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0xa7 / 255, green: 0x8b / 255, blue: 0xfa / 255, alpha: 1)
            : UIColor(red: 0x7c / 255, green: 0x3a / 255, blue: 0xed / 255, alpha: 1)
    })
}

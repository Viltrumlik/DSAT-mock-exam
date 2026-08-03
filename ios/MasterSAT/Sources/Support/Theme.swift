import SwiftUI

/// The platform's visual tokens, matched to the web app so a student moving between
/// phone and laptop sees one product.
enum Theme {
    /// Brand blue — the same #2a68c0 the email and web shells use.
    static let accent = Color(red: 0x2a / 255, green: 0x68 / 255, blue: 0xc0 / 255)

    /// Bluebook's exam chrome is deliberately plain: nothing on an exam screen should
    /// compete with the question.
    static let examBackground = Color(.systemBackground)
    static let examChrome = Color(.secondarySystemBackground)

    static let flagged = Color(red: 0.85, green: 0.25, blue: 0.25)

    /// Under five minutes the timer turns urgent. Matching the web runner matters: a
    /// student trained on one should not have to re-learn the other mid-exam.
    static let timerUrgent = Color(red: 0.78, green: 0.16, blue: 0.16)
    static let timerUrgentThreshold: TimeInterval = 5 * 60
}

extension View {
    /// Card styling shared by the dashboard and list rows.
    func cardStyle() -> some View {
        self
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Status wording shown to students.
///
/// Nothing here reads as a punishment. A student who has not started something is "Not
/// started", never "Missing" or "Failed" — the app names the state, and never the student.
enum StatusLabel {
    static func homework(_ workflowStatus: String?) -> String {
        switch (workflowStatus ?? "").lowercased() {
        case "graded", "reviewed": return "Reviewed"
        case "submitted": return "Submitted"
        case "returned": return "Ready to revise"
        case "in_progress": return "In progress"
        default: return "Not started"
        }
    }

    static func color(_ workflowStatus: String?) -> Color {
        switch (workflowStatus ?? "").lowercased() {
        case "graded", "reviewed": return .green
        case "submitted": return Theme.accent
        case "returned": return .orange
        default: return .secondary
        }
    }
}

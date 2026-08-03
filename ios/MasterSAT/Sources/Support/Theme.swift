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
            // Cards must claim the full width. A `ScrollView` sizes itself to its content,
            // so cards that only take the width of their own text drag the whole
            // navigation area in with them — which is how the dashboard ended up in a
            // narrow centre column with its title clipped to a single letter.
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// SAT scores, written the way a score is written.
///
/// `Text("\(score)")` interpolates into a `LocalizedStringKey` and formats the number for
/// the current locale — so 1450 renders as "1,450", or "1 450" in Uzbek. A section or
/// total score is an identifier, not a quantity; it never carries a thousands separator.
enum ScoreText {
    static func string(_ value: Int) -> String { String(value) }
    static func string(_ value: Double) -> String { String(Int(value.rounded())) }
    static func string(_ value: Int?) -> String { value.map(String.init) ?? "—" }
    static func string(_ value: Double?) -> String { value.map { String(Int($0.rounded())) } ?? "—" }
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

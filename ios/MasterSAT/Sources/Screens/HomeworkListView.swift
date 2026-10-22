import SwiftUI
import MasterSATKit

struct HomeworkRow: View {
    let assignment: AssignmentListing

    /// Papers sat on a computer — a past paper, a mock, a practice pack — as the list row
    /// names them (`contents`; the list does not carry the sections themselves).
    private var paperCount: Int {
        assignment.contents.filter { ["PASTPAPER", "MOCK", "PRACTICE"].contains($0.kind) }.count
    }

    /// The icon says what KIND of work it is at a glance — a quiz, a paper, words, a video,
    /// or something to hand in — which is the first thing a student wants from a list.
    private var icon: String {
        if !assignment.assessmentHomeworks.isEmpty { return "square.and.pencil" }
        if paperCount > 0 { return "doc.text" }
        if !assignment.vocabHomeworks.isEmpty { return "character.book.closed.fill" }
        if assignment.videoURL?.isEmpty == false || assignment.videoFileURL?.isEmpty == false {
            return "play.rectangle.fill"
        }
        return "tray.and.arrow.up.fill"
    }

    /// What is actually inside, so a bundle does not read as an empty title.
    private var contents: [String] {
        var parts: [String] = []
        if !assignment.assessmentHomeworks.isEmpty {
            parts.append("\(ScoreText.string(assignment.assessmentHomeworks.count)) quiz\(assignment.assessmentHomeworks.count == 1 ? "" : "zes")")
        }
        if paperCount > 0 {
            parts.append("\(ScoreText.string(paperCount)) paper\(paperCount == 1 ? "" : "s") on a computer")
        }
        if !assignment.vocabHomeworks.isEmpty {
            parts.append("\(ScoreText.string(assignment.vocabHomeworks.count)) word set\(assignment.vocabHomeworks.count == 1 ? "" : "s")")
        }
        if assignment.videoURL?.isEmpty == false || assignment.videoFileURL?.isEmpty == false {
            parts.append("Video")
        }
        return parts
    }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: icon, tone: StatusLabel.color(assignment.workflowStatus), size: 40)

            VStack(alignment: .leading, spacing: 5) {
                Text(assignment.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)

                HStack(spacing: 6) {
                    Text(StatusLabel.homework(assignment.workflowStatus))
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(StatusLabel.color(assignment.workflowStatus))

                    if let due = DueLabel.text(assignment.dueAt, handedIn: ["submitted", "graded", "reviewed"].contains((assignment.workflowStatus ?? "").lowercased())) {
                        Text("·").foregroundStyle(Theme.textLabel)
                        // States a fact. Even a passed deadline is phrased as information,
                        // never as an accusation.
                        Text(due.text)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(due.late ? Theme.warning : Theme.textSecondary)
                    }
                }

                if !contents.isEmpty {
                    Text(contents.joined(separator: " · "))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textLabel)
                .accessibilityHidden(true)
        }
    }
}


/// Navigation needs identity; the server id is it.
extension AssignmentListing: @retroactive Hashable {
    public static func == (lhs: AssignmentListing, rhs: AssignmentListing) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

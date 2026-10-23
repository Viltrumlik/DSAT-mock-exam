import SwiftUI
import MasterSATKit

/// One thing to do — a homework still owed, or one of today's lessons. Today's Up next and the
/// Class tab's To do share it, so a piece of work looks the same wherever it is met.
struct WorkRow: View {
    let item: WorkItem

    private var visual: (icon: String, tone: Color) {
        switch item.look {
        case .quiz: return ("square.and.pencil", Theme.success)
        case .words: return ("character.book.closed.fill", Theme.subjectWords)
        case .paper: return ("doc.text", Theme.info)
        case .handIn: return ("tray.and.arrow.up.fill", Theme.accent)
        case .lesson: return ("person.2.fill", Theme.accent)
        case .exam: return ("list.clipboard.fill", Theme.amber)
        }
    }

    /// "Due Thu", "Catch up · Tue" — or, for a lesson, its time today. A lesson (or midterm)
    /// the schedule gave no time says the day only: its start is the day's midnight.
    private var when: (text: String, late: Bool)? {
        switch item.source {
        case .homework:
            // Classwork is done in class and never owed: whatever date it carries is not a
            // deadline, so it is never "Due" or "Catch up" (the detail page says "In class" too).
            // The day it was held, as the class page's classwork rows write it.
            if item.isClasswork {
                guard let assigned = item.assignment?.assignedAt else { return ("In class", false) }
                return ("In class · \(HomeworkWording.shortDate(assigned))", false)
            }
            // `catchUp` is the kit's call, not the label's: a homework that is not behind has a
            // date and nothing else to say, so `DueLabel` is told not to decide "late" itself.
            return DueLabel.text(item.dueAt, handedIn: !item.catchUp)
        case .lesson:
            let time = item.clockText.map { "Today · \($0)" } ?? "Today"
            return (item.look == .exam ? "\(time) · sat on a computer" : time, false)
        }
    }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: visual.icon, tone: visual.tone, size: 42)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .appFont(15, weight: .bold)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .appFont(12, weight: .semibold)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                if when != nil || item.xpCap != nil {
                    // The due line and the XP chip share a line; at the accessibility sizes the
                    // chip drops under the date instead of pushing it off the row.
                    AdaptiveStack(spacing: 8, columnSpacing: 4) {
                        if let when {
                            // A passed deadline is information, never an accusation.
                            Text(when.text)
                                .appFont(12, weight: when.late ? .heavy : .semibold)
                                .foregroundStyle(when.late ? Theme.warning : Theme.textSecondary)
                        }
                        if let cap = item.xpCap { XPCapChip(amount: cap) }
                    }
                }
            }
            Spacer(minLength: 0)
            if item.assignment != nil {
                Image(systemName: "chevron.right")
                    .appFont(12, weight: .bold)
                    .foregroundStyle(Theme.textLabel)
                    .accessibilityHidden(true)
            }
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// "up to +15 XP" — the most this homework can pay, read off the live rule.
struct XPCapChip: View {
    let amount: Int

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "bolt.fill").appFont(9, weight: .black)
            Text("up to +\(amount) XP").appFont(11, weight: .heavy, design: .rounded)
        }
        .foregroundStyle(Theme.amber)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(Theme.amberSoft))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Worth up to \(amount) XP")
    }
}

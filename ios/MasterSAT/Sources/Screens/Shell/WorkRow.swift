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
            return DueLabel.text(item.dueAt)
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
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                if when != nil || item.xpCap != nil {
                    HStack(spacing: 8) {
                        if let when {
                            // A passed deadline is information, never an accusation.
                            Text(when.text)
                                .font(.system(size: 12, weight: when.late ? .heavy : .semibold))
                                .foregroundStyle(when.late ? Theme.warning : Theme.textSecondary)
                        }
                        if let cap = item.xpCap { XPCapChip(amount: cap) }
                    }
                }
            }
            Spacer(minLength: 0)
            if item.assignment != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
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
            Image(systemName: "bolt.fill").font(.system(size: 9, weight: .black))
            Text("up to +\(amount) XP").font(.system(size: 11, weight: .heavy, design: .rounded))
        }
        .foregroundStyle(Theme.amber)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(Theme.amberSoft))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Worth up to \(amount) XP")
    }
}

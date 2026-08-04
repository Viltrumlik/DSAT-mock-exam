import SwiftUI
import MasterSATKit

/// The lesson calendar, the next-lesson card and the selected-day card — the bottom two
/// thirds of the site's dashboard, ported.
///
/// The month grid is the reason the dashboard is worth opening on a phone: it is the only
/// place on the platform that answers "when is my next lesson, and what else is that week"
/// without reading anything.

// MARK: - Model

/// Events for one visible 6-week grid, bucketed by day.
struct ScheduleMonth {
    var byDate: [String: [ScheduleEvent]] = [:]
    var nextLesson: ScheduleEvent?

    var nextLessonDate: String? { nextLesson?.date }

    /// The 42-cell grid for a month, starting on the Sunday on or before the 1st.
    ///
    /// Sunday-first regardless of locale, because the site is: a student comparing the two
    /// calendars must not find the columns shifted by a day.
    static func gridRange(year: Int, month: Int) -> (start: Date, end: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 1
        let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)) ?? Date()
        let weekday = calendar.component(.weekday, from: first) // 1 = Sunday
        let start = calendar.date(byAdding: .day, value: -(weekday - 1), to: first) ?? first
        let end = calendar.date(byAdding: .day, value: 41, to: start) ?? start
        return (start, end)
    }

    static func build(from events: [ScheduleEvent]) -> ScheduleMonth {
        var byDate: [String: [ScheduleEvent]] = [:]
        for event in events { byDate[event.date, default: []].append(event) }
        for (key, list) in byDate {
            byDate[key] = list.sorted { window($0).start < window($1).start }
        }
        // Time-aware, exactly as the web computes it: the earliest lesson whose window has
        // not ended. A lesson that finished this morning must not still read as "next",
        // and a second lesson later today must surface once the first ends.
        let now = Date()
        let lessons: Set<ScheduleEvent.Kind> = [.classMeeting, .mock, .midterm]
        let next = events
            .filter { lessons.contains($0.type) }
            .map { (event: $0, window: window($0)) }
            .filter { $0.window.end > now }
            .min { $0.window.start < $1.window.start }?
            .event
        return ScheduleMonth(byDate: byDate, nextLesson: next)
    }

    /// A lesson's local start/end. A `time` may be a single start ("16:00") or a range
    /// ("08:00-10:00"); anything unparseable — and every mock, midterm and due date, which
    /// carry no time at all — occupies the whole day.
    private static func window(_ event: ScheduleEvent) -> (start: Date, end: Date) {
        let base = DayKey.date(from: event.date) ?? Date.distantPast
        let dayEnd = base.addingTimeInterval(86_400 - 60)
        let raw = event.time.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return (base, dayEnd) }
        let parts = raw
            .replacingOccurrences(of: "–", with: "-")
            .replacingOccurrences(of: "—", with: "-")
            .split(whereSeparator: { $0 == "-" || $0 == "/" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
        guard let startMinutes = minutes(parts.first ?? "") else { return (base, dayEnd) }
        var endMinutes = parts.count > 1 ? minutes(parts[1]) : nil
        if endMinutes == nil || endMinutes! <= startMinutes { endMinutes = startMinutes + 120 }
        return (
            base.addingTimeInterval(Double(startMinutes) * 60),
            base.addingTimeInterval(Double(endMinutes!) * 60)
        )
    }

    /// "16:00" / "4:00 PM" / "9am" → minutes since midnight.
    private static func minutes(_ raw: String) -> Int? {
        let s = raw.lowercased().trimmingCharacters(in: .whitespaces)
        let pm = s.contains("pm"), am = s.contains("am")
        let digits = s.replacingOccurrences(of: "am", with: "").replacingOccurrences(of: "pm", with: "")
            .trimmingCharacters(in: .whitespaces)
        let bits = digits.split(separator: ":")
        guard let first = bits.first, var hour = Int(first) else { return nil }
        let minute = bits.count > 1 ? (Int(bits[1]) ?? 0) : 0
        if pm, hour < 12 { hour += 12 }
        if am, hour == 12 { hour = 0 }
        guard hour <= 23, minute <= 59 else { return nil }
        return hour * 60 + minute
    }
}

/// `yyyy-MM-dd` both ways. The server speaks it and every schedule event is keyed by it.
enum DayKey {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ date: Date) -> String { formatter.string(from: date) }
    static func date(from key: String) -> Date? { formatter.date(from: key) }
}

// MARK: - Calendar

struct LessonCalendarCard: View {
    let month: ScheduleMonth
    @Binding var year: Int
    @Binding var monthIndex: Int
    @Binding var selected: String?

    private static let weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    private var monthLabel: String {
        let calendar = Calendar(identifier: .gregorian)
        guard let date = calendar.date(from: DateComponents(year: year, month: monthIndex, day: 1)) else { return "" }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("LLLL yyyy")
        return f.string(from: date)
    }

    private var cells: [DayCellModel] {
        let (start, _) = ScheduleMonth.gridRange(year: year, month: monthIndex)
        let calendar = Calendar(identifier: .gregorian)
        let todayKey = DayKey.string(Date())
        return (0..<42).map { offset in
            let date = calendar.date(byAdding: .day, value: offset, to: start) ?? start
            let key = DayKey.string(date)
            let events = month.byDate[key] ?? []
            return DayCellModel(
                key: key,
                day: calendar.component(.day, from: date),
                inMonth: calendar.component(.month, from: date) == monthIndex,
                isToday: key == todayKey,
                isSelected: key == selected,
                isNext: key == month.nextLessonDate,
                hasTest: events.contains { $0.type == .mock || $0.type == .midterm },
                hasClass: events.contains { $0.type == .classMeeting },
                hasAssignment: events.contains { $0.type == .assignment }
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "calendar")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Lesson calendar").font(.system(size: 17, weight: .heavy)).tracking(-0.2)
                    Text("Tap a day to see what's on")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 10) {
                monthButton("chevron.left") { step(-1) }
                Text(monthLabel)
                    .font(.system(size: 15, weight: .heavy))
                    .frame(maxWidth: .infinity)
                monthButton("chevron.right") { step(1) }
            }

            HStack(spacing: 4) {
                ForEach(Self.weekdays, id: \.self) { day in
                    Text(day)
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(0.6)
                        .foregroundStyle(Theme.textLabel)
                        .frame(maxWidth: .infinity)
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(cells) { cell in
                    DayCell(model: cell) {
                        guard cell.inMonth else { return }
                        selected = cell.key
                    }
                }
            }

            Divider()

            // Four states, four different marks. Without the key the ringed day and the
            // amber day are just two colours a student has to guess at.
            FlowLegend(items: [
                .init(label: "Class", stroke: Theme.accent, fill: Theme.accentSoft, ring: false, dashed: false),
                .init(label: "Test", stroke: Theme.amber, fill: Theme.amberSoft, ring: false, dashed: false),
                .init(label: "Next lesson", stroke: .clear, fill: Theme.accent, ring: true, dashed: false),
                .init(label: "Today", stroke: Theme.accent, fill: .clear, ring: false, dashed: true),
            ])
        }
        .cardStyle(padding: 18)
    }

    private func monthButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.background))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
                )
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func step(_ delta: Int) {
        var newMonth = monthIndex + delta
        var newYear = year
        if newMonth < 1 { newMonth = 12; newYear -= 1 }
        if newMonth > 12 { newMonth = 1; newYear += 1 }
        monthIndex = newMonth
        year = newYear
    }
}

struct DayCellModel: Identifiable {
    let key: String
    let day: Int
    let inMonth: Bool
    let isToday: Bool
    let isSelected: Bool
    let isNext: Bool
    let hasTest: Bool
    let hasClass: Bool
    let hasAssignment: Bool

    var id: String { key }
}

private struct DayCell: View {
    let model: DayCellModel
    let onTap: () -> Void

    /// The site's precedence, kept in order: highlight beats a test, a test beats a class,
    /// a class beats today. Reordering these silently hides a day's real state.
    private var highlighted: Bool { model.isSelected || model.isNext }

    var body: some View {
        Button(action: onTap) {
            ZStack {
                if highlighted {
                    Circle().fill(Theme.accent)
                    Circle().stroke(Theme.accent.opacity(0.2), lineWidth: 3).padding(-2)
                } else if model.hasTest {
                    Circle().fill(Theme.amberSoft)
                    Circle().stroke(Theme.amber, lineWidth: 2)
                } else if model.hasClass {
                    Circle().fill(Theme.accentSoft)
                    Circle().stroke(Theme.accent, lineWidth: 2)
                } else if model.isToday {
                    Circle().stroke(Theme.accent, style: StrokeStyle(lineWidth: 2, dash: [3, 3]))
                }
                Text(ScoreText.string(model.day))
                    .font(.system(size: 14, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(foreground)
            }
            .frame(width: 38, height: 38)
            .frame(maxWidth: .infinity)
            .opacity(model.inMonth ? 1 : 0.35)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!model.inMonth)
    }

    private var foreground: Color {
        if highlighted { return .white }
        if model.hasTest { return Theme.amber }
        if model.hasClass || model.isToday || model.hasAssignment { return Theme.accent }
        return .primary
    }
}

private struct LegendItem: Identifiable {
    let label: String
    let stroke: Color
    let fill: Color
    let ring: Bool
    let dashed: Bool

    var id: String { label }
}

private struct FlowLegend: View {
    let items: [LegendItem]

    var body: some View {
        // Two per row: four legend entries on one phone line squeeze the labels to nothing.
        let rows = stride(from: 0, to: items.count, by: 2).map { Array(items[$0..<min($0 + 2, items.count)]) }
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 18) {
                    ForEach(row) { item in
                        HStack(spacing: 8) {
                            ZStack {
                                Circle().fill(item.fill)
                                if item.dashed {
                                    Circle().stroke(item.stroke, style: StrokeStyle(lineWidth: 2, dash: [2.5, 2.5]))
                                } else if item.stroke != .clear {
                                    Circle().stroke(item.stroke, lineWidth: 2)
                                }
                                if item.ring {
                                    Circle().stroke(Theme.accent.opacity(0.2), lineWidth: 2.5).padding(-1.5)
                                }
                            }
                            .frame(width: 15, height: 15)
                            Text(item.label)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if row.count == 1 { Spacer(minLength: 0).frame(maxWidth: .infinity) }
                }
            }
        }
    }
}

// MARK: - Next lesson

struct NextLessonCard: View {
    let event: ScheduleEvent?
    let onOpen: (ScheduleEvent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                Circle().fill(Theme.accent).frame(width: 9, height: 9)
                Text("NEXT LESSON")
                    .font(.system(size: 12, weight: .heavy))
                    .tracking(1.4)
                    .foregroundStyle(Theme.accent)
            }

            if let event, let date = DayKey.date(from: event.date) {
                Text(event.title)
                    .font(.system(size: 21, weight: .heavy))
                    .tracking(-0.3)
                    .padding(.top, 16)
                    .fixedSize(horizontal: false, vertical: true)
                if !event.sub.isEmpty {
                    Text(event.sub)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 5)
                }
                HStack(spacing: 10) {
                    InfoBox(label: "When", value: Self.when(date))
                    InfoBox(label: "Time", value: event.time.isEmpty ? "—" : event.time)
                }
                .padding(.top, 18)

                Button {
                    onOpen(event)
                } label: {
                    HStack(spacing: 8) {
                        Text("\(Self.cta(event)) · \(Self.relative(date))")
                        Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .padding(.top, 16)
                .disabled(!Self.openable(event))
                .opacity(Self.openable(event) ? 1 : 0.55)
            } else {
                Text("You're all caught up")
                    .font(.system(size: 21, weight: .heavy))
                    .tracking(-0.3)
                    .padding(.top, 16)
                Text("Upcoming lessons will appear here.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 5)
            }
        }
        .cardStyle(padding: 20)
    }

    static func openable(_ event: ScheduleEvent) -> Bool {
        // Mocks and sittings are not hosted here, so their rows say what they are without
        // pretending to lead anywhere. Everything else opens its classroom or homework.
        switch event.type {
        case .mock, .midterm: return false
        default: return event.classroomId != nil
        }
    }

    static func cta(_ event: ScheduleEvent) -> String {
        switch event.type {
        case .classMeeting: return "Open class"
        case .assignment: return "Open homework"
        case .mock, .midterm: return "Sat on a laptop"
        case .unknown: return "Open"
        }
    }

    private static func when(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return f.string(from: date)
    }

    static func relative(_ date: Date) -> String {
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: Date()), to: calendar.startOfDay(for: date)).day ?? 0
        if days <= 0 { return "today" }
        if days == 1 { return "tomorrow" }
        return "in \(days) days"
    }
}

// MARK: - Selected day

struct SelectedDayCard: View {
    let dayKey: String?
    let events: [ScheduleEvent]
    let onOpen: (ScheduleEvent) -> Void

    private var heading: String {
        guard let dayKey, let date = DayKey.date(from: dayKey) else { return "Select a day" }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("EEEE MMMM d")
        return f.string(from: date)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(heading).font(.system(size: 14, weight: .heavy))
            if events.isEmpty {
                DashedEmpty(title: "No lessons scheduled", hint: "A good day for vocabulary.")
            } else {
                ForEach(events) { event in
                    Button {
                        onOpen(event)
                    } label: {
                        LessonRow(event: event)
                    }
                    .buttonStyle(.plain)
                    .disabled(!NextLessonCard.openable(event))
                }
            }
        }
        .cardStyle(padding: 20)
    }
}

struct LessonRow: View {
    let event: ScheduleEvent

    private var visual: (icon: String, tone: Color) {
        switch event.type {
        case .mock, .midterm: return ("list.clipboard.fill", Theme.amber)
        case .assignment: return ("doc.text.fill", Theme.accent)
        default: return ("person.2.fill", Theme.accent)
        }
    }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: visual.icon, tone: visual.tone, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if !event.sub.isEmpty {
                    Text(event.sub)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
            }
            Spacer(minLength: 0)
            if !event.time.isEmpty {
                Text(event.time)
                    .font(.system(size: 13, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.background))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

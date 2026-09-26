import SwiftUI
import MasterSATKit

/// One classroom, the student beside their group — the web's `PeerGroupCard`.
///
/// Top to bottom: the sentences the page writes on its own (`PeerInsights`), each measure on a
/// scale with the group's average marked on it, the student's last lessons, and attendance
/// month by month for them and the group. Every group figure is an aggregate the server
/// computed; a missing one says why instead of standing in as a zero.
struct MyProgressPeerCard: View {
    let group: PeerProgressGroup
    let minPeers: Int
    let columns: [GridItem]

    private var metrics: PeerProgressMetrics { group.metrics }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header

            let insights = PeerInsights.insights(for: group, minPeers: minPeers)
            if !insights.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(insights) { MyProgressInsightRow(insight: $0) }
                }
            }

            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                MyProgressMetricTile(
                    label: "Attendance",
                    icon: "calendar.badge.checkmark",
                    tone: Theme.success,
                    unit: .percent,
                    metric: metrics.attendance,
                    detail: PeerMetricText.attendanceDetail(metrics.attendance, detail: metrics.attendanceDetail)
                )
                MyProgressMetricTile(
                    label: "Homework",
                    icon: "checklist",
                    tone: Theme.warning,
                    unit: .percent,
                    metric: metrics.homework,
                    // In points, like the other tiles. The count of pieces that closes the gap
                    // is the insight's to say — both at once is one number drawn twice.
                    detail: PeerMetricText.homeworkDetail(metrics.homeworkDetail)
                )
                MyProgressMetricTile(
                    label: "Overall",
                    icon: "chart.line.uptrend.xyaxis",
                    tone: Theme.accent,
                    unit: .percent,
                    metric: metrics.overall,
                    detail: PeerMetricText.overallDetail
                )
                if let vocabulary = metrics.vocabulary {
                    MyProgressMetricTile(
                        label: "Words mastered",
                        icon: "character.book.closed",
                        tone: Theme.subjectEnglish,
                        unit: .words,
                        metric: vocabulary,
                        detail: PeerMetricText.vocabularyDetail
                    )
                }
            }

            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                panel("Your last lessons") {
                    MyProgressLessonStrip(lessons: group.recentLessons)
                }
                panel("Attendance by month") {
                    MyProgressAttendanceChart(trend: group.attendanceTrend)
                }
            }
        }
        .cardStyle(padding: 18)
    }

    // MARK: - Header

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 12) {
                identity
                Spacer(minLength: 8)
                openClass
            }
            VStack(alignment: .leading, spacing: 12) {
                identity
                openClass
            }
        }
    }

    private var identity: some View {
        HStack(spacing: 12) {
            IconTile(systemName: group.subject == "math" ? "function" : "book.closed", size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(group.subjectLabel) · \(group.levelLabel)".uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(Theme.textSecondary)
                Text(group.classroomName)
                    .font(.system(size: 18, weight: .heavy))
                    .tracking(-0.2)
                    .lineLimit(2)
                Label(PeerMetricText.groupSize(group.groupSize), systemImage: "person.2")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var openClass: some View {
        NavigationLink {
            LearnMoreClassroomView(classroomId: group.classroomId)
        } label: {
            HStack(spacing: 6) {
                Text("Open class")
                Image(systemName: "arrow.right")
            }
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Capsule().fill(Theme.accentSoft))
            .fixedSize()
        }
        .buttonStyle(.plain)
    }

    private func panel<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Overline(title)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Theme.success.opacity(0.06))
        )
    }
}

// MARK: - A sentence

/// One automatic sentence, in its tone's soft wash.
struct MyProgressInsightRow: View {
    let insight: PeerInsight

    private var icon: String {
        switch insight.icon {
        case .trophy: return "trophy.fill"
        case .sparkles: return "sparkles"
        case .target: return "target"
        case .calendar: return "calendar.badge.checkmark"
        case .lock: return "lock.fill"
        case .users: return "person.2.fill"
        }
    }

    private var tint: Color {
        switch insight.tone {
        case .success: return Theme.success
        case .warning: return Theme.warning
        case .info: return Theme.accent
        case .muted: return Theme.textSecondary
        }
    }

    private var wash: Color {
        switch insight.tone {
        case .success: return Theme.success.opacity(0.09)
        case .warning: return Theme.warning.opacity(0.10)
        case .info: return Theme.accent.opacity(0.07)
        case .muted: return Theme.surface2.opacity(0.7)
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 16)
            Text(insight.text)
                .font(.system(size: 13.5, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(wash))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - A measure

/// One measure: the student's figure, how far from the group's average it is, both on one
/// scale, and what the figure is made of.
struct MyProgressMetricTile: View {
    let label: String
    let icon: String
    let tone: Color
    let unit: PeerMetricText.Unit
    let metric: PeerProgressMetric
    let detail: String

    private var gap: Double? { PeerInsights.gapToGroup(metric) }

    private var chipTone: Chip.Tone {
        guard let gap else { return .neutral }
        let rounded = ProgressFormat.jsRound(gap)
        // Tinted, never red: under the group is a next step, not a warning light.
        return rounded == 0 ? .neutral : (rounded > 0 ? .success : .warning)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // The label has the row to itself — beside the chip it would truncate.
            HStack(spacing: 8) {
                IconTile(systemName: icon, tone: tone, size: 28)
                Text(label.uppercased())
                    .font(.system(size: 11.5, weight: .bold))
                    .tracking(0.9)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 8) {
                    figure
                    Spacer(minLength: 8)
                    chip
                }
                VStack(alignment: .leading, spacing: 6) {
                    figure
                    chip
                }
            }

            MyProgressCompareScale(metric: metric, unit: unit, tone: tone, label: label)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if metric.groupAverage != nil {
                        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                            .fill(Color.primary.opacity(0.8))
                            .frame(width: 3, height: 12)
                            .accessibilityHidden(true)
                    }
                    Text(PeerMetricText.groupAverage(metric, unit: unit))
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)

                Text(detail)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let band = PeerMetricText.band(metric, unit: unit) {
                    Text(band)
                        .font(.system(size: 12.5, weight: .bold))
                        .foregroundStyle(metric.standing == .lowerHalf ? Color.primary : Theme.success)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.background))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }

    private var figure: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(PeerMetricText.value(metric, unit: unit))
                .font(.system(size: 30, weight: .heavy))
                .monospacedDigit()
                .tracking(-0.8)
            if unit == .words, metric.you != nil {
                Text("words")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .lineLimit(1)
        .fixedSize()
    }

    @ViewBuilder
    private var chip: some View {
        if let text = ProgressFormat.deltaChip(gap) {
            Chip(text: text, tone: chipTone).fixedSize()
        }
    }
}

/// The student's figure as a fill, the group's average as a mark on the same track. The
/// number beside it says how much; this says which side of the group they are on.
struct MyProgressCompareScale: View {
    let metric: PeerProgressMetric
    let unit: PeerMetricText.Unit
    let tone: Color
    let label: String

    private var accessibilityText: String {
        let you = PeerMetricText.value(metric, unit: unit)
        guard metric.groupAverage != nil else { return "\(label): you \(you)" }
        let group = unit == .percent
            ? ProgressFormat.percent(metric.groupAverage)
            : ProgressFormat.count(metric.groupAverage)
        return "\(label): you \(you), group average \(group)"
    }

    var body: some View {
        let scale = PeerMetricText.scale(metric, unit: unit)
        GeometryReader { geometry in
            let width = geometry.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(tone.opacity(0.15)).frame(height: 8)
                if let you = scale.you {
                    Capsule().fill(tone).frame(width: width * you, height: 8)
                }
                if let group = scale.group {
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(Color.primary.opacity(0.8))
                        .frame(width: 3, height: 20)
                        // A ring in the tile's own colour, so the mark reads over the fill.
                        .background(
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .fill(Theme.background)
                                .padding(-2)
                        )
                        .position(x: min(max(width * group, 2), width - 2), y: 10)
                }
            }
            .frame(width: width, height: 20)
        }
        .frame(height: 20)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

// MARK: - The last lessons

/// Up to eight of the student's own marked lessons, oldest first, with their dates. An absence
/// is "Missed" — the fact, not a charge.
struct MyProgressLessonStrip: View {
    let lessons: [PeerLessonMark]

    var body: some View {
        if lessons.isEmpty {
            Text("No lessons marked for you yet.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
        } else {
            HStack(alignment: .top, spacing: 6) {
                ForEach(Array(lessons.enumerated()), id: \.offset) { _, lesson in
                    let day = LearnMoreDateText.shortDay(lesson.date)
                    VStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(fill(lesson.status))
                            .frame(width: 32, height: 32)
                            .overlay(
                                Image(systemName: icon(lesson.status))
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(ink(lesson.status))
                            )
                        Text(day)
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(day): \(lesson.status.label)")
                }
            }
        }
    }

    private func icon(_ status: PeerLessonStatus) -> String {
        switch status {
        case .present: return "checkmark"
        case .late: return "clock"
        case .absent: return "xmark"
        case .excused: return "minus"
        }
    }

    private func fill(_ status: PeerLessonStatus) -> Color {
        switch status {
        case .present: return Theme.success
        case .late: return Theme.warning
        case .absent: return Theme.dangerSoft
        case .excused: return Theme.surface2
        }
    }

    private func ink(_ status: PeerLessonStatus) -> Color {
        switch status {
        case .present, .late: return .white
        case .absent: return Theme.danger
        case .excused: return Theme.textSecondary
        }
    }
}

// MARK: - Attendance by month

/// The student's attendance and the group's average, month by month — two bars a month, the
/// last four months with marks.
struct MyProgressAttendanceChart: View {
    let trend: [PeerTrendMonth]

    private static let barArea: CGFloat = 92

    var body: some View {
        if trend.isEmpty {
            Text("Nothing marked yet.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .bottom, spacing: 12) {
                    ForEach(trend) { month in
                        VStack(spacing: 6) {
                            HStack(alignment: .bottom, spacing: 6) {
                                bar(month.you, fill: Theme.success, who: "You")
                                bar(month.group, fill: Theme.success.opacity(0.35), who: "Group")
                            }
                            .frame(height: Self.barArea + 18, alignment: .bottom)
                            Text(LearnMoreDateText.shortMonth(month.month))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                HStack(spacing: 16) {
                    legend("You", fill: Theme.success)
                    legend("Group average", fill: Theme.success.opacity(0.35))
                }
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func bar(_ value: Double?, fill: Color, who: String) -> some View {
        VStack(spacing: 4) {
            if let value, value.isFinite {
                Text(ProgressFormat.count(value))
                    .font(.system(size: 10, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize()
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(fill)
                    .frame(width: 22, height: max(4, Self.barArea * min(max(value, 0), 100) / 100))
            } else {
                Text("—")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(width: 24)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            value.map { "\(who): \(ProgressFormat.percent($0))" } ?? "\(who): not enough marks"
        )
    }

    private func legend(_ title: String, fill: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(fill)
                .frame(width: 10, height: 10)
            Text(title)
        }
    }
}

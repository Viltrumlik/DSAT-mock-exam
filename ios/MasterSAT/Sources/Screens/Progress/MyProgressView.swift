import SwiftUI
import MasterSATKit

/// My Progress — how each level has gone, and how the class the student is in now compares.
/// The site's `/progress`.
///
/// Two requests, as on the web: the level ladder answers on its own, and the comparison with
/// the group — which reads the whole class's registers — arrives when it arrives. Each has
/// its own loading, error and empty state, and a failed comparison never takes the ladder
/// down with it.
///
/// Every number the server does not have shows as "—", never 0%: a level nobody taught the
/// student, or a group too small to average, is "we don't know", not "you did none of it".
struct MyProgressView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var report: MyProgressReport?
    @State private var reportError: String?
    @State private var peers: PeerProgress?
    @State private var peersError: String?

    private var api: ProgressAPI { ProgressAPI(client: session.client) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HeroHeader(
                    eyebrow: "My progress",
                    eyebrowIcon: "chart.line.uptrend.xyaxis",
                    title: "My progress",
                    blurb: "How each level has gone — turning up and doing the work, counted together.",
                    tiles: heroTiles
                )
                peersSection
                ladderSection
            }
            .padding(16)
            .padding(.bottom, 24)
            .frame(maxWidth: 960)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { if report == nil || peers == nil { await load() } }
        .refreshable { await load() }
    }

    /// "Overall" only once there is an overall to show — a tile reading "—" while the page is
    /// still loading would look like a verdict of "unknown".
    private var heroTiles: [HeroTile] {
        guard let overall = report?.overall else { return [] }
        return [HeroTile("Overall", icon: "chart.line.uptrend.xyaxis", value: ProgressFormat.percent(overall))]
    }

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: 12, alignment: .top),
            count: sizeClass == .regular ? 2 : 1
        )
    }

    // MARK: - You and your group

    @ViewBuilder
    private var peersSection: some View {
        let heading = LearnMoreSectionHeading(
            title: "You and your group",
            description: "Your numbers beside your classmates'. Group figures are averages — nobody else's own numbers are shown."
        )
        if let peers {
            // No current class to compare in: the ladder's own empty state already says why.
            if !peers.groups.isEmpty {
                VStack(alignment: .leading, spacing: 16) {
                    heading
                    ForEach(peers.groups) { group in
                        MyProgressPeerCard(group: group, minPeers: peers.minPeers, columns: columns)
                    }
                }
            }
        } else if peersError != nil {
            VStack(alignment: .leading, spacing: 16) {
                heading
                // Not an empty state: "no comparison" would read as "your class has no one in it".
                LearnMoreErrorCard(
                    title: "The comparison with your group didn’t load.",
                    message: "Your own progress below is unaffected — try again in a moment."
                ) { await loadPeers() }
            }
        } else {
            VStack(alignment: .leading, spacing: 16) {
                heading
                LearnMoreSkeleton(height: 320)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading the comparison with your group")
        }
    }

    // MARK: - Level by level

    @ViewBuilder
    private var ladderSection: some View {
        if let report {
            if report.tracks.isEmpty {
                LearnMoreEmptyCard(
                    icon: "chart.line.uptrend.xyaxis",
                    title: "Nothing to show yet",
                    message: "Once you are enrolled in a class with a level, your attendance and homework for it appear here."
                )
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    LearnMoreSectionHeading(
                        title: "Level by level",
                        description: "Every level you have studied, and the ones still ahead."
                    )
                    ForEach(report.tracks) { track in
                        MyProgressTrackCard(track: track, columns: columns)
                    }
                    Text(MyProgressText.footnote)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                .fill(Theme.accent.opacity(0.05))
                        )
                }
            }
        } else if reportError != nil {
            // Not an empty state. "No progress yet" would tell a student their term did not
            // happen, when all that failed was a request.
            LearnMoreErrorCard(
                title: "Your progress didn’t load.",
                message: "Nothing has been lost — it will be here once the connection comes back."
            ) { await loadReport() }
        } else {
            VStack(spacing: 16) {
                LearnMoreSkeleton(height: 256)
                LearnMoreSkeleton(height: 256)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading your progress")
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let ladder: Void = loadReport()
        async let group: Void = loadPeers()
        _ = await (ladder, group)
    }

    @MainActor
    private func loadReport() async {
        do {
            report = try await api.progress()
            reportError = nil
        } catch {
            if Task.isCancelled { return }
            // A failed refresh keeps the page it already has.
            if report == nil { reportError = learnMoreMessage(error) }
        }
    }

    @MainActor
    private func loadPeers() async {
        do {
            peers = try await api.peers()
            peersError = nil
        } catch {
            if Task.isCancelled { return }
            if peers == nil { peersError = learnMoreMessage(error) }
        }
    }
}

// MARK: - Level by level

/// One subject's ladder: where the student is, and a card per level.
struct MyProgressTrackCard: View {
    let track: MyProgressTrack
    let columns: [GridItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                IconTile(systemName: track.subject == "math" ? "function" : "book.closed", size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.subjectLabel)
                        .font(.system(size: 18, weight: .heavy))
                        .tracking(-0.2)
                    Text(MyProgressText.trackLine(track))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)

            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                ForEach(track.levels) { level in
                    MyProgressLevelCard(level: level)
                }
            }
        }
        .cardStyle(padding: 18)
    }
}

/// One level: its pill, its overall, and the two halves it was counted from.
///
/// No bar under the numbers: each would only draw the percentage printed beside it.
struct MyProgressLevelCard: View {
    let level: MyProgressLevel

    private var measured: Bool { level.overall != nil }
    private var isCurrent: Bool { level.state == .current }

    private var pillTone: Chip.Tone {
        switch level.state {
        case .current: return .accent
        case .done: return .success
        default: return .neutral
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(level.levelLabel)
                        .font(.system(size: 15, weight: .heavy))
                    if let name = level.classroomName, !name.isEmpty {
                        Text(name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Chip(text: MyProgressText.pill(level.state), tone: pillTone)
                Text(ProgressFormat.percent(level.overall))
                    .font(.system(size: 24, weight: .heavy))
                    .monospacedDigit()
                    .tracking(-0.5)
                    .lineLimit(1)
                    .fixedSize()
            }

            if measured {
                VStack(alignment: .leading, spacing: 10) {
                    MyProgressHalfRow(
                        icon: "calendar.badge.checkmark",
                        label: "Attendance",
                        value: level.attendance?.rate,
                        detail: MyProgressText.attendanceDetail(level.attendance)
                    )
                    MyProgressHalfRow(
                        icon: "checklist",
                        label: "Homework",
                        value: level.homework?.rate,
                        detail: MyProgressText.homeworkDetail(level.homework)
                    )
                }
                if let note = MyProgressText.basisNote(level.basis) {
                    Text(note)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text(MyProgressText.emptyNote(level.state))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(isCurrent ? Theme.accent.opacity(0.05) : Theme.card)
        )
        .overlay {
            // The current level is outlined in blue; a level with numbers in a hairline; one
            // with nothing recorded in the house's dashed "nothing here yet".
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    isCurrent ? Theme.accent.opacity(0.35) : Theme.separator.opacity(measured ? 0.6 : 0.8),
                    style: StrokeStyle(lineWidth: measured || isCurrent ? 1 : 1.5, dash: measured || isCurrent ? [] : [6, 5])
                )
        }
    }
}

/// "Attendance 93% · 12 present · 1 late" — one half of a level's number.
struct MyProgressHalfRow: View {
    let icon: String
    let label: String
    let value: Double?
    let detail: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                name
                Spacer(minLength: 8)
                figure
                detailText
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                name
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    figure
                    detailText.multilineTextAlignment(.trailing)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(ProgressFormat.percent(value)), \(detail)")
    }

    private var name: some View {
        Label {
            Text(label)
        } icon: {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold))
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Theme.textSecondary)
        .lineLimit(1)
    }

    private var figure: some View {
        Text(ProgressFormat.percent(value))
            .font(.system(size: 14, weight: .heavy))
            .monospacedDigit()
            .fixedSize()
    }

    private var detailText: some View {
        Text(detail)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

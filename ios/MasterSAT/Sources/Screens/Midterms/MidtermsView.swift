import SwiftUI
import MasterSATKit

/// Midterms — what is coming, and how the last one went.
///
/// The app does not host the paper. A midterm is sat on a laptop, in a room, under
/// supervision, and putting a Start button here would be an invitation to sit one on a bus.
/// What the phone is good for is the things around it: **when**, **what you scored**, and
/// **which skills to work on**. The list is sorted exactly as the site sorts it — Available
/// now, Scheduled, Closed, Past attempts — so a paper is in the same place on both.
struct MidtermsView: View {
    enum Filter: Hashable { case all, available, scheduled, past }

    @Environment(Session.self) private var session

    @State private var midterms: [MidtermListing] = []
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var hasLoaded = false
    @State private var filter: Filter = .all

    private func rows(_ bucket: MidtermBucket) -> [MidtermListing] {
        let matching = midterms.filter { $0.bucket == bucket }
        switch bucket {
        case .scheduled:
            // Soonest first; a room waiting on its teacher has no date and goes last.
            return matching.sorted { ($0.availableAt ?? "9999") < ($1.availableAt ?? "9999") }
        default:
            return matching // The server's order: by title.
        }
    }

    private func shows(_ bucket: MidtermBucket) -> Bool {
        switch filter {
        case .all: return true
        case .available: return bucket == .available
        case .scheduled: return bucket == .scheduled
        // "Closed" is a past state, so it is listed with the past, as the site does.
        case .past: return bucket == .past || bucket == .closed
        }
    }

    /// The one to count down to: the soonest paper whose window is still ahead.
    private var next: (midterm: MidtermListing, opensAt: Date)? {
        rows(.scheduled)
            .filter { !$0.awaitingCode }
            .compactMap { midterm -> (MidtermListing, Date)? in
                guard let raw = midterm.availableAt,
                      let date = JSONCoding.parseServerDate(raw),
                      date > Date() else { return nil }
                return (midterm, date)
            }
            .min { $0.1 < $1.1 }
            .map { (midterm: $0.0, opensAt: $0.1) }
    }

    private var published: Int {
        midterms.filter { $0.bucket == .past && $0.releasedScore != nil }.count
    }

    private var tabs: [PillTabs<Filter>.Item] {
        [
            .init(tab: .all, title: "All", icon: "square.stack"),
            .init(tab: .available, title: "Available now", icon: "dot.radiowaves.left.and.right", count: countOrNil(.available)),
            .init(tab: .scheduled, title: "Scheduled", icon: "clock", count: countOrNil(.scheduled)),
            .init(tab: .past, title: "Past", icon: "checkmark.seal", count: countOrNil(.past)),
        ]
    }

    private func countOrNil(_ bucket: MidtermBucket) -> Int? {
        let n = rows(bucket).count
        return n > 0 ? n : nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HeroHeader(
                    eyebrow: "Midterm",
                    eyebrowIcon: "calendar.badge.clock",
                    title: "Midterm",
                    blurb: "Papers are sat in the centre. Here you can see when the next one opens and how the last one went.",
                    tiles: [
                        HeroTile("Available now", icon: "dot.radiowaves.left.and.right", value: rows(.available).count),
                        HeroTile("Scheduled", icon: "clock", value: rows(.scheduled).count),
                        HeroTile("Sat", icon: "checkmark.seal", value: rows(.past).count),
                        HeroTile("Scores out", icon: "chart.bar.fill", value: published),
                    ]
                )

                if isLoading && !hasLoaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                } else if let loadError, midterms.isEmpty {
                    // A failed load is never "no midterms yet".
                    RetryNotice(message: loadError) { await load() }
                } else if midterms.isEmpty {
                    DashedEmpty(
                        title: "No midterms assigned yet.",
                        hint: "When your teacher sets one, you'll see here when it opens."
                    )
                } else {
                    if let loadError {
                        Label("Could not refresh just now — this is the last list we had. \(loadError)", systemImage: "exclamationmark.triangle")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }

                    PillTabs(items: tabs, selection: $filter)

                    if filter == .all || filter == .scheduled, let next {
                        MidtermCountdownCard(midterm: next.midterm, opensAt: next.opensAt)
                    }

                    let visible = MidtermBucket.allCases.filter { shows($0) && !rows($0).isEmpty }
                    if visible.isEmpty {
                        DashedEmpty(title: emptyTitle)
                    }
                    ForEach(visible, id: \.self) { bucket in
                        section(bucket)
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private var emptyTitle: String {
        switch filter {
        case .all: return "No midterms assigned yet."
        case .available: return "Nothing to sit right now."
        case .scheduled: return "Nothing scheduled."
        case .past: return "No past attempts yet."
        }
    }

    private func tone(_ bucket: MidtermBucket) -> Color {
        switch bucket {
        case .available: return Theme.accent
        case .scheduled: return Theme.textLabel
        case .closed: return Theme.warning
        case .past: return Theme.success
        }
    }

    @ViewBuilder
    private func section(_ bucket: MidtermBucket) -> some View {
        let items = rows(bucket)
        VStack(alignment: .leading, spacing: 10) {
            DotHeading(title: bucket.title, count: items.count, tone: tone(bucket))
            ForEach(items) { midterm in
                if bucket == .past, let attemptId = midterm.attemptId {
                    NavigationLink {
                        MidtermReportView(attemptId: attemptId, title: midterm.title)
                    } label: {
                        MidtermRow(midterm: midterm, onOpened: reloadSoon)
                    }
                    .buttonStyle(.plain)
                } else {
                    MidtermRow(midterm: midterm, onOpened: reloadSoon)
                }
            }
        }
    }

    /// A scheduled row whose countdown just reached zero asks for a fresh list: whether it
    /// is now open is the server's call (the teacher may not have started the room yet).
    private func reloadSoon() {
        Task { await load() }
    }

    @MainActor
    private func load() async {
        loadError = nil
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            midterms = try await session.student.midterms()
            // Opening this screen is also the moment to notice a score that went out while
            // the app was closed — there is no push to tell us any earlier.
            await session.notifications.announceResults(midterms: midterms)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

// MARK: - Countdown

/// How long until the next paper opens.
///
/// The same idiom as Home's SAT countdown, and deliberately so: a student who has learnt to
/// read one should not have to learn the other. `TimelineView` ticks it rather than a timer,
/// so it stops on its own when the screen is not visible.
struct MidtermCountdownCard: View {
    let midterm: MidtermListing
    let opensAt: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.clock").font(.system(size: 12, weight: .bold))
                Text("NEXT MIDTERM").font(.system(size: 12, weight: .heavy)).tracking(1.1)
            }
            .foregroundStyle(.white.opacity(0.85))

            Text(midterm.title)
                .font(.system(size: 20, weight: .heavy))
                .tracking(-0.4)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)

            TimelineView(.periodic(from: .now, by: 1)) { context in
                let parts = Countdown.split(until: opensAt, from: context.date)
                HStack(spacing: 8) {
                    CountdownCell(value: parts.days, label: "DAYS")
                    CountdownCell(value: parts.hours, label: "HRS")
                    CountdownCell(value: parts.minutes, label: "MIN")
                    CountdownCell(value: parts.seconds, label: "SEC")
                }
            }

            HStack(spacing: 6) {
                Image(systemName: "clock").font(.system(size: 11, weight: .bold))
                Text(Countdown.fullDate(opensAt))
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.14)))
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentDeep)
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.07))
                .frame(width: 190, height: 190)
                .offset(x: 60, y: -70)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
    }
}

private struct CountdownCell: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(ScoreText.string(value))
                .font(.system(size: 25, weight: .heavy).monospacedDigit())
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(.system(size: 9, weight: .heavy))
                .tracking(0.8)
                .foregroundStyle(.white.opacity(0.72))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.16)))
    }
}

enum Countdown {
    /// Clamped at zero: a date that has just passed counts down to 0:00:00:00 rather than
    /// running negative for the second before the list reloads.
    static func split(until target: Date, from now: Date) -> (days: Int, hours: Int, minutes: Int, seconds: Int) {
        let remaining = max(0, Int(target.timeIntervalSince(now)))
        return (remaining / 86400, (remaining % 86400) / 3600, (remaining % 3600) / 60, remaining % 60)
    }

    static func fullDate(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).day().month(.wide).hour().minute())
    }

    /// "6 Aug, 17:10" — for a row that also has to fit a status chip.
    static func shortDate(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    /// "Aug 6" — the "Opens …" date.
    static func dayDate(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day())
    }
}

// MARK: - Rows

/// One midterm, in the site's row anatomy: the paper, its badge, a meta line, and on the
/// right what it is waiting on — never a Start button.
private struct MidtermRow: View {
    let midterm: MidtermListing
    /// Called once when a scheduled row's countdown reaches zero.
    let onOpened: () -> Void

    private var bucket: MidtermBucket { midterm.bucket }

    private var badgeTone: Chip.Tone {
        switch bucket {
        case .available: return midterm.resitOpen ? .warning : .accent
        case .scheduled: return .neutral
        case .closed: return .warning
        case .past: return .success
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(systemName: "doc.text", tone: bucket == .past ? Theme.success : Theme.accent, size: 40)
                VStack(alignment: .leading, spacing: 5) {
                    Text(midterm.title)
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Chip(text: midterm.badge, tone: badgeTone)
                    if !midterm.metaLine.isEmpty {
                        Text(midterm.metaLine)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer(minLength: 0)
                if bucket == .past { pastTrailing }
            }
            status
        }
        .cardStyle(padding: 14)
    }

    // MARK: Past

    @ViewBuilder
    private var pastTrailing: some View {
        HStack(spacing: 8) {
            if let score = midterm.releasedScore {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(ScoreText.string(score))
                        .font(.system(size: 22, weight: .heavy).monospacedDigit())
                        .tracking(-0.5)
                        .foregroundStyle(Theme.accent)
                    if let ceiling = midterm.scoreCeiling {
                        Text("/\(ScoreText.string(ceiling))")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            if midterm.attemptId != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
        }
    }

    // MARK: What it is waiting on

    @ViewBuilder
    private var status: some View {
        switch bucket {
        case .available:
            StatusLine(
                icon: "building.columns",
                text: midterm.resitOpen
                    ? "Re-sit available — sit it at the centre."
                    : midterm.inProgress
                        ? "In progress — carry on at the centre."
                        : "Open now — sit it at the centre."
            )
        case .scheduled:
            if midterm.awaitingCode {
                StatusLine(icon: "lock", text: "Waiting for teacher", detail: "your teacher hasn’t started this yet")
            } else if let opens = midterm.availableAt.flatMap(JSONCoding.parseServerDate) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if let left = MidtermWording.startsIn(opens, now: context.date) {
                        StatusLine(icon: "lock", text: "Opens \(Countdown.dayDate(opens))", detail: "starts in \(left)")
                    } else {
                        // The moment has come, but whether it is open is the server's call.
                        StatusLine(icon: "hourglass", text: "Starting…")
                            .task { onOpened() }
                    }
                }
            } else {
                StatusLine(icon: "lock", text: "Scheduled")
            }
        case .closed:
            StatusLine(
                icon: "lock",
                text: "Deadline passed",
                detail: midterm.deadline.flatMap(JSONCoding.parseServerDate).map { "closed \(Countdown.shortDate($0))" }
            )
        case .past:
            if midterm.releasedScore != nil {
                HStack(spacing: 8) {
                    StatusLine(icon: "chart.bar.fill", text: "View result")
                    if midterm.certificate?.available == true {
                        Chip(text: "Certificate", icon: "rosette", tone: .success)
                    }
                }
            } else {
                // Named, never left blank — a blank score reads as a zero.
                StatusLine(icon: "hourglass", text: "Awaiting results")
            }
        }
    }
}

private struct StatusLine: View {
    let icon: String
    let text: String
    var detail: String?

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold))
            Text(text).font(.system(size: 13, weight: .bold))
            if let detail {
                Text("· \(detail)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textLabel)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.textSecondary)
    }
}

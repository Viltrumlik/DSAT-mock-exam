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

    /// Counts only when there are some, as the site's chips have them.
    private var chips: [NewLookFilterChips<Filter>.Option] {
        [
            .init(value: .all, title: "All"),
            .init(value: .available, title: "Available now", count: countOrNil(.available)),
            .init(value: .scheduled, title: "Scheduled", count: countOrNil(.scheduled)),
            .init(value: .past, title: "Past", count: countOrNil(.past)),
        ]
    }

    private func countOrNil(_ bucket: MidtermBucket) -> Int? {
        let n = rows(bucket).count
        return n > 0 ? n : nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NewLookPageTitle(
                    title: "Midterms",
                    subtitle: "Papers are sat in the centre. Here you can see when the next one opens and how the last one went."
                )
                // The hero's four tiles, as one white card of counts.
                MidtermCountsCard(counts: [
                    (rows(.available).count, "Available now"),
                    (rows(.scheduled).count, "Scheduled"),
                    (rows(.past).count, "Sat"),
                    (published, "Scores out"),
                ])

                if isLoading && !hasLoaded {
                    LoadingSkeleton(rows: 3, height: 84, style: .cards)
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
                            .appFont(12, weight: .semibold)
                            .foregroundStyle(NewLook.ink4)
                    }

                    NewLookFilterChips(options: chips, selection: $filter)

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
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 16)
        }
        .background(NewLook.page.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .detachedRefresh { await load() }
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
        case .available: return NewLook.blue
        case .scheduled: return NewLook.chevron
        case .closed: return NewLook.orange
        case .past: return NewLook.green
        }
    }

    @ViewBuilder
    private func section(_ bucket: MidtermBucket) -> some View {
        let items = rows(bucket)
        VStack(alignment: .leading, spacing: 12) {
            MidtermSectionHeading(title: bucket.title, count: items.count, tone: tone(bucket))
                .padding(.top, 6)
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
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 7) {
                Image(systemName: "calendar.badge.clock").font(.system(size: 13, weight: .bold))
                    .accessibilityHidden(true)
                Text("Next midterm").appFont(11.5, weight: .heavy).tracking(1.4).textCase(.uppercase)
            }
            .foregroundStyle(.white.opacity(0.85))

            Text(midterm.title)
                .appDisplayFont(22)
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

            HStack(spacing: 7) {
                Image(systemName: "clock").font(.system(size: 13, weight: .bold))
                    .accessibilityHidden(true)
                Text(Countdown.fullDate(opensAt))
                    .appFont(14, weight: .bold)
            }
            .foregroundStyle(.white.opacity(0.95))
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
            .background(.white.opacity(0.14), in: Capsule())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .newLookBlueCard(padding: EdgeInsets(top: 18, leading: 18, bottom: 18, trailing: 18))
    }
}

private struct CountdownCell: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(ScoreText.string(value))
                .appDisplayFont(26, monospacedDigits: true)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .appFont(9.5, weight: .heavy)
                .tracking(1)
                .foregroundStyle(.white.opacity(0.72))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// The hero's four numbers in one white card, split by hairlines (mockup 36).
private struct MidtermCountsCard: View {
    let counts: [(value: Int, label: String)]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(counts.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Rectangle().fill(NewLook.line).frame(width: 1, height: 36)
                }
                VStack(spacing: 2) {
                    Text(ScoreText.string(item.value))
                        .appDisplayFont(24, monospacedDigits: true)
                        .foregroundStyle(NewLook.ink)
                    Text(item.label)
                        .appFont(12, weight: .medium)
                        .foregroundStyle(NewLook.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity)
        .newLookSurface(NewLook.card, radius: 20, shadow: .card)
    }
}

/// A list's heading: a coloured dot, the bucket in Archivo 22 and its count.
private struct MidtermSectionHeading: View {
    let title: String
    let count: Int
    let tone: Color

    var body: some View {
        HStack(spacing: 9) {
            Circle().fill(tone).frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(title)
                .appDisplayFont(22)
                .tracking(-0.4)
                .foregroundStyle(NewLook.ink)
                .accessibilityAddTraits(.isHeader)
            Text(ScoreText.string(count))
                .appFont(14, weight: .heavy, monospacedDigits: true)
                .foregroundStyle(NewLook.muted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
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

    private var badgeStyle: NewLookChip.Style {
        switch bucket {
        case .available: return midterm.resitOpen ? .orange : .blue
        case .scheduled: return .gray
        case .closed: return .orange
        case .past: return .green
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                NewLookTile(systemName: "doc.text.fill", tone: bucket == .past ? .green : .blue)
                VStack(alignment: .leading, spacing: 6) {
                    Text(midterm.title)
                        .appFont(16, weight: .bold)
                        .foregroundStyle(NewLook.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    NewLookChip(text: midterm.badge, style: badgeStyle)
                    if !midterm.metaLine.isEmpty {
                        Text(midterm.metaLine)
                            .appFont(14, weight: .medium)
                            .foregroundStyle(NewLook.ink4)
                    }
                }
                Spacer(minLength: 0)
                if bucket == .past { pastTrailing }
            }
            .padding(.bottom, 12)
            Rectangle().fill(NewLook.line).frame(height: 1)
            status
                .padding(.top, 12)
        }
        .newLookCard(padding: 16)
    }

    // MARK: Past

    @ViewBuilder
    private var pastTrailing: some View {
        HStack(spacing: 8) {
            if let score = midterm.releasedScore {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(ScoreText.string(score))
                        .appDisplayFont(24, monospacedDigits: true)
                        .tracking(-0.5)
                        .foregroundStyle(NewLook.blueText)
                    if let ceiling = midterm.scoreCeiling {
                        Text("/ \(ScoreText.string(ceiling))")
                            .appFont(12, weight: .bold)
                            .foregroundStyle(NewLook.muted)
                    }
                }
            }
            if midterm.attemptId != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(NewLook.chevron)
                    .accessibilityHidden(true)
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
                        NewLookChip(text: "Certificate", systemImage: "rosette", style: .green, small: false)
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
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(icon == "chart.bar.fill" ? NewLook.blueText : NewLook.ink4)
                .accessibilityHidden(true)
            // One run of text, so a long detail wraps under the words instead of squeezing them.
            (Text(text).foregroundStyle(NewLook.ink2)
                + Text(detail.map { " · \($0)" } ?? "").fontWeight(.medium).foregroundStyle(NewLook.muted))
                .appFont(14, weight: .bold)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

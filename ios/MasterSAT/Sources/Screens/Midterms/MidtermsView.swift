import SwiftUI
import MasterSATKit

/// Midterms — what is coming, and how the last one went.
///
/// The app does not host the paper. A midterm is sat on a laptop, in a room, under
/// supervision, and putting a Start button here would be an invitation to sit one on a bus.
/// What the phone is good for is the three things around it: **when**, **what you scored**,
/// and **which skills to work on** — so those are the only three things this screen has.
struct MidtermsView: View {
    @Environment(Session.self) private var session

    @State private var midterms: [MidtermListing] = []
    @State private var loadError: String?
    @State private var isLoading = true

    /// Scheduled, not yet sat. Sorted by when they open, so the next one is first — with
    /// the undated ones last rather than sorting as the distant past.
    private var upcoming: [MidtermListing] {
        midterms
            .filter { !$0.submitted }
            .sorted { ($0.availableAt ?? "9999") < ($1.availableAt ?? "9999") }
    }

    private var sat: [MidtermListing] {
        midterms.filter(\.submitted).sorted { $0.title < $1.title }
    }

    /// The one to count down to: the soonest paper that has a date still ahead of us.
    private var next: (midterm: MidtermListing, opensAt: Date)? {
        upcoming
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
        sat.filter { $0.resultsVisible && $0.score != nil }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HeroHeader(
                    eyebrow: "Midterms",
                    eyebrowIcon: "calendar.badge.clock",
                    title: "Your midterms",
                    blurb: "Papers are sat in the centre. Here you can see when the next one is and how the last one went.",
                    tiles: [
                        HeroTile("Coming up", icon: "clock", value: upcoming.count),
                        HeroTile("Sat", icon: "checkmark.seal", value: sat.count),
                        HeroTile("Scores out", icon: "chart.bar.fill", value: published),
                    ]
                ) { EmptyView() }
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))

                if let loadError {
                    RetryNotice(message: loadError) { await load() }
                }

                if let next {
                    MidtermCountdownCard(midterm: next.midterm, opensAt: next.opensAt)
                }

                if !upcoming.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        DotHeading(title: "Coming up", count: upcoming.count, tone: Theme.amber)
                        ForEach(upcoming) { UpcomingMidtermRow(midterm: $0) }
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    DotHeading(title: "Your results", count: sat.count, tone: Theme.success)
                    if sat.isEmpty && !isLoading {
                        DashedEmpty(
                            title: "No midterms sat yet",
                            hint: "Your score and a breakdown of the skills to work on will appear here."
                        )
                    }
                    ForEach(sat) { midterm in
                        NavigationLink {
                            MidtermReportView(attemptId: midterm.attemptId ?? 0, title: midterm.title)
                        } label: {
                            SatMidtermRow(midterm: midterm)
                        }
                        .buttonStyle(.plain)
                        .disabled(midterm.attemptId == nil)
                    }
                }

                if isLoading && midterms.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
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

    @MainActor
    private func load() async {
        loadError = nil
        isLoading = true
        defer { isLoading = false }
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
}

// MARK: - Rows

private struct UpcomingMidtermRow: View {
    let midterm: MidtermListing

    private var opensAt: Date? {
        midterm.availableAt.flatMap(JSONCoding.parseServerDate)
    }

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: "doc.text", tone: Theme.amber, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(midterm.title)
                    .font(.system(size: 15, weight: .bold))
                    .multilineTextAlignment(.leading)
                // Short form here, full form on the countdown card above: the row shares its
                // line with a status chip, and the long date wrapped straight into it.
                Text([midterm.subject.isEmpty ? nil : midterm.subject.humanisedSubject,
                      opensAt.map(Countdown.shortDate)]
                    .compactMap { $0 }
                    .joined(separator: " · "))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
            // The states are kept distinct because they need different words: the window has
            // not opened, the teacher has not released the room's code, or it has closed.
            if let reason = midterm.blockedReason {
                Chip(text: reason, tone: reason == "Closed" ? .neutral : .warning)
            } else if midterm.isOpen {
                Chip(text: "Open now", icon: "dot.radiowaves.left.and.right", tone: .success)
            }
        }
        .cardStyle()
    }
}

private struct SatMidtermRow: View {
    let midterm: MidtermListing

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(midterm.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if !midterm.subject.isEmpty {
                    Text(midterm.subject.humanisedSubject)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if midterm.resultsVisible, let score = midterm.score {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(ScoreText.string(score))
                        .font(.system(size: 24, weight: .heavy).monospacedDigit())
                        .tracking(-0.6)
                        .foregroundStyle(Theme.accent)
                    if let ceiling = midterm.scoreCeiling {
                        Text("of \(ScoreText.string(ceiling))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            } else {
                // Named, never left blank — a blank score reads as a zero.
                Chip(text: "Not released", icon: "hourglass", tone: .warning)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
        .cardStyle()
    }
}

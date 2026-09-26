import SwiftUI
import MasterSATKit

/// The row of single facts under the goal cards — level per subject, XP, points and strikes —
/// the web's `DashboardPulse`. Each chip is one fact, and a way in to where it comes from.
///
/// Levels come from the roadmap and the rest from `/rewards/me/`, loaded apart so a failure in
/// one leaves the other's chips standing. The rewards chips are drawn only once their figures
/// are in, as on the web: a chip that says "—" and then changes is worse than one that arrives
/// a beat late. With nothing to show, the row takes no space at all.
struct HomePulse: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var levels: [RoadmapLevelChip] = []
    @State private var rewards: MyRewards?

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(spacing: 0) {
            if levels.isEmpty && rewards == nil {
                Color.clear.frame(height: 0)
            } else {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(levels) { chip in
                        NavigationLink { RoadmapView() } label: {
                            PulseChip(icon: "graduationcap.fill", tone: Theme.info,
                                      label: chip.subjectLabel, value: chip.levelLabel, detail: chip.detail)
                        }
                        .buttonStyle(.plain)
                    }
                    if let rewards {
                        NavigationLink { LeaderboardView() } label: {
                            PulseChip(icon: "trophy.fill", tone: Theme.success,
                                      label: "XP", value: ScoreText.string(rewards.xp))
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .topTrailing) { RewardsExplainButton(explainer: .xp) }

                        NavigationLink { ShopView() } label: {
                            PulseChip(icon: "circle.circle.fill", tone: Theme.subjectEnglish,
                                      label: "Points", value: ScoreText.string(rewards.points),
                                      detail: "\(ScoreText.string(rewards.coins)) \(rewards.coins == 1 ? "coin" : "coins")")
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .topTrailing) { RewardsExplainButton(explainer: .points) }

                        // `strikes`, not the streak: the spendable balance is what the Strike
                        // shop charges against. The run is the detail, where it reads as context.
                        PulseChip(icon: "flame.fill", tone: Theme.amber,
                                  label: "Strikes", value: ScoreText.string(rewards.strikes),
                                  detail: rewards.currentStreak > 0
                                      ? "\(rewards.currentStreak) \(rewards.currentStreak == 1 ? "lesson" : "lessons") in a row"
                                      : "attend a lesson to start")
                            .overlay(alignment: .topTrailing) { RewardsExplainButton(explainer: .strike) }
                    }
                }
            }
        }
        .task(id: refreshID) { await load() }
    }

    @MainActor
    private func load() async {
        // A failed refresh keeps what is on screen; the pages behind the chips say what failed.
        async let chips = try? RoadmapAPI(client: session.client).levelChips()
        async let mine = try? session.rewards.me()
        if let fresh = await chips { levels = fresh }
        if let fresh = await mine { rewards = fresh }
    }
}

private struct PulseChip: View {
    let icon: String
    let tone: Color
    let label: String
    let value: String
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            IconTile(systemName: icon, tone: tone, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.6)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                Text(value)
                    .font(.system(size: 20, weight: .heavy).monospacedDigit())
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let detail {
                    Text(detail)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The web's permanent Events button — always in the top bar, never gated on a count: the
/// owner asked for it after a button that came and went vanished at exactly the wrong moment.
/// The count shows from one open event.
struct HomeEventsButton: View {
    @Environment(Session.self) private var session
    @State private var open: Int?
    @State private var failed = false

    private var accessibilityText: String {
        if failed { return "Events — couldn't check for new ones" }
        switch open ?? 0 {
        case 0: return "Events"
        case 1: return "Events — 1 open for sign-up"
        case let n: return "Events — \(n) open for sign-up"
        }
    }

    var body: some View {
        NavigationLink { EventsView() } label: {
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.accent)
                Text("Events")
                    .font(.system(size: 14, weight: .bold))
                if let open, open > 0 {
                    Text(ScoreText.string(open))
                        .font(.system(size: 11, weight: .heavy).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Capsule().fill(Theme.accent))
                }
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.04), radius: 3, x: 0, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
        .task {
            let count = await CommunityCounts.eventsOpenForSignUp(session)
            failed = count == nil
            if let count { open = count }
        }
    }
}

/// A live quiz running in one of the student's classes. The web has no dashboard card for it —
/// a student reaches `/live` from the code the teacher projects — but a phone has no address
/// bar to type that into, so while a room is open in their class Home offers the way in.
/// Nothing running (or live quizzes switched off), nothing drawn.
struct LiveQuizRunningCard: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var running: [LiveQuizSummary] = []

    var body: some View {
        VStack(spacing: 0) {
            if let room = running.first {
                VStack(alignment: .leading, spacing: 14) {
                    CardHeading(
                        icon: "dot.radiowaves.left.and.right",
                        title: running.count == 1 ? "A live quiz is on" : "\(running.count) live quizzes are on",
                        subtitle: running.count == 1
                            ? "\(room.classroomName) · \(room.title). Join with the code on the board."
                            : "In your classes. Join with the code on the board."
                    )
                    NavigationLink { LiveQuizJoinView() } label: { Text("Join the quiz") }
                        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                }
                .cardStyle(padding: 18)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: refreshID) {
            let rooms = (try? await LiveQuizAPI(client: session.client).mine()) ?? []
            running = rooms.filter { $0.status != .finished && $0.status != .terminated }
        }
    }
}

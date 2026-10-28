import SwiftUI
import MasterSATKit

/// The leaderboard sheet (mockup 13) — Today's Leaderboard card opens it.
///
/// The same board the card's place comes from: the whole centre, all time, XP
/// (`LeaderboardQuery.heroBoard`), so the sheet and the card never show two numbers. XP | Strikes
/// and All time | This month are the Rewards board's own controls; the Strikes board ranks the
/// current run of lessons and has no time chips. The rows are the top three, a gap, and the places
/// around the student (`LeaderboardSnippet`); "See the full board" opens `LeaderboardView`.
struct LeaderboardSheet: View {
    let onClose: () -> Void

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(RewardsStore.self) private var rewards
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var metric: LeaderboardMetric = .xp
    @State private var window = LeaderboardQuery.allTime
    @State private var boards: [LeaderboardQuery: LeaderboardBoard] = [:]
    @State private var failed: Set<LeaderboardQuery> = []

    private var query: LeaderboardQuery {
        metric == .strikes
            ? LeaderboardQuery(metric: .strikes, limit: 200)
            : (window == LeaderboardQuery.allTime ? .heroBoard : LeaderboardQuery(window: window, limit: 200))
    }

    private var subtitle: String {
        if metric == .strikes { return "Whole centre · lessons in a row" }
        return window == LeaderboardQuery.allTime ? "Whole centre · all time" : "Whole centre · this month"
    }

    private var footnote: String {
        if metric == .strikes { return "Lessons in a row, now" }
        return window == LeaderboardQuery.allTime ? "XP earned, all time" : "XP earned, this month"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NewLookSheetHeader(title: "Leaderboard", subtitle: subtitle, onClose: onClose) {
                    NewLookBadge(systemName: "trophy.fill")
                }
                NewLookSegmented(
                    options: [(LeaderboardMetric.xp, "XP"), (LeaderboardMetric.strikes, "Strikes")],
                    selection: $metric
                )
                if metric == .xp {
                    NewLookFilterChips(
                        options: [
                            .init(value: LeaderboardQuery.allTime, title: "All time"),
                            .init(value: LeaderboardQuery.thisMonth, title: "This month"),
                        ],
                        selection: $window
                    )
                }
                board
                footer
            }
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 24)
        }
        .background(NewLook.sheet.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .presentationDetents([.large])
        .noBarClearance()
        .task(id: query) { await load(query) }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: metric)
    }

    @ViewBuilder private var board: some View {
        if let board = boards[query] {
            let lines = LeaderboardSnippet.lines(board)
            if lines.isEmpty {
                Text(metric == .strikes ? "No runs on the board yet — the next lesson starts one." : "Nobody on this board yet.")
                    .appFont(14, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .frame(maxWidth: .infinity)
                    .newLookCard(padding: 20, radius: 22, shadow: .tile)
            } else {
                VStack(spacing: 0) {
                    ForEach(lines) { line in
                        switch line {
                        case .row(let row): BoardRow(row: row, metric: board.metric)
                        case .gap: GapDots()
                        }
                    }
                }
                .padding(6)
                .frame(maxWidth: .infinity)
                .background(NewLook.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .newLookShadow(.tile)
            }
        } else if failed.contains(query) {
            // A board that did not load is never "nobody here".
            ErrorState(title: "The board didn't load", style: .inline) { await load(query) }
        } else {
            LoadingSkeleton(rows: 6, height: 44, label: "Loading the board")
        }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Text(footnote)
                .appFont(13, weight: .medium)
                .foregroundStyle(NewLook.muted)
            Text("·").foregroundStyle(NewLook.muted)
            Button {
                router.open(.leaderboard, baseURL: session.client.config.baseURL) { openURL($0) }
            } label: {
                HStack(spacing: 3) {
                    Text("See the full board")
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                }
                .appFont(14, weight: .bold)
                .foregroundStyle(NewLook.blueText)
                .hitTarget(44)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
    }

    @MainActor
    private func load(_ asked: LeaderboardQuery) async {
        do {
            let fresh = try await LeaderboardAPI(client: session.client).board(asked)
            guard !Task.isCancelled else { return }
            if boards[asked] != fresh { boards[asked] = fresh }
            failed.remove(asked)
            // The card's board: what is shown here is the place the student has now seen.
            if asked == .heroBoard { rewards.noteRank(fresh.standing?.rank) }
        } catch {
            guard !Task.isCancelled else { return }
            if boards[asked] == nil { failed.insert(asked) }
        }
    }
}

/// One place: the rank pill, the initials, the name ("You" for the student), the figure.
private struct BoardRow: View {
    let row: LeaderboardRow
    let metric: LeaderboardMetric

    private var figure: String {
        metric == .strikes ? String(row.strikes ?? 0) : String(row.xp)
    }

    var body: some View {
        HStack(spacing: 12) {
            RankPill(rank: row.rank)
            InitialsDisc(initials: row.initials, seed: row.studentId, isMe: row.isMe)
            Text(row.isMe ? "You" : row.displayName)
                .appFont(16, weight: row.isMe ? .bold : .semibold)
                .foregroundStyle(NewLook.ink)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(figure)
                .appFont(16, weight: .bold, monospacedDigits: true)
                .foregroundStyle(NewLook.ink)
        }
        .padding(.leading, 8)
        .padding(.trailing, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 54)
        .background(row.isMe ? NewLook.blue50 : .clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Number \(row.rank), \(row.isMe ? "you" : row.displayName), "
                + (metric == .strikes ? RewardsFormat.count(row.strikes ?? 0, "lesson") + " in a row" : "\(row.xp) XP")
        )
    }
}

/// Places left out between two runs.
private struct GapDots: View {
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { _ in
                Circle().fill(NewLook.dots).frame(width: 4, height: 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .accessibilityLabel("Places in between")
    }
}

import SwiftUI
import MasterSATKit

// MARK: - The trophy hero

/// The student's place on the whole learning center's board, all time — the owner's choice for
/// this card (2026-10-21) — and the one student to pass next. Drawn inside a link to the full
/// board, on look B: the one card on the tab that is all about the student.
struct RankHeroContent: View {
    enum State: Equatable {
        case loading
        /// No XP yet, so no place on the board (the server's `my` is null).
        case unranked
        case ranked(rank: Int, pass: LeaderboardPass?)
    }

    let state: State
    /// Bumped by the tab each time it comes back on screen: a new value is a new trophy, which
    /// plays once more. A tab is never torn down, so without it the trophy would play only on
    /// the very first appearance.
    var plays = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 12) {
            LottieClip(.trophy, playback: reduceMotion ? .still : .once)
                .id(plays)
                .frame(width: 88, height: 88)
            VStack(alignment: .leading, spacing: 4) {
                switch state {
                case .loading:
                    Text(verbatim: "#00")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .redacted(reason: .placeholder)
                    Text("overall · all time")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                case .unranked:
                    Text("Not on the board yet")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                    Text("Your first XP puts you on it — come to a lesson or hand in homework.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                case .ranked(let rank, let pass):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        // A place is an identifier: never "#1,204".
                        Text(verbatim: "#\(rank)")
                            .font(.system(size: 40, weight: .black, design: .rounded))
                            .contentTransition(.numericText(value: Double(rank)))
                        Text("overall · all time")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Label(line(rank: rank, pass: pass), systemImage: rank == 1 ? "crown.fill" : "arrow.up.forward")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(rank == 1 ? RewardsPalette.gold.solid : RewardsPalette.accentText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityHint("Opens the leaderboard")
    }

    /// The next step, never the distance from the top. Without the row above in the response
    /// there is no honest number, so none is given.
    private func line(rank: Int, pass: LeaderboardPass?) -> String {
        if rank == 1 { return "You're top of the whole board" }
        return pass?.text ?? "Keep earning XP to climb"
    }

    private var spoken: String {
        switch state {
        case .loading: return "Loading your place on the board"
        case .unranked: return "Not on the board yet. Your first XP puts you on it."
        case .ranked(let rank, let pass): return "Number \(rank) overall, all time. \(line(rank: rank, pass: pass))."
        }
    }
}

// MARK: - Streak and coins

/// The run of lessons attended, with the best one. Look B.
struct StreakCard: View {
    let streak: Int?
    let best: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                LottieClip(.strikeFlame).frame(width: 34, height: 34)
                Text(ScoreText.string(streak))
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak ?? 0)))
            }
            Text(streak == 1 ? "lesson in a row" : "lessons in a row")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            if let best, best > 0 {
                Text(verbatim: "Best: \(best)")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.textLabel)
            } else if streak == 0 {
                Text("Your next lesson starts one")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .chunky(Theme.strike)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private var spoken: String {
        guard let streak else { return "Lessons in a row: not loaded" }
        let run = "\(streak) \(streak == 1 ? "lesson" : "lessons") in a row"
        guard let best, best > 0 else { return run }
        return "\(run), best \(best)"
    }
}

/// Coins to spend, and the one-tap convert. Look B.
struct CoinsCard: View {
    let rewards: MyRewards?
    let converting: Bool
    /// What the last conversion did — or that it did not go through.
    let note: String?
    let onConvert: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                RewardsCoinArt(kind: .coin, size: 30)
                Text(ScoreText.string(rewards?.coins))
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .contentTransition(.numericText(value: Double(rewards?.coins ?? 0)))
            }
            Text(rewards?.coins == 1 ? "coin to spend" : "coins to spend")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            if let rewards {
                if rewards.convertibleCoins > 0 {
                    Button(action: onConvert) {
                        HStack(spacing: 5) {
                            if converting {
                                ProgressView().controlSize(.mini).tint(.white)
                            } else {
                                Image(systemName: "arrow.left.arrow.right").font(.system(size: 11, weight: .bold))
                            }
                            Text(converting ? "Converting…" : "Convert points")
                        }
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Theme.accent))
                    }
                    .buttonStyle(PressBounce())
                    .disabled(converting)
                    .accessibilityLabel("Convert points into \(RewardsFormat.count(rewards.convertibleCoins, "coin"))")
                } else {
                    Text(verbatim: "\(RewardsFormat.count(rewards.pointsToNextCoin, "point")) to your next coin")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            if let note {
                Text(note)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .chunky(Theme.accent)
        // Contain, not combine: the Convert button must stay its own VoiceOver target.
        .accessibilityElement(children: .contain)
    }
}

/// A measured frame kept out of SwiftUI state: written on every scroll frame, read only when a
/// coin bursts — so measuring never re-renders the tab.
@MainActor
final class FrameBox {
    var rect: CGRect = .zero
}

// MARK: - The board

/// The global board on the tab: XP (all time or this month) or Strikes, the top five and the
/// student's own row. The full page — scopes, filters, podium — is behind "See the full board".
struct RewardsBoardSection: View {
    @Binding var metric: LeaderboardMetric
    @Binding var window: String
    /// Only a board that answers the chosen metric and window; nil while it loads.
    let board: LeaderboardBoard?
    let failed: Bool
    let retry: @MainActor () async -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let topCount = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Leaderboard")
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .accessibilityAddTraits(.isHeader)
            SegmentBar(
                items: [.init(segment: LeaderboardMetric.xp, title: "XP"), .init(segment: LeaderboardMetric.strikes, title: "Strikes")],
                selection: $metric
            )
            // The strike board is a run, now: the server ranks it over all time whatever is asked,
            // so there is no window to choose, and no filter summary to print.
            if metric == .xp { windowChips }
            content
            if metric == .xp {
                NavigationLink(value: AppLink.leaderboard) {
                    HStack(spacing: 4) {
                        Text("See the full board").font(.system(size: 14, weight: .bold))
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                    }
                    .foregroundStyle(RewardsPalette.accentText)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var windowChips: some View {
        HStack(spacing: 8) {
            ForEach([LeaderboardQuery.allTime, LeaderboardQuery.thisMonth], id: \.self) { value in
                let active = window == value
                Button {
                    guard !active else { return }
                    withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { window = value }
                } label: {
                    Text(LeaderboardFilters.fallbackWindowLabel(value))
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(active ? Color.white : Theme.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(active ? Theme.accent : Theme.card))
                        .contentShape(Capsule())
                }
                .buttonStyle(PressBounce())
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: window)
    }

    private var emptyHint: String {
        if metric == .strikes { return "Come to your next lesson and you're on it." }
        return window == LeaderboardQuery.thisMonth
            ? "The first XP of the month puts you at the top."
            : "The first XP puts you at the top."
    }

    @ViewBuilder private var content: some View {
        if let board {
            let top = Array(board.rows.prefix(Self.topCount))
            let me = board.standing
            if top.isEmpty && me == nil {
                DashedEmpty(
                    title: metric == .strikes ? "No runs yet" : "Nobody on this board yet",
                    hint: emptyHint
                )
            } else {
                VStack(spacing: 8) {
                    ForEach(top) { row in
                        RewardsBoardRow(row: row, metric: metric, mine: row.studentId == me?.studentId)
                    }
                    if let me, !top.contains(where: { $0.studentId == me.studentId }) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.textLabel)
                            .accessibilityHidden(true)
                        RewardsBoardRow(row: me, metric: metric, mine: true)
                    }
                }
            }
            if !board.scopeNote.isEmpty {
                Text(board.scopeNote)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else if failed {
            RewardsErrorState(
                title: "The leaderboard isn't loading right now.",
                message: "Your XP is safe — only this list failed to load.",
                retry: retry
            )
            .cardStyle(padding: 8)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .accessibilityLabel("Loading the leaderboard")
        }
    }
}

/// One place on the tab's board. The student's own row is look B.
struct RewardsBoardRow: View {
    let row: LeaderboardRow
    let metric: LeaderboardMetric
    let mine: Bool

    private var value: String {
        guard metric == .strikes else { return "\(ScoreText.string(row.xp)) XP" }
        let run = row.strikes ?? 0
        return "\(run) in a row"
    }

    var body: some View {
        let line = HStack(spacing: 10) {
            LeaderboardRankBadge(rank: row.rank, highlight: mine)
            LeaderboardAvatar(row: row, size: 34)
            Text(row.displayName)
                .font(.system(size: 14, weight: mine ? .heavy : .semibold))
                .lineLimit(1)
            if mine { LeaderboardYouTag() }
            Spacer(minLength: 6)
            Text(value)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(mine ? RewardsPalette.accentText : Theme.textSecondary)
                .fixedSize()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rank \(row.rank), \(row.displayName)\(mine ? ", you" : ""), \(value)")

        if mine {
            line.frame(maxWidth: .infinity).chunky(Theme.accent, radius: 16)
        } else {
            line.background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

// MARK: - Where your XP came from

struct XPLedgerCard: View {
    let rows: [PointAward]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeading(icon: "bolt.fill", title: "Where your XP came from", subtitle: "Your newest earnings that added XP")
            if rows.isEmpty {
                DashedEmpty(
                    title: "Nothing yet — but everything counts",
                    hint: "Come to a lesson or hand in homework, and it shows up here."
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, award in
                        if index > 0 { Divider().padding(.leading, 52) }
                        RewardsAwardRow(award: award)
                    }
                }
            }
            NavigationLink(value: AppLink.points) {
                HStack(spacing: 4) {
                    Text("All your points").font(.system(size: 14, weight: .bold))
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(RewardsPalette.accentText)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .cardStyle(padding: 18)
    }
}

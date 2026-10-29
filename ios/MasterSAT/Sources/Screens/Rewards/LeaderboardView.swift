import SwiftUI
import MasterSATKit

/// The school's board — the owner's Leaderboard design (2026-10-29), the page the Rewards hub's
/// hero, Today's rank card and the short board's "See the full board" open.
///
/// The blue band, a line saying what the board shows with the filter button beside it, the top
/// three on the blue podium card, everyone else in tinted rows, and the student's own row in
/// blue — in its place, and pinned over the tab bar while that place is further down. The sheet
/// picks XP or Strikes, this week, this month or all time, and the whole school or the class.
///
/// Rules this page keeps that are easy to break:
///
/// - **Ranks are the server's.** Shown as sent, ties included; never renumbered.
/// - **The goal is only ever the next place** — measured against the row directly above
///   (`LeaderboardBoard.climb`), never the distance from the top.
/// - **No email is ever a name** (`LeaderboardRow.displayName`).
/// - **An error is not an empty board**, and a failed pull keeps the board and says so in a line.
struct LeaderboardView: View {
    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(AppRouter.self) private var router
    @Environment(StatusBarChrome.self) private var statusBar: StatusBarChrome?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.tabBarClearance) private var barClearance
    @Environment(\.dismiss) private var dismiss

    /// XP, this week, the whole school — the design's first board.
    @State private var query = LeaderboardQuery(window: LeaderboardQuery.thisWeek)
    /// The board on screen, and the question it answers. Kept through a failed read of the same
    /// question; a new question's board replaces it once it arrives.
    @State private var board: LeaderboardBoard?
    @State private var boardQuery: LeaderboardQuery?
    @State private var boardFailed = false
    /// The last read of the question on screen failed and its board stays: said in one line.
    @State private var refreshFailed = false
    @State private var isLoading = true
    @State private var shown = false
    @State private var stage = LeaderboardStage(visible: false, swap: false)
    @State private var showingFilters = false
    /// This page's claim on the status bar: white over the band.
    @State private var statusBarOwner = UUID()
    /// The scroll view's frame and the student's own row's, both on the screen — enough to say
    /// whether the row's place is below the line where it pins.
    @State private var viewport: CGRect = .zero
    @State private var inlineMine: CGRect?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                TabBand(shown: shown, bottomPadding: 28) { titleRow }
                VStack(spacing: 0) {
                    summaryRow.padding(.top, 24)
                    content.padding(.top, 14)
                    if refreshFailed, board != nil, !boardFailed {
                        StaleNote().padding(.top, 12)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, offPageRoom)
            }
        }
        .scrollIndicators(.hidden)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { viewport = $0 }
        .background { LeaderboardBackground() }
        // The status bar stays on the band's blue however far the page scrolls.
        .safeAreaInset(edge: .top, spacing: 0) {
            Color.clear.frame(height: 0)
                .background(ClassTabPalette.band)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .overlay { ClassTabBottomFade(color: LeaderboardPalette.pageBottom) }
        .overlay(alignment: .bottom) { pinnedRow }
        .background { InteractivePopKeeper().frame(width: 0, height: 0) }
        .navigationTitle("")
        .toolbar(.hidden, for: .navigationBar)
        // VoiceOver's two-finger scrub: the system button's escape, kept with the bar hidden.
        .accessibilityAction(.escape) { dismiss() }
        // Keyed on the query: a new choice cancels the answer to the old one, so a slow reply
        // can never overwrite a newer board.
        .task(id: query) { await loadBoard() }
        .detachedRefresh { await loadBoard() }
        .sheet(isPresented: $showingFilters) {
            LeaderboardFilterSheet(query: $query) { showingFilters = false }
                // Tall enough for all three groups and the strike line, on the smallest phone.
                .presentationDetents([.height(470), .large])
                .noBarClearance()
        }
        .onAppear {
            if !shown { shown = true }
            if reduceMotion, !stage.visible { stage.visible = true }
            // Pushed from Rewards or from Today: the claim names the tab it is showing in.
            statusBar?.ask(.light, on: router.selection, owner: statusBarOwner)
        }
        .onDisappear { statusBar?.release(owner: statusBarOwner) }
        .onChange(of: reduceMotion) { _, calm in
            if calm, !stage.visible { stage.visible = true }
        }
    }

    // MARK: - Header

    private var titleRow: some View {
        HStack(spacing: 10) {
            ClassPageBackButton { dismiss() }
            Text("Leaderboard")
                .appDisplayFont(32)
                .tracking(-0.8)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
                .accessibilityAddTraits(.isHeader)
                .accessibilitySortPriority(1)
        }
    }

    /// "XP · This Week · Global" — what the board is, so nobody has to open the sheet to find out
    /// why their number changed. The strike board has no time range, so it has no time part.
    private var summary: String {
        let scope = query.scope == .group ? "My Class" : "Global"
        guard query.metric == .xp else { return "Strikes · \(scope)" }
        // Said as the board answered it: a server that does not know the week yet answers all time.
        let window = (boardQuery == query ? board?.window : nil) ?? query.window
        let title = LeaderboardFilterSheet.windows.first { $0.value == window }?.title ?? "All Time"
        return "XP · \(title) · \(scope)"
    }

    private var summaryRow: some View {
        HStack(spacing: 10) {
            Text(summary)
                .appFont(15, weight: .bold)
                .foregroundStyle(NewLook.ink2)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                showingFilters = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(NewLook.blueText)
                    .frame(width: 42, height: 42)
                    .background { Circle().fill(NewLook.card).newLookShadow(.tile) }
                    .hitTarget(44)
            }
            .buttonStyle(PressBounce())
            .accessibilityLabel("Filters")
            .accessibilityValue(summary)
        }
        .padding(.leading, 2)
    }

    // MARK: - The board

    /// Four branches, always: loading, failed, empty, rows. A failure that rendered as an empty
    /// board would tell the student they are alone on it.
    @ViewBuilder private var content: some View {
        if boardFailed {
            RewardsErrorState(
                title: "The leaderboard isn't loading right now.",
                message: "Your XP and strikes are safe — only this list failed to load."
            ) { await loadBoard() }
            .newLookCard()
        } else if let board {
            if board.rows.isEmpty {
                DashedEmpty(title: "Nothing on this board yet", hint: emptyHint(board))
            } else {
                rows(board)
                    // A new question still on its way: the old answer waits, dimmed.
                    .opacity(isLoading && boardQuery != query ? 0.6 : 1)
                    .animation(.easeInOut(duration: 0.2), value: isLoading)
            }
        } else {
            skeleton
        }
    }

    private func emptyHint(_ board: LeaderboardBoard) -> String {
        if query.scope == .group, board.classroomId == nil {
            return "Join a class and your class's board shows up here."
        }
        return board.metric == .strikes
            ? "Come to lessons in a row and the board fills up."
            : "Once XP is earned here, the standings will show up."
    }

    private func rows(_ board: LeaderboardBoard) -> some View {
        let mine = inlineMineID(board)
        return VStack(spacing: 8) {
            if !board.podium.isEmpty {
                LeaderboardPodiumCard(rows: board.podium, metric: board.metric, stage: stage)
            }
            ForEach(Array(board.standings.enumerated()), id: \.element.id) { index, row in
                let isMine = row.studentId == mine
                Group {
                    if isMine {
                        LeaderboardMyRow(row: row, metric: board.metric, climb: board.climb)
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { inlineMine = $0 }
                    } else {
                        LeaderboardPlaceRow(row: row, metric: board.metric)
                    }
                }
                .opacity(stage.visible ? 1 : 0)
                .offset(y: stage.visible ? 0 : 8)
                .animation(
                    reduceMotion ? nil : (stage.visible ? LeaderboardMotion.slide(isMine ? stage.mine : stage.row(index)) : LeaderboardMotion.leave),
                    value: stage.visible
                )
            }
        }
    }

    private var skeleton: some View {
        VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(LinearGradient(colors: [LeaderboardPalette.podiumTop, LeaderboardPalette.podiumBottom], startPoint: .top, endPoint: .bottom))
                .frame(height: 236)
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(NewLook.skeleton)
                    .frame(height: 62)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading the leaderboard")
    }

    // MARK: - The student's own row

    /// The student's row when it is one of the rows under the podium — it is drawn there, blue.
    private func inlineMineID(_ board: LeaderboardBoard) -> Int? {
        guard let mine = board.myVisibleRow,
              board.standings.contains(where: { $0.studentId == mine.studentId }) else { return nil }
        return mine.studentId
    }

    /// How far above the bottom the pinned row sits: 12 pt over the floating bar.
    private var rowLift: CGFloat { barClearance > 0 ? barClearance + 4 : 16 }

    /// Past the page (`showsYourPosition`) the row is always pinned, and the list leaves room for
    /// it under its last row.
    private var offPageRoom: CGFloat {
        guard let board, !boardFailed, board.showsYourPosition else { return 0 }
        return 76
    }

    /// The row pinned over the bar: the student's own, while its place in the list is below the
    /// line it pins on — or always, when the student is past the page. On the podium there is
    /// nothing to pin: they are on the card.
    @ViewBuilder private var pinnedRow: some View {
        if let board, !boardFailed {
            let offPage = board.showsYourPosition
            let inList = inlineMineID(board).flatMap { id in board.standings.first { $0.studentId == id } }
            if let row = offPage ? board.my : inList {
                // Not pinned before the list's copy has been measured — it may well be on screen.
                let below = inlineMine.map { $0.maxY > viewport.maxY - rowLift + 0.5 } ?? false
                let pinned = offPage || below
                LeaderboardMyRow(row: row, metric: board.metric, climb: board.climb)
                    .padding(.horizontal, 16)
                    .padding(.bottom, rowLift)
                    .opacity(pinned && stage.visible ? 1 : 0)
                    .animation(reduceMotion ? nil : (stage.visible ? LeaderboardMotion.slide(stage.mine) : LeaderboardMotion.leave), value: stage.visible)
                    .allowsHitTesting(false)
                    // In the list too, the list's copy is the one VoiceOver reads.
                    .accessibilityHidden(!offPage)
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func loadBoard() async {
        isLoading = true
        let asked = query
        // A new question: the line was about the old question's board.
        if refreshFailed, boardQuery != asked { refreshFailed = false }
        do {
            let fresh = try await LeaderboardAPI(client: session.client).board(asked)
            guard !Task.isCancelled, asked == query else { return }
            await present(fresh, for: asked)
            guard !Task.isCancelled, asked == query else { return }
            if boardFailed { boardFailed = false }
            if refreshFailed { refreshFailed = false }
            // The default slice is the one "while you were away" follows; what the student has
            // seen here is not news the next time they come back.
            if asked == LeaderboardQuery() { rewards.noteRank(fresh.standing?.rank) }
        } catch {
            guard !Task.isCancelled, asked == query else { return }
            // A pull that fails leaves the working board where it is, and says so in a line;
            // only a board that answers something else (or none yet) gives way to the error.
            let unanswered = board == nil || boardQuery != asked
            if boardFailed != unanswered { boardFailed = unanswered }
            if refreshFailed != !unanswered { refreshFailed = !unanswered }
        }
        isLoading = false
    }

    /// Puts an answer on screen the design's way: the first board rises in once it is laid out;
    /// a new question's board waits for the old one to leave (170 ms) and comes in faster; a pull
    /// that answers the same question just replaces the numbers. Reduce Motion: at once.
    @MainActor
    private func present(_ fresh: LeaderboardBoard, for asked: LeaderboardQuery) async {
        let first = board == nil
        let newQuestion = boardQuery != asked
        if reduceMotion || (!first && !newQuestion) {
            if board != fresh { board = fresh }
            boardQuery = asked
            if !stage.visible { stage = LeaderboardStage(visible: true, swap: !first) }
            return
        }
        if first {
            board = fresh
            boardQuery = asked
            // Laid out hidden first, so there is a rise to see.
            try? await Task.sleep(for: .milliseconds(60))
            stage = LeaderboardStage(visible: true, swap: false)
            return
        }
        stage.visible = false
        try? await Task.sleep(for: LeaderboardMotion.swapGap)
        guard !Task.isCancelled, asked == query else { return }
        // `inlineMine` is kept: the row's geometry only reports a change, so a student who stays
        // at the same place would never be measured again after a reset.
        board = fresh
        boardQuery = asked
        try? await Task.sleep(for: .milliseconds(16))
        stage = LeaderboardStage(visible: true, swap: true)
    }
}

// MARK: - Shared row pieces

/// The rank, in a medal where there is one — by the rank the server gave, never the position.
struct LeaderboardRankBadge: View {
    let rank: Int
    var highlight = false

    var body: some View {
        let medal = RewardsPalette.medal(forRank: rank)
        Text(String(rank))
            .appFont(13, weight: .heavy, monospacedDigits: true)
            .foregroundStyle(medal != nil || highlight ? Color.white : Theme.textSecondary)
            .shadow(color: medal != nil ? Color.black.opacity(0.3) : .clear, radius: 1, x: 0, y: 1)
            .padding(.horizontal, 6)
            .frame(minWidth: 32, minHeight: 32)
            .background {
                let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
                if let medal {
                    shape.fill(medal.fill)
                } else if highlight {
                    shape.fill(Theme.accent)
                } else {
                    shape.fill(Color.primary.opacity(0.06))
                }
            }
    }
}

/// A photo where there is one, initials otherwise — tinted per student, or in the medal's
/// colours on the podium.
struct LeaderboardAvatar: View {
    let row: LeaderboardRow
    var size: CGFloat = 40
    var medal: RewardsPalette.Medal?

    var body: some View {
        let tint = RewardsPalette.tint(forStudent: row.studentId)
        ZStack {
            if let medal {
                Circle().fill(medal.fill)
            } else {
                Circle().fill(tint.opacity(0.16))
            }
            Text(row.initials)
                .font(.system(size: max(11, size * 0.36), weight: .heavy))
                .foregroundStyle(medal == nil ? tint : Color.white)
                .shadow(color: medal == nil ? .clear : Color.black.opacity(0.35), radius: 1, x: 0, y: 1)
            // Signed and expiring: loaded, never stored. A failure leaves the initials showing.
            if let url = row.profileImage {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

struct LeaderboardYouTag: View {
    var body: some View {
        Text("YOU")
            .appFont(10, weight: .heavy)
            .tracking(0.6)
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Theme.accent))
            .fixedSize()
    }
}

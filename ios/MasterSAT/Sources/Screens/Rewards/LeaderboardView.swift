import SwiftUI
import MasterSATKit

/// The school-wide XP board — the native counterpart of the site's `/leaderboard`.
///
/// Three rules this screen keeps that are easy to break:
///
/// - **Ranks are the server's.** On main today the table's ranks are unique (ties broken by
///   earning count) while `my` shares a tied rank. The app shows what it is sent and never
///   renumbers; where the two could disagree on one screen, the visible row wins (`standing`).
/// - **The goal is only ever the next place.** "N XP to reach #k", measured against the row
///   directly above — never the distance from the top.
/// - **No email is ever a name.** A student with no name set comes back as their full address;
///   `LeaderboardRow.displayName` shows the part before the @.
struct LeaderboardView: View {
    @Environment(Session.self) private var session

    /// Global and all-time by default — the web's defaults.
    @State private var query = LeaderboardQuery()
    @State private var board: LeaderboardBoard?
    @State private var boardFailed = false
    @State private var isLoading = true
    @State private var filters: LeaderboardFilters?
    @State private var filtersFailed = false
    /// Lessons in a row, from `/rewards/me/` — a count of the RUN, not the spendable strikes.
    @State private var streak = 0
    @State private var showingFilters = false
    @State private var showingOrdering = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero
                filterBar
                podiumSection
                standingsCard
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // Keyed on the query: a new chip cancels the answer to the old one, so a slow reply
        // can never overwrite a newer board.
        .task(id: query) { await loadBoard() }
        .task { await loadExtras() }
        .refreshable {
            async let board: Void = loadBoard()
            async let extras: Void = loadExtras()
            _ = await (board, extras)
        }
        .sheet(isPresented: $showingFilters) {
            LeaderboardFiltersSheet(query: $query, filters: filters, failed: filtersFailed) {
                await loadFilters()
            }
        }
    }

    // MARK: - Hero

    /// A dash, never a zero, whenever the board has not said — while it loads, when it failed,
    /// and when the student has no standing on this slice.
    private var standing: LeaderboardRow? { boardFailed ? nil : board?.standing }

    private var heroTiles: [HeroTile] {
        var tiles = [
            HeroTile("Your rank", icon: standing?.rank == 1 ? "crown.fill" : "trophy.fill", value: standing.map { "#\($0.rank)" } ?? "—"),
            HeroTile("Your XP", icon: "bolt.fill", value: standing.map { ScoreText.string($0.xp) } ?? "—"),
        ]
        // Named for what it counts — the run, not the strikes — and shown only while there is
        // one to celebrate.
        if streak > 0 {
            tiles.append(HeroTile("In a row", icon: "flame.fill", value: RewardsFormat.count(streak, "lesson")))
        }
        return tiles
    }

    private var hero: some View {
        RewardsHero(
            eyebrow: "Leaderboard",
            eyebrowIcon: "trophy.fill",
            title: "Leaderboard",
            blurb: "Ranked on XP — what you earn by turning up and doing the work."
        ) {
            VStack(alignment: .leading, spacing: 20) {
                RewardsHeroStatGrid(tiles: heroTiles)
                scopeTabs
            }
            .padding(.top, 22)
        }
    }

    /// "My Branch" is hidden rather than shown over an empty board when the student's class has
    /// no branch yet. Until the filters answer, it is shown under its generic name.
    private var visibleScopes: [LeaderboardScope] {
        let hasBranch = filters == nil || filters?.myBranch != nil
        return hasBranch ? [.group, .branch, .global] : [.group, .global]
    }

    private func label(for scope: LeaderboardScope) -> String {
        switch scope {
        case .group: return "My Group"
        case .branch: return filters?.myBranch?.name ?? "My Branch"
        case .global: return "Global"
        }
    }

    private func icon(for scope: LeaderboardScope) -> String {
        switch scope {
        case .group: return "person.3.fill"
        case .branch: return "building.2.fill"
        case .global: return "globe"
        }
    }

    private var scopeTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(visibleScopes, id: \.self) { scope in
                    let active = query.scope == scope
                    Button {
                        query.scope = scope
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: icon(for: scope)).font(.system(size: 13, weight: .bold))
                            Text(label(for: scope)).font(.system(size: 14, weight: .bold)).lineLimit(1)
                        }
                        .foregroundStyle(active ? Theme.accent : Color.white)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(active ? Color.white : Color.black.opacity(0.22))
                        )
                        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
        }
    }

    // MARK: - Filters

    /// Folded behind one button, the way the web folds it. Folded, the bar still says what the
    /// board is filtered to, so nobody has to open it to find out why their number changed.
    private var filterBar: some View {
        let count = query.activeFilterCount
        return HStack(spacing: 10) {
            Button {
                showingFilters = true
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 13, weight: .bold))
                    Text("Filters").font(.system(size: 14, weight: .bold))
                    if count > 0 {
                        Text(ScoreText.string(count))
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(.white)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Circle().fill(Theme.accent))
                    }
                }
                .foregroundStyle(RewardsPalette.accentText)
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.accentSoft))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(count > 0 ? "Filters, \(count) active" : "Filters")

            Text(summary)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .contentShape(Rectangle())
                .onTapGesture { showingFilters = true }

            Spacer(minLength: 0)

            if count > 0 {
                Button {
                    query.resetFilters()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.counterclockwise").font(.system(size: 12, weight: .bold))
                        Text("Reset")
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(RewardsPalette.accentText)
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle(padding: 10)
    }

    /// "This month · Math · Chilonzor", the active parts in the foreground colour.
    private var summary: AttributedString {
        var text = AttributedString()
        for (index, part) in query.summary(using: filters).enumerated() {
            if index > 0 { text += AttributedString("  ·  ") }
            var piece = AttributedString(part.label)
            if part.isActive {
                piece.foregroundColor = .primary
                piece.font = .system(size: 13, weight: .bold)
            }
            text += piece
        }
        return text
    }

    // MARK: - Podium

    /// The top three, in a card of their own. Three people who are the point of the board
    /// should not be the first item of something else.
    @ViewBuilder private var podiumSection: some View {
        if board == nil && isLoading && !boardFailed {
            HStack(alignment: .bottom, spacing: 10) {
                ForEach([140.0, 176.0, 128.0], id: \.self) { height in
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.surface2)
                        .frame(height: height)
                }
            }
            .cardStyle(padding: 16)
            .accessibilityLabel("Loading the leaderboard")
        } else if let board, !boardFailed, !board.podium.isEmpty {
            VStack(spacing: 0) {
                LeaderboardPodium(rows: board.podium)
                    // A new top three replays the rise; the same three do not.
                    .id(board.podium.map(\.studentId))
                if let goal = board.podiumGoal {
                    LeaderboardGoalLine(goal: goal, pill: true).padding(.bottom, 16)
                }
            }
            .frame(maxWidth: .infinity)
            .cardStyle(padding: 0)
            .opacity(isLoading ? 0.6 : 1)
            .animation(.easeInOut(duration: 0.2), value: isLoading)
        }
    }

    // MARK: - Standings

    private var standingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            standingsHeader
            standingsBody

            if let board, !boardFailed, board.showsYourPosition, let my = board.my {
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                    Overline("Your position").padding(.top, 6)
                    LeaderboardStandingRow(row: my, highlight: true, goal: board.goal)
                }
            }

            if let board, !boardFailed, board.my == nil {
                HStack(spacing: 12) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(LinearGradient(colors: [Theme.accent, Theme.accentHover], startPoint: .topLeading, endPoint: .bottomTrailing))
                        )
                    Text("Earn your first XP and you'll appear here.")
                        .font(.system(size: 13, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.accent.opacity(0.06)))
                .accessibilityElement(children: .combine)
            }
        }
        .cardStyle(padding: 16)
    }

    private var standingsHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(RewardsPalette.gold.fill))
                    .shadow(color: RewardsPalette.gold.solid.opacity(0.45), radius: 6, x: 0, y: 3)
                    .accessibilityHidden(true)
                Text("Standings")
                    .font(.system(size: 17, weight: .heavy))
                    .accessibilityAddTraits(.isHeader)
                Button {
                    showingOrdering = true
                } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("How the board is ordered")
                .popover(isPresented: $showingOrdering) { orderingExplainer }
                Spacer(minLength: 0)
                // The rows this answer carries, capped by the server — not how many are ranked.
                if let board, !boardFailed, !board.rows.isEmpty {
                    Chip(text: "Top \(board.count)", tone: .accent)
                }
            }
            // The server's own sentence about what this slice counts, never paraphrased: it is
            // what explains a total that shrank when a filter was pressed.
            if let note = board?.scopeNote, !note.isEmpty, !boardFailed {
                Text(note)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var orderingExplainer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("How the board is ordered")
                .font(.system(size: 15, weight: .heavy))
            Text("It ranks on **XP**, highest first. When two students are level on XP, the one who earned it across more separate awards is placed above — steady work outranks a single big one. The line under the filters says which XP this particular board is counting.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(width: 300)
        .presentationCompactAdaptation(.popover)
    }

    /// Four branches, always: loading, failed, empty, rows. A failure that rendered as an empty
    /// board would tell the student they are alone on it.
    @ViewBuilder private var standingsBody: some View {
        if board == nil && isLoading && !boardFailed {
            VStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.surface2)
                        .frame(height: 56)
                }
            }
        } else if boardFailed {
            RewardsErrorState(
                title: "The leaderboard isn't loading right now.",
                message: "Your XP is safe — only this list failed to load."
            ) { await loadBoard() }
        } else if let board {
            if board.rows.isEmpty {
                DashedEmpty(
                    title: "Nothing on this board yet",
                    hint: "Once XP is earned here, the standings will show up."
                )
            } else if !board.standings.isEmpty {
                let mine = board.myVisibleRow?.studentId
                VStack(spacing: 4) {
                    ForEach(board.standings) { row in
                        LeaderboardStandingRow(
                            row: row,
                            highlight: row.isMe,
                            goal: row.studentId == mine ? board.goal : nil
                        )
                    }
                }
                .opacity(isLoading ? 0.6 : 1)
                .animation(.easeInOut(duration: 0.2), value: isLoading)
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func loadBoard() async {
        isLoading = true
        let asked = query
        let api = LeaderboardAPI(client: session.client)
        do {
            let fresh = try await api.board(asked)
            guard !Task.isCancelled, asked == query else { return }
            board = fresh
            boardFailed = false
        } catch {
            guard !Task.isCancelled, asked == query else { return }
            boardFailed = true
        }
        isLoading = false
    }

    @MainActor
    private func loadExtras() async {
        async let chips: Void = loadFilters()
        async let run: Void = loadStreak()
        _ = await (chips, run)
    }

    @MainActor
    private func loadFilters() async {
        let api = LeaderboardAPI(client: session.client)
        do {
            let fresh = try await api.filters()
            filters = fresh
            filtersFailed = false
            // The branch tab has just been withdrawn; do not leave the student on it.
            if fresh.myBranch == nil && query.scope == .branch {
                query.scope = .global
            }
        } catch {
            filtersFailed = true
        }
    }

    @MainActor
    private func loadStreak() async {
        // Only feeds the "In a row" tile, which is simply not shown without it.
        if let mine = try? await session.rewards.me() {
            streak = mine.currentStreak
        }
    }
}

// MARK: - Filters sheet

/// The chip groups — Time, Subject, and Branch on the global board. A chip applies at once,
/// as on the web; the board behind the sheet reloads while it is open.
private struct LeaderboardFiltersSheet: View {
    @Binding var query: LeaderboardQuery
    let filters: LeaderboardFilters?
    let failed: Bool
    let retry: @MainActor () async -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let filters {
                        if !filters.windows.isEmpty {
                            group("Time") {
                                ForEach(filters.windows) { window in
                                    chip(window.label, active: query.window == window.value) { query.window = window.value }
                                }
                            }
                        }
                        group("Subject") {
                            chip("All subjects", active: query.subject == nil) { query.subject = nil }
                            ForEach(filters.subjects) { subject in
                                chip(subject.label, active: query.subject == subject.value) { query.subject = subject.value }
                            }
                        }
                        // A branch filter only means anything on the global board; inside
                        // "My Branch" the scope has already decided it.
                        if query.scope == .global && !filters.branches.isEmpty {
                            group("Branch") {
                                chip("All branches", active: query.branchId == nil) { query.branchId = nil }
                                ForEach(filters.branches) { branch in
                                    chip(branch.name, active: query.branchId == branch.id) { query.branchId = branch.id }
                                }
                            }
                        }
                    } else if failed {
                        RewardsErrorState(
                            title: "The filters aren't loading right now.",
                            message: "The board itself is unaffected — only the filter choices failed to load."
                        ) { await retry() }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if query.activeFilterCount > 0 {
                        Button("Reset") { query.resetFilters() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func group<Chips: View>(_ label: String, @ViewBuilder chips: () -> Chips) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Overline(label)
            RewardsFlowLayout(spacing: 8) { chips() }
        }
    }

    private func chip(_ title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .lineLimit(1)
                .foregroundStyle(active ? Color.white : Theme.textSecondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(active ? Theme.accent : Theme.surface2))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

// MARK: - Hero stats

/// Two columns of hero totals — `HeroHeader`'s own tile grid, for `RewardsHero`.
struct RewardsHeroStatGrid: View {
    let tiles: [HeroTile]

    var body: some View {
        let rows = stride(from: 0, to: tiles.count, by: 2).map { Array(tiles[$0..<min($0 + 2, tiles.count)]) }
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 28) {
                    ForEach(row) { tile in
                        RewardsHeroStat(label: tile.label, icon: tile.icon, value: tile.value)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if row.count == 1 { Spacer(minLength: 0).frame(maxWidth: .infinity) }
                }
            }
        }
    }
}

// MARK: - Rows

/// One place in the standings: rank, face, name, where they study, XP — and, on the student's
/// own row, the next place to reach.
struct LeaderboardStandingRow: View {
    let row: LeaderboardRow
    var highlight = false
    var goal: LeaderboardGoal?

    var body: some View {
        HStack(spacing: 10) {
            LeaderboardRankBadge(rank: row.rank, highlight: highlight)
            LeaderboardAvatar(row: row, size: 40)
            // Name over branch, the XP on the branch line: a phone cannot spare a right-hand
            // column without cutting the name short.
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.displayName)
                        .font(.system(size: 14, weight: .bold))
                        .lineLimit(1)
                    if row.isMe { LeaderboardYouTag() }
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.place)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(ScoreText.string(row.xp))
                            .font(.system(size: 14, weight: .heavy))
                            .monospacedDigit()
                        Text("XP")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .fixedSize()
                }
                if let goal {
                    LeaderboardGoalLine(goal: goal).padding(.top, 2)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 10)
        .background {
            if highlight {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Theme.accent.opacity(0.07))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Theme.accent.opacity(0.3), lineWidth: 1)
                    )
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var parts = ["Rank \(row.rank)", row.displayName]
        if row.isMe { parts.append("you") }
        parts.append(row.place)
        parts.append("\(row.xp) XP")
        if let goal { parts.append(goal.text) }
        return parts.joined(separator: ", ")
    }
}

/// The rank, in a medal where there is one — by the rank the server gave, never the position.
struct LeaderboardRankBadge: View {
    let rank: Int
    var highlight = false

    var body: some View {
        let medal = RewardsPalette.medal(forRank: rank)
        Text(String(rank))
            .font(.system(size: 13, weight: .heavy))
            .monospacedDigit()
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
            .font(.system(size: 10, weight: .heavy))
            .tracking(0.6)
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Theme.accent))
            .fixedSize()
    }
}

/// "120 XP to reach #4". Growth-oriented by construction: it names the next place, never the
/// distance from the top.
struct LeaderboardGoalLine: View {
    let goal: LeaderboardGoal
    var pill = false

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.up.forward").font(.system(size: pill ? 12 : 10, weight: .bold))
            Text(goal.text).font(.system(size: pill ? 12 : 11, weight: .bold))
        }
        .foregroundStyle(RewardsPalette.accentText)
        .padding(.horizontal, pill ? 12 : 0)
        .padding(.vertical, pill ? 7 : 0)
        .background {
            if pill { Capsule().fill(Theme.accent.opacity(0.1)) }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Podium

/// The first three, stood on a podium.
///
/// The staging is the point, and it runs bottom-up: **third rises, then second, then the
/// winner**, and each person appears only once their own step is standing. A podium drawn
/// complete on the first frame is a photograph of a podium — the owner's word for the web's
/// first version was *huddi rasmdek*, "just like a picture". Timings are the web's own
/// (`lb-stepRise`, `lb-numeralIn`, `lb-profileIn` in globals.css); Reduce Motion draws the
/// finished podium at once.
struct LeaderboardPodium: View {
    /// In rank order.
    let rows: [LeaderboardRow]

    @State private var staged = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The leader in the middle, second on the left, third on the right.
    private var onScreen: [LeaderboardRow] {
        rows.count >= 3 ? [rows[1], rows[0], rows[2]] : rows
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(onScreen) { row in
                LeaderboardPodiumColumn(row: row, staged: staged, reduceMotion: reduceMotion)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 30)
        .frame(maxWidth: .infinity)
        .background(stage)
        .task { staged = true }
        // Rank order for VoiceOver: a screen reader hears 1, 2, 3, not 2, 1, 3.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rows.map { "Rank \($0.rank), \($0.displayName)\($0.isMe ? ", you" : ""), \($0.xp) XP" }.joined(separator: ". "))
    }

    /// A warm light over the winner, over a wash of the house blue, with a little confetti.
    private var stage: some View {
        ZStack {
            LinearGradient(colors: [Theme.accent.opacity(0.10), .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.88))
            RadialGradient(colors: [RewardsPalette.crown.opacity(0.26), .clear], center: .top, startRadius: 0, endRadius: 190)
            GeometryReader { geometry in
                ForEach(Array(Self.confetti.enumerated()), id: \.offset) { _, dot in
                    Circle()
                        .fill(dot.colour)
                        .opacity(dot.opacity)
                        .frame(width: dot.size, height: dot.size)
                        .position(x: geometry.size.width * dot.x, y: geometry.size.height * dot.y)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static let confetti: [(x: CGFloat, y: CGFloat, size: CGFloat, colour: Color, opacity: Double)] = [
        (0.04, 0.14, 8, RewardsPalette.tint(forStudent: 4), 0.55),
        (0.11, 0.42, 5, RewardsPalette.tint(forStudent: 1), 0.65),
        (0.27, 0.07, 6, RewardsPalette.crown, 0.8),
        (0.72, 0.09, 5, RewardsPalette.tint(forStudent: 2), 0.65),
        (0.88, 0.18, 8, RewardsPalette.tint(forStudent: 5), 0.5),
        (0.95, 0.46, 5, RewardsPalette.tint(forStudent: 0), 0.6),
    ]
}

private struct LeaderboardPodiumColumn: View {
    let row: LeaderboardRow
    let staged: Bool
    let reduceMotion: Bool

    /// Ranks can tie; a medal follows the rank. Anything outside 1–3 stands on the third step.
    private var place: Int { (1...3).contains(row.rank) ? row.rank : 3 }
    private var medal: RewardsPalette.Medal { RewardsPalette.medal(forRank: place) ?? RewardsPalette.bronze }
    private var isWinner: Bool { place == 1 }
    /// Third at 0 ms, the winner last, so the eye finishes on the crown. Derived from the
    /// place, never from where the column sits on screen.
    private var barDelay: Double { Double(3 - place) * 0.17 }
    private var profileDelay: Double { barDelay + 0.62 }
    private var stepHeight: CGFloat { [96, 64, 44][place - 1] }

    private func ease(_ duration: Double, delay: Double) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.22, 1, 0.36, 1, duration: duration).delay(delay)
    }

    var body: some View {
        VStack(spacing: 0) {
            person
                .opacity(staged ? 1 : 0)
                .scaleEffect(staged ? 1 : 0.92, anchor: .bottom)
                .offset(y: staged ? 0 : 16)
                .animation(ease(0.55, delay: profileDelay), value: staged)
            step.padding(.top, 12)
        }
    }

    private var person: some View {
        VStack(spacing: 0) {
            if isWinner {
                Image(systemName: "crown.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(RewardsPalette.crown)
                    .shadow(color: RewardsPalette.crown.opacity(0.55), radius: 4, x: 0, y: 3)
                    .padding(.bottom, 4)
            }
            LeaderboardMedalAvatar(
                row: row,
                medal: medal,
                size: isWinner ? 72 : 54,
                place: place,
                sparkDelay: profileDelay,
                reduceMotion: reduceMotion
            )
            // Two lines rather than an ellipsis: each step has under a hundred points, and the
            // three names are the point of the podium.
            Text(row.displayName)
                .font(.system(size: 13, weight: .heavy))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
                .padding(.horizontal, 2)
            if row.isMe {
                LeaderboardYouTag().padding(.top, 4)
            }
            Text(row.branch ?? "No branch yet")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .padding(.top, 2)
                .padding(.horizontal, 2)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(ScoreText.string(row.xp))
                    .font(.system(size: 18, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(isWinner ? medal.solid : Color.primary)
                Text("XP")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
    }

    /// Full height from the first frame; only its fill grows, so nothing below it moves.
    private var step: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12, style: .continuous)
        return ZStack(alignment: .top) {
            ZStack {
                shape.fill(medal.fill)
                shape.fill(
                    LinearGradient(
                        colors: [Color.white.opacity(0.28), Color.white.opacity(0), Color.black.opacity(0.16)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                if !reduceMotion {
                    LeaderboardStepShine(delay: barDelay + 0.95).clipShape(shape)
                }
            }
            .shadow(color: medal.solid.opacity(0.45), radius: 10, x: 0, y: 6)
            .scaleEffect(x: 1, y: staged ? 1 : 0, anchor: .bottom)
            .animation(ease(0.7, delay: barDelay), value: staged)

            Text(String(row.rank))
                .font(.system(size: 30, weight: .heavy))
                .foregroundStyle(.white)
                .shadow(color: Color.black.opacity(0.35), radius: 3, x: 0, y: 2)
                .padding(.top, 6)
                .opacity(staged ? 1 : 0)
                .offset(y: staged ? 0 : 10)
                .animation(ease(0.45, delay: barDelay + 0.34), value: staged)
        }
        .frame(maxWidth: .infinity)
        .frame(height: stepHeight)
        .accessibilityHidden(true)
    }
}

/// The avatar in its medal ring. The winner alone gets the breathing halo and the turning
/// ring — two effects on one avatar is a lot; on all three it would be noise.
private struct LeaderboardMedalAvatar: View {
    let row: LeaderboardRow
    let medal: RewardsPalette.Medal
    let size: CGFloat
    let place: Int
    let sparkDelay: Double
    let reduceMotion: Bool

    @State private var spinning = false
    @State private var breathing = false

    /// Three sparks per column, never in the same places twice, so the three medals do not
    /// twinkle in unison. Positions are fractions of the avatar, from the web's `SPARKS`.
    private static let sparks: [[(x: CGFloat, y: CGFloat, size: CGFloat, delay: Double)]] = [
        [(-0.14, 0.06, 11, 0), (0.96, 0.28, 8, 0.7), (0.84, -0.08, 7, 1.5)],
        [(-0.12, 0.22, 8, 0.4), (0.92, 0.08, 9, 1.2), (0.10, -0.10, 6, 1.9)],
        [(0.94, 0.18, 9, 0.25), (-0.10, -0.04, 7, 1.05), (0.78, 0.92, 6, 1.75)],
    ]

    var body: some View {
        ZStack {
            if place == 1 {
                Circle()
                    .fill(RadialGradient(colors: [RewardsPalette.crown, .clear], center: .center, startRadius: 0, endRadius: (size + 34) / 2))
                    .frame(width: size + 34, height: size + 34)
                    .opacity(reduceMotion ? 0.5 : (breathing ? 0.8 : 0.38))
                    .scaleEffect(breathing ? 1.07 : 1)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 1.6).repeatForever(autoreverses: true), value: breathing)
                Circle()
                    .fill(AngularGradient(colors: [RewardsPalette.crown, .white, medal.solid, RewardsPalette.crown], center: .center))
                    .frame(width: size + 14, height: size + 14)
                    .opacity(0.9)
                    .rotationEffect(.degrees(spinning ? 360 : 0))
                    .animation(reduceMotion ? nil : .linear(duration: 7).repeatForever(autoreverses: false), value: spinning)
            }
            Circle()
                .fill(medal.fill)
                .frame(width: size + 10, height: size + 10)
                .shadow(color: medal.solid.opacity(0.6), radius: 8, x: 0, y: 5)
            Circle()
                .fill(Theme.card)
                .frame(width: size + 4, height: size + 4)
            LeaderboardAvatar(row: row, size: size, medal: medal)

            if !reduceMotion {
                ForEach(Array(Self.sparks[place - 1].enumerated()), id: \.offset) { index, spark in
                    LeaderboardSpark(
                        colour: index == 1 ? .white : RewardsPalette.crown,
                        size: spark.size,
                        delay: sparkDelay + spark.delay
                    )
                    .position(x: size * spark.x + 5 + spark.size / 2, y: size * spark.y + 5 + spark.size / 2)
                }
            }
        }
        .frame(width: size + 10, height: size + 10)
        .task {
            guard !reduceMotion else { return }
            spinning = true
            breathing = true
        }
    }
}

/// A four-point star catching the light now and then.
private struct LeaderboardSpark: View {
    let colour: Color
    let size: CGFloat
    let delay: Double

    @State private var lit = false

    var body: some View {
        LeaderboardSparkShape()
            .fill(colour)
            .frame(width: size, height: size)
            .opacity(lit ? 1 : 0)
            .scaleEffect(lit ? 1 : 0.3)
            .rotationEffect(.degrees(lit ? 70 : 0))
            .animation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true).delay(delay), value: lit)
            .task { lit = true }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private struct LeaderboardSparkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let points: [(CGFloat, CGFloat)] = [
            (0.5, 0), (0.61, 0.39), (1, 0.5), (0.61, 0.61),
            (0.5, 1), (0.39, 0.61), (0, 0.5), (0.39, 0.39),
        ]
        var path = Path()
        for (index, point) in points.enumerated() {
            let p = CGPoint(x: rect.minX + rect.width * point.0, y: rect.minY + rect.height * point.1)
            if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }
}

/// The glint that travels across a step now and then — held off the step until it has risen,
/// then a pass, then a long rest so it reads as an occasional catch of light.
private struct LeaderboardStepShine: View {
    let delay: Double

    var body: some View {
        GeometryReader { geometry in
            // Plain numbers into the animator: its content closure is @Sendable, and the
            // proxy itself is not.
            let band = geometry.size.width * 0.26
            let height = geometry.size.height
            LinearGradient(colors: [.clear, Color.white.opacity(0.6), .clear], startPoint: .leading, endPoint: .trailing)
                .frame(width: band, height: height * 1.4)
                .rotationEffect(.degrees(12))
                .keyframeAnimator(initialValue: -2.2, repeating: true) { content, position in
                    content.offset(x: band * position, y: -height * 0.2)
                } keyframes: { _ in
                    KeyframeTrack {
                        LinearKeyframe(-2.2, duration: delay)
                        CubicKeyframe(6.2, duration: 1.6)
                        LinearKeyframe(6.2, duration: 2.6)
                    }
                }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

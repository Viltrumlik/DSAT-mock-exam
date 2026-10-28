import Foundation

// The new look's Today (owner, 2026-10-28; mockups 10 and 17): the four stat cards over the band,
// the compact Up next, the leaderboard sheet's short board and the Shop rail. Every word and every
// choice of row is made here, so it is tested rather than eyeballed (`TodayLookTests`); the views
// only draw what these return.

// MARK: - The stat cards

/// What one stat card prints: the figure, the caps caption under it, and the one sentence
/// VoiceOver reads for the whole card.
public struct TodayStatFigure: Sendable, Equatable {
    /// "29", "#12", or "—" while the figure is not known.
    public let value: String
    /// "Coins", "XP", "Strike", "Leaderboard" — drawn in caps.
    public let caption: String
    public let spoken: String
}

/// The four cards: Coins · XP · Strike · Leaderboard rank.
///
/// Figures are plain integers, never grouped by a locale (`RewardsFormat`): a balance printed
/// "1,204" on one screen and "1204" on the next reads as two numbers.
public enum TodayStats {
    /// Shown while a figure has not been read yet. Never "0": a figure not yet known is not a
    /// figure of nothing.
    public static let unknown = "—"

    public static func coins(_ coins: Int?) -> TodayStatFigure {
        guard let coins else {
            return TodayStatFigure(value: unknown, caption: "Coins", spoken: "Coins, loading")
        }
        return TodayStatFigure(value: String(coins), caption: "Coins", spoken: RewardsFormat.count(coins, "coin"))
    }

    public static func xp(_ xp: Int?) -> TodayStatFigure {
        guard let xp else {
            return TodayStatFigure(value: unknown, caption: "XP", spoken: "XP, loading")
        }
        return TodayStatFigure(value: String(xp), caption: "XP", spoken: "\(xp) XP")
    }

    /// The Strike card: `current_streak`, the lessons attended in a row — the run the server
    /// re-derives from the register and breaks to 0 on a missed lesson. Captioned "Strike",
    /// never "streak" or "days" (owner). The spendable balance lives in the Strikes window.
    ///
    /// A run of nothing is said as an invitation, not as a zero: "0 lessons in a row" reads as a
    /// failure, and the student is one lesson away from a run (`StrikesWindow.runLine`).
    public static func strike(_ run: Int?) -> TodayStatFigure {
        guard let run else {
            return TodayStatFigure(value: unknown, caption: "Strike", spoken: "Strike, loading")
        }
        let spoken = run > 0
            ? "\(RewardsFormat.count(run, "strike")), \(RewardsFormat.count(run, "lesson")) in a row"
            : "No strike run yet — your next lesson starts one"
        return TodayStatFigure(value: String(run), caption: "Strike", spoken: spoken)
    }

    /// The place on the hero board (global, all time, XP) — the board the Rewards hero and the XP
    /// window read, so the three never disagree. `read` says whether that board has answered: an
    /// unread place is loading, a read board without the student on it is "not on the board yet".
    /// A place is an identifier, so it is never grouped ("#1204", not "#1,204").
    public static func rank(_ rank: Int?, read: Bool) -> TodayStatFigure {
        if let rank {
            return TodayStatFigure(value: "#\(rank)", caption: "Leaderboard", spoken: "Number \(rank) on the leaderboard")
        }
        return TodayStatFigure(
            value: unknown,
            caption: "Leaderboard",
            spoken: read ? "Not on the leaderboard yet" : "Leaderboard place, loading"
        )
    }
}

// MARK: - Up next, compact

/// Up next in the new look: one-line rows, at most three, then "See all" (owner: mockup 17's
/// rows took too much room).
public enum UpNextCompact {
    /// How many rows Today shows.
    public static let limit = 3

    /// The first `limit` of Today's work in its own order — homework (catching up first, then by
    /// deadline), then today's lessons — and how many did not fit. A lesson that does not fit is
    /// counted too: "See all" is owed whenever something is left off.
    public static func select(_ plan: TodayPlan, limit: Int = UpNextCompact.limit) -> (items: [WorkItem], more: Int) {
        let all = plan.homework + plan.lessons
        let shown = Array(all.prefix(max(0, limit)))
        return (shown, all.count - shown.count)
    }

    /// What the small chip on a row says.
    public struct Chip: Sendable, Equatable {
        public enum Tone: Sendable, Equatable {
            /// A deadline ahead.
            case due
            /// Past its deadline and still owed: "Catch up · Tue". Information, never an accusation.
            case catchUp
            /// One of today's lessons.
            case lesson
        }

        /// What the chip prints. A catch-up prints its day alone ("Tue") — its orange and its
        /// icon say "catch up", which keeps a one-line row's title from being cut to "Pra…".
        public let text: String
        public let tone: Tone
        /// The whole phrase, for VoiceOver: "Catch up · Tue", "Due Thu", "Today · 16:00".
        public let spoken: String

        public init(text: String, tone: Tone, spoken: String? = nil) {
            self.text = text
            self.tone = tone
            self.spoken = spoken ?? text
        }
    }

    /// "Due Thu", "Due Nov 6", a catch-up's "Tue" (spoken "Catch up · Tue") for homework; the start time ("16:00") or "Today"
    /// for a lesson. Nil for homework with no deadline.
    ///
    /// The weekday within six days, the date beyond (the app's `DueLabel` rule), on the
    /// learning center's calendar, whatever time zone the phone is in.
    public static func chip(for item: WorkItem, now: Date, calendar: Calendar, locale: Locale = .autoupdatingCurrent) -> Chip? {
        switch item.source {
        case .homework:
            guard let due = item.dueAt.flatMap(JSONCoding.parseServerDate) else { return nil }
            let days = abs(calendar.dateComponents([.day], from: now, to: due).day ?? 0)
            let formatter = DateFormatter()
            formatter.locale = locale
            formatter.calendar = calendar
            formatter.timeZone = calendar.timeZone
            formatter.setLocalizedDateFormatFromTemplate(days <= 6 ? "EEE" : "MMMd")
            let label = formatter.string(from: due)
            return item.catchUp
                ? Chip(text: label, tone: .catchUp, spoken: "Catch up · \(label)")
                : Chip(text: "Due \(label)", tone: .due)
        case .lesson:
            // "16:00-18:00" → "16:00": the chip says when it starts; a lesson the schedule gave no
            // clock time says the day only — never "00:00".
            guard let clock = item.clockText else { return Chip(text: "Today", tone: .lesson) }
            let start = clock.split(separator: "-", maxSplits: 1).first.map {
                $0.trimmingCharacters(in: .whitespaces)
            } ?? clock
            return start.isEmpty
                ? Chip(text: "Today", tone: .lesson)
                : Chip(text: start, tone: .lesson, spoken: "Today · \(start)")
        }
    }

    /// "up to +15 XP" — only where the homework still pays (`WorkItem.xpCap` is set by the live
    /// rule, and only while the deadline is ahead). Nil everywhere else: XP is printed only where
    /// it is real.
    public static func xpChip(for item: WorkItem) -> String? {
        item.xpCap.map { "up to +\($0) XP" }
    }
}

// MARK: - The leaderboard sheet's short board

/// The board the leaderboard sheet shows (mockup 13): the top three, a gap, then the places
/// around the student — or, when the student is near the top, one unbroken run.
public enum LeaderboardSnippet {
    public enum Line: Sendable, Equatable, Identifiable {
        case row(LeaderboardRow)
        /// Places left out between two runs: drawn as three dots.
        case gap(after: Int)

        public var id: String {
            switch self {
            case .row(let row): return "row-\(row.studentId)-\(row.rank)"
            case .gap(let after): return "gap-\(after)"
            }
        }
    }

    /// `around` rows either side of the student. Rows are the server's, in the server's order and
    /// with the server's ranks — nothing here ranks anybody.
    ///
    /// - The student in the rows: the top three, then `around` either side of them; joined into one
    ///   run when the two touch.
    /// - The student below the rows (`my` only): the top three, a gap, their own row.
    /// - No standing: the top `3 + 2 × around` rows.
    public static func lines(_ board: LeaderboardBoard, around: Int = 2) -> [Line] {
        let rows = board.rows
        guard !rows.isEmpty || board.my != nil else { return [] }
        let top = min(3, rows.count)
        let mine = board.my.flatMap { my in rows.firstIndex { $0.studentId == my.studentId } }

        var picked = Set(0..<top)
        if let mine {
            let low = max(0, mine - around)
            let high = min(rows.count - 1, mine + around)
            picked.formUnion(low...high)
        } else if board.my == nil {
            picked.formUnion(0..<min(rows.count, 3 + 2 * around))
        }

        var lines: [Line] = []
        var previous: Int?
        for index in picked.sorted() {
            if let previous, index > previous + 1 { lines.append(.gap(after: rows[previous].rank)) }
            lines.append(.row(rows[index]))
            previous = index
        }
        if mine == nil, let my = board.my {
            // Below every row the response carries: their own row, after a gap.
            if let last = rows.last, last.studentId != my.studentId { lines.append(.gap(after: last.rank)) }
            lines.append(.row(my))
        }
        return lines
    }
}

// MARK: - The Shop rail

/// What Today's Shop rail offers: real items from the storefront, coin shelf first, then the
/// strike shelf, active ones only, at most `limit`.
public enum ShopRail {
    public static let limit = 8

    public static func items(_ storefront: Storefront, limit: Int = ShopRail.limit) -> [ShopItem] {
        let shelved = storefront.coinItems.sorted(by: order) + storefront.strikeItems.sorted(by: order)
        return Array(shelved.filter(\.isActive).prefix(max(0, limit)))
    }

    /// The shelf's own order: the admin's sort order, then the oldest first.
    private static func order(_ a: ShopItem, _ b: ShopItem) -> Bool {
        a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.id < b.id
    }

    /// "1200" for a coin price, "15 strikes" for a strike price — the coin's own picture says
    /// "coins", so the word is left off there.
    public static func priceText(_ item: ShopItem) -> String {
        item.isCoin ? String(item.price) : RewardsFormat.count(item.price, "strike")
    }
}

// MARK: - First sign-in steps

extension ProfileCompletion {
    /// "Step 1 of 3" — where `step` stands among the steps owed when the gate opened. Counted off
    /// the server's own list of missing fields, so no server change; nil when the gate owes a
    /// single step (a chip reading "Step 1 of 1" says nothing) or the step is not one of them.
    public static func position(of step: Step, owedAtStart missing: [String]) -> (number: Int, total: Int)? {
        let owed = Step.allCases.filter { !isCleared($0, in: missing) }
        guard owed.count > 1, let index = owed.firstIndex(of: step) else { return nil }
        return (index + 1, owed.count)
    }
}

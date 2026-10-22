import Foundation

/// Which slice of the learning center a board ranks. "Group" is this school's word for a class.
public enum LeaderboardScope: String, Sendable, Hashable, CaseIterable {
    case group = "GROUP"
    case branch = "BRANCH"
    case global = "GLOBAL"
}

/// What a board ranks: XP earned, or the run of lessons attended right now (`?metric=STRIKES`,
/// the server's #302). The strike board ranks the RUN, never the spendable balance.
public enum LeaderboardMetric: String, Sendable, Hashable, CaseIterable {
    case xp = "XP"
    case strikes = "STRIKES"
}

/// What a board is being asked for. Everything the web sends, and nothing it does not: `level`
/// goes out only as its server default, so it is not sent at all. `limit` is sent only when a
/// caller asks for a page size (the Rewards hero asks for the server's maximum, so its "to pass"
/// line reaches past the default top 50); with none, the server's default page is what comes back.
public struct LeaderboardQuery: Sendable, Hashable {
    public static let allTime = "ALL"
    public static let thisMonth = "MONTH"

    /// Global by default — the web's default tab.
    public var scope: LeaderboardScope
    /// A server value (`ALL`, `MONTH`). A string rather than an enum: the chips are served, and
    /// the board coerces anything it does not know back to all-time rather than refusing it.
    public var window: String
    /// `ENGLISH` / `MATH`, or nil for all subjects.
    public var subject: String?
    /// Only means anything on the global board. Kept while another tab is open — the web keeps
    /// it too — but never sent there: inside "My Branch" the scope has already decided it.
    public var branchId: Int?
    /// XP by default — the server's default, so it is only ever sent as `STRIKES`.
    public var metric: LeaderboardMetric
    /// How many rows to ask for; nil asks for the server's default page (50) and sends nothing.
    /// Not a filter: it does not count toward `activeFilterCount`, appears in no `summary`, and
    /// `resetFilters` leaves it alone. Sent as given — the server clamps it to 1…200.
    public var limit: Int?

    public init(
        scope: LeaderboardScope = .global,
        window: String = LeaderboardQuery.allTime,
        subject: String? = nil,
        branchId: Int? = nil,
        metric: LeaderboardMetric = .xp,
        limit: Int? = nil
    ) {
        self.scope = scope
        self.window = window
        self.subject = subject
        self.branchId = branchId
        self.metric = metric
        self.limit = limit
    }

    /// The one question the app asks to learn the student's place: the default board — global, all
    /// time, XP — at the server's largest page, so "N XP to pass <name>" reaches the row above a
    /// student who is deep in the board (Ruling P3-R3). The Rewards hero and the welcome-back check
    /// both ask exactly this, so a place noted by either is the same number. The full leaderboard
    /// page keeps the default page.
    public static let heroBoard = LeaderboardQuery(limit: 200)

    /// Whether the branch filter applies to the board being asked for.
    public var branchApplies: Bool { scope == .global && branchId != nil }

    public var queryItems: [URLQueryItem] {
        var items = [URLQueryItem(name: "scope", value: scope.rawValue)]
        if metric == .strikes {
            // A run is now, and it belongs to the student rather than to a subject: the server
            // forces all time and ignores the subject on this board, so neither is sent.
            items.append(URLQueryItem(name: "metric", value: metric.rawValue))
        } else {
            items.append(URLQueryItem(name: "window", value: window))
            if let subject, !subject.isEmpty { items.append(URLQueryItem(name: "subject", value: subject)) }
        }
        if branchApplies, let branchId { items.append(URLQueryItem(name: "branch", value: String(branchId))) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return items
    }

    /// How many filters are narrowing the board — the badge on the Filters button. On the strike
    /// board only the branch narrows anything.
    public var activeFilterCount: Int {
        if metric == .strikes { return branchApplies ? 1 : 0 }
        return (window != Self.allTime ? 1 : 0) + (subject != nil ? 1 : 0) + (branchApplies ? 1 : 0)
    }

    /// Back to all time, all subjects, all branches. The scope tab is not a filter.
    public mutating func resetFilters() {
        window = Self.allTime
        subject = nil
        branchId = nil
    }

    /// The folded Filters bar says what the board is filtered to, so nobody has to open it to
    /// find out why their number changed. Labels come from the served chips; the fallbacks cover
    /// the moment before they arrive, or a failure to fetch them.
    public func summary(using filters: LeaderboardFilters?) -> [LeaderboardSummaryPart] {
        var parts = [
            LeaderboardSummaryPart(
                label: filters?.windowLabel(window) ?? LeaderboardFilters.fallbackWindowLabel(window),
                isActive: window != Self.allTime
            ),
            LeaderboardSummaryPart(
                label: subject.map { filters?.subjectLabel($0) ?? $0 } ?? "All subjects",
                isActive: subject != nil
            ),
        ]
        if branchApplies, let branchId {
            parts.append(LeaderboardSummaryPart(label: filters?.branchName(branchId) ?? "Branch", isActive: true))
        }
        return parts
    }
}

public struct LeaderboardSummaryPart: Sendable, Equatable, Hashable {
    public let label: String
    public let isActive: Bool
}

/// One student on a board.
public struct LeaderboardRow: Decodable, Identifiable, Sendable, Equatable, Hashable {
    /// The SERVER's rank, shown as-is. The app never ranks anybody: on main today the table and
    /// `my` number ties the same way (competition ranks — tied students share a place, and the
    /// next is skipped), and a client that renumbered either would disagree with the site.
    public let rank: Int
    public let studentId: Int
    /// As the server wrote it — which, for a student with no name set, can be a full email
    /// address. Never shown raw: see `displayName`.
    public let name: String
    /// Absolute and signed: cache briefly at most.
    public let profileImageURL: String?
    public let xp: Int
    /// How many earnings are behind the total — the tie-break.
    public let awards: Int
    public let branch: String?
    public let region: String?
    public let isMe: Bool
    /// The run of lessons attended — filled on the strike board only (`xp` is 0 there).
    public let strikes: Int?

    public var id: Int { studentId }

    public init(
        rank: Int,
        studentId: Int,
        name: String,
        profileImageURL: String? = nil,
        xp: Int,
        awards: Int = 0,
        branch: String? = nil,
        region: String? = nil,
        isMe: Bool = false,
        strikes: Int? = nil
    ) {
        self.rank = rank
        self.studentId = studentId
        self.name = name
        self.profileImageURL = profileImageURL
        self.xp = xp
        self.awards = awards
        self.branch = branch
        self.region = region
        self.isMe = isMe
        self.strikes = strikes
    }

    enum CodingKeys: String, CodingKey {
        case rank, name, xp, awards, branch, region, strikes
        case studentId = "student_id"
        case profileImageURL = "profile_image_url"
        case isMe = "is_me"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank = try c.rewardsRequiredInt(.rank)
        studentId = try c.decode(Int.self, forKey: .studentId)
        name = c.rewardsString(.name) ?? ""
        profileImageURL = c.rewardsString(.profileImageURL).flatMap { $0.isEmpty ? nil : $0 }
        xp = c.rewardsInt(.xp) ?? 0
        awards = c.rewardsInt(.awards) ?? 0
        branch = c.rewardsString(.branch).flatMap { $0.isEmpty ? nil : $0 }
        region = c.rewardsString(.region).flatMap { $0.isEmpty ? nil : $0 }
        isMe = c.rewardsBool(.isMe) ?? false
        strikes = c.rewardsInt(.strikes)
    }

    /// The name to put on screen. See `LeaderboardName.display`.
    public var displayName: String { LeaderboardName.display(name) }

    /// Up to two letters, the web's `Avatar` rule, taken from the name as displayed.
    public var initials: String { LeaderboardName.initials(displayName) }

    /// Branch and region are the whole reason a school-wide board is worth crossing classes
    /// for — without them a row is a name and a number with no context.
    public var place: String {
        guard let branch else { return "No branch yet" }
        guard let region else { return branch }
        return "\(branch) · \(region)"
    }

    public var profileImage: URL? { profileImageURL.flatMap(URL.init(string:)) }
}

/// Names on a school-wide board.
public enum LeaderboardName {
    /// The name as it may be shown to every student in the learning center.
    ///
    /// **Privacy.** The server falls back from a full name to the username and then to the
    /// **full email address** for a student who has set neither (`_display_name` in
    /// `classes/views_rankings.py`) — and this board is read by the whole school. Anything that
    /// looks like an address is cut to the part before the `@`, so a student's inbox is never
    /// published. The real fix is server-side; until then the app does not repeat it.
    public static func display(_ raw: String) -> String {
        shown(raw) ?? "Student"
    }

    /// `display` without its stand-in: nil when there is no name to show at all. For a sentence
    /// that names somebody in passing, where "pass Student" would read as a name.
    public static func shown(_ raw: String) -> String? {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        guard looksLikeEmail(name) else { return name }
        let local = name.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return local.isEmpty ? nil : local
    }

    /// `something@something.tld`, with no spaces — a name with an "@" in a sentence is left alone.
    public static func looksLikeEmail(_ text: String) -> Bool {
        guard !text.contains(where: \.isWhitespace) else { return false }
        let parts = text.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return false }
        let domain = parts[1]
        return !domain.isEmpty && domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
    }

    /// The first word of a shown name — "Malika" for "Malika Karimova" — for a line that names
    /// somebody in passing. "Student" when there is nothing to show.
    public static func firstName(_ name: String) -> String {
        name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "Student"
    }

    /// First letters of the first two words, upper-cased; "?" when there are none.
    public static func initials(_ name: String) -> String {
        let letters = name
            .split(whereSeparator: \.isWhitespace)
            .prefix(2)
            .compactMap { $0.first.map { String($0).uppercased() } }
            .joined()
        return letters.isEmpty ? "?" : letters
    }
}

/// What it takes to move up one place.
public struct LeaderboardGoal: Sendable, Equatable {
    public let xp: Int
    public let rank: Int

    /// "120 XP to reach #4" — growth-oriented by construction: it names the next place, never
    /// the distance from the top.
    public var text: String { "\(xp) XP to reach #\(rank)" }
}

/// "120 XP to pass Malika" — the next student up, by name. Growth-oriented by construction: it
/// names the one place to take next, never the distance from the top.
public struct LeaderboardPass: Sendable, Equatable {
    /// The first name, or nil for a student with no name to show — passed as "the next student".
    public let name: String?
    public let xp: Int
    public let rank: Int

    public init(name: String?, xp: Int, rank: Int) {
        self.name = name
        self.xp = xp
        self.rank = rank
    }

    public var text: String { "\(xp) XP to pass \(name ?? "the next student")" }
}

/// `GET /api/rewards/leaderboard/`.
public struct LeaderboardBoard: Decodable, Sendable, Equatable {
    /// What this board ranks — the meta the server sends back. An older server that never sent
    /// it only ever had the XP board.
    public let metric: LeaderboardMetric
    public let scope: String
    public let window: String
    public let branchId: Int?
    public let classroomId: Int?
    public let subject: String?
    public let level: String?
    /// The rows this response carries, capped by the server — not how many are ranked.
    public let count: Int
    /// The server's own sentence about what this slice counts. Shown, never paraphrased.
    public let scopeNote: String
    public let rows: [LeaderboardRow]
    /// The viewer's standing, present even far below the visible rows. Nil when they have no
    /// XP on this board.
    public let my: LeaderboardRow?

    public init(
        metric: LeaderboardMetric = .xp,
        scope: String = LeaderboardScope.global.rawValue,
        window: String = LeaderboardQuery.allTime,
        branchId: Int? = nil,
        classroomId: Int? = nil,
        subject: String? = nil,
        level: String? = nil,
        count: Int? = nil,
        scopeNote: String = "",
        rows: [LeaderboardRow],
        my: LeaderboardRow?
    ) {
        self.metric = metric
        self.scope = scope
        self.window = window
        self.branchId = branchId
        self.classroomId = classroomId
        self.subject = subject
        self.level = level
        self.count = count ?? rows.count
        self.scopeNote = scopeNote
        self.rows = rows
        self.my = my
    }

    enum CodingKeys: String, CodingKey {
        case metric, scope, window, subject, level, count, rows, my
        case branchId = "branch_id"
        case classroomId = "classroom_id"
        case scopeNote = "scope_note"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Strict on the rows: a board that silently dropped students would misstate the
        // standings, and one that dropped all of them would read as "nobody here yet".
        let rows = try c.decodeIfPresent([LeaderboardRow].self, forKey: .rows) ?? []
        self.init(
            metric: c.rewardsString(.metric).flatMap { LeaderboardMetric(rawValue: $0.uppercased()) } ?? .xp,
            scope: c.rewardsString(.scope) ?? LeaderboardScope.global.rawValue,
            window: c.rewardsString(.window) ?? LeaderboardQuery.allTime,
            branchId: c.rewardsInt(.branchId),
            classroomId: c.rewardsInt(.classroomId),
            subject: c.rewardsString(.subject),
            level: c.rewardsString(.level),
            count: c.rewardsInt(.count),
            scopeNote: c.rewardsString(.scopeNote) ?? "",
            rows: rows,
            my: try c.decodeIfPresent(LeaderboardRow.self, forKey: .my)
        )
    }

    // MARK: Layout — the web's rules, in one tested place

    /// The first three stand on a podium — but only when there are three to stand there.
    public var podium: [LeaderboardRow] { rows.count >= 3 ? Array(rows.prefix(3)) : [] }

    /// Everybody under the podium; the whole board when there is no podium.
    public var standings: [LeaderboardRow] { rows.count >= 3 ? Array(rows.dropFirst(3)) : rows }

    /// The viewer's own row, if it is one of the visible ones.
    public var myVisibleRow: LeaderboardRow? {
        guard let my else { return nil }
        return rows.first { $0.studentId == my.studentId }
    }

    /// The standing the hero shows. The visible row beats `my`: it is the row the table shows, so
    /// the hero and the table can never name two places on one screen (on main both number ties
    /// the same way, but `my` is a separate read).
    public var standing: LeaderboardRow? { myVisibleRow ?? my }

    /// "Your position" is shown on its own only when the viewer is not already in the table —
    /// repeating a row they can see is noise, and hiding it when they cannot is worse.
    public var showsYourPosition: Bool { my != nil && myVisibleRow == nil }

    /// The next place up, measured only against the row directly above — to pass them, not to
    /// tie, so the gap plus one.
    ///
    /// Only when that row is on screen. A viewer below the visible list gets a target only if
    /// the last visible row is the very next rank up; anything else would be a number to take on
    /// trust. Nil at #1, and when the row above shares their rank.
    public var goal: LeaderboardGoal? {
        // An XP gap means nothing on the strike board.
        guard metric == .xp, let my else { return nil }
        if let index = rows.firstIndex(where: { $0.studentId == my.studentId }) {
            let me = rows[index]
            guard index > 0 else { return nil }
            let above = rows[index - 1]
            guard above.rank < me.rank else { return nil }
            return LeaderboardGoal(xp: max(1, above.xp - me.xp + 1), rank: above.rank)
        }
        guard let last = rows.last, last.rank == my.rank - 1 else { return nil }
        return LeaderboardGoal(xp: max(1, last.xp - my.xp + 1), rank: last.rank)
    }

    /// The student to pass next, by name — the Rewards hero's line.
    ///
    /// Offered only when EVERY student ranked ahead of the viewer is in this response. Ranks are
    /// competition ranks, so exactly `rank − 1` students are ahead; when all of them are here,
    /// the nearest is the one directly above. A viewer past the page with a gap the response
    /// does not show gets no line rather than a guess. A tie-mate printed above is not "above" —
    /// passing them changes no number — so the line names the nearest better rank. Nil at #1,
    /// without a standing, and on the strike board.
    ///
    /// Only meaningful on the global, all-time XP board — the one the Rewards hero asks for. On a
    /// filtered board (one subject, this month, one branch) the row above is the next student
    /// within that slice, not the student to pass overall.
    public var passTarget: LeaderboardPass? {
        guard metric == .xp, let me = standing, me.rank > 1 else { return nil }
        let ahead = rows.filter { $0.rank < me.rank && $0.studentId != me.studentId }
        // By rank, not by position: the nearest better rank is the largest one still ahead. Of a
        // tie at that rank the one printed last is named — the row directly above the viewer.
        guard ahead.count == me.rank - 1,
              let above = ahead.enumerated().max(by: { ($0.element.rank, $0.offset) < ($1.element.rank, $1.offset) })?.element
        else { return nil }
        return LeaderboardPass(
            name: LeaderboardName.shown(above.name).map(LeaderboardName.firstName),
            xp: max(1, above.xp - me.xp + 1),
            rank: above.rank
        )
    }

    /// The goal, when the viewer is standing on the podium — it is shown under the podium then.
    public var podiumGoal: LeaderboardGoal? {
        guard let mine = myVisibleRow, podium.contains(where: { $0.studentId == mine.studentId }) else { return nil }
        return goal
    }
}

/// `GET /api/rewards/leaderboard/filters/` — the chips, served so a new branch needs no release.
public struct LeaderboardFilters: Decodable, Sendable, Equatable {
    public struct Option: Decodable, Sendable, Equatable, Hashable, Identifiable {
        public let value: String
        public let label: String
        public var id: String { value }

        public init(value: String, label: String) {
            self.value = value
            self.label = label
        }

        enum CodingKeys: String, CodingKey { case value, label }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            value = try c.decode(String.self, forKey: .value)
            label = c.rewardsString(.label) ?? value
        }
    }

    public struct Branch: Decodable, Sendable, Equatable, Hashable, Identifiable {
        public let id: Int
        public let name: String
        public let code: String
        public let regionId: Int?

        public init(id: Int, name: String, code: String = "", regionId: Int? = nil) {
            self.id = id
            self.name = name
            self.code = code
            self.regionId = regionId
        }

        enum CodingKeys: String, CodingKey {
            case id, name, code
            case regionId = "region_id"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(Int.self, forKey: .id)
            name = c.rewardsString(.name) ?? ""
            code = c.rewardsString(.code) ?? ""
            regionId = c.rewardsInt(.regionId)
        }
    }

    public struct Region: Decodable, Sendable, Equatable, Hashable, Identifiable {
        public let id: Int
        public let name: String
        public let code: String

        enum CodingKeys: String, CodingKey { case id, name, code }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(Int.self, forKey: .id)
            name = c.rewardsString(.name) ?? ""
            code = c.rewardsString(.code) ?? ""
        }
    }

    /// The viewer's own branch — the "My Branch" tab's label. Nil when their class has no
    /// branch yet, and the tab is hidden then rather than shown over an empty board.
    public struct MyBranch: Decodable, Sendable, Equatable, Hashable {
        public let id: Int
        public let name: String
        public let region: String

        public init(id: Int, name: String, region: String = "") {
            self.id = id
            self.name = name
            self.region = region
        }

        enum CodingKeys: String, CodingKey { case id, name, region }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(Int.self, forKey: .id)
            name = c.rewardsString(.name) ?? ""
            region = c.rewardsString(.region) ?? ""
        }
    }

    public let regions: [Region]
    public let branches: [Branch]
    public let subjects: [Option]
    public let levels: [Option]
    public let windows: [Option]
    public let myBranch: MyBranch?

    public init(
        regions: [Region] = [],
        branches: [Branch] = [],
        subjects: [Option] = [],
        levels: [Option] = [],
        windows: [Option] = [],
        myBranch: MyBranch? = nil
    ) {
        self.regions = regions
        self.branches = branches
        self.subjects = subjects
        self.levels = levels
        self.windows = windows
        self.myBranch = myBranch
    }

    enum CodingKeys: String, CodingKey {
        case regions, branches, subjects, levels, windows
        case myBranch = "my_branch"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            regions: try c.rewardsList(Region.self, .regions),
            branches: try c.rewardsList(Branch.self, .branches),
            subjects: try c.rewardsList(Option.self, .subjects),
            levels: try c.rewardsList(Option.self, .levels),
            windows: try c.rewardsList(Option.self, .windows),
            myBranch: try? c.decodeIfPresent(MyBranch.self, forKey: .myBranch)
        )
    }

    /// Only for the moment before the served labels arrive — the chips themselves only ever
    /// render the server's.
    public static func fallbackWindowLabel(_ value: String) -> String {
        switch value {
        case LeaderboardQuery.allTime: return "All time"
        case LeaderboardQuery.thisMonth: return "This month"
        default: return value
        }
    }

    public func windowLabel(_ value: String) -> String {
        windows.first { $0.value == value }?.label ?? Self.fallbackWindowLabel(value)
    }

    public func subjectLabel(_ value: String) -> String {
        subjects.first { $0.value == value }?.label ?? value
    }

    public func branchName(_ id: Int) -> String {
        branches.first { $0.id == id }?.name ?? "Branch"
    }
}

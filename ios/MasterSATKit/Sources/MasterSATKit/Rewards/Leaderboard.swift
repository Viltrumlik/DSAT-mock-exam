import Foundation

/// Which slice of the learning center a board ranks. "Group" is this school's word for a class.
public enum LeaderboardScope: String, Sendable, Hashable, CaseIterable {
    case group = "GROUP"
    case branch = "BRANCH"
    case global = "GLOBAL"
}

/// What a board is being asked for. Everything the web sends, and nothing it does not: `limit`
/// and `level` go out only as their server defaults, so they are not sent at all.
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

    public init(scope: LeaderboardScope = .global, window: String = LeaderboardQuery.allTime, subject: String? = nil, branchId: Int? = nil) {
        self.scope = scope
        self.window = window
        self.subject = subject
        self.branchId = branchId
    }

    /// Whether the branch filter applies to the board being asked for.
    public var branchApplies: Bool { scope == .global && branchId != nil }

    public var queryItems: [URLQueryItem] {
        var items = [
            URLQueryItem(name: "scope", value: scope.rawValue),
            URLQueryItem(name: "window", value: window),
        ]
        if let subject, !subject.isEmpty { items.append(URLQueryItem(name: "subject", value: subject)) }
        if branchApplies, let branchId { items.append(URLQueryItem(name: "branch", value: String(branchId))) }
        return items
    }

    /// How many filters are narrowing the board — the badge on the Filters button.
    public var activeFilterCount: Int {
        (window != Self.allTime ? 1 : 0) + (subject != nil ? 1 : 0) + (branchApplies ? 1 : 0)
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
    /// The SERVER's rank, shown as-is. The app never ranks anybody: on main today the table's
    /// ranks are unique (ties broken by earning count) while `my` shares a tied rank, and a
    /// client that "fixed" either would disagree with the site.
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
        isMe: Bool = false
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
    }

    enum CodingKeys: String, CodingKey {
        case rank, name, xp, awards, branch, region
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
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return "Student" }
        guard looksLikeEmail(name) else { return name }
        let local = name.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return local.isEmpty ? "Student" : local
    }

    /// `something@something.tld`, with no spaces — a name with an "@" in a sentence is left alone.
    public static func looksLikeEmail(_ text: String) -> Bool {
        guard !text.contains(where: \.isWhitespace) else { return false }
        let parts = text.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return false }
        let domain = parts[1]
        return !domain.isEmpty && domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
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

/// `GET /api/rewards/leaderboard/`.
public struct LeaderboardBoard: Decodable, Sendable, Equatable {
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
        case scope, window, subject, level, count, rows, my
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

    /// The standing the hero shows. The visible row beats `my`: on main `my` shares a tied rank
    /// while the table breaks the tie, and the two must not disagree on one screen.
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
        guard let my else { return nil }
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

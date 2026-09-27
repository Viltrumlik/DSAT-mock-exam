import Foundation

/// One line of the points ledger: a lesson attended, a homework finished, a support session
/// held — or, since conversion became manual, points **spent** on coins.
///
/// `points` is signed. A `COIN_CONVERSION` row is negative ("30 points → 3 coins"), and it is
/// the one row in the feed that must not wear a green plus: see `signedPoints`.
public struct PointAward: Decodable, Identifiable, Sendable, Equatable {
    public let id: Int
    /// An open string, not an enum. New codes arrive without an app release (`HOMEWORK`,
    /// `CLASSWORK_MANUAL`, `EVENT_ATTENDED`, `COIN_CONVERSION` all did), and a closed set would
    /// fail to decode the first row that used one.
    public let event: String
    /// Server-rendered wording. The app does not map events to text of its own — a new
    /// earning type must not need an app release to be readable.
    public let label: String
    public let points: Int
    public let classroomId: Int?
    public let classroomName: String?
    /// Kept as the raw string, like every other server timestamp in this kit (`dueAt` and
    /// friends). The shared decoder sets no `dateDecodingStrategy`, so a `Date` property
    /// would fail to decode an ISO-8601 payload — at runtime, with nothing to catch it at
    /// build time. `JSONCoding.parseServerDate` handles the microsecond, `Z` and `+05:00` forms.
    public let awardedAt: String
    /// "30 points → 3 coins" on a conversion; usually empty otherwise.
    public let note: String

    public var awardedDate: Date? { JSONCoding.parseServerDate(awardedAt) }

    /// Points going out rather than coming in — a conversion to coins.
    public var isSpend: Bool { points < 0 }

    /// `+5` or `-30`. The app used to print `"+\(points)"`, which made a conversion "+-30".
    public var signedPoints: String { RewardsFormat.signed(points) }

    public init(
        id: Int,
        event: String,
        label: String,
        points: Int,
        classroomId: Int? = nil,
        classroomName: String? = nil,
        awardedAt: String,
        note: String = ""
    ) {
        self.id = id
        self.event = event
        self.label = label
        self.points = points
        self.classroomId = classroomId
        self.classroomName = classroomName
        self.awardedAt = awardedAt
        self.note = note
    }

    enum CodingKeys: String, CodingKey {
        case id, event, label, points, note, classroom
        case classroomName = "classroom_name"
        case awardedAt = "awarded_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        event = c.rewardsString(.event) ?? ""
        label = c.rewardsString(.label) ?? ""
        points = c.rewardsInt(.points) ?? 0
        classroomId = c.rewardsInt(.classroom)
        classroomName = c.rewardsString(.classroomName).flatMap { $0.isEmpty ? nil : $0 }
        awardedAt = c.rewardsString(.awardedAt) ?? ""
        note = c.rewardsString(.note) ?? ""
    }
}

/// The student's own balances and recent earnings — `GET /api/rewards/me/`.
///
/// **`coins` comes from the wallet, never from `points / pointsPerCoin`.** Points are a score
/// and coins are a balance; the moment coins can be spent the two stop agreeing, and a screen
/// that derived them would keep showing a student coins they had already spent. The backend
/// makes the same point in `MyRewardsView`.
///
/// **Points are spent now.** Converting to coins writes a negative `COIN_CONVERSION` row, so
/// `points` is what the student has earned *and not yet converted* this season. Nothing on a
/// read path converts: `convertibleCoins` is what pressing Convert would give them.
///
/// Still decodes the pre-conversion shape (`points`, `coins`, `points_per_coin`,
/// `points_to_next_coin`, `history`) — every field added since defaults to zero or nil.
///
/// There is no season here, deliberately: the balance is already scoped to the current one,
/// and the product never names it. `xp` is lifetime; coins are never reset.
public struct MyRewards: Decodable, Sendable, Equatable {
    public let points: Int
    public let coins: Int
    /// Lifetime, and what the leaderboard ranks on. Converting never moves it.
    public let xp: Int
    public let pointsPerCoin: Int
    /// `rate − points % rate` — so it equals the rate, not zero, when points divide evenly.
    public let pointsToNextCoin: Int
    /// What Convert would mint right now: whole coins only.
    public let convertibleCoins: Int
    /// What Max would spend — `points` minus the change that does not add up to a coin.
    public let maxConvertiblePoints: Int
    /// The run of lessons attended (PRESENT or LATE) — the *streak*.
    public let currentStreak: Int
    public let bestStreak: Int
    /// The spendable part of the run — the *strikes*: `currentStreak − spentInStreak`.
    public let strikes: Int
    public let spentInStreak: Int
    /// `YYYY-MM-DD`, Tashkent time. Kept raw: nothing on the phone shows it.
    public let lastCountedDate: String?
    /// Current season, non-zero rows, newest first, at most 50.
    public let history: [PointAward]

    public init(
        points: Int,
        coins: Int,
        xp: Int = 0,
        pointsPerCoin: Int = 10,
        pointsToNextCoin: Int? = nil,
        convertibleCoins: Int = 0,
        maxConvertiblePoints: Int = 0,
        currentStreak: Int = 0,
        bestStreak: Int = 0,
        strikes: Int = 0,
        spentInStreak: Int = 0,
        lastCountedDate: String? = nil,
        history: [PointAward] = []
    ) {
        let rate = max(1, pointsPerCoin)
        self.points = points
        self.coins = coins
        self.xp = xp
        self.pointsPerCoin = rate
        self.pointsToNextCoin = pointsToNextCoin ?? (rate - (max(0, points) % rate))
        self.convertibleCoins = convertibleCoins
        self.maxConvertiblePoints = maxConvertiblePoints
        self.currentStreak = currentStreak
        self.bestStreak = bestStreak
        self.strikes = strikes
        self.spentInStreak = spentInStreak
        self.lastCountedDate = lastCountedDate
        self.history = history
    }

    enum CodingKeys: String, CodingKey {
        case points, coins, xp, strikes, history
        case pointsPerCoin = "points_per_coin"
        case pointsToNextCoin = "points_to_next_coin"
        case convertibleCoins = "convertible_coins"
        case maxConvertiblePoints = "max_convertible_points"
        case currentStreak = "current_streak"
        case bestStreak = "best_streak"
        case spentInStreak = "spent_in_streak"
        case lastCountedDate = "last_counted_date"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The two balances this payload exists for are required. Defaulting them would turn a
        // malformed answer into "0 points", which reads as a student having earned nothing.
        self.init(
            points: try c.rewardsRequiredInt(.points),
            coins: try c.rewardsRequiredInt(.coins),
            xp: c.rewardsInt(.xp) ?? 0,
            pointsPerCoin: c.rewardsInt(.pointsPerCoin) ?? 10,
            pointsToNextCoin: c.rewardsInt(.pointsToNextCoin),
            convertibleCoins: c.rewardsInt(.convertibleCoins) ?? 0,
            maxConvertiblePoints: c.rewardsInt(.maxConvertiblePoints) ?? 0,
            currentStreak: c.rewardsInt(.currentStreak) ?? 0,
            bestStreak: c.rewardsInt(.bestStreak) ?? 0,
            strikes: c.rewardsInt(.strikes) ?? 0,
            spentInStreak: c.rewardsInt(.spentInStreak) ?? 0,
            lastCountedDate: c.rewardsString(.lastCountedDate).flatMap { $0.isEmpty ? nil : $0 },
            history: try c.rewardsList(PointAward.self, .history)
        )
    }

    /// The same student after a conversion: the balances the convert endpoint answered with,
    /// the streak and history as they were. The history gains its negative row on the next
    /// read of `/rewards/me/`; the numbers must not wait for it.
    public func applying(_ balances: RewardsBalances) -> MyRewards {
        MyRewards(
            points: balances.points,
            coins: balances.coins,
            xp: balances.xp,
            pointsPerCoin: balances.pointsPerCoin,
            pointsToNextCoin: balances.pointsToNextCoin,
            convertibleCoins: balances.convertibleCoins,
            maxConvertiblePoints: balances.maxConvertiblePoints,
            currentStreak: currentStreak,
            bestStreak: bestStreak,
            strikes: strikes,
            spentInStreak: spentInStreak,
            lastCountedDate: lastCountedDate,
            history: history
        )
    }
}

/// What earns what — the rules, visible in the product rather than only in a spreadsheet.
/// `GET /api/rewards/rules/`, served from the learning center's live `RewardRule` rows.
public struct RewardRule: Decodable, Identifiable, Sendable, Equatable {
    public let event: String
    public let label: String
    /// For HOMEWORK, the *most* it can pay; for SUPPORT_SESSION, what it pays a student alone.
    public let points: Int
    /// False where an earning pays points and no XP — SURVEY, since 2026-09-01. A checkbox the
    /// school can tick back on, so it is read off the rule and never matched on the event.
    public let grantsXP: Bool
    /// `[alone, two, three]` for an earning priced per head (SUPPORT_SESSION only), else nil.
    public let groupPoints: [Int]?

    public var id: String { event }

    public init(event: String, label: String, points: Int, grantsXP: Bool = true, groupPoints: [Int]? = nil) {
        self.event = event
        self.label = label
        self.points = points
        self.grantsXP = grantsXP
        self.groupPoints = groupPoints
    }

    enum CodingKeys: String, CodingKey {
        case event, label, points
        case grantsXP = "grants_xp"
        case groupPoints = "group_points"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        event = try c.decode(String.self, forKey: .event)
        label = c.rewardsString(.label) ?? event
        points = c.rewardsInt(.points) ?? 0
        // The model's own default. The old payload had no flag, and reading its absence as
        // "no XP" would stamp "Points only" on every rule.
        grantsXP = c.rewardsBool(.grantsXP) ?? true
        if let ladder = try? c.decodeIfPresent([JSONValue].self, forKey: .groupPoints) {
            let rungs = ladder.compactMap { value -> Int? in
                switch value {
                case .number(let n) where n.isFinite: return Int(n.rounded())
                case .string(let s): return Int(s)
                default: return nil
                }
            }
            groupPoints = rungs.isEmpty ? nil : rungs
        } else {
            groupPoints = nil
        }
    }
}

// MARK: - How a rule reads

extension RewardRule {
    /// The homework bands, retired when homework started paying a share of its maximum.
    /// `/rewards/rules/` still serves their seeded rows; left in, "How to earn" would tell a
    /// student to aim for a 60–79% band that no longer exists. History still carries them.
    public static let retiredEvents: Set<String> = ["HOMEWORK_FULL", "HOMEWORK_HIGH", "HOMEWORK_MID"]

    /// Priced by the person who awards it. Its rule row is seeded at 0, and "+0" under "How
    /// to earn" reads as "worth nothing" — the opposite of true.
    public static let teacherPricedEvents: Set<String> = ["CLASSWORK_MANUAL"]

    public var isRetired: Bool { Self.retiredEvents.contains(event) }
    public var isTeacherPriced: Bool { Self.teacherPricedEvents.contains(event) }

    /// The rules worth showing a student, in the server's order.
    public static func earnable(_ rules: [RewardRule]) -> [RewardRule] {
        rules.filter { !$0.isRetired }
    }

    /// `+5`, or `+10–20` for a rule whose price climbs with the group. Nil for a rule a teacher
    /// prices — the screen says "Set by your teacher" there instead.
    public var amountText: String? {
        guard !isTeacherPriced else { return nil }
        guard let ladder = groupPoints, let low = ladder.first, let high = ladder.last else {
            return "+\(points)"
        }
        return low == high ? "+\(low)" : "+\(low)\u{2013}\(high)"
    }

    /// What a student can do about a rule, where the amount alone does not say it. The web's
    /// own sentences (`RewardsPage.tsx`), with the live numbers read off the rule.
    public var hint: String? {
        var lines: [String] = []
        switch event {
        case "HOMEWORK":
            lines.append(
                "Finish it all before the deadline and the full \(points) lands right away. Otherwise you're paid at the deadline for the share you've finished — only what's done by then counts, so starting early is what pays."
            )
        case "CLASSWORK_MANUAL":
            lines.append("Your teacher decides this one, for the work you do in the lesson itself.")
        case "SUPPORT_SESSION":
            if let ladder = groupPoints, ladder.count >= 3 {
                lines.append(
                    "Bring a classmate and you both earn more: \(ladder[0]) on your own, \(ladder[1]) each if two of you go, \(ladder[2]) each if three do. You're paid once the teacher marks the session as held."
                )
            }
        default:
            break
        }
        if !grantsXP {
            lines.append("Points only — this one doesn't add to your XP.")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " ")
    }
}

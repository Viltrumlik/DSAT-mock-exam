import Foundation

/// The balances every wallet answer carries — `coins.wallet_state` on the server, which
/// `/rewards/wallet/` and `/rewards/wallet/convert/` both spread into their payloads.
public struct RewardsBalances: Decodable, Sendable, Equatable {
    public let coins: Int
    public let points: Int
    public let xp: Int
    public let pointsPerCoin: Int
    public let pointsToNextCoin: Int
    public let convertibleCoins: Int
    public let maxConvertiblePoints: Int

    public init(
        coins: Int,
        points: Int,
        xp: Int,
        pointsPerCoin: Int,
        pointsToNextCoin: Int,
        convertibleCoins: Int,
        maxConvertiblePoints: Int
    ) {
        self.coins = coins
        self.points = points
        self.xp = xp
        self.pointsPerCoin = max(1, pointsPerCoin)
        self.pointsToNextCoin = pointsToNextCoin
        self.convertibleCoins = convertibleCoins
        self.maxConvertiblePoints = maxConvertiblePoints
    }

    enum CodingKeys: String, CodingKey {
        case coins, points, xp
        case pointsPerCoin = "points_per_coin"
        case pointsToNextCoin = "points_to_next_coin"
        case convertibleCoins = "convertible_coins"
        case maxConvertiblePoints = "max_convertible_points"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let points = try c.rewardsRequiredInt(.points)
        let rate = max(1, c.rewardsInt(.pointsPerCoin) ?? 10)
        self.init(
            coins: try c.rewardsRequiredInt(.coins),
            points: points,
            xp: c.rewardsInt(.xp) ?? 0,
            pointsPerCoin: rate,
            pointsToNextCoin: c.rewardsInt(.pointsToNextCoin) ?? (rate - max(0, points) % rate),
            convertibleCoins: c.rewardsInt(.convertibleCoins) ?? max(0, points) / rate,
            maxConvertiblePoints: c.rewardsInt(.maxConvertiblePoints) ?? (max(0, points) / rate) * rate
        )
    }
}

/// One movement of coins: a conversion (`EARN`), a shop purchase (`SPEND`), or a member of
/// staff granting or revoking by hand.
public struct CoinTransaction: Decodable, Identifiable, Sendable, Equatable {
    public let id: Int
    /// `EARN` / `SPEND` / `ADMIN_GRANT` / `ADMIN_REVOKE` — open, like every code here.
    public let kind: String
    public let label: String
    /// Signed: a purchase is negative.
    public let amount: Int
    public let balanceAfter: Int
    /// What the coins cost in points. Zero on a spend or a grant.
    public let pointsSpent: Int
    /// "10 points = 1 coin", "Shop: Notebook", or what an administrator wrote.
    public let reference: String
    /// `…Z` with microseconds — a hand-built dict on the server, not a serializer.
    public let createdAt: String

    /// The row's title, as the web writes it: `reference || label`.
    public var title: String { reference.isEmpty ? label : reference }
    public var signedAmount: String { RewardsFormat.signed(amount) }
    public var isSpend: Bool { amount < 0 }
    public var createdDate: Date? { JSONCoding.parseServerDate(createdAt) }

    enum CodingKeys: String, CodingKey {
        case id, kind, label, amount, reference
        case balanceAfter = "balance_after"
        case pointsSpent = "points_spent"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        kind = c.rewardsString(.kind) ?? ""
        label = c.rewardsString(.label) ?? ""
        amount = c.rewardsInt(.amount) ?? 0
        balanceAfter = c.rewardsInt(.balanceAfter) ?? 0
        pointsSpent = c.rewardsInt(.pointsSpent) ?? 0
        reference = c.rewardsString(.reference) ?? ""
        createdAt = c.rewardsString(.createdAt) ?? ""
    }
}

/// `GET /api/rewards/wallet/` — the balances, and the last 50 coin movements, newest first.
public struct RewardsWallet: Decodable, Sendable, Equatable {
    public let balances: RewardsBalances
    public let transactions: [CoinTransaction]

    enum CodingKeys: String, CodingKey { case transactions }

    public init(from decoder: Decoder) throws {
        // The balances are spread flat into the same object the list sits in.
        balances = try RewardsBalances(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        transactions = try c.rewardsList(CoinTransaction.self, .transactions)
    }
}

/// What `POST /api/rewards/wallet/convert/` answered: the new balances, what the press
/// actually did, and the server's sentence about it.
public struct ConversionResult: Decodable, Sendable, Equatable {
    /// Coins this press minted. Zero is an ordinary answer — "Not enough points yet — N more
    /// for a coin." — not a failure.
    public let minted: Int
    /// What the balance fell by: always a whole number of coins' worth.
    public let pointsSpent: Int
    /// For display only. Never branched on: it is written for people and may change.
    public let detail: String
    public let balances: RewardsBalances

    enum CodingKeys: String, CodingKey {
        case minted, detail
        case pointsSpent = "points_spent"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        minted = c.rewardsInt(.minted) ?? 0
        pointsSpent = c.rewardsInt(.pointsSpent) ?? 0
        detail = c.rewardsString(.detail) ?? ""
        balances = try RewardsBalances(from: decoder)
    }
}

// MARK: - The convert strip

/// What pressing Convert would do with what the student has typed, said before they press it.
///
/// Points do not come back, so the one number a student must see in advance is how many
/// they are giving up — including the change that stays behind, which is otherwise read as
/// points going missing. Only whole coins are bought: `spent = ⌊asked / rate⌋ × rate`, and the
/// remainder stays in the balance. The server applies the same rule (`coins.convert`); this is
/// the preview of it, not a second authority — the request sends what was typed.
///
/// The sentences are the web's own (`RewardsPage.tsx`).
public struct ConversionPreview: Equatable, Sendable {
    public enum State: Equatable, Sendable {
        /// Nothing typed. No line at all.
        case blank
        /// Not a positive whole number.
        case notAnAmount
        /// More than the balance. The server would refuse it rather than quietly clamp.
        case moreThanYouHave(points: Int)
        /// A real amount that buys no coin yet.
        case lessThanACoin(asked: Int, rate: Int)
        case buys(coins: Int, spent: Int, kept: Int)
    }

    public let state: State
    /// The number to send, once it is one worth sending.
    public let asked: Int?

    public init(input: String, points: Int, pointsPerCoin: Int) {
        let rate = max(1, pointsPerCoin)
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            state = .blank
            asked = nil
            return
        }
        let digitsOnly = text.allSatisfy { $0.isASCII && $0.isNumber }
        guard let value = Int(text), value > 0 else {
            // A run of digits too long for an Int is still a number — just a bigger one than
            // anybody has. Saying "enter an amount" to a student who did would be wrong.
            if digitsOnly, text.contains(where: { $0 != "0" }) {
                state = .moreThanYouHave(points: points)
            } else {
                state = .notAnAmount
            }
            asked = nil
            return
        }
        guard value <= points else {
            state = .moreThanYouHave(points: points)
            asked = nil
            return
        }
        let coins = value / rate
        if coins == 0 {
            state = .lessThanACoin(asked: value, rate: rate)
            asked = nil
        } else {
            state = .buys(coins: coins, spent: coins * rate, kept: value - coins * rate)
            asked = value
        }
    }

    /// Whether Convert has anything to do.
    public var canConvert: Bool { asked != nil }

    /// The line under the box, or nil while it is empty.
    public var message: String? {
        switch state {
        case .blank:
            return nil
        case .notAnAmount:
            return "Enter how many points to convert."
        case .moreThanYouHave(let points):
            return "You only have \(RewardsFormat.count(points, "point"))."
        case .lessThanACoin(let asked, let rate):
            return "\(rate) points buy a coin — \(asked) isn't enough for one yet."
        case .buys(let coins, let spent, let kept):
            let head = "\(spent) points buy \(RewardsFormat.count(coins, "coin"))"
            return kept > 0 ? "\(head), and you keep the other \(kept)." : "\(head)."
        }
    }

    /// The strip's heading: what the points are worth now, or how far off the next coin is.
    /// When there is nothing to convert the strip keeps its place and reports the distance,
    /// so a student learns where the button lives before they need it.
    public static func headline(convertibleCoins: Int, pointsToNextCoin: Int) -> (overline: String, sentence: String) {
        if convertibleCoins > 0 {
            return ("Ready to convert", "Your points are worth \(RewardsFormat.count(convertibleCoins, "coin")).")
        }
        return ("To your next coin", "\(RewardsFormat.count(pointsToNextCoin, "more point", "more points")) and you can convert.")
    }
}

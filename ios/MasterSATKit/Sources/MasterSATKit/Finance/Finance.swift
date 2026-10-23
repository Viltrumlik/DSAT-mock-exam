import Foundation

/// The student's own money at the learning center — `GET /api/lcup/me/finance/`, which
/// `backend/lcup/finance.py`'s `student_finance()` builds from what lc-up last told us.
///
/// Only ever their own: the endpoint is `IsAuthenticated` on purpose, so a frozen student can
/// still read what they owe, and nobody can read anyone else's.

/// One row of the student's payment history, as lc-up keeps it.
public struct FinancePayment: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    /// `YYYY-MM-DD`, the day lc-up recorded it.
    public let date: String
    public let amount: Double
    /// lc-up's type: `payment`, `refund` or `extra`.
    public let kind: String
    /// lc-up names the methods in Uzbek ("Naqd pul"); `FinanceRules.methodLabel` reads them.
    public let method: String
    /// The month it pays for, `YYYY-MM` — empty when lc-up left it blank.
    public let month: String
    public let group: String

    public init(
        id: Int, date: String = "", amount: Double = 0, kind: String = "payment",
        method: String = "", month: String = "", group: String = ""
    ) {
        self.id = id
        self.date = date
        self.amount = amount
        self.kind = kind
        self.method = method
        self.month = month
        self.group = group
    }

    private enum CodingKeys: String, CodingKey { case id, date, amount, kind, method, month, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        date = FinanceDecoding.text(c, .date)
        amount = FinanceDecoding.number(c, .amount) ?? 0
        kind = FinanceDecoding.text(c, .kind)
        method = FinanceDecoding.text(c, .method)
        month = FinanceDecoding.text(c, .month)
        group = FinanceDecoding.text(c, .group)
    }
}

/// One of the student's groups and what it costs a month.
public struct FinanceGroupCost: Decodable, Sendable, Equatable, Identifiable {
    public let name: String
    public let monthlyCost: Double

    public var id: String { name }

    public init(name: String, monthlyCost: Double) {
        self.name = name
        self.monthlyCost = monthlyCost
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case monthlyCost = "monthly_cost"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = FinanceDecoding.text(c, .name)
        monthlyCost = FinanceDecoding.number(c, .monthlyCost) ?? 0
    }
}

/// What a linked student's money looks like.
public struct MyFinance: Decodable, Sendable, Equatable {
    /// Negative is a debt; nil when lc-up has never told us a balance.
    public let balance: Double?
    /// What they owe, which the server works out as `max(0, -balance)`. Nil with the balance.
    public let debt: Double?
    public let updatedAt: String?
    /// Frozen for THIS, rather than by an administrator — the two read differently.
    public let frozenForDebt: Bool
    /// From this day of each month an unpaid balance freezes the account.
    public let freezeDay: Int
    public let monthlyCost: Double
    public let groups: [FinanceGroupCost]
    public let payments: [FinancePayment]

    public init(
        balance: Double? = nil, debt: Double? = nil, updatedAt: String? = nil,
        frozenForDebt: Bool = false, freezeDay: Int = 1, monthlyCost: Double = 0,
        groups: [FinanceGroupCost] = [], payments: [FinancePayment] = []
    ) {
        self.balance = balance
        self.debt = debt
        self.updatedAt = updatedAt
        self.frozenForDebt = frozenForDebt
        self.freezeDay = freezeDay
        self.monthlyCost = monthlyCost
        self.groups = groups
        self.payments = payments
    }

    private enum CodingKeys: String, CodingKey {
        case balance, debt, groups, payments
        case updatedAt = "updated_at"
        case frozenForDebt = "frozen_for_debt"
        case freezeDay = "freeze_day"
        case monthlyCost = "monthly_cost"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        balance = FinanceDecoding.number(c, .balance)
        debt = FinanceDecoding.number(c, .debt)
        updatedAt = (try? c.decodeIfPresent(String.self, forKey: .updatedAt)) ?? nil
        frozenForDebt = ((try? c.decodeIfPresent(Bool.self, forKey: .frozenForDebt)) ?? nil) ?? false
        freezeDay = FinanceDecoding.number(c, .freezeDay).map { Int($0.rounded()) } ?? 1
        monthlyCost = FinanceDecoding.number(c, .monthlyCost) ?? 0
        // A group or a payment the app cannot read must not blank the panel: the rest of the
        // money is still the student's to see.
        groups = ((try? c.decodeIfPresent(CommunityLossyList<FinanceGroupCost>.self, forKey: .groups)) ?? nil)?
            .elements ?? []
        payments = ((try? c.decodeIfPresent(CommunityLossyList<FinancePayment>.self, forKey: .payments)) ?? nil)?
            .elements ?? []
    }
}

/// An account lc-up has never been told about answers `{"linked": false}` and has nothing to
/// show — which is not the same as a student who owes nothing, so it is its own case.
public enum MyFinanceState: Decodable, Sendable, Equatable {
    case unlinked
    case linked(MyFinance)

    /// The money, where there is any.
    public var finance: MyFinance? {
        switch self {
        case .unlinked: return nil
        case .linked(let finance): return finance
        }
    }

    private enum CodingKeys: String, CodingKey { case linked }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let linked = ((try? c.decodeIfPresent(Bool.self, forKey: .linked)) ?? nil) ?? false
        self = linked ? .linked(try MyFinance(from: decoder)) : .unlinked
    }
}

/// DRF writes a `DecimalField` as a string (`"120000.00"`) in places and as a number in
/// others, and lc-up's amounts travel through both — so both are read, as `SubmissionReview`
/// reads a grade. A student told they owe nothing because a figure arrived in quotes would be
/// the worst bug on this screen.
enum FinanceDecoding {
    static func number<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> Double? {
        if let d = try? c.decodeIfPresent(Double.self, forKey: key) { return d }
        guard let raw = try? c.decodeIfPresent(String.self, forKey: key) else { return nil }
        return Double(raw.trimmingCharacters(in: .whitespaces))
    }

    static func text<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> String {
        ((try? c.decodeIfPresent(String.self, forKey: key)) ?? nil) ?? ""
    }
}

import Foundation
import Testing
@testable import MasterSATKit

/// The money the student is shown is the money the website shows them, down to the comma —
/// these mirror `formatUzs` and `PaymentsBody` in the frontend, and `student_finance()` in
/// `backend/lcup/finance.py` for the shape it arrives in.
@Suite struct MoneyTests {

    @Test("A figure reads as it does on the website")
    func grouping() {
        #expect(UZS.format(1_250_000) == "1,250,000 UZS")
        #expect(UZS.format(0) == "0 UZS")
        #expect(UZS.format(999) == "999 UZS")
        #expect(UZS.format(1_000) == "1,000 UZS")
        #expect(UZS.format(12_345_678) == "12,345,678 UZS")
    }

    @Test("The grouping is the same for the amounts the app actually holds")
    func groupingOfDoubles() {
        // Every figure on the panel arrives as a `Double`, and an untyped literal above picks
        // the `Int` overload — so the one the app calls went unpinned while its tests passed.
        #expect(UZS.format(1_250_000.0) == "1,250,000 UZS")
        #expect(UZS.format(0.0) == "0 UZS")
        #expect(UZS.format(999.0) == "999 UZS")
        #expect(UZS.format(1_000.0) == "1,000 UZS")
        #expect(UZS.format(12_345_678.0) == "12,345,678 UZS")
        #expect(UZS.format(-480_000.0) == "-480,000 UZS")
    }

    @Test("Nothing owed never prints as minus nothing")
    func negativeZero() {
        #expect(UZS.format(-0.0) == "0 UZS")
        #expect(UZS.format(-0.4) == "0 UZS")
    }

    @Test("Fractions round the way Math.round does — to the nearest, ties upwards")
    func rounding() {
        #expect(UZS.format(120_000.4) == "120,000 UZS")
        #expect(UZS.format(120_000.5) == "120,001 UZS")
        #expect(UZS.format(-2.5) == "-2 UZS")
        #expect(UZS.format(-2.6) == "-3 UZS")
    }

    @Test("A debt keeps its sign where one is shown")
    func negative() {
        #expect(UZS.format(-480_000) == "-480,000 UZS")
    }

    @Test("A broken figure is clamped rather than trapping the panel")
    func notANumber() {
        #expect(UZS.format(Double.nan) == "0 UZS")
        #expect(UZS.format(Double.infinity).hasSuffix(" UZS"))
    }
}

@Suite struct FinanceDecodingTests {

    private func decode(_ object: Any) throws -> MyFinanceState {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder().decode(MyFinanceState.self, from: data)
    }

    static func payload(
        balance: Any = -480_000, debt: Any = 480_000, frozen: Bool = false, freezeDay: Any = 5,
        monthlyCost: Any = 600_000, groups: [Any] = [["name": "SAT Intensive", "monthly_cost": 600_000]],
        payments: [Any] = []
    ) -> [String: Any] {
        [
            "linked": true, "balance": balance, "debt": debt, "updated_at": "2026-10-23T10:00:00+05:00",
            "frozen_for_debt": frozen, "freeze_day": freezeDay, "monthly_cost": monthlyCost,
            "groups": groups, "payments": payments,
        ]
    }

    static func payment(
        id: Int = 1, date: String = "2026-10-15", amount: Any = 600_000,
        kind: String = "payment", method: String = "Naqd pul", month: String = "2026-10"
    ) -> [String: Any] {
        ["id": id, "date": date, "amount": amount, "kind": kind, "method": method, "month": month, "group": "SAT Intensive"]
    }

    @Test("A linked student decodes whole")
    func linked() throws {
        let state = try decode(Self.payload(payments: [Self.payment()]))
        let finance = try #require(state.finance)
        #expect(finance.balance == -480_000)
        #expect(finance.debt == 480_000)
        #expect(finance.freezeDay == 5)
        #expect(finance.monthlyCost == 600_000)
        #expect(finance.groups == [FinanceGroupCost(name: "SAT Intensive", monthlyCost: 600_000)])
        #expect(finance.payments.first?.method == "Naqd pul")
        #expect(finance.payments.first?.amount == 600_000)
    }

    @Test("DRF's quoted decimals are read as the numbers they are")
    func decimalsAsStrings() throws {
        let state = try decode(Self.payload(
            balance: "-480000.00", debt: "480000.00", monthlyCost: "600000.00",
            groups: [["name": "SAT Intensive", "monthly_cost": "600000.00"]],
            payments: [Self.payment(amount: "600000.00")]
        ))
        let finance = try #require(state.finance)
        #expect(finance.balance == -480_000)
        #expect(finance.debt == 480_000)
        #expect(finance.monthlyCost == 600_000)
        #expect(finance.groups.first?.monthlyCost == 600_000)
        #expect(finance.payments.first?.amount == 600_000)
    }

    @Test("An account lc-up does not know is its own answer, not an empty one")
    func unlinked() throws {
        #expect(try decode(["linked": false]) == .unlinked)
        #expect(try decode(["linked": false]).finance == nil)
    }

    @Test("An answer with no `linked` key at all is read as unlinked, never as a linked zero")
    func missingLinkedKey() throws {
        // The key the whole payload hangs off. Reading its absence as "linked" would draw a
        // balance of nothing over a student the learning center simply has not tied up yet.
        #expect(try decode([:] as [String: Any]) == .unlinked)
        #expect(try decode(["balance": -480_000]) == .unlinked)
    }

    @Test("A balance that is not a number is unknown, never zero")
    func unreadableBalance() throws {
        // `Double("—")` is nil, and nil here means "lc-up never said". Falling back to 0 would
        // tell a student in debt that they are square with the centre.
        let finance = try #require(try decode(Self.payload(balance: "—", debt: "n/a")).finance)
        #expect(finance.balance == nil)
        #expect(finance.debt == nil)
        #expect(FinanceRules.balanceLine(finance) == nil)
    }

    @Test("A payments key that is not a list is a payload this does not understand")
    func paymentsNotAList() throws {
        // Swallowed into an empty list, this drew "No payments recorded yet" over a student's
        // real history. Error is not empty: the list itself throws and the panel says so.
        var object = Self.payload()
        object["payments"] = ["count": 3]
        #expect(throws: (any Error).self) { try decode(object) }
        // Absent is still fine — it means none.
        var noKey = Self.payload()
        noKey.removeValue(forKey: "payments")
        #expect(try decode(noKey).finance?.payments.isEmpty == true)
    }

    @Test("A balance lc-up never sent stays unknown")
    func noBalance() throws {
        let finance = try #require(try decode(Self.payload(balance: NSNull(), debt: NSNull())).finance)
        #expect(finance.balance == nil)
        #expect(finance.debt == nil)
        #expect(FinanceRules.balanceLine(finance) == nil)
    }

    @Test("One unreadable payment does not cost the student the rest of them")
    func lossyRows() throws {
        let finance = try #require(try decode(Self.payload(
            payments: [Self.payment(id: 1), ["date": "2026-09-15"], Self.payment(id: 3)]
        )).finance)
        #expect(finance.payments.map(\.id) == [1, 3])
    }

    @Test("GET /lcup/me/finance/ is the path, and its answer is the state")
    func apiPath() async throws {
        let server = StubServer()
        server.handler = { _ in .json(Self.payload()) }
        let api = FinanceAPI(client: APIClient(
            config: APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test"),
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
        let state = try await api.mine()
        #expect(state.finance?.debt == 480_000)
        // The whole URL, not `url.path`, which drops the trailing slash Django insists on.
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/lcup/me/finance/")
    }

    @Test("A refusal reaches the caller rather than passing for an empty account")
    func apiPropagatesFailure() async throws {
        // Everything downstream is built on this throwing: the panel's own error line with its
        // "Try again", and the frozen screen leaving the administrator's wording alone instead
        // of inventing a debt of nothing.
        let server = StubServer()
        server.handler = { _ in .json(["detail": "Server error"], status: 500) }
        let api = FinanceAPI(client: APIClient(
            config: APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test"),
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
        await #expect(throws: APIError.self) { try await api.mine() }
    }
}

@Suite struct FinanceRulesTests {

    private func finance(
        balance: Double? = -480_000, debt: Double? = 480_000, freezeDay: Int = 5,
        monthlyCost: Double = 600_000, groups: [FinanceGroupCost] = [],
        payments: [FinancePayment] = []
    ) -> MyFinance {
        MyFinance(
            balance: balance, debt: debt, freezeDay: freezeDay, monthlyCost: monthlyCost,
            groups: groups, payments: payments
        )
    }

    @Test("Behind on the month: the debt, in the danger tone")
    func owing() {
        let money = finance()
        #expect(FinanceRules.owes(money))
        #expect(FinanceRules.balanceLine(money) == .owes("480,000 UZS"))
    }

    @Test("Paid ahead: the credit")
    func credit() {
        let money = finance(balance: 200_000, debt: 0)
        #expect(!FinanceRules.owes(money))
        #expect(FinanceRules.balanceLine(money) == .inCredit("200,000 UZS"))
    }

    @Test("Square with the centre: all paid, not a zero")
    func square() {
        #expect(FinanceRules.balanceLine(finance(balance: 0, debt: 0)) == .allPaid)
    }

    @Test("The due sentence shows only while something is owed")
    func dueSentence() {
        #expect(FinanceRules.dueSentence(finance(freezeDay: 1))
            == "Payments are due by the 1st of each month. Pay at your learning center.")
        #expect(FinanceRules.dueSentence(finance(balance: 0, debt: 0)) == nil)
        // No balance at all: nothing is known, so nothing is claimed.
        #expect(FinanceRules.dueSentence(finance(balance: nil, debt: 480_000)) == nil)
    }

    @Test("The ordinal is the website's")
    func ordinals() {
        #expect(FinanceRules.ordinal(1) == "1st")
        #expect(FinanceRules.ordinal(2) == "2nd")
        #expect(FinanceRules.ordinal(3) == "3rd")
        #expect(FinanceRules.ordinal(4) == "4th")
        #expect(FinanceRules.ordinal(11) == "11th")
        #expect(FinanceRules.ordinal(12) == "12th")
        #expect(FinanceRules.ordinal(13) == "13th")
        #expect(FinanceRules.ordinal(21) == "21st")
        #expect(FinanceRules.ordinal(22) == "22nd")
    }

    @Test("A single group says its price once; several break it down")
    func breakdown() {
        let one = [FinanceGroupCost(name: "SAT Intensive", monthlyCost: 600_000)]
        let two = one + [FinanceGroupCost(name: "Math club", monthlyCost: 200_000)]
        #expect(FinanceRules.groupBreakdown(finance(groups: one)).isEmpty)
        #expect(FinanceRules.groupBreakdown(finance(groups: two)) == two)
    }

    @Test("Recent payments are the latest five")
    func recent() {
        let rows = (1...8).map { FinancePayment(id: $0) }
        #expect(FinanceRules.recentPayments(finance(payments: rows)).map(\.id) == [1, 2, 3, 4, 5])
        #expect(FinanceRules.recentPayments(finance(payments: [])).isEmpty)
    }

    @Test("A payment reads as a day, how it was paid, and the month it buys")
    func paymentRow() {
        let row = FinancePayment(
            id: 1, date: "2026-10-15", amount: 600_000, kind: "payment",
            method: "Naqd pul", month: "2026-10"
        )
        #expect(FinanceRules.payDay(row.date) == "15 Oct 2026")
        #expect(FinanceRules.note(row) == "Cash · October 2026")
        #expect(FinanceRules.amountText(row) == "600,000 UZS")
    }

    @Test("A refund says so, and takes a minus")
    func refund() {
        let row = FinancePayment(
            id: 2, date: "2026-09-02", amount: 150_000, kind: "refund",
            method: "Plastik karta", month: "2026-09"
        )
        #expect(FinanceRules.isRefund(row))
        #expect(FinanceRules.note(row) == "Refund · September 2026")
        #expect(FinanceRules.amountText(row) == "\u{2212}150,000 UZS")
    }

    @Test("Every method lc-up sends has an English name; an unknown one is shown as it came")
    func methods() {
        #expect(FinanceRules.methodLabel("Naqd pul") == "Cash")
        #expect(FinanceRules.methodLabel("Plastik karta") == "Card")
        #expect(FinanceRules.methodLabel("Bank hisobi") == "Bank transfer")
        #expect(FinanceRules.methodLabel("Payme") == "Payme")
        #expect(FinanceRules.methodLabel("") == "")
    }

    @Test("A month lc-up left empty simply drops out of the row")
    func emptyMonth() {
        let row = FinancePayment(id: 3, date: "2026-10-15", amount: 100_000, method: "Naqd pul", month: "")
        #expect(FinanceRules.payMonth("") == "")
        #expect(FinanceRules.note(row) == "Cash")
    }

    @Test("A date that is not one is shown as it came rather than as a wrong day")
    func unreadableDate() {
        #expect(FinanceRules.payDay("not a date") == "not a date")
        #expect(FinanceRules.payMonth("2026-13") == "")
    }
}

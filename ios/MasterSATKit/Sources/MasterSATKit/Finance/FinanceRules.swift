import Foundation

/// How the Payments panel reads the student's money — the website's `PaymentsBody`
/// (`frontend/src/features/profile/OverviewTab.tsx`), line for line, so the two surfaces
/// never disagree about what somebody owes.
public enum FinanceRules {

    /// The one summary line at the top. Nil when lc-up has never told us a balance: the
    /// website draws nothing there rather than guessing at zero.
    public enum BalanceLine: Sendable, Equatable {
        /// Behind on this month — drawn in the danger tone, with what is owed.
        case owes(String)
        /// Paid ahead.
        case inCredit(String)
        /// Square with the centre.
        case allPaid
    }

    /// Owing is read off the debt the server worked out, never off the sign of the balance:
    /// the two are the same fact, and only one of them is the one the freeze uses.
    public static func owes(_ finance: MyFinance) -> Bool {
        (finance.debt ?? 0) > 0
    }

    public static func balanceLine(_ finance: MyFinance) -> BalanceLine? {
        guard let balance = finance.balance else { return nil }
        if owes(finance) { return .owes(UZS.format(finance.debt ?? 0)) }
        return balance > 0 ? .inCredit(UZS.format(balance)) : .allPaid
    }

    /// The per-group prices are worth showing only when there is more than one of them —
    /// with a single group the breakdown would repeat the monthly price underneath itself.
    public static func groupBreakdown(_ finance: MyFinance) -> [FinanceGroupCost] {
        finance.groups.count > 1 ? finance.groups : []
    }

    /// The latest few, in the order lc-up sent them (newest first).
    public static func recentPayments(_ finance: MyFinance, limit: Int = 5) -> [FinancePayment] {
        Array(finance.payments.prefix(max(0, limit)))
    }

    /// Only while something is owed, as on the website — a student who is square has no due
    /// date to be told about.
    public static func dueSentence(_ finance: MyFinance) -> String? {
        guard owes(finance), finance.balance != nil else { return nil }
        return "Payments are due by the \(ordinal(finance.freezeDay)) of each month. "
            + "Pay at your learning center."
    }

    // MARK: - One payment

    public static func isRefund(_ payment: FinancePayment) -> Bool {
        payment.kind == "refund"
    }

    /// "Cash", "October 2026" — what the row says after its date. A refund says so in place
    /// of the method: the money went the other way, and how it travelled is the smaller fact.
    public static func note(_ payment: FinancePayment) -> String {
        let how = isRefund(payment) ? "Refund" : methodLabel(payment.method)
        return [how, payMonth(payment.month)].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The figure on the right of a row; a refund carries a minus.
    public static func amountText(_ payment: FinancePayment) -> String {
        // U+2212, the typographic minus the website prints — a hyphen next to digits reads
        // as a dash in this font.
        (isRefund(payment) ? "\u{2212}" : "") + UZS.format(payment.amount)
    }

    /// lc-up names the methods in Uzbek; the student's page is English (owner, 2026-10-14).
    /// A name we have not met is shown as it came rather than hidden: lc-up may well grow a
    /// fourth one, and "" is worse than a word in Uzbek.
    public static func methodLabel(_ raw: String) -> String {
        methodLabels[raw] ?? raw
    }

    private static let methodLabels: [String: String] = [
        "Naqd pul": "Cash", "Plastik karta": "Card", "Bank hisobi": "Bank transfer",
    ]

    // MARK: - Dates

    /// "15 Oct 2026" for lc-up's `YYYY-MM-DD`. Read on the centre's own calendar, as every
    /// other date in the app is: a payment recorded on the 1st in Tashkent is the 1st to the
    /// student, wherever their phone is.
    public static func payDay(_ day: String) -> String {
        guard let date = ServicesTime.date(fromDay: day) else { return day }
        return dayFormatter.string(from: date)
    }

    /// "October 2026" for `YYYY-MM`; empty when lc-up left the month blank, which the row
    /// then simply leaves out.
    public static func payMonth(_ month: String) -> String {
        guard !month.isEmpty, let date = ServicesTime.date(fromDay: "\(month)-01") else { return "" }
        return monthFormatter.string(from: date)
    }

    /// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st — the website's `ordinal`.
    public static func ordinal(_ n: Int) -> String {
        let teens = abs(n) % 100
        if teens >= 11, teens <= 13 { return "\(n)th" }
        switch abs(n) % 10 {
        case 1: return "\(n)st"
        case 2: return "\(n)nd"
        case 3: return "\(n)rd"
        default: return "\(n)th"
        }
    }

    /// Both formatters are pinned to en_GB / en_US and Tashkent, the way the website's two
    /// `toLocaleDateString` calls are: the figures and their dates read the same in both
    /// places whatever the phone is set to.
    private static let dayFormatter: DateFormatter = formatter("d MMM yyyy", locale: "en_GB")
    private static let monthFormatter: DateFormatter = formatter("MMMM yyyy", locale: "en_US")

    private static func formatter(_ format: String, locale: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: locale)
        f.timeZone = ServicesTime.tashkent
        f.dateFormat = format
        return f
    }
}

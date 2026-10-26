import Foundation

/// Money at the learning center, written the one way the site writes it.
///
/// lc-up keeps whole so'm and the website prints them as `1,250,000 UZS` (`formatUzs` in
/// `frontend/src/features/finance/financeApi.ts`): grouped en-US wherever a student sees an
/// amount, whatever the phone's own locale would do with it. A student comparing their
/// Payments panel with the same figure on the website must read the same characters.
public enum UZS {
    /// `1,250,000 UZS`. Rounded to a whole so'm, grouped in threes, and never `-0`.
    public static func format(_ amount: Double) -> String {
        "\(grouped(whole(amount))) UZS"
    }

    public static func format(_ amount: Int) -> String {
        "\(grouped(amount)) UZS"
    }

    /// The website rounds with `Math.round`, which goes to the nearest and ties UPWARDS —
    /// towards +∞, not away from zero — so `-2.5` is `-2` there and must be here. Swift's own
    /// `rounded()` ties away from zero and would print `-3`.
    ///
    /// `|| 0` on the website turns a negative zero (a refund total of nothing, say) into `0`;
    /// `Int` has no negative zero, so the conversion does it.
    /// A figure too large for `Int` is not money anyone owes; it is a broken payload, and
    /// converting it would trap, so it is clamped rather than crashing the panel.
    static func whole(_ amount: Double) -> Int {
        guard amount.isFinite else { return 0 }
        let rounded = (amount + 0.5).rounded(.down)
        guard rounded > -9_007_199_254_740_992, rounded < 9_007_199_254_740_992 else {
            return rounded < 0 ? Int.min : Int.max
        }
        return Int(rounded)
    }

    /// The digits in threes, a lone minus in front — `toLocaleString("en-US")` for a whole
    /// number. Written out rather than handed to a `NumberFormatter`: the separator must be a
    /// comma for every student, and a formatter reads the device's locale unless it is pinned,
    /// which is the same amount of code with a surprise in it.
    static func grouped(_ amount: Int) -> String {
        let digits = String(amount.magnitude)
        var out = ""
        for (index, digit) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(digit)
        }
        return amount < 0 ? "-\(out)" : out
    }
}

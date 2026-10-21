import Foundation

/// "Where your XP came from" — the newest earnings that added XP, from `/rewards/me/`'s history.
///
/// The history is the points ledger, so two kinds of row are left out: a conversion (it spends
/// points, and never touched XP) and an earning whose rule pays points only (a survey, since
/// 2026-09-01 — `RewardRule.grantsXP`). Without the rules — not loaded yet, or failed — every
/// earning stays: the server itself reads a missing rule as one that adds XP
/// (`rewards/constants.py::_rule_grants_xp`). The amounts are the rows' points, which is the XP
/// they added for every rule that grants XP.
public enum XPLedger {
    public static func rows(_ history: [PointAward], rules: [RewardRule]?, limit: Int = 5) -> [PointAward] {
        let pointsOnly = Set((rules ?? []).filter { !$0.grantsXP }.map(\.event))
        return Array(history.filter { $0.points > 0 && !pointsOnly.contains($0.event) }.prefix(limit))
    }
}

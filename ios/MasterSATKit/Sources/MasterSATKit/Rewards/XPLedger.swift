import Foundation

/// "Where your XP came from" — the newest earnings that added XP, from `/rewards/me/`'s history.
///
/// The history is the points ledger, so two kinds of row are left out: a conversion (it spends
/// points, and never touched XP) and an earning that pays points only (a survey, since
/// 2026-09-01). Whether an earning adds XP is decided per event, the way the server decides it
/// (`rewards/constants.py::_rule_grants_xp`):
///
/// - an event with a rule in `rules` follows that rule's `grantsXP` flag;
/// - an event with NO rule — the rules not loaded yet or failed (`rules == nil`), or the rule
///   inactive, which `/rewards/rules/` does not serve — adds XP, except the events the server
///   keeps outside XP as its fallback (`excludedWithoutARule`, today SURVEY).
///
/// Reading a missing rule as "adds XP" for SURVEY too would show a survey here on first paint
/// and then drop it the moment the rules arrive. The amounts are the rows' points, which is the
/// XP they added for every rule that grants XP.
public enum XPLedger {
    /// Events that add no XP when they have no active rule. Mirrors `XP_EXCLUDED_EVENTS` in
    /// `backend/rewards/constants.py` — change them together.
    static let excludedWithoutARule: Set<String> = ["SURVEY"]

    public static func rows(_ history: [PointAward], rules: [RewardRule]?, limit: Int = 5) -> [PointAward] {
        var grantsXP: [String: Bool] = [:]
        for rule in rules ?? [] { grantsXP[rule.event] = rule.grantsXP }
        func addsXP(_ award: PointAward) -> Bool {
            award.points > 0 && (grantsXP[award.event] ?? !excludedWithoutARule.contains(award.event))
        }
        return Array(history.filter(addsXP).prefix(max(0, limit)))
    }
}

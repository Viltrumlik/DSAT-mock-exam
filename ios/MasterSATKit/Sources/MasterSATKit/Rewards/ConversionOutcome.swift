import Foundation

/// What became of a Convert press — the one decision behind every screen that spends points.
///
/// Converting is **not idempotent**: a second request is a second conversion, and points do not
/// come back. So the question "what actually happened?" is answered once, here, from the three
/// things a caller has after the press — the answer the server gave (nil when it was lost on the
/// way back), the student's balances from *before*, and the read-back that follows every press
/// (nil when that failed too). Both Convert surfaces — the Rewards hub's coins card and the XP
/// header window — asked that question in their own copy of the same twelve lines, and the copies
/// had already drifted apart once in wording.
///
/// This type is the decision and the sentence, and nothing else. The request, the balances
/// written into `@State`, the coin burst, the VoiceOver announcement and the focus move stay with
/// each view: they are I/O and presentation, they differ between a tab page and a floating card,
/// and they are not what a test can pin down. What a test can pin down is which of six things
/// happened and what the student is told, which is all of it below.
///
/// **The branch that is easy to get wrong** is `mintedUnreported`: an answer that never arrived
/// is not a failure, because the conversion it asked for may well have landed. When the read-back
/// shows the coins rose, that is a *success* — said as one, and celebrated as one — rather than
/// "that didn't go through" printed over a balance that went up.
public enum ConversionOutcome: Sendable, Equatable {
    /// The server answered, and coins were minted. `pointsSpent` is what the balance fell by.
    case minted(pointsSpent: Int, coins: Int)
    /// The server answered, and there was nothing whole to mint. An ordinary answer, not a
    /// failure: the student is told how far off the next coin is.
    case nothingToMint(pointsToNextCoin: Int)
    /// The server answered with a sentence of its own, which wins over the app's wording — it is
    /// written for people and is the only account of a refusal the app has no words for.
    ///
    /// `coins` is what that same answer said it minted, and is carried because the two halves of
    /// the decision are separate: a server that both minted and sent a detail line still owes the
    /// student a coin burst. Zero is ordinary (a refusal, "not enough points yet" in the server's
    /// own words).
    case serverMessage(String, coins: Int)
    /// The answer was lost, and the read-back shows the coins rose: it happened. The points spent
    /// are not known — only the server's answer carried them — so the sentence names the coins.
    case mintedUnreported(coins: Int)
    /// The answer was lost, and the read-back says the coins are as they were: it did not happen.
    case didNotHappen
    /// The answer was lost AND the read-back failed. Nothing is known, so the student is sent to
    /// look, and the caller holds Convert until a read goes through (a second press here could be
    /// a second conversion of points that are already gone).
    case unconfirmed

    /// Whether coins were minted — the flag that decides whether a coin bursts and whether the
    /// announcement waits its turn behind the card being read (news the screen already shows) or
    /// is said at normal priority (the only signal that nothing happened).
    ///
    /// True for both successes, including the lost answer whose read-back proved it worked, and
    /// for a server sentence that came with minted coins.
    public var mintedCoins: Bool {
        switch self {
        case .minted, .mintedUnreported:
            return true
        case .serverMessage(_, let coins):
            return coins > 0
        case .nothingToMint, .didNotHappen, .unconfirmed:
            return false
        }
    }

    /// What the student is told.
    ///
    /// `unconfirmed` is a parameter because that one sentence is deliberately not shared: it ends
    /// by asking the student to look, and the gesture differs. The Rewards hub is a page with a
    /// pull ("Pull down to check your coins."); the XP window is a floating card with none, so it
    /// names the button beside it ("Check again to see your coins."). Every other sentence is the
    /// same promise on both surfaces and so is written once, here.
    public func text(unconfirmed: String) -> String {
        switch self {
        case .minted(let pointsSpent, let coins):
            return "Converted \(pointsSpent) points into \(RewardsFormat.count(coins, "coin"))."
        case .nothingToMint(let pointsToNextCoin):
            return "Not enough points yet — \(RewardsFormat.count(pointsToNextCoin, "point")) to your next coin."
        case .serverMessage(let detail, _):
            return detail
        case .mintedUnreported(let coins):
            return "Converted points into \(RewardsFormat.count(coins, "coin"))."
        case .didNotHappen:
            return "That didn't go through — your coins are as they were. Try again."
        case .unconfirmed:
            return unconfirmed
        }
    }

    /// The decision, from exactly what a caller has after the press.
    ///
    /// - Parameters:
    ///   - answer: what `POST /rewards/wallet/convert/` answered, or nil when the request threw —
    ///     which includes an answer that was *sent* and lost on the way back.
    ///   - before: the balances as they were when Convert was pressed.
    ///   - readBack: the `/rewards/me/` that follows every press, or nil when it failed or was
    ///     cancelled. **Only consulted when the answer was lost** — a server that spoke is the
    ///     authority on its own conversion, and the read-back cannot overrule it.
    public static func decide(
        answer: ConversionResult?,
        before: MyRewards,
        readBack: MyRewards?
    ) -> ConversionOutcome {
        if let answer {
            // The server's own sentence first, as both surfaces have always done: it may be a
            // refusal the app has no wording for, and it is written for the student.
            guard answer.detail.isEmpty else { return .serverMessage(answer.detail, coins: answer.minted) }
            guard answer.minted > 0 else {
                // The distance to the next coin as the *new* balances report it — the same figure
                // `MyRewards.applying(_:)` carries through onto the card.
                return .nothingToMint(pointsToNextCoin: answer.balances.pointsToNextCoin)
            }
            return .minted(pointsSpent: answer.pointsSpent, coins: answer.minted)
        }
        guard let readBack else { return .unconfirmed }
        // Strictly risen: equal coins after a lost answer is a conversion that did not land, and
        // a fall is not a conversion at all (nothing here mints a negative).
        guard readBack.coins > before.coins else { return .didNotHappen }
        return .mintedUnreported(coins: readBack.coins - before.coins)
    }
}

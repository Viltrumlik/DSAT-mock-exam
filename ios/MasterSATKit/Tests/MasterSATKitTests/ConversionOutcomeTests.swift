import Foundation
import Testing
@testable import MasterSATKit

/// The decision behind Convert, which spends real points and cannot be retried. Until this type
/// existed the same twelve lines lived in `RewardsHubView.convert()` and `XPWindowView.convert()`
/// with no test at all, and had already drifted apart once.
@Suite struct ConversionOutcomeTests {

    /// The hub's sentence and the window's — the one deliberate divergence, and the reason the
    /// unconfirmed line is a parameter rather than a constant here.
    private static let hubUnconfirmed = "We couldn't confirm that went through. Pull down to check your coins."
    private static let windowUnconfirmed = "We couldn't confirm that went through. Check again to see your coins."

    private func rewards(points: Int, coins: Int, rate: Int = 10) -> MyRewards {
        MyRewards(
            points: points,
            coins: coins,
            pointsPerCoin: rate,
            convertibleCoins: points / rate,
            maxConvertiblePoints: (points / rate) * rate
        )
    }

    private func answer(minted: Int, pointsSpent: Int, detail: String = "", coins: Int, points: Int, rate: Int = 10) -> ConversionResult {
        let balances = RewardsBalances(
            coins: coins,
            points: points,
            xp: 0,
            pointsPerCoin: rate,
            pointsToNextCoin: rate - (max(0, points) % rate),
            convertibleCoins: points / rate,
            maxConvertiblePoints: (points / rate) * rate
        )
        return ConversionResult(minted: minted, pointsSpent: pointsSpent, detail: detail, balances: balances)
    }

    // MARK: - The server answered

    @Test("The server minted coins: what was spent and what it bought")
    func minted() {
        let outcome = ConversionOutcome.decide(
            answer: answer(minted: 3, pointsSpent: 30, coins: 32, points: 4),
            before: rewards(points: 34, coins: 29),
            readBack: nil
        )
        #expect(outcome == .minted(pointsSpent: 30, coins: 3))
        #expect(outcome.mintedCoins)
        #expect(outcome.text(unconfirmed: Self.hubUnconfirmed) == "Converted 30 points into 3 coins.")
    }

    @Test("One coin, and one point to the next, are said in the singular")
    func singulars() {
        let one = ConversionOutcome.decide(
            answer: answer(minted: 1, pointsSpent: 10, coins: 1, points: 0),
            before: rewards(points: 10, coins: 0),
            readBack: nil
        )
        #expect(one.text(unconfirmed: Self.hubUnconfirmed) == "Converted 10 points into 1 coin.")

        // `points_to_next_coin` is `rate − points % rate`, so 9 points of 10 leaves exactly one.
        let nearly = ConversionOutcome.decide(
            answer: answer(minted: 0, pointsSpent: 0, coins: 4, points: 9),
            before: rewards(points: 9, coins: 4),
            readBack: nil
        )
        #expect(nearly == .nothingToMint(pointsToNextCoin: 1))
        #expect(nearly.text(unconfirmed: Self.hubUnconfirmed) == "Not enough points yet — 1 point to your next coin.")
    }

    @Test("Nothing whole to mint is an ordinary answer, not a failure")
    func nothingToMint() {
        let outcome = ConversionOutcome.decide(
            answer: answer(minted: 0, pointsSpent: 0, coins: 4, points: 7),
            before: rewards(points: 7, coins: 4),
            readBack: nil
        )
        #expect(outcome == .nothingToMint(pointsToNextCoin: 3))
        #expect(!outcome.mintedCoins, "no coin burst for a press that minted nothing")
        #expect(outcome.text(unconfirmed: Self.hubUnconfirmed) == "Not enough points yet — 3 points to your next coin.")
    }

    @Test("The server's own sentence beats the app's wording")
    func serverMessageWins() {
        let refused = ConversionOutcome.decide(
            answer: answer(minted: 0, pointsSpent: 0, detail: "Conversions are paused until Monday.", coins: 4, points: 40),
            before: rewards(points: 40, coins: 4),
            readBack: nil
        )
        #expect(refused == .serverMessage("Conversions are paused until Monday.", coins: 0))
        #expect(!refused.mintedCoins)
        #expect(refused.text(unconfirmed: Self.hubUnconfirmed) == "Conversions are paused until Monday.")
    }

    @Test("A server sentence that came with minted coins still bursts a coin")
    func serverMessageWithCoins() {
        // The two halves of the decision are separate: the detail is what the student reads, and
        // `minted` is still what decides the celebration. Both copies of this flow have always
        // behaved this way, and a `serverMessage` that reported `mintedCoins == false` would
        // quietly swallow the burst for a conversion that happened.
        let outcome = ConversionOutcome.decide(
            answer: answer(minted: 2, pointsSpent: 20, detail: "Converted 20 points — enjoy!", coins: 31, points: 3),
            before: rewards(points: 23, coins: 29),
            readBack: nil
        )
        #expect(outcome == .serverMessage("Converted 20 points — enjoy!", coins: 2))
        #expect(outcome.mintedCoins)
        #expect(outcome.text(unconfirmed: Self.windowUnconfirmed) == "Converted 20 points — enjoy!")
    }

    @Test("An answer that arrived is never second-guessed by the read-back")
    func answerWinsOverReadBack() {
        // A read-back that happens to disagree (a slower, older `/rewards/me/`) cannot turn a
        // reported conversion into "that didn't go through".
        let outcome = ConversionOutcome.decide(
            answer: answer(minted: 1, pointsSpent: 10, coins: 30, points: 2),
            before: rewards(points: 12, coins: 29),
            readBack: rewards(points: 12, coins: 29)
        )
        #expect(outcome == .minted(pointsSpent: 10, coins: 1))
    }

    // MARK: - The answer was lost

    @Test("The answer was lost but the coins rose: a success, with the burst")
    func mintedUnreported() {
        let outcome = ConversionOutcome.decide(
            answer: nil,
            before: rewards(points: 34, coins: 29),
            readBack: rewards(points: 4, coins: 32)
        )
        #expect(outcome == .mintedUnreported(coins: 3))
        #expect(outcome.mintedCoins, "the conversion landed even though the answer did not come back")
        #expect(outcome.text(unconfirmed: Self.hubUnconfirmed) == "Converted points into 3 coins.")
    }

    @Test("One coin gained after a lost answer is said in the singular")
    func mintedUnreportedSingular() {
        let outcome = ConversionOutcome.decide(
            answer: nil,
            before: rewards(points: 12, coins: 0),
            readBack: rewards(points: 2, coins: 1)
        )
        #expect(outcome.text(unconfirmed: Self.windowUnconfirmed) == "Converted points into 1 coin.")
    }

    @Test("The answer was lost and the coins are unchanged: it did not happen")
    func didNotHappen() {
        let outcome = ConversionOutcome.decide(
            answer: nil,
            before: rewards(points: 34, coins: 29),
            readBack: rewards(points: 34, coins: 29)
        )
        #expect(outcome == .didNotHappen)
        #expect(!outcome.mintedCoins)
        #expect(outcome.text(unconfirmed: Self.hubUnconfirmed) == "That didn't go through — your coins are as they were. Try again.")
    }

    @Test("Coins that somehow fell are not read as a conversion")
    func coinsFellIsNotAMint() {
        // A shop purchase on another device between the press and the read-back. Whatever it was,
        // it was not this conversion minting coins, so nothing is celebrated.
        let outcome = ConversionOutcome.decide(
            answer: nil,
            before: rewards(points: 34, coins: 29),
            readBack: rewards(points: 34, coins: 25)
        )
        #expect(outcome == .didNotHappen)
        #expect(!outcome.mintedCoins)
    }

    @Test("The answer was lost AND the read-back failed: nothing is known")
    func unconfirmed() {
        let outcome = ConversionOutcome.decide(
            answer: nil,
            before: rewards(points: 34, coins: 29),
            readBack: nil
        )
        #expect(outcome == .unconfirmed)
        #expect(!outcome.mintedCoins, "no burst over a conversion nobody can confirm")
    }

    @Test("The unconfirmed line is the caller's own, and only that branch takes it")
    func unconfirmedWordingIsTheCallers() {
        let outcome = ConversionOutcome.decide(answer: nil, before: rewards(points: 34, coins: 29), readBack: nil)
        #expect(outcome.text(unconfirmed: Self.hubUnconfirmed) == Self.hubUnconfirmed)
        #expect(outcome.text(unconfirmed: Self.windowUnconfirmed) == Self.windowUnconfirmed)
        #expect(Self.hubUnconfirmed != Self.windowUnconfirmed, "a page has a pull; a floating card does not")

        // Every other branch ignores it — the shared sentences are the same promise on both.
        let shared: [ConversionOutcome] = [
            .minted(pointsSpent: 30, coins: 3),
            .nothingToMint(pointsToNextCoin: 3),
            .serverMessage("Conversions are paused until Monday.", coins: 0),
            .mintedUnreported(coins: 3),
            .didNotHappen
        ]
        for outcome in shared {
            #expect(
                outcome.text(unconfirmed: Self.hubUnconfirmed) == outcome.text(unconfirmed: Self.windowUnconfirmed),
                "\(outcome) must read the same on both surfaces"
            )
        }
    }
}

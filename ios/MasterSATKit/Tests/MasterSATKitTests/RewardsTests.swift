import Foundation
import Testing
@testable import MasterSATKit

@Suite struct RewardsAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> RewardsAPI {
        RewardsAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("The balance decodes, timestamps and all")
    func rewardsDecode() async throws {
        // A real `/api/rewards/me/` body. The timestamp matters: the shared decoder sets no
        // `dateDecodingStrategy`, so a `Date` property here would throw at runtime with
        // nothing to catch it at build time. It is a String, parsed where it is displayed.
        server.handler = { _ in
            .json([
                "points": 85,
                "coins": 8,
                "points_per_coin": 10,
                "points_to_next_coin": 5,
                "history": [[
                    "id": 12,
                    "event": "ATTENDANCE_PRESENT",
                    "label": "Attended a lesson",
                    "points": 5,
                    "classroom": 3,
                    "classroom_name": "Maths A",
                    "awarded_at": "2026-08-08T09:12:44.123456Z",
                    "note": "",
                ]],
            ])
        }
        let mine = try await api().me()
        #expect(mine.points == 85)
        #expect(mine.coins == 8)
        #expect(mine.pointsToNextCoin == 5)
        #expect(mine.history.first?.label == "Attended a lesson")
        #expect(mine.history.first?.classroomName == "Maths A")
        #expect(mine.history.first?.classroomId == 3)
        #expect(mine.history.first?.awardedDate != nil)
        // The pre-conversion shape: everything added since reads as zero, not as a failure.
        #expect(mine.xp == 0)
        #expect(mine.convertibleCoins == 0)
        #expect(mine.maxConvertiblePoints == 0)
        #expect(mine.strikes == 0)
        #expect(mine.currentStreak == 0)
        #expect(mine.lastCountedDate == nil)
    }

    @Test("A classroom-less award decodes — surveys and midterms belong to no class")
    func classroomlessAward() async throws {
        server.handler = { _ in
            .json([
                "points": 40, "coins": 4, "points_per_coin": 10, "points_to_next_coin": 0,
                "history": [[
                    "id": 13, "event": "SURVEY", "label": "Completed a survey", "points": 40,
                    "classroom": NSNull(), "classroom_name": NSNull(),
                    "awarded_at": "2026-08-08T09:12:44Z", "note": "",
                ]],
            ])
        }
        let mine = try await api().me()
        #expect(mine.history.first?.classroomName == nil)
        #expect(mine.history.first?.classroomId == nil)
        // The plain (no-microsecond) form has to parse too — both appear in one payload.
        #expect(mine.history.first?.awardedDate != nil)
    }

    @Test("Coins come from the wallet, not from points ÷ rate")
    func coinsAreNotDerived() async throws {
        // 85 points at 10 per coin would *derive* 8 coins. The student has spent some, so the
        // wallet says 3 — and the screen must show what they can spend, not what they earned.
        server.handler = { _ in
            .json([
                "points": 85, "coins": 3, "points_per_coin": 10,
                "points_to_next_coin": 5, "history": [],
            ])
        }
        let mine = try await api().me()
        #expect(mine.coins == 3)
        #expect(mine.coins != mine.points / mine.pointsPerCoin)
    }

    @Test("The rules arrive unwrapped from their envelope")
    func rulesDecode() async throws {
        server.handler = { _ in
            .json(["rules": [
                ["event": "ATTENDANCE_PRESENT", "label": "Attended a lesson", "points": 5],
                ["event": "SURVEY", "label": "Completed a survey", "points": 40],
            ]])
        }
        let rules = try await api().rules()
        #expect(rules.count == 2)
        #expect(rules.first?.points == 5)
        // No flag in the old payload is not "no XP" — it would stamp "Points only" on everything.
        #expect(rules.filter { !$0.grantsXP }.isEmpty)
        #expect(rules.filter { $0.groupPoints != nil }.isEmpty)
    }

    @Test("The current /rewards/me/ decodes every new field, and a conversion row is a spend")
    func currentShape() async throws {
        server.handler = { _ in
            .json([
                "points": 4, "coins": 11, "xp": 340,
                "points_per_coin": 10, "points_to_next_coin": 6,
                "convertible_coins": 0, "max_convertible_points": 0,
                "current_streak": 5, "best_streak": 9, "strikes": 3, "spent_in_streak": 2,
                "last_counted_date": "2026-09-24",
                "history": [
                    [
                        "id": 90, "event": "COIN_CONVERSION", "label": "Turned into coins",
                        "points": -30, "classroom": NSNull(), "classroom_name": NSNull(),
                        // Serializer timestamps carry the Tashkent offset, with microseconds.
                        "awarded_at": "2026-09-25T14:05:09.123456+05:00",
                        "note": "30 points → 3 coins",
                    ],
                    [
                        "id": 89, "event": "HOMEWORK", "label": "Homework completed",
                        "points": 15, "classroom": 3, "classroom_name": "Maths A",
                        "awarded_at": "2026-09-24T18:00:00+05:00", "note": "",
                    ],
                ],
            ])
        }
        let mine = try await api().me()
        #expect(mine.xp == 340)
        #expect(mine.currentStreak == 5)
        #expect(mine.bestStreak == 9)
        #expect(mine.strikes == 3)
        #expect(mine.spentInStreak == 2)
        #expect(mine.lastCountedDate == "2026-09-24")

        let conversion = try #require(mine.history.first)
        #expect(conversion.points == -30)
        #expect(conversion.isSpend)
        // The bug this fixes: the app printed "+\(points)", which is "+-30".
        #expect(conversion.signedPoints == "-30")
        #expect(conversion.note == "30 points → 3 coins")
        #expect(conversion.awardedDate != nil)

        let earning = try #require(mine.history.last)
        #expect(!earning.isSpend)
        #expect(earning.signedPoints == "+15")
        #expect(earning.awardedDate != nil)
    }

    @Test("DRF quirks: numbers as strings, nulls, absent keys and empty names")
    func drfQuirks() async throws {
        server.handler = { _ in
            .json([
                "points": "85", "coins": "8", "xp": 120.0,
                "points_per_coin": "10",
                "last_counted_date": NSNull(),
                "history": [[
                    "id": 1, "event": "SUPPORT_SESSION", "label": "Support-teacher session held",
                    "points": "20", "classroom_name": "",
                    "awarded_at": "2026-09-01T10:00:00.5+05:00",
                ]],
            ])
        }
        let mine = try await api().me()
        #expect(mine.points == 85)
        #expect(mine.coins == 8)
        #expect(mine.xp == 120)
        // Absent, it is derived the server's way: rate − points % rate.
        #expect(mine.pointsToNextCoin == 5)
        #expect(mine.lastCountedDate == nil)
        let row = try #require(mine.history.first)
        #expect(row.points == 20)
        #expect(row.classroomName == nil)
        #expect(row.note == "")
    }

    @Test("A /rewards/me/ with no balance is a failure, never a zero")
    func missingBalanceThrows() async throws {
        server.handler = { _ in .json(["coins": 3, "history": []]) }
        await #expect(throws: APIError.self) { try await api().me() }
    }

    @Test("One unreadable history row costs that row; all of them unreadable is an error")
    func lossyHistory() async throws {
        server.handler = { _ in
            .json([
                "points": 10, "coins": 1,
                "history": [
                    ["event": "SURVEY", "points": 40],            // no id
                    ["id": 2, "event": "SURVEY", "points": 40, "awarded_at": "2026-09-01T10:00:00Z"],
                    "garbage",
                    ["id": 3, "event": "MANUAL", "points": 5, "awarded_at": "2026-09-01T10:00:00Z"],
                ],
            ])
        }
        let mine = try await api().me()
        #expect(mine.history.map(\.id) == [2, 3])

        // Every row failing is a contract change, and "Nothing yet" would be the wrong answer.
        server.handler = { _ in
            .json(["points": 10, "coins": 1, "history": [["event": "SURVEY"], ["label": "x"]]])
        }
        await #expect(throws: APIError.self) { try await api().me() }
    }

    @Test("Rules carry grants_xp and the support ladder")
    func richRules() async throws {
        server.handler = { _ in
            .json(["rules": [
                ["event": "HOMEWORK", "label": "Homework completed", "points": 15, "grants_xp": true, "group_points": NSNull()],
                ["event": "SUPPORT_SESSION", "label": "Support-teacher session held", "points": 10,
                 "grants_xp": true, "group_points": [10, 15, 20]],
                ["event": "SURVEY", "label": "Survey completed", "points": 40, "grants_xp": false, "group_points": NSNull()],
                ["event": "CLASSWORK_MANUAL", "label": "Classwork awarded by a teacher", "points": 0, "grants_xp": true],
                ["event": "HOMEWORK_FULL", "label": "Homework 100%", "points": 15, "grants_xp": true],
                ["event": "HOMEWORK_HIGH", "label": "Homework 80–99%", "points": 10, "grants_xp": true],
                ["event": "HOMEWORK_MID", "label": "Homework 60–79%", "points": 5, "grants_xp": true],
            ]])
        }
        let rules = try await api().rules()
        #expect(rules.count == 7)

        let earnable = RewardRule.earnable(rules)
        #expect(earnable.map(\.event) == ["HOMEWORK", "SUPPORT_SESSION", "SURVEY", "CLASSWORK_MANUAL"])

        let homework = earnable[0]
        #expect(homework.amountText == "+15")
        #expect(homework.hint == "Finish it all before the deadline and the full 15 lands right away. Otherwise you're paid at the deadline for the share you've finished — only what's done by then counts, so starting early is what pays.")

        let support = earnable[1]
        #expect(support.groupPoints == [10, 15, 20])
        #expect(support.amountText == "+10\u{2013}20")
        #expect(support.hint == "Bring a classmate and you both earn more: 10 on your own, 15 each if two of you go, 20 each if three do. You're paid once the teacher marks the session as held.")

        let survey = earnable[2]
        #expect(!survey.grantsXP)
        #expect(survey.amountText == "+40")
        #expect(survey.hint == "Points only — this one doesn't add to your XP.")

        let classwork = earnable[3]
        #expect(classwork.isTeacherPriced)
        // "+0" would read as "worth nothing"; the screen says "Set by your teacher" instead.
        #expect(classwork.amountText == nil)
        #expect(classwork.hint == "Your teacher decides this one, for the work you do in the lesson itself.")
    }

    @Test("A flat ladder reads as one number, and a rule without XP says so after its own hint")
    func ruleEdges() {
        let flat = RewardRule(event: "SUPPORT_SESSION", label: "Support", points: 10, groupPoints: [10, 10, 10])
        #expect(flat.amountText == "+10")
        let noXPHomework = RewardRule(event: "HOMEWORK", label: "Homework", points: 15, grantsXP: false)
        #expect(noXPHomework.hint?.hasSuffix("starting early is what pays. Points only — this one doesn't add to your XP.") == true)
        let plain = RewardRule(event: "ATTENDANCE_PRESENT", label: "Attended a lesson", points: 5)
        #expect(plain.hint == nil)
    }

    @Test("The wallet decodes its balances and signed coin history")
    func walletDecode() async throws {
        server.handler = { _ in
            .json([
                "coins": 6, "points": 4, "xp": 340, "points_per_coin": 10, "points_to_next_coin": 6,
                "convertible_coins": 0, "max_convertible_points": 0,
                "transactions": [
                    ["id": 7, "kind": "SPEND", "label": "Spent", "amount": -5, "balance_after": 6,
                     "points_spent": 0, "reference": "Shop: Notebook",
                     "created_at": "2026-09-25T09:05:09.123456Z"],
                    ["id": 6, "kind": "EARN", "label": "Earned", "amount": 3, "balance_after": 11,
                     "points_spent": 30, "reference": "10 points = 1 coin",
                     "created_at": "2026-09-24T09:05:09.123456Z"],
                    ["id": 5, "kind": "ADMIN_GRANT", "label": "Admin grant", "amount": 8, "balance_after": 8,
                     "points_spent": 0, "reference": "", "created_at": "2026-09-20T09:05:09Z"],
                ],
            ])
        }
        let wallet = try await api().wallet()
        #expect(wallet.balances.coins == 6)
        #expect(wallet.balances.xp == 340)
        #expect(wallet.transactions.count == 3)

        let spend = wallet.transactions[0]
        #expect(spend.isSpend)
        #expect(spend.signedAmount == "-5")
        #expect(spend.title == "Shop: Notebook")
        #expect(spend.createdDate != nil)

        let earn = wallet.transactions[1]
        #expect(earn.signedAmount == "+3")
        #expect(earn.pointsSpent == 30)

        // `reference || label`: an empty reference falls back to the kind's label.
        #expect(wallet.transactions[2].title == "Admin grant")
    }

    @Test("Convert sends the amount typed, and reads back the new balances")
    func convertSendsAmount() async throws {
        server.handler = { _ in
            .json([
                "minted": 3, "points_spent": 30,
                "detail": "Converted 30 points into 3 coins.",
                "coins": 11, "points": 4, "xp": 340, "points_per_coin": 10, "points_to_next_coin": 6,
                "convertible_coins": 0, "max_convertible_points": 0,
            ])
        }
        let result = try await api().convert(points: 34)
        #expect(result.minted == 3)
        #expect(result.pointsSpent == 30)
        #expect(result.detail == "Converted 30 points into 3 coins.")
        #expect(result.balances.points == 4)
        #expect(result.balances.coins == 11)

        let request = try #require(server.requests.first)
        #expect(server.requests.count == 1)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/rewards/wallet/convert/")
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["points"] as? Int == 34)
    }

    @Test("Max is an empty body, not a null — the server reads {} as every whole coin")
    func convertMaxSendsEmptyObject() async throws {
        server.handler = { _ in
            .json([
                "minted": 0, "points_spent": 0,
                "detail": "Not enough points yet — 3 more for a coin.",
                "coins": 11, "points": 7, "xp": 340, "points_per_coin": 10, "points_to_next_coin": 3,
                "convertible_coins": 0, "max_convertible_points": 0,
            ])
        }
        let result = try await api().convert(points: nil)
        // Minting nothing is an answer, not an error.
        #expect(result.minted == 0)
        #expect(result.detail == "Not enough points yet — 3 more for a coin.")
        let body = try #require(server.requests.first?.httpBody)
        #expect(String(decoding: body, as: UTF8.self) == "{}")
    }

    @Test("A refused conversion surfaces the server's sentence and is sent exactly once")
    func convertRefusal() async throws {
        server.handler = { _ in
            .json(["detail": "Not enough points: 40 available, 400 needed."], status: 400)
        }
        do {
            _ = try await api().convert(points: 400)
            Issue.record("A refused conversion must throw")
        } catch let APIError.http(status, detail) {
            #expect(status == 400)
            #expect(detail == "Not enough points: 40 available, 400 needed.")
        }
        // Not idempotent: nothing may retry it behind the student's back.
        #expect(server.requests.count == 1)
    }

    @Test("After a conversion the balances move and the run and history stay")
    func applyingBalances() throws {
        let before = MyRewards(
            points: 34, coins: 8, xp: 340, pointsPerCoin: 10,
            convertibleCoins: 3, maxConvertiblePoints: 30,
            currentStreak: 5, bestStreak: 9, strikes: 3, spentInStreak: 2,
            history: [PointAward(id: 1, event: "HOMEWORK", label: "Homework completed", points: 15, awardedAt: "2026-09-24T18:00:00+05:00")]
        )
        let after = before.applying(RewardsBalances(
            coins: 11, points: 4, xp: 340, pointsPerCoin: 10, pointsToNextCoin: 6,
            convertibleCoins: 0, maxConvertiblePoints: 0
        ))
        #expect(after.points == 4)
        #expect(after.coins == 11)
        #expect(after.convertibleCoins == 0)
        #expect(after.pointsToNextCoin == 6)
        // Converting never touches XP or the strikes.
        #expect(after.xp == 340)
        #expect(after.strikes == 3)
        #expect(after.currentStreak == 5)
        #expect(after.history == before.history)
    }
}

@Suite struct ConversionPreviewTests {

    private func line(_ input: String, points: Int = 40, rate: Int = 10) -> String? {
        ConversionPreview(input: input, points: points, pointsPerCoin: rate).message
    }

    @Test("Whole coins only: the remainder stays in the balance")
    func wholeCoins() {
        let preview = ConversionPreview(input: "34", points: 40, pointsPerCoin: 10)
        #expect(preview.state == .buys(coins: 3, spent: 30, kept: 4))
        #expect(preview.message == "30 points buy 3 coins, and you keep the other 4.")
        #expect(preview.canConvert)
        // What is sent is what was typed; the server applies the same rounding.
        #expect(preview.asked == 34)
    }

    @Test("An exact multiple keeps nothing back, and one coin is singular")
    func exactMultiples() {
        #expect(line("30") == "30 points buy 3 coins.")
        #expect(line("10") == "10 points buy 1 coin.")
        #expect(line("19") == "10 points buy 1 coin, and you keep the other 9.")
    }

    @Test("Short of a coin says how the rate works, and Convert stays off")
    func lessThanACoin() {
        let preview = ConversionPreview(input: "7", points: 40, pointsPerCoin: 10)
        #expect(preview.message == "10 points buy a coin — 7 isn't enough for one yet.")
        #expect(!preview.canConvert)
        #expect(preview.asked == nil)
    }

    @Test("More than the balance is refused in advance, singular and plural")
    func moreThanYouHave() {
        #expect(line("400") == "You only have 40 points.")
        #expect(line("2", points: 1) == "You only have 1 point.")
        // A number too long for an Int is still a number — a bigger one than anybody has.
        #expect(line("99999999999999999999999") == "You only have 40 points.")
        #expect(!ConversionPreview(input: "400", points: 40, pointsPerCoin: 10).canConvert)
    }

    @Test("Nothing typed shows no line; anything that is not an amount asks for one")
    func notAnAmount() {
        #expect(line("") == nil)
        #expect(line("   ") == nil)
        #expect(line("0") == "Enter how many points to convert.")
        #expect(line("000") == "Enter how many points to convert.")
        #expect(line("-5") == "Enter how many points to convert.")
        #expect(line("abc") == "Enter how many points to convert.")
        #expect(line("3.5") == "Enter how many points to convert.")
        #expect(line(" 20 ") == "20 points buy 2 coins.")
    }

    @Test("A rate of zero is clamped rather than divided by")
    func zeroRate() {
        #expect(line("5", points: 40, rate: 0) == "5 points buy 5 coins.")
    }

    @Test("The strip's heading: what the points are worth, or how far off the next coin is")
    func headline() {
        let ready = ConversionPreview.headline(convertibleCoins: 3, pointsToNextCoin: 6)
        #expect(ready.overline == "Ready to convert")
        #expect(ready.sentence == "Your points are worth 3 coins.")
        #expect(ConversionPreview.headline(convertibleCoins: 1, pointsToNextCoin: 6).sentence == "Your points are worth 1 coin.")
        let short = ConversionPreview.headline(convertibleCoins: 0, pointsToNextCoin: 7)
        #expect(short.overline == "To your next coin")
        #expect(short.sentence == "7 more points and you can convert.")
        #expect(ConversionPreview.headline(convertibleCoins: 0, pointsToNextCoin: 1).sentence == "1 more point and you can convert.")
    }

    @Test("Signed amounts: plus for earning, minus for spending, and no overflow")
    func signed() {
        #expect(RewardsFormat.signed(5) == "+5")
        #expect(RewardsFormat.signed(-30) == "-30")
        #expect(RewardsFormat.signed(0) == "+0")
        #expect(RewardsFormat.signed(Int.min).hasPrefix("-"))
        #expect(RewardsFormat.count(1, "coin") == "1 coin")
        #expect(RewardsFormat.count(2, "coin") == "2 coins")
    }
}

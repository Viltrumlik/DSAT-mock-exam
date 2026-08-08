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
        #expect(mine.history.first?.awardedDate != nil)
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
    }
}

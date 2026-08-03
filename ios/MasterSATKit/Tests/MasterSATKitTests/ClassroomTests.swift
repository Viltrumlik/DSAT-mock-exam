import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ClassroomAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> ClassroomAPI {
        ClassroomAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("A classroom row carries its teacher and the viewer's role")
    func classroomDecodes() async throws {
        server.handler = { _ in
            .json([[
                "id": 4,
                "name": "Senior Math A",
                "subject": "MATH",
                "schedule_summary": "Mon, Wed, Fri · 15:00",
                "members_count": 12,
                "is_active": true,
                "my_role": "STUDENT",
                "teacher_details": ["first_name": "Aziz", "last_name": "Karimov"],
            ]])
        }

        let rooms = try await api().classrooms()

        let room = try #require(rooms.first)
        #expect(room.name == "Senior Math A")
        #expect(room.teacherName == "Aziz Karimov")
        #expect(room.isStudent)
    }

    @Test("A removed student's row has no role")
    func removedMemberHasNoRole() async throws {
        // The list still returns the classroom, so "there is a row" must not be read as
        // "they are still in the class".
        server.handler = { _ in .json([["id": 1, "name": "Old class", "my_role": nil]]) }

        let rooms = try await api().classrooms()

        #expect(rooms.first?.myRole == nil)
        #expect(rooms.first?.isStudent == false)
    }

    @Test("Joining posts the code to the join endpoint")
    func joinPostsCode() async throws {
        server.handler = { _ in .json(["id": 9, "name": "Joined"]) }

        _ = try await api().join(code: "  ABC123 ")

        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/classes/join/")
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        // Trimmed: a code pasted from a chat message routinely arrives with whitespace.
        #expect(json["join_code"] as? String == "ABC123")
    }

    @Test("People are split into staff and students by role")
    func peopleRoles() async throws {
        server.handler = { _ in
            .json([
                ["id": 1, "role": "TEACHER", "user": ["id": 7, "first_name": "Aziz", "last_name": "K", "email": "a@x.uz"]],
                ["id": 2, "role": "STUDENT", "user": ["id": 8, "first_name": "Dilnoza", "email": "d@x.uz"]],
                // Legacy classrooms still carry these two role names.
                ["id": 3, "role": "CO_TEACHER", "user": ["id": 9, "email": "c@x.uz"]],
            ])
        }

        let people = try await api().people(classroomId: 4)

        #expect(people.count == 3)
        #expect(people[0].isStaff)
        #expect(people[1].isStaff == false)
        #expect(people[2].isStaff)
        #expect(people[2].roleLabel == "Teaching Assistant")
        // No name at all: the email is better than "Student".
        #expect(people[2].name == "c@x.uz")
    }

    @Test("A hidden leaderboard is a setting, not an error")
    func hiddenBoard() async throws {
        server.handler = { _ in
            .json([
                "kind": "ACADEMIC",
                "rows": [],
                "my": nil,
                "config": ["leaderboard_mode": "HIDDEN", "hide_score_values": true],
            ])
        }

        let board = try await api().rankings(classroomId: 4, kind: .academic)

        #expect(board.isHidden)
        #expect(board.hideScoreValues)
        #expect(board.rows.isEmpty)
    }

    @Test("A row with no result is distinguishable from a hidden score")
    func noResultVersusHiddenScore() async throws {
        server.handler = { _ in
            .json([
                "kind": "SAT",
                "sat_available": true,
                "config": ["leaderboard_mode": "FULL", "hide_score_values": false],
                "rows": [
                    ["rank": 1, "name": "A", "score": 1400, "has_result": true, "is_me": false],
                    ["rank": 2, "name": "B", "score": nil, "has_result": false, "is_me": true],
                ],
            ])
        }

        let board = try await api().rankings(classroomId: 4, kind: .sat)

        #expect(board.rows[0].hasResult)
        // Both have a nil score on a hidden board; only `has_result` tells them apart, and
        // they need different words in front of a student.
        #expect(board.rows[1].hasResult == false)
        #expect(board.rows[1].isMe)
    }

    @Test("SAT ranking is not offered to a class that does not rank on it")
    func satUnavailable() async throws {
        server.handler = { _ in
            .json(["kind": "SAT", "rows": [], "sat_available": false, "config": [:]])
        }

        let board = try await api().rankings(classroomId: 4, kind: .sat)

        #expect(board.satAvailable == false)
    }
}

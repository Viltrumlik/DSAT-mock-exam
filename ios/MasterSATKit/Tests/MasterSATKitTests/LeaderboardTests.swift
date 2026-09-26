import Foundation
import Testing
@testable import MasterSATKit

@Suite struct LeaderboardAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> LeaderboardAPI {
        LeaderboardAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    private static func row(
        _ rank: Int, _ id: Int, _ xp: Int, name: String = "Student", me: Bool = false,
        branch: Any = "Chilonzor", region: Any = "Tashkent", photo: Any = NSNull()
    ) -> [String: Any] {
        [
            "rank": rank, "student_id": id, "name": name, "profile_image_url": photo,
            "xp": xp, "awards": 3, "branch": branch, "region": region, "is_me": me,
        ]
    }

    @Test("A board decodes: rows, the viewer's own standing, and the server's note")
    func boardDecodes() async throws {
        server.handler = { _ in
            .json([
                "scope": "GLOBAL", "window": "ALL", "branch_id": NSNull(), "classroom_id": NSNull(),
                "subject": NSNull(), "level": NSNull(), "count": 2,
                "scope_note": "All the XP earned across the whole learning center.",
                "rows": [
                    Self.row(1, 11, 500, name: "Aziz Karimov", photo: "https://cdn.example/a.jpg?sig=1"),
                    Self.row(2, 12, 450, name: "Madina", me: true, branch: NSNull(), region: NSNull()),
                ],
                "my": Self.row(2, 12, 450, name: "Madina", me: true, branch: NSNull(), region: NSNull()),
            ])
        }
        let board = try await api().board()
        #expect(board.count == 2)
        #expect(board.scopeNote == "All the XP earned across the whole learning center.")
        #expect(board.branchId == nil)
        #expect(board.rows.map(\.rank) == [1, 2])

        let first = board.rows[0]
        #expect(first.profileImage?.host == "cdn.example")
        #expect(first.place == "Chilonzor · Tashkent")
        #expect(first.initials == "AK")
        #expect(!first.isMe)

        let me = try #require(board.my)
        #expect(me.isMe)
        #expect(me.profileImageURL == nil)
        #expect(me.place == "No branch yet")
        #expect(board.myVisibleRow?.studentId == 12)
        #expect(!board.showsYourPosition)
    }

    @Test("No XP on this board: `my` is null")
    func myNull() async throws {
        server.handler = { _ in
            .json(["scope": "GROUP", "window": "ALL", "count": 0,
                   "scope_note": "You're not in a group yet, so there's nobody to rank you against.",
                   "rows": [], "my": NSNull()])
        }
        let board = try await api().board(LeaderboardQuery(scope: .group))
        #expect(board.my == nil)
        #expect(board.rows.isEmpty)
        #expect(board.standing == nil)
        #expect(board.goal == nil)
        #expect(!board.showsYourPosition)
        #expect(board.scopeNote == "You're not in a group yet, so there's nobody to rank you against.")
    }

    @Test("A row without its student is refused, not silently dropped")
    func strictRows() async throws {
        server.handler = { _ in
            .json(["rows": [["rank": 1, "name": "Nobody", "xp": 5]], "my": NSNull()])
        }
        await #expect(throws: APIError.self) { try await api().board() }
    }

    @Test("Ranks are the server's, as sent — shared ranks included")
    func ranksAsSent() async throws {
        // Once shared ranks land, two students on equal XP both read #1. The app shows that;
        // it never renumbers.
        server.handler = { _ in
            .json(["rows": [Self.row(1, 1, 90), Self.row(1, 2, 90), Self.row(3, 3, 40)], "my": NSNull(), "count": 3])
        }
        let board = try await api().board()
        #expect(board.rows.map(\.rank) == [1, 1, 3])
    }

    @Test("The request carries what the web sends, and a branch only on the global board")
    func queryItems() async throws {
        server.handler = { _ in .json(["rows": [], "my": NSNull()]) }
        _ = try await api().board(LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4))
        let url = try #require(server.requests.first?.url)
        // The trailing slash is load-bearing (Django), and `URL.path` drops it — assert the string.
        #expect(url.absoluteString.hasPrefix("https://mastersat.uz/api/rewards/leaderboard/?"))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(query == ["scope": "GLOBAL", "window": "MONTH", "subject": "MATH", "branch": "4"])

        // Inside "My Branch" the scope has already decided the branch.
        let mine = LeaderboardQuery(scope: .branch, branchId: 4)
        #expect(mine.queryItems.map(\.name) == ["scope", "window"])
        #expect(!mine.branchApplies)
    }

    @Test("The filters decode, with and without a branch of my own")
    func filtersDecode() async throws {
        server.handler = { _ in
            .json([
                "regions": [["id": 1, "name": "Tashkent", "code": "TAS"]],
                "branches": [["id": 4, "name": "Chilonzor", "code": "CHI", "region_id": 1]],
                "subjects": [["value": "ENGLISH", "label": "English"], ["value": "MATH", "label": "Math"]],
                "levels": [["value": "junior", "label": "Junior"]],
                "windows": [["value": "ALL", "label": "All time"], ["value": "MONTH", "label": "This month"]],
                "my_branch": ["id": 4, "name": "Chilonzor", "region": "Tashkent"],
            ])
        }
        let filters = try await api().filters()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/rewards/leaderboard/filters/")
        #expect(filters.branches.first?.regionId == 1)
        #expect(filters.subjects.map(\.value) == ["ENGLISH", "MATH"])
        #expect(filters.windows.count == 2)
        #expect(filters.myBranch?.name == "Chilonzor")
        #expect(filters.windowLabel("MONTH") == "This month")
        #expect(filters.subjectLabel("MATH") == "Math")
        #expect(filters.branchName(4) == "Chilonzor")
        #expect(filters.branchName(99) == "Branch")

        server.handler = { _ in
            .json(["regions": [], "branches": [], "subjects": [], "levels": [], "windows": [], "my_branch": NSNull()])
        }
        let bare = try await api().filters()
        // No branch behind "My Branch": the tab is hidden rather than shown over an empty board.
        #expect(bare.myBranch == nil)
    }
}

@Suite struct LeaderboardLayoutTests {

    private func row(_ rank: Int, _ id: Int, _ xp: Int, me: Bool = false) -> LeaderboardRow {
        LeaderboardRow(rank: rank, studentId: id, name: "S\(id)", xp: xp, isMe: me)
    }

    @Test("Three or more rows: the first three stand on the podium, the rest are standings")
    func podiumSplit() {
        let board = LeaderboardBoard(rows: (1...6).map { row($0, $0, 100 - $0) }, my: nil)
        #expect(board.podium.map(\.rank) == [1, 2, 3])
        #expect(board.standings.map(\.rank) == [4, 5, 6])

        let small = LeaderboardBoard(rows: [row(1, 1, 50), row(2, 2, 40)], my: nil)
        #expect(small.podium.isEmpty)
        #expect(small.standings.map(\.rank) == [1, 2])
    }

    @Test("The goal is measured against the row directly above, to pass and not to tie")
    func goalAgainstRowAbove() {
        let me = row(5, 5, 150, me: true)
        let board = LeaderboardBoard(rows: [row(1, 1, 400), row(2, 2, 300), row(3, 3, 250), row(4, 4, 200), me], my: me)
        let goal = board.goal
        #expect(goal == LeaderboardGoal(xp: 51, rank: 4))
        #expect(goal?.text == "51 XP to reach #4")
        #expect(board.podiumGoal == nil)
    }

    @Test("No goal at #1, and none when the row above shares the rank")
    func noGoal() {
        let top = row(1, 1, 400, me: true)
        #expect(LeaderboardBoard(rows: [top, row(2, 2, 300)], my: top).goal == nil)

        let tiedMe = row(2, 2, 300, me: true)
        let tied = LeaderboardBoard(rows: [row(1, 1, 400), row(2, 3, 300), tiedMe], my: tiedMe)
        #expect(tied.goal == nil)
    }

    @Test("Level on XP but ranked below: one XP passes them")
    func levelXP() {
        let me = row(2, 2, 300, me: true)
        let board = LeaderboardBoard(rows: [row(1, 1, 300), me], my: me)
        #expect(board.goal == LeaderboardGoal(xp: 1, rank: 1))
    }

    @Test("Below the visible rows: a goal only when the last row is the very next rank up")
    func goalBelowTheList() {
        let rows = [row(1, 1, 400), row(2, 2, 300), row(3, 3, 250)]
        let next = row(4, 9, 100, me: true)
        let reachable = LeaderboardBoard(rows: rows, my: next)
        #expect(reachable.showsYourPosition)
        #expect(reachable.goal == LeaderboardGoal(xp: 151, rank: 3))

        let far = row(40, 9, 10, me: true)
        #expect(LeaderboardBoard(rows: rows, my: far).goal == nil)
    }

    @Test("On the podium, the goal moves under the podium")
    func podiumGoal() {
        let me = row(2, 2, 300, me: true)
        let board = LeaderboardBoard(rows: [row(1, 1, 320), me, row(3, 3, 250), row(4, 4, 100)], my: me)
        #expect(board.podiumGoal == LeaderboardGoal(xp: 21, rank: 1))
    }

    @Test("The visible row beats `my` for the hero, so one screen never shows two ranks")
    func standingPrefersVisibleRow() {
        // On main `my` counts only students strictly ahead, so a tie reads #1 there while the
        // table — which breaks the tie — says #2.
        let visible = row(2, 2, 300, me: true)
        let my = row(1, 2, 300, me: true)
        let board = LeaderboardBoard(rows: [row(1, 1, 300), visible], my: my)
        #expect(board.standing?.rank == 2)

        let offList = LeaderboardBoard(rows: [row(1, 1, 300)], my: row(7, 2, 40, me: true))
        #expect(offList.standing?.rank == 7)
        #expect(offList.showsYourPosition)
    }

    @Test("An email is never shown as a name — only the part before the @")
    func namePrivacy() {
        #expect(LeaderboardName.display("aziz.karimov@gmail.com") == "aziz.karimov")
        #expect(LeaderboardName.display("  AZIZ@Mail.UZ ") == "AZIZ")
        #expect(LeaderboardName.display("@gmail.com") == "Student")
        #expect(LeaderboardName.display("Aziz Karimov") == "Aziz Karimov")
        #expect(LeaderboardName.display("madina_2009") == "madina_2009")
        #expect(LeaderboardName.display("Ali @ Home") == "Ali @ Home")
        #expect(LeaderboardName.display("") == "Student")

        let row = LeaderboardRow(rank: 1, studentId: 1, name: "karim.aliyev@mail.ru", xp: 10)
        #expect(row.displayName == "karim.aliyev")
        #expect(row.initials == "K")
    }

    @Test("Initials follow the web's Avatar: first letters of two words, or a question mark")
    func initials() {
        #expect(LeaderboardName.initials("Aziz Karimov Olimovich") == "AK")
        #expect(LeaderboardName.initials("madina") == "M")
        #expect(LeaderboardName.initials("   ") == "?")
    }

    @Test("Filters: the count on the button, the folded summary, and reset")
    func filterSummary() {
        var query = LeaderboardQuery()
        #expect(query.activeFilterCount == 0)
        #expect(query.summary(using: nil) == [
            LeaderboardSummaryPart(label: "All time", isActive: false),
            LeaderboardSummaryPart(label: "All subjects", isActive: false),
        ])

        query.window = LeaderboardQuery.thisMonth
        query.subject = "MATH"
        query.branchId = 4
        #expect(query.activeFilterCount == 3)
        let filters = LeaderboardFilters(
            branches: [LeaderboardFilters.Branch(id: 4, name: "Chilonzor")],
            subjects: [LeaderboardFilters.Option(value: "MATH", label: "Math")],
            windows: [LeaderboardFilters.Option(value: "MONTH", label: "This month")]
        )
        #expect(query.summary(using: filters).map(\.label) == ["This month", "Math", "Chilonzor"])
        // Before the chips arrive, the raw values stand in.
        #expect(query.summary(using: nil).map(\.label) == ["This month", "MATH", "Branch"])

        // The branch is kept on another tab, but it is not filtering that board.
        query.scope = .group
        #expect(query.activeFilterCount == 2)
        #expect(query.summary(using: filters).count == 2)

        query.resetFilters()
        #expect(query == LeaderboardQuery(scope: .group))
    }
}

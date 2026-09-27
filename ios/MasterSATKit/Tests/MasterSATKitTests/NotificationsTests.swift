import Foundation
import Testing
@testable import MasterSATKit

// MARK: - The API and its shapes

@Suite struct NotificationsAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> NotificationsAPI {
        NotificationsAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    private func body(_ request: URLRequest?) -> [String: Any] {
        guard let data = request?.httpBody,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    /// A real `/api/notifications/` answer, shaped by `NotificationListView`.
    private static func inboxBody() -> [String: Any] { [
        "notifications": [
            [
                "id": 41, "category": "GRADES", "category_label": "Grades", "event": "HOMEWORK_GRADED",
                "title": "Your homework was marked", "body": "Reading set · 18/20",
                "link_url": "/classes/12", "is_read": false, "read_at": NSNull(),
                "created_at": "2026-09-25T08:12:44.123456Z",
            ],
            [
                "id": 40, "category": "HOMEWORK", "category_label": "Homework", "event": "HOMEWORK_ASSIGNED",
                "title": "New homework", "body": "", "link_url": "/classes/12/assignments/34",
                "is_read": true, "read_at": "2026-09-25T07:00:00Z", "created_at": "2026-09-24T19:00:00Z",
            ],
        ],
        "unread_total": 3,
        "unread_by_category": ["GRADES": 1, "EVENTS": 2],
        "categories": [
            ["value": "GRADES", "label": "Grades"],
            ["value": "HOMEWORK", "label": "Homework"],
            ["value": "CLASSROOM", "label": "Classroom"],
            ["value": "EXAMS", "label": "Exams"],
            ["value": "SUPPORT", "label": "Support"],
            ["value": "REWARDS", "label": "Rewards & Shop"],
            ["value": "EVENTS", "label": "Events"],
            ["value": "SYSTEM", "label": "System"],
        ],
    ] }

    @Test("The inbox decodes: rows, counts across every section, and the served sections in order")
    func inboxDecodes() async throws {
        server.handler = { _ in .json(Self.inboxBody()) }
        let inbox = try await api().list()

        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/notifications/")
        #expect(server.requests.first?.url?.query == nil)
        #expect(inbox.notifications.map(\.id) == [41, 40])
        #expect(inbox.unreadTotal == 3)
        #expect(inbox.unreadByCategory == ["GRADES": 1, "EVENTS": 2])
        #expect(inbox.unread(in: "grades") == 1)
        #expect(inbox.unread(in: "HOMEWORK") == 0)
        #expect(inbox.unread(in: nil) == 3)
        #expect(inbox.categories.map(\.value) == ["GRADES", "HOMEWORK", "CLASSROOM", "EXAMS", "SUPPORT", "REWARDS", "EVENTS", "SYSTEM"])
        #expect(inbox.categories.first { $0.value == "REWARDS" }?.label == "Rewards & Shop")

        let first = inbox.notifications[0]
        #expect(first.categoryLabel == "Grades")
        #expect(first.event == "HOMEWORK_GRADED")
        #expect(first.isRead == false)
        #expect(first.readAt == nil)
        #expect(first.createdDate != nil)
        #expect(first.link == .classroom(id: 12))
        #expect(inbox.notifications[1].link == .homework(classroomId: 12, assignmentId: 34))
        #expect(inbox.notifications[1].isRead)
        #expect(inbox.summary == NotificationSummary(total: 3, byCategory: ["GRADES": 1, "EVENTS": 2]))
    }

    @Test("A section filter and the unread filter reach the query string")
    func filtersReachTheQuery() async throws {
        server.handler = { _ in .json(Self.inboxBody()) }
        _ = try await api().list(category: "grades", unreadOnly: true)
        let items = URLComponents(url: try #require(server.requests.first?.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(items.contains(URLQueryItem(name: "category", value: "GRADES")))
        #expect(items.contains(URLQueryItem(name: "unread", value: "1")))
    }

    @Test("One malformed row costs that row, not the inbox")
    func malformedRowIsDropped() async throws {
        server.handler = { _ in
            .json([
                "notifications": [
                    ["id": "not-a-number", "title": "Broken"],
                    ["title": "No id at all"],
                    42,
                    ["id": 7, "title": "Fine", "created_at": "2026-09-25T08:00:00Z"],
                ],
                "unread_total": 1,
                "unread_by_category": ["SYSTEM": 1],
                "categories": [["label": "No value"], ["value": "system", "label": "System"]],
            ])
        }
        let inbox = try await api().list()
        #expect(inbox.notifications.map(\.id) == [7])
        // A section with no value cannot be filtered or muted, so it is dropped; the other is
        // upper-cased to the server's spelling.
        #expect(inbox.categories.map(\.value) == ["SYSTEM"])
        // Missing fields read as the server's own defaults, not as a crash.
        let row = inbox.notifications[0]
        #expect(row.category == "SYSTEM")
        #expect(row.categoryLabel == "System")
        #expect(row.body.isEmpty)
        #expect(row.link == nil)
        #expect(row.isRead == false)
    }

    @Test("A read row with no is_read is still read — it is derived from read_at")
    func isReadDerivesFromReadAt() async throws {
        server.handler = { _ in
            .json([
                "notifications": [["id": 1, "title": "Seen", "read_at": "2026-09-25T08:00:00Z", "created_at": "2026-09-25T07:00:00Z"]],
                "unread_total": 0, "unread_by_category": [:], "categories": [],
            ])
        }
        let inbox = try await api().list()
        #expect(inbox.notifications.first?.isRead == true)
    }

    @Test("An answer with no list at all is an error, never an empty inbox")
    func missingListIsAnError() async throws {
        // "You're all caught up" drawn over a payload that was not an inbox would be a lie.
        server.handler = { _ in .json(["detail": "Something else entirely"]) }
        await #expect(throws: APIError.self) {
            _ = try await api().list()
        }
    }

    @Test("The summary is the bell's number; without a total it is not a summary")
    func summaryDecodes() async throws {
        server.handler = { _ in .json(["total": 12, "by_category": ["HOMEWORK": 10, "grades": 2, "EVENTS": 0]]) }
        let summary = try await api().summary()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/notifications/summary/")
        #expect(summary.total == 12)
        // Keys normalised; zero counts dropped, as the server itself never sends them.
        #expect(summary.byCategory == ["HOMEWORK": 10, "GRADES": 2])

        server.handler = { _ in .json(["by_category": [:]]) }
        await #expect(throws: APIError.self) {
            _ = try await api().summary()
        }
    }

    @Test("Marking rows read sends their ids, deduplicated, and reads the new counts back")
    func markRowsRead() async throws {
        server.handler = { _ in .json(["marked": 2, "total": 1, "by_category": ["EVENTS": 1]]) }
        let result = try #require(try await api().markRead(ids: [5, 3, 5]))

        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/notifications/read/")
        #expect(body(request)["ids"] as? [Int] == [3, 5])
        #expect(body(request)["category"] == nil)
        #expect(result.marked == 2)
        #expect(result.summary == NotificationSummary(total: 1, byCategory: ["EVENTS": 1]))
    }

    @Test("An empty id list sends nothing — the server would read it as 'mark everything'")
    func emptyIdsSendNothing() async throws {
        server.handler = { _ in .json(["marked": 99, "total": 0, "by_category": [:]]) }
        let result = try await api().markRead(ids: [])
        #expect(result == nil)
        #expect(server.requests.isEmpty)
    }

    @Test("A section is marked read by its code; everything is marked read with an empty body")
    func markSectionAndAll() async throws {
        server.handler = { _ in .json(["marked": 4, "total": 0, "by_category": [:]]) }
        _ = try await api().markRead(category: "homework")
        #expect(body(server.requests.last) as NSDictionary == ["category": "HOMEWORK"] as NSDictionary)

        _ = try await api().markAllRead()
        let all = try #require(server.requests.last)
        #expect(all.httpMethod == "POST")
        #expect(body(all).isEmpty)
        #expect(String(decoding: all.httpBody ?? Data(), as: UTF8.self) == "{}")
    }

    @Test("An unknown section is refused with the server's sentence")
    func unknownCategoryIsRefused() async throws {
        server.handler = { _ in .json(["detail": "Unknown category."], status: 400) }
        do {
            _ = try await api().markRead(category: "NOPE")
            Issue.record("expected a refusal")
        } catch let error as APIError {
            guard case .http(let status, let detail) = error else {
                Issue.record("unexpected error \(error)")
                return
            }
            #expect(status == 400)
            #expect(detail == "Unknown category.")
        }
    }

    @Test("Preferences decode: muted sections are the exceptions, push defaults on")
    func preferencesDecode() async throws {
        server.handler = { _ in
            .json([
                "muted_categories": ["rewards", 7, "SYSTEM"],
                "categories": [["value": "GRADES", "label": "Grades"], ["value": "REWARDS", "label": "Rewards & Shop"]],
            ])
        }
        let prefs = try await api().preferences()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/notifications/preferences/")
        #expect(prefs.mutedCategories == ["REWARDS", "SYSTEM"])
        #expect(prefs.pushEnabled == true)
        #expect(prefs.isOn("GRADES"))
        #expect(!prefs.isOn("rewards"))
        #expect(prefs.categories.count == 2)
    }

    @Test("Saving a preference PATCHes only the key that changed")
    func preferencePatchIsMinimal() async throws {
        server.handler = { _ in .json(["muted_categories": [], "push_enabled": false, "categories": []]) }
        let saved = try await api().updatePreferences(NotificationPreferencesPatch(pushEnabled: false))
        let first = try #require(server.requests.first)
        #expect(first.httpMethod == "PATCH")
        #expect(body(first) as NSDictionary == ["push_enabled": false] as NSDictionary)
        #expect(saved.pushEnabled == false)

        _ = try await api().updatePreferences(NotificationPreferencesPatch(mutedCategories: ["GRADES"]))
        #expect(body(server.requests.last) as NSDictionary == ["muted_categories": ["GRADES"]] as NSDictionary)
    }

    @Test("A switch turned on unmutes its section; turned off mutes it once")
    func mutedListFollowsTheSwitch() {
        let prefs = NotificationPreferences(mutedCategories: ["REWARDS", "SYSTEM"], pushEnabled: true, categories: [])
        #expect(prefs.mutedList(setting: "rewards", on: true) == ["SYSTEM"])
        #expect(prefs.mutedList(setting: "GRADES", on: false) == ["REWARDS", "SYSTEM", "GRADES"])
        // Already muted: switching it off again does not add a duplicate.
        #expect(prefs.mutedList(setting: "SYSTEM", on: false) == ["REWARDS", "SYSTEM"])
        // Already on: switching it on again changes nothing.
        #expect(prefs.mutedList(setting: "GRADES", on: true) == ["REWARDS", "SYSTEM"])
    }

    @Test("Push config reads both transports; an older server has no APNs")
    func pushConfigDecodes() async throws {
        server.handler = { _ in .json(["enabled": true, "public_key": "BPk", "apns_enabled": true]) }
        let config = try await api().pushConfig()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/notifications/push/config/")
        #expect(config == PushConfig(webPushEnabled: true, publicKey: "BPk", apnsEnabled: true))

        server.handler = { _ in .json(["enabled": false, "public_key": ""]) }
        let older = try await api().pushConfig()
        #expect(older.apnsEnabled == false)
        #expect(older.webPushEnabled == false)
    }

    @Test("Registering sends the token in lower-case hex with the build's host and version")
    func registerAPNs() async throws {
        server.handler = { _ in .json(["detail": "Registered.", "id": 17], status: 201) }
        let id = try await api().registerAPNs(
            token: "ABCDEF0123456789ABCDEF0123456789",
            environment: .sandbox,
            bundleId: "uz.mastersat.app",
            appVersion: "1.2.0"
        )
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/notifications/push/apns/register/")
        #expect(body(request) as NSDictionary == [
            "token": "abcdef0123456789abcdef0123456789",
            "environment": "sandbox",
            "bundle_id": "uz.mastersat.app",
            "app_version": "1.2.0",
        ] as NSDictionary)
        #expect(id == 17)
    }

    @Test("Unregistering sends the token and reports how many rows went")
    func unregisterAPNs() async throws {
        server.handler = { _ in .json(["deleted": 1]) }
        let deleted = try await api().unregisterAPNs(token: "ABCDEF0123456789ABCDEF0123456789")
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/notifications/push/apns/unregister/")
        #expect(body(request) as NSDictionary == ["token": "abcdef0123456789abcdef0123456789"] as NSDictionary)
        #expect(deleted == 1)
    }

    @Test("Optimistic read keeps the first read time and flips the dot")
    func markedReadCopy() {
        let row = AppNotification(id: 1, category: "grades", categoryLabel: "Grades", event: "HOMEWORK_GRADED",
                                  title: "Marked", createdAt: "2026-09-25T08:00:00Z")
        let read = row.markedRead(at: "2026-09-25T09:00:00Z")
        #expect(row.isRead == false)
        #expect(read.isRead)
        #expect(read.readAt == "2026-09-25T09:00:00Z")
        #expect(read.category == "GRADES")
        #expect(read.markedRead(at: "later").readAt == "2026-09-25T09:00:00Z")
    }
}

// MARK: - Deep links

@Suite struct AppLinkTests {

    @Test("Every link_url the server writes lands on a destination", arguments: [
        ("/classes/12", AppLink.classroom(id: 12)),                                      // HOMEWORK_GRADED, CLASS_ANNOUNCEMENT, COMMENT_REPLY, TELEGRAM_GROUP, HOMEWORK_DUE_SOON
        ("/classes/12/assignments/34", .homework(classroomId: 12, assignmentId: 34)),   // HOMEWORK_ASSIGNED
        ("/midterm", .midterms),                                                          // MIDTERM_SCHEDULED
        ("/midterm/result/7", .midtermResult(attemptId: 7)),                              // MIDTERM_RESULT
        ("/review/9", .examReview(attemptId: 9)),                                         // MIDTERM_RESULT, old style
        ("/certificate/ABC123", .certificate(code: "ABC123")),                            // CERTIFICATE_READY
        ("/support", .support),                                                           // SUPPORT_BOOKED
        ("/events", .events),                                                             // EVENT_*
        ("/rewards", .points),                                                            // REWARD_EARNED
        ("/shop", .shop),                                                                 // SHOP_ORDER_READY, STRIKE_LOST
        ("/", .home),                                                                     // HOMEWORK_GRADED with no class
    ])
    func serverLinks(path: String, expected: AppLink) {
        #expect(AppLink.parse(path) == expected)
    }

    @Test("The rest of the student site", arguments: [
        ("/classes", AppLink.classes),
        ("/services", .services),
        ("/leaderboard", .leaderboard),
        ("/surveys", .surveys),
        ("/surveys/5", .survey(id: 5)),
        ("/roadmap", .roadmap),
        ("/roadmap/31", .roadmapDelivery(id: 31)),
        ("/progress", .progress),
        ("/analytics", .progress),
        ("/live", .liveQuiz(sessionId: nil)),
        ("/live/88", .liveQuiz(sessionId: 88)),
        ("/vocabulary", .vocabulary),
        ("/vocabulary/new-set", .vocabulary),
        ("/vocabulary/sets/14", .vocabularySet(id: 14)),
        ("/vocabulary/sets/14/flashcards", .vocabularySet(id: 14)),
        ("/vocabulary/sections/3", .vocabularySection(id: 3)),
        ("/assessments", .assessments),
        ("/assessments/result/12", .assessments),
        ("/profile", .profile),
        ("/complete-profile", .profile),
    ])
    func sitePaths(path: String, expected: AppLink) {
        #expect(AppLink.parse(path) == expected)
    }

    @Test("Query strings, fragments, trailing and doubled slashes are tolerated", arguments: [
        ("/classes/12/", AppLink.classroom(id: 12)),
        ("/classes/12?tab=materials", .classroom(id: 12)),
        ("/classes/12/assignments/34/#top", .homework(classroomId: 12, assignmentId: 34)),
        ("/surveys/5/?from=push#q2", .survey(id: 5)),
        ("/classes//12", .classroom(id: 12)),
        ("  /events \n", .events),
        ("classes/12", .classroom(id: 12)),
        ("/Classes/12/Assignments/34", .homework(classroomId: 12, assignmentId: 34)),
        ("/MIDTERM/RESULT/7", .midtermResult(attemptId: 7)),
        ("?from=push", .home),
        ("/?x=1", .home),
    ])
    func tolerated(path: String, expected: AppLink) {
        #expect(AppLink.parse(path) == expected)
    }

    @Test("The site's absolute URLs and the app's own scheme read like paths", arguments: [
        ("https://mastersat.uz/classes/12/assignments/34", AppLink.homework(classroomId: 12, assignmentId: 34)),
        ("https://www.mastersat.uz/midterm/result/7?x=1", .midtermResult(attemptId: 7)),
        ("HTTPS://MasterSAT.uz/events", .events),
        ("http://mastersat.uz/shop/", .shop),
        ("https://mastersat.uz", .home),
        ("https://mastersat.uz/", .home),
        ("//mastersat.uz/rewards", .points),
        ("mastersat://classes/12", .classroom(id: 12)),
        ("mastersat:///classes/12/assignments/34", .homework(classroomId: 12, assignmentId: 34)),
        ("mastersat://midterm/result/7", .midtermResult(attemptId: 7)),
        ("mastersat://certificate/AbC-9", .certificate(code: "AbC-9")),
        ("mastersat://", .home),
        ("MASTERSAT://events", .events),
    ])
    func absoluteForms(text: String, expected: AppLink) {
        #expect(AppLink.parse(text) == expected)
    }

    @Test("Ids that are not ids fall back to the section, never to a guess", arguments: [
        ("/classes/abc", AppLink.classes),
        ("/classes/-3", .classes),
        ("/classes/0", .classes),
        ("/classes/99999999999999999999999", .classes),
        ("/classes/12/assignments/new", .classroom(id: 12)),
        ("/classes/12/assignments/34/edit", .homework(classroomId: 12, assignmentId: 34)),
        ("/classes/12/people", .classroom(id: 12)),
        ("/midterm/result/x", .midterms),
        ("/surveys/latest", .surveys),
        ("/live/code-abc", .liveQuiz(sessionId: nil)),
    ])
    func badIds(path: String, expected: AppLink) {
        #expect(AppLink.parse(path) == expected)
    }

    @Test("Junk, other hosts and other schemes are unknown — and say what they were", arguments: [
        ("/pastpapers", AppLink.unknown("/pastpapers")),
        ("/mock-exam/result/4", .unknown("/mock-exam/result/4")),
        ("/review", .unknown("/review")),
        ("/certificate/", .unknown("/certificate/")),
        ("garbage", .unknown("/garbage")),
        ("javascript:alert(1)", .unknown("javascript:alert(1)")),
        ("https://evil.example/classes/12", .unknown("https://evil.example/classes/12")),
        ("https://teacher.mastersat.uz/classes/12", .unknown("https://teacher.mastersat.uz/classes/12")),
        ("//evil.example/classes/12", .unknown("//evil.example/classes/12")),
        ("mailto:someone@example.com", .unknown("mailto:someone@example.com")),
    ])
    func unknowns(text: String, expected: AppLink) {
        #expect(AppLink.parse(text) == expected)
    }

    @Test("An empty link opens the app")
    func emptyIsHome() {
        #expect(AppLink.parse("") == .home)
        #expect(AppLink.parse("   \n") == .home)
        #expect(AppLink(linkURL: "") == .home)
    }

    @Test("A certificate code keeps its case and loses its percent-encoding")
    func certificateCode() {
        #expect(AppLink.parse("/certificate/MsT-2026-AbC") == .certificate(code: "MsT-2026-AbC"))
        #expect(AppLink.parse("/certificate/AB%20C") == .certificate(code: "AB C"))
    }

    @Test("Every destination's path reads back as itself")
    func roundTrip() {
        let all: [AppLink] = [
            .home, .classes, .classroom(id: 3), .homework(classroomId: 3, assignmentId: 4),
            .midterms, .midtermResult(attemptId: 5), .examReview(attemptId: 6),
            .certificate(code: "AB C/1?"), .support, .services, .events, .points, .shop,
            .leaderboard, .surveys, .survey(id: 7), .roadmap, .roadmapDelivery(id: 8),
            .progress, .liveQuiz(sessionId: nil), .liveQuiz(sessionId: 9), .vocabulary,
            .vocabularySection(id: 10), .vocabularySet(id: 11), .assessments, .profile,
        ]
        for link in all {
            #expect(AppLink.parse(link.path) == link, "\(link) → \(link.path)")
            #expect(AppLink.parse("mastersat://" + link.path.dropFirst()) == link, "scheme form of \(link)")
        }
    }

    @Test("A place the app cannot show opens on the site; a foreign one never does")
    func webURL() {
        let base = URL(string: "https://mastersat.uz")!
        #expect(AppLink.parse("/pastpapers").webURL(base: base)?.absoluteString == "https://mastersat.uz/pastpapers")
        #expect(AppLink.homework(classroomId: 1, assignmentId: 2).webURL(base: base)?.absoluteString
                == "https://mastersat.uz/classes/1/assignments/2")
        #expect(AppLink.parse("https://evil.example/x").webURL(base: base) == nil)
        #expect(AppLink.parse("javascript:alert(1)").webURL(base: base) == nil)
    }

    @Test("A URL handed to the app parses the same as its text")
    func parseURL() throws {
        let url = try #require(URL(string: "mastersat://classes/12/assignments/34"))
        #expect(AppLink.parse(url) == .homework(classroomId: 12, assignmentId: 34))
    }
}

// MARK: - Words and numbers

@Suite struct NotificationFormattingTests {

    let now = Date(timeIntervalSince1970: 1_790_000_000)  // 2026-09-21T14:13:20Z
    let utc = TimeZone(identifier: "UTC")!
    let english = Locale(identifier: "en_US")

    private func iso(minutesAgo: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: now.addingTimeInterval(-minutesAgo * 60))
    }

    private func ago(_ minutes: Double) -> String {
        NotificationTime.ago(iso(minutesAgo: minutes), now: now, locale: english, timeZone: utc)
    }

    @Test("Minutes and hours round the way the web rounds them")
    func relativeTime() {
        #expect(ago(0.3) == "just now")
        #expect(ago(0.6) == "1m ago")          // Math.round(0.6) = 1
        #expect(ago(1.5) == "2m ago")
        #expect(ago(59.4) == "59m ago")
        #expect(ago(59.6) == "1h ago")          // rounds to 60 minutes → an hour
        #expect(ago(89) == "1h ago")
        #expect(ago(90) == "2h ago")
        #expect(ago(23 * 60 + 29) == "23h ago")
        #expect(ago(23 * 60 + 31) != "24h ago") // 23.5h rounds to 24 → a date, never "24h ago"
    }

    @Test("A day or more reads as a short date")
    func olderIsADate() {
        #expect(ago(3 * 24 * 60) == "Sep 18")
        #expect(ago(24 * 60) == "Sep 20")
    }

    @Test("A clock running behind the server, or a bad timestamp, never reads as a time")
    func oddInputs() {
        #expect(ago(-30) == "just now")
        #expect(NotificationTime.ago("not a date", now: now) == "")
        #expect(NotificationTime.ago("2026-09-21T14:03:20Z", now: now, locale: english, timeZone: utc) == "10m ago")
    }

    @Test("The badge: nothing at zero, the number to nine, then 9+")
    func badgeText() {
        #expect(NotificationBadge.text(for: 0) == nil)
        #expect(NotificationBadge.text(for: -2) == nil)
        #expect(NotificationBadge.text(for: 1) == "1")
        #expect(NotificationBadge.text(for: 9) == "9")
        #expect(NotificationBadge.text(for: 10) == "9+")
        #expect(NotificationBadge.text(for: 250) == "9+")
        #expect(NotificationBadge.accessibilityLabel(for: 0) == "Notifications")
        #expect(NotificationBadge.accessibilityLabel(for: 12) == "Notifications, 12 unread")
    }
}

// MARK: - Push registration rules

@Suite struct PushRegistrationTests {

    let now = Date(timeIntervalSince1970: 1_790_000_000)

    @Test("A token is lower-case hex, two digits a byte — what the server's pattern accepts")
    func tokenHex() throws {
        #expect(DeviceToken.hex(Data([0x00, 0x0f, 0xab, 0xff])) == "000fabff")
        let token = DeviceToken.hex(Data((0..<32).map { UInt8($0 * 7 % 256) }))
        #expect(token.count == 64)
        let pattern = try Regex("^[0-9a-f]{32,200}$")
        #expect(token.wholeMatch(of: pattern) != nil)
        #expect(DeviceToken.hex(Data()) == "")
    }

    private func record(token: String = "aa", user: Int = 1, env: APNsEnvironment = .sandbox, sentAt: Date? = nil) -> PushRegistrationRecord {
        PushRegistrationRecord(token: token, userId: user, environment: env, sentAt: sentAt ?? now)
    }

    @Test("Sent once, not again — until the token, the student or the host changes")
    func needsUpload() {
        #expect(PushRegistrationPlan.needsUpload(token: "aa", userId: 1, environment: .sandbox, lastSent: nil, now: now))
        #expect(!PushRegistrationPlan.needsUpload(token: "aa", userId: 1, environment: .sandbox, lastSent: record(), now: now))
        #expect(!PushRegistrationPlan.needsUpload(token: "AA", userId: 1, environment: .sandbox, lastSent: record(), now: now))
        #expect(PushRegistrationPlan.needsUpload(token: "bb", userId: 1, environment: .sandbox, lastSent: record(), now: now))
        #expect(PushRegistrationPlan.needsUpload(token: "aa", userId: 2, environment: .sandbox, lastSent: record(), now: now))
        #expect(PushRegistrationPlan.needsUpload(token: "aa", userId: 1, environment: .production, lastSent: record(), now: now))
    }

    @Test("An unchanged registration is refreshed weekly, and after the clock moves back")
    func weeklyRefresh() {
        let sixDays = record(sentAt: now.addingTimeInterval(-6 * 24 * 3600))
        let sevenDays = record(sentAt: now.addingTimeInterval(-7 * 24 * 3600))
        let future = record(sentAt: now.addingTimeInterval(3600))
        #expect(!PushRegistrationPlan.needsUpload(token: "aa", userId: 1, environment: .sandbox, lastSent: sixDays, now: now))
        #expect(PushRegistrationPlan.needsUpload(token: "aa", userId: 1, environment: .sandbox, lastSent: sevenDays, now: now))
        #expect(PushRegistrationPlan.needsUpload(token: "aa", userId: 1, environment: .sandbox, lastSent: future, now: now))
    }

    @Test("The record survives a round trip through storage")
    func recordCodable() throws {
        let original = record(token: "ABCD", user: 9, env: .production)
        let data = try JSONEncoder().encode(original)
        let back = try JSONDecoder().decode(PushRegistrationRecord.self, from: data)
        #expect(back == original)
        #expect(back.token == "abcd")
    }

    /// A stand-in for `embedded.mobileprovision`: a plist inside binary CMS framing.
    private func profile(apsEnvironment: String?) -> Data {
        var entitlements = "<key>application-identifier</key><string>TEAM.uz.mastersat.app</string>"
        if let apsEnvironment {
            entitlements += "<key>aps-environment</key><string>\(apsEnvironment)</string>"
        }
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
        <key>Name</key><string>iOS Team Provisioning Profile</string>
        <key>Entitlements</key><dict>\(entitlements)</dict>
        </dict></plist>
        """
        var data = Data([0x30, 0x82, 0x3a, 0x1f, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02, 0xa0])
        data.append(Data(plist.utf8))
        data.append(Data([0xa0, 0x82, 0x0c, 0x3c, 0x30, 0x82, 0x04, 0x00, 0x00, 0xff]))
        return data
    }

    @Test("The signed profile decides the APNs host")
    func profileEnvironment() {
        #expect(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: "development")) == .sandbox)
        #expect(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: "production")) == .production)
        #expect(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: nil)) == nil)
        #expect(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: "something-new")) == nil)
        #expect(ProvisioningProfile.apnsEnvironment(fromProfile: Data([0x30, 0x82, 0x00, 0x01])) == nil)
        #expect(ProvisioningProfile.apnsEnvironment(fromProfile: Data("<?xml version=\"1.0\"?><plist>".utf8)) == nil)
    }

    @Test("Simulator is sandbox; no profile is the App Store; a profile says what it grants")
    func resolvedEnvironment() {
        let dev = profile(apsEnvironment: "development")
        let prod = profile(apsEnvironment: "production")
        #expect(ProvisioningProfile.apnsEnvironment(profileData: prod, isSimulator: true) == .sandbox)
        #expect(ProvisioningProfile.apnsEnvironment(profileData: nil, isSimulator: false) == .production)
        #expect(ProvisioningProfile.apnsEnvironment(profileData: dev, isSimulator: false) == .sandbox)
        #expect(ProvisioningProfile.apnsEnvironment(profileData: prod, isSimulator: false) == .production)
        #expect(ProvisioningProfile.apnsEnvironment(profileData: profile(apsEnvironment: nil), isSimulator: false) == .production)
    }
}

// MARK: - Local reminders lead somewhere too

@Suite struct ReminderLinkTests {

    let now = Date(timeIntervalSince1970: 1_785_000_000)

    private func iso(_ offset: TimeInterval) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: now.addingTimeInterval(offset))
    }

    private func decode<T: Decodable>(_ object: [String: Any], as type: T.Type) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: try JSONSerialization.data(withJSONObject: object))
    }

    @Test("A homework reminder opens the homework, like HOMEWORK_ASSIGNED does")
    func homeworkLink() throws {
        let withClass = try decode(["id": 34, "title": "Set", "classroom_id": 12, "due_at": iso(5 * 24 * 3600)], as: AssignmentListing.self)
        let withoutClass = try decode(["id": 35, "title": "Set", "due_at": iso(5 * 24 * 3600)], as: AssignmentListing.self)
        let plan = ReminderPlan.build(assignments: [withClass, withoutClass], midterms: [], now: now)
        let byAssignment = Dictionary(grouping: plan, by: { $0.id.split(separator: "-")[1] })
        #expect(byAssignment["34"]?.allSatisfy { $0.link == "/classes/12/assignments/34" } == true)
        #expect(byAssignment["35"]?.allSatisfy { $0.link == "/classes" } == true)
        #expect(plan.allSatisfy { AppLink.parse($0.link) != .home })
    }

    @Test("A midterm reminder opens the midterms; a published score opens its result")
    func midtermLinks() throws {
        let upcoming = try decode(["midterm_id": 3, "title": "Midterm", "subject": "MATH", "submitted": false,
                                   "results_visible": false, "available_at": iso(3 * 24 * 3600)], as: MidtermListing.self)
        let plan = ReminderPlan.build(assignments: [], midterms: [upcoming], now: now)
        #expect(!plan.isEmpty)
        #expect(plan.allSatisfy { AppLink.parse($0.link) == .midterms })

        let scored = try decode(["midterm_id": 4, "title": "Midterm", "subject": "MATH", "submitted": true,
                                 "results_visible": true, "score": 610, "attempt_id": 91], as: MidtermListing.self)
        let fresh = ReminderPlan.newlyPublished(midterms: [scored], announced: [])
        #expect(fresh.map { AppLink.parse($0.link) } == [.midtermResult(attemptId: 91)])
    }

    @Test("A reminder built without a link still means 'open the app'")
    func defaultLink() {
        let reminder = StudentReminder(id: "x", kind: .homework, title: "t", body: "b", fireAt: now)
        #expect(reminder.link.isEmpty)
        #expect(AppLink.parse(reminder.link) == .home)
    }
}

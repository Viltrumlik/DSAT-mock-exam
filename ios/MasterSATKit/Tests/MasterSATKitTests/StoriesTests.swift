import Foundation
import Testing
@testable import MasterSATKit

@Suite struct StoriesAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> StoriesAPI {
        StoriesAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("The rail decodes in the server's order, a story with no picture included")
    func railDecodes() async throws {
        server.handler = { _ in
            .json(["stories": [
                ["id": 9, "title": "Mock on Friday", "caption": "Room 3, 10:00",
                 "image_url": "https://r2.example/s9.png?sig=x", "link_url": "https://mastersat.uz/events",
                 "is_active": true, "sort_order": -1, "starts_at": NSNull(), "ends_at": NSNull(),
                 "is_live": true, "created_at": "2026-09-20T09:00:00.1+05:00"],
                ["id": 4, "title": "Welcome", "caption": "", "image_url": NSNull(), "link_url": "",
                 "is_active": true, "sort_order": 0, "starts_at": NSNull(), "ends_at": NSNull(),
                 "is_live": true, "created_at": "2026-09-01T09:00:00+05:00"],
                ["title": "no id"],
            ]])
        }
        let stories = try await api().rail()
        #expect(stories.map(\.id) == [9, 4])
        #expect(stories[0].openableLink?.absoluteString == "https://mastersat.uz/events")
        #expect(stories[1].imageURL == nil)
        #expect(stories[1].openableLink == nil)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/stories/")
    }

    @Test("An empty rail is an empty list, not an error")
    func emptyRail() async throws {
        server.handler = { _ in .json(["stories": []]) }
        #expect(try await api().rail().isEmpty)
    }

    @Test("A payload with no readable stories is a failure, not an empty rail")
    func unreadablePayloadThrows() async {
        server.handler = { _ in .json(["results": []]) }
        await #expect(throws: (any Error).self) { try await api().rail() }
        server.handler = { _ in .json(["stories": "soon"]) }
        await #expect(throws: (any Error).self) { try await api().rail() }
    }

    @Test("A link the app has a screen for is routed; everything else is not")
    func routedLinks() {
        func link(_ raw: String) -> AppLink? { Story(id: 1, title: "t", linkURL: raw).routedLink }
        #expect(link("/events") == .events)
        #expect(link("https://mastersat.uz/events") == .events)
        #expect(link("https://www.mastersat.uz/classes/12?from=story") == .classroom(id: 12))
        #expect(link("  /vocabulary/sets/8  ") == .vocabularySet(id: 8))
        // Somewhere on the site the app has no screen for: the browser's job, not the router's.
        #expect(link("/blog/2026/mock-day") == nil)
        #expect(link("https://example.com/a") == nil)
        #expect(link("mailto:office@mastersat.uz") == nil)
        #expect(link("") == nil)
        #expect(link("   ") == nil)
    }

    @Test("Only a web page can be opened in the browser — a story is not a launcher")
    func openableLinks() {
        func link(_ raw: String) -> URL? { Story(id: 1, title: "t", linkURL: raw).openableLink }
        #expect(link("https://example.com/a?b=1") != nil)
        #expect(link("http://example.com") != nil)
        #expect(link("  https://example.com  ")?.host == "example.com")
        #expect(link("") == nil)
        #expect(link("javascript:alert(1)") == nil)
        #expect(link("mailto:office@mastersat.uz") == nil)
        #expect(link("ftp://example.com/file") == nil)
        #expect(link("https://") == nil)
        #expect(link("example.com") == nil)
    }
}

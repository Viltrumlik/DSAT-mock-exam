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
        // The claim is narrower than "it throws": the client turns every decode failure into
        // `APIError.decoding`, which is what the rail reads as "we could not understand the
        // answer" rather than as a transport problem.
        func isDecoding(_ error: APIError?) -> Bool {
            if let error, case .decoding = error { return true }
            return false
        }
        server.handler = { _ in .json(["results": []]) }
        let noKey = await #expect(throws: APIError.self) { try await api().rail() }
        #expect(isDecoding(noKey))

        server.handler = { _ in .json(["stories": "soon"]) }
        let notAList = await #expect(throws: APIError.self) { try await api().rail() }
        #expect(isDecoding(notAList))

        // A null list is unreadable too — the endpoint always sends a list, so a null means
        // something went wrong, and the rail must not read it as "nothing posted".
        server.handler = { _ in .json(["stories": NSNull()]) }
        let null = await #expect(throws: APIError.self) { try await api().rail() }
        #expect(isDecoding(null))
    }

    @Test("Anywhere on the site is routed; anywhere else is not")
    func routedLinks() {
        func link(_ raw: String) -> AppLink? { Story(id: 1, title: "t", linkURL: raw).routedLink }
        #expect(link("/events") == .events)
        #expect(link("https://mastersat.uz/events") == .events)
        #expect(link("https://www.mastersat.uz/classes/12?from=story") == .classroom(id: 12))
        #expect(link("  /vocabulary/sets/8  ") == .vocabularySet(id: 8))
        // Protocol-relative, on the site: still the site, still routed.
        #expect(link("//mastersat.uz/events") == .events)
        // Somewhere on the site the app has no screen for: still routed, as the site path it
        // is, so the router's `.web` branch opens it on the website rather than the viewer
        // showing no "Open" at all.
        #expect(link("/blog/2026/mock-day") == .unknown("/blog/2026/mock-day"))
        #expect(
            link("/blog/2026/mock-day")?.webURL(base: config.baseURL)?.absoluteString
                == "https://mastersat.uz/blog/2026/mock-day"
        )
        // Not this site: `openableLink` or nothing. A protocol-relative off-site link must
        // never become a path the router would open on mastersat.uz.
        #expect(link("https://example.com/a") == nil)
        #expect(link("//evil.com/x") == nil)
        #expect(link("mailto:office@mastersat.uz") == nil)
        #expect(link("javascript:alert(1)") == nil)
        #expect(link("") == nil)
        #expect(link("   ") == nil)
    }

    @Test("A story's link produces an Open button, or deliberately none at all")
    func openButtonPresence() {
        func shows(_ raw: String) -> Bool {
            let story = Story(id: 1, title: "t", linkURL: raw)
            return story.routedLink != nil || story.openableLink != nil
        }
        // Everything on the site, screen or no screen, and every off-site web page.
        #expect(shows("/events"))
        #expect(shows("/blog/2026/mock-day"))
        #expect(shows("https://mastersat.uz/blog"))
        #expect(shows("//mastersat.uz/events"))
        #expect(shows("https://example.com/a"))
        // A link saved without a scheme is relative on the website too (`href="example.com"`
        // resolves against the site), so it gets the same button and the same 404 — not the
        // silence the app used to answer with.
        #expect(shows("example.com"))
        // Nothing else gets a button.
        #expect(!shows("//evil.com/x"))
        #expect(!shows("mailto:office@mastersat.uz"))
        #expect(!shows("javascript:alert(1)"))
        #expect(!shows(""))
    }

    @Test("Only a web page can be opened in the browser — a story is not a launcher")
    func openableLinks() {
        func link(_ raw: String) -> URL? { Story(id: 1, title: "t", linkURL: raw).openableLink }
        #expect(link("https://example.com/a?b=1") != nil)
        #expect(link("http://example.com") != nil)
        // On the site but with no screen of its own: the browser can still have it.
        #expect(link("https://mastersat.uz/blog") != nil)
        #expect(link("  https://example.com  ")?.host == "example.com")
        #expect(link("") == nil)
        #expect(link("javascript:alert(1)") == nil)
        #expect(link("mailto:office@mastersat.uz") == nil)
        #expect(link("ftp://example.com/file") == nil)
        #expect(link("https://") == nil)
        #expect(link("example.com") == nil)
        // Protocol-relative: no scheme, so not something to hand the browser.
        #expect(link("//evil.com/x") == nil)
        #expect(link("//mastersat.uz/events") == nil)
    }
}

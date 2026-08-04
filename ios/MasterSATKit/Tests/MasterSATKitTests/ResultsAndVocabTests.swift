import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ResultsAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> ResultsAPI {
        ResultsAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("An unreleased midterm result reports that, rather than a zero")
    func unreleasedMidterm() async throws {
        // A classroom midterm is scored on submit but stays sealed until the teacher
        // publishes it. Showing 0 would read as a failed paper.
        server.handler = { _ in .json(["score_only": true, "released": false, "subject": "MATH"]) }

        let result = try await api().midtermResult(attemptId: 4)

        #expect(result.released == false)
        #expect(result.totalScore == nil)
    }

    @Test("A released midterm carries its score and ceiling")
    func releasedMidterm() async throws {
        server.handler = { _ in
            .json([
                "score_only": true, "released": true, "subject": "MATH",
                "total_score": 720, "score_ceiling": 800,
                "certificate": ["available": true, "code": "ABC123", "rank": 3, "cohort_size": 28],
            ])
        }

        let result = try await api().midtermResult(attemptId: 4)

        #expect(result.totalScore == 720)
        #expect(result.scoreCeiling == 800)
        #expect(result.certificate?.rank == 3)
    }

    @Test("A certificate is fetched by its printed code")
    func certificateByCode() async throws {
        server.handler = { _ in .json(["code": "ABC123", "student_name": "Aziz", "score": 720]) }

        let cert = try await api().certificate(code: "ABC123")

        #expect(cert.code == "ABC123")
        let url = try #require(server.requests.first?.url?.absoluteString)
        // The trailing slash matters — Django's urlconf will not match without it, and
        // `URL.path` silently drops it, so assert on the whole string.
        #expect(url.hasSuffix("/api/classes/certificates/midterm/ABC123/"))
    }
}

@Suite struct VocabSearchTests {

    @Test("A search result carries the section that tells it apart")
    func searchRowCarriesSection() throws {
        // The bank stores the same word once per section, so three rows come back reading
        // "abate / to become less intense" with nothing to choose between them.
        let data = Data(#"""
        [{"id":1,"word":"abate","definition":"to lessen","section_id":2,"section_title":"650 Hard Words"},
         {"id":9,"word":"abate","definition":"to lessen","section_id":3,"section_title":"College Panda"}]
        """#.utf8)

        let words = try JSONCoding.decoder.decode([VocabWord].self, from: data)

        #expect(words.map(\.sectionTitle) == ["650 Hard Words", "College Panda"])
        #expect(words[0].id != words[1].id)
    }

    @Test("A set's own words have no section, and that is not an error")
    func setWordsHaveNoSection() throws {
        let data = Data(#"{"id":1,"word":"abate","definition":"to lessen","status":"learning"}"#.utf8)
        let word = try JSONCoding.decoder.decode(VocabWord.self, from: data)

        #expect(word.sectionTitle == nil)
        #expect(word.status == .learning)
    }
}

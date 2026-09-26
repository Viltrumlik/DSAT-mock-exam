import Foundation
import Testing
@testable import MasterSATKit

/// Per-game mastery, as `vocabulary/serializers.py` serves it since 22dfe328: a word is
/// `new` or `mastered`, a set carries a four-game `mastery` block, a section rolls its sets
/// up, and a finished run says whether it mastered its game.
@Suite struct VocabMasteryDecodingTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test("A set's mastery block decodes game by game")
    func setMasteryDecodes() throws {
        let m = try decode(VocabSetMastery.self, #"""
        {"modes":{"flashcard":true,"matching":false,"speed":true,"test":false},
         "mastered_modes":2,"total_modes":4,"percent":50,"is_mastered":false}
        """#)

        #expect(m.isMastered(.flashcard))
        #expect(m.isMastered(.speed))
        #expect(m.isMastered(.matching) == false)
        #expect(m.masteredModes == 2)
        #expect(m.totalModes == 4)
        #expect(m.percent == 50)
        #expect(m.isMastered == false)
    }

    @Test("A game the app has never heard of does not blank the bar")
    func unknownGameIsSkipped() throws {
        let m = try decode(VocabSetMastery.self, #"""
        {"modes":{"flashcard":true,"spelling_bee":true},"mastered_modes":1,"total_modes":5,"percent":20}
        """#)

        #expect(m.isMastered(.flashcard))
        #expect(m.masteredModes == 1)
        #expect(m.percent == 20)
    }

    @Test("A block with only the games fills in the counts the server would have sent")
    func sparseBlockIsDerived() throws {
        let m = try decode(VocabSetMastery.self, #"{"modes":{"flashcard":true,"matching":true,"speed":true,"test":true}}"#)

        #expect(m.masteredModes == 4)
        #expect(m.totalModes == 4)
        #expect(m.percent == 100)
        #expect(m.isMastered)
    }

    @Test("A percent that arrives as a float still fills the bar")
    func floatPercentIsRead() throws {
        let m = try decode(VocabSetMastery.self, #"{"modes":{"test":true},"mastered_modes":1,"total_modes":4,"percent":25.0}"#)
        #expect(m.percent == 25)
    }

    @Test("A set with no mastery block reads as nothing mastered, not as an error")
    func missingMasteryIsEmpty() throws {
        let set = try decode(VocabSetDetail.self, #"{"id":3,"title":"Set 1","words":[]}"#)

        #expect(set.mastery == .empty)
        #expect(set.mastery.percent == 0)
        #expect(set.mastery.isMastered == false)
    }

    @Test("The set page reads mastery beside completion, and they differ")
    func setDetailCarriesBoth() throws {
        // Completed = any game finished; mastered = all four clean. One does not imply the other.
        let set = try decode(VocabSetDetail.self, #"""
        {"id":11,"title":"Set A","is_custom":false,"section":{"id":4,"title":"College Panda"},
         "word_count":25,"completed":true,
         "mastery":{"modes":{"flashcard":false,"matching":false,"speed":false,"test":false},
                    "mastered_modes":0,"total_modes":4,"percent":0,"is_mastered":false},
         "words":[{"id":1,"word":"abate","definition":"to lessen","status":"mastered"}]}
        """#)

        #expect(set.completed)
        #expect(set.mastery.percent == 0)
        #expect(set.words.first?.status == .mastered)
    }

    @Test("The retired 'learning' status reads as new")
    func learningIsNew() throws {
        let word = try decode(VocabWord.self, #"{"id":1,"word":"abate","definition":"to lessen","status":"learning"}"#)
        #expect(word.status == .new)
    }

    @Test("Progress has two buckets and ignores a stale third")
    func progressHasTwoBuckets() throws {
        let p = try decode(VocabProgress.self, #"{"new":17,"learning":3,"mastered":8,"total":25}"#)

        #expect(p.new == 17)
        #expect(p.mastered == 8)
        #expect(p.total == 25)
        #expect(p.percentMastered == 32)
    }

    @Test("A hub section carries words progress and sets mastery separately")
    func sectionDecodes() throws {
        let sections = try decode([VocabSection].self, #"""
        [{"id":4,"title":"College Panda","slug":"college-panda","description":"",
          "set_count":8,"word_count":200,
          "progress":{"new":150,"mastered":50,"total":200},
          "mastery":{"mastered_sets":2,"total_sets":8,"percent":25}}]
        """#)

        let section = try #require(sections.first)
        #expect(section.progress.percentMastered == 25)
        #expect(section.mastery.masteredSets == 2)
        #expect(section.mastery.totalSets == 8)
        #expect(section.mastery.percent == 25)
        #expect(section.mastery.isComplete == false)
    }

    @Test("A section page decodes its roll-up and its set rows")
    func sectionDetailDecodes() throws {
        let detail = try decode(VocabSectionDetail.self, #"""
        {"id":4,"title":"College Panda","word_count":50,
         "progress":{"new":40,"mastered":10,"total":50},
         "mastery":{"mastered_sets":1,"total_sets":2,"percent":50},
         "sets":[
           {"id":1,"title":"Set 1","order":0,"word_count":25,"completed":true,
            "progress":{"new":15,"mastered":10,"total":25},
            "mastery":{"modes":{"flashcard":true,"matching":true,"speed":true,"test":true},
                       "mastered_modes":4,"total_modes":4,"percent":100,"is_mastered":true}},
           {"id":2,"title":"Set 2","order":1,"word_count":25,"completed":false,
            "progress":{"new":25,"mastered":0,"total":25}}
         ]}
        """#)

        #expect(detail.mastery.percent == 50)
        #expect(detail.sets[0].mastery.isMastered)
        #expect(detail.sets[1].mastery == .empty)
        #expect(detail.startedSets == 1)
        #expect(detail.everySetMastered == false)
    }

    @Test("A section page without a roll-up derives it from its sets")
    func sectionRollUpIsDerived() throws {
        let detail = try decode(VocabSectionDetail.self, #"""
        {"id":4,"title":"T","sets":[
          {"id":1,"title":"A","mastery":{"modes":{},"mastered_modes":4,"total_modes":4,"percent":100,"is_mastered":true}},
          {"id":2,"title":"B","mastery":{"modes":{},"mastered_modes":4,"total_modes":4,"percent":100,"is_mastered":true}}]}
        """#)

        #expect(detail.mastery.masteredSets == 2)
        #expect(detail.mastery.percent == 100)
        #expect(detail.everySetMastered)
    }

    @Test("An empty section is never 'every set mastered'")
    func emptySectionIsNotComplete() throws {
        let detail = try decode(VocabSectionDetail.self, #"{"id":4,"title":"T","sets":[]}"#)
        #expect(detail.everySetMastered == false)
        #expect(detail.mastery.isComplete == false)
    }

    @Test("A custom set lists with its mastery")
    func mySetDecodes() throws {
        let sets = try decode([VocabMySet].self, #"""
        [{"id":9,"title":"Words I keep missing","word_count":12,"completed":true,
          "mastery":{"modes":{"flashcard":true},"mastered_modes":1,"total_modes":4,"percent":25,"is_mastered":false},
          "created_at":"2026-09-20T10:00:00Z"}]
        """#)

        #expect(sets.first?.mastery.percent == 25)
        #expect(sets.first?.createdAt == "2026-09-20T10:00:00Z")
    }

    @Test("A finished run says whether it mastered its game")
    func sessionSummaryDecodes() throws {
        let summary = try decode(VocabSessionSummary.self, #"""
        {"id":77,"mode":"speed","correct_count":25,"total_count":25,"accuracy":100.0,
         "distinct_words":25,"coverage":1.0,"duration_ms":41000,"set_completed":true,
         "mode_mastered":true,
         "mastery":{"modes":{"flashcard":true,"matching":false,"speed":true,"test":false},
                    "mastered_modes":2,"total_modes":4,"percent":50,"is_mastered":false},
         "progress":{"new":20,"mastered":5,"total":25}}
        """#)

        #expect(summary.mode == .speed)
        #expect(summary.modeMastered)
        #expect(summary.distinctWords == 25)
        #expect(summary.coverage == 1.0)
        #expect(summary.durationMs == 41000)
        #expect(summary.mastery.masteredModes == 2)
        #expect(summary.progress?.mastered == 5)
        #expect(summary.accuracy == 100)
    }

    @Test("An older finish payload still decodes, with nothing mastered")
    func oldSummaryDecodes() throws {
        let summary = try decode(VocabSessionSummary.self, #"{"id":77,"correct_count":2,"total_count":3,"set_completed":true}"#)

        #expect(summary.modeMastered == false)
        #expect(summary.mastery == .empty)
        #expect(summary.progress == nil)
    }
}

@Suite struct VocabHubRulesTests {

    private func groups(_ json: String) throws -> [VocabHomeworkGroup] {
        try JSONCoding.decoder.decode([VocabHomeworkGroup].self, from: Data(json.utf8))
    }

    private let mastered = #"{"modes":{"flashcard":true,"matching":true,"speed":true,"test":true},"mastered_modes":4,"total_modes":4,"percent":100,"is_mastered":true}"#

    @Test("The Homework tab counts sets not yet MASTERED, not sets not yet started")
    func outstandingCountsMastery() throws {
        // A set with one game finished is "done" on the pill but still owed on the tab: the
        // homework scores three quarters until all four games are clean.
        let g = try groups(#"""
        [{"assignment_id":4,"assignment_title":"Unit 3","sets":[
           {"id":1,"title":"A","completed":true,"mastery":\#(mastered)},
           {"id":2,"title":"B","completed":true},
           {"id":3,"title":"C","completed":false}]},
         {"assignment_id":5,"assignment_title":"Unit 4","sets":[{"id":1,"title":"A","completed":true,"mastery":\#(mastered)}]}]
        """#)

        #expect(g[0].doneCount == 2)
        #expect(g[0].outstandingCount == 2)
        #expect(g[0].isComplete == false)
        #expect(VocabHomeworkGroup.outstanding(in: g) == 2)
    }

    @Test("The hub's four tiles sum every section")
    func hubTotals() throws {
        let sections = try JSONCoding.decoder.decode([VocabSection].self, from: Data(#"""
        [{"id":4,"title":"A","set_count":8,"word_count":200,"progress":{"new":150,"mastered":50,"total":200},
          "mastery":{"mastered_sets":2,"total_sets":8,"percent":25}},
         {"id":5,"title":"B","set_count":4,"word_count":100,"progress":{"new":90,"mastered":10,"total":100}}]
        """#.utf8))

        let totals = VocabHubTotals(sections: sections)

        #expect(totals.words == 300)
        #expect(totals.wordsMastered == 60)
        #expect(totals.sets == 12)
        #expect(totals.setsMastered == 2)
    }

    @Test("A section's colour follows its id, and consecutive ids land far apart")
    func sectionToneSlots() {
        // The bank's own ids, as the web's comment gives them: pink, cyan, blue, orange.
        #expect(VocabSectionTone.of(sectionId: 4) == .rose)
        #expect(VocabSectionTone.of(sectionId: 5) == .sky)
        #expect(VocabSectionTone.of(sectionId: 6) == .primary)
        #expect(VocabSectionTone.of(sectionId: 7) == .amber)
        #expect(VocabSectionTone.of(sectionId: 0) == .primary)
        #expect(VocabSectionTone.of(sectionId: 8) == .violet)
        #expect(VocabSectionTone.of(sectionId: 9) == .emerald)
    }

    @Test("A negative or extreme id still picks a slot rather than crashing")
    func sectionToneIsTotal() {
        #expect(VocabSectionTone.of(sectionId: -1) == .amber)
        _ = VocabSectionTone.of(sectionId: Int.min)
        _ = VocabSectionTone.of(sectionId: Int.max)
    }

    @Test("The word filter counts and filters by the two statuses")
    func wordFilter() {
        let words = [
            VocabWord(id: 1, word: "a", definition: "x", status: .mastered),
            VocabWord(id: 2, word: "b", definition: "y", status: .new),
            VocabWord(id: 3, word: "c", definition: "z", status: .new),
        ]

        let counts = VocabWordFilter.counts(words)

        #expect(counts[.all] == 3)
        #expect(counts[.new] == 2)
        #expect(counts[.mastered] == 1)
        #expect(VocabWordFilter.mastered.apply(words).map(\.id) == [1])
        #expect(VocabWordFilter.all.apply(words).count == 3)
    }
}

@Suite(.serialized) @MainActor
struct VocabSessionBindingTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> StudentAPI {
        StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
    }

    private func json(_ request: URLRequest) -> [String: Any] {
        guard let body = request.httpBody,
              let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return [:] }
        return object
    }

    /// `URL.path` drops the trailing slash, so match on the whole string.
    private func startBody() throws -> [String: Any] {
        let start = try #require(server.requests.first { $0.url?.absoluteString.hasSuffix("/vocabulary/sessions/") == true })
        return json(start)
    }

    private func finishBodies() -> [[String: Any]] {
        server.requests
            .filter { $0.url?.absoluteString.contains("/finish/") == true }
            .map(json)
    }

    private func words(_ n: Int) -> [VocabWord] {
        (0..<n).map { VocabWord(id: 100 + $0, word: "w\($0)", definition: "d\($0)") }
    }

    private func sessionThenSummary(status: Int = 200) -> @Sendable (URLRequest) -> StubResponse {
        { request in
            request.url?.absoluteString.contains("finish") == true
                ? .json(["id": 77, "mode": "flashcard", "correct_count": 2, "total_count": 2,
                         "set_completed": true, "mode_mastered": true], status: status)
                : .json(["id": 77, "set_id": 11, "mode": "flashcard"], status: 201)
        }
    }

    @Test("A run launched from a homework names that homework")
    func homeworkLaunchSendsAssignment() async throws {
        server.handler = sessionThenSummary()
        _ = try await api().startVocabularySession(setId: 11, mode: .matching, assignmentId: 42)

        let body = try startBody()
        #expect(body["assignment_id"] as? Int == 42)
        #expect(body["set_id"] as? Int == 11)
        #expect(body["mode"] as? String == "matching")
    }

    @Test("Self-study sends no homework at all — not even a null")
    func selfStudySendsNothing() async throws {
        server.handler = sessionThenSummary()
        _ = try await api().startVocabularySession(setId: 11, mode: .flashcard)

        let body = try startBody()
        #expect(body.keys.contains("assignment_id") == false)
    }

    @Test("A junk id is dropped rather than failing the round on the server's validator")
    func junkIdIsDropped() async throws {
        server.handler = sessionThenSummary()
        _ = try await api().startVocabularySession(setId: 11, mode: .flashcard, assignmentId: 0)

        #expect(try startBody().keys.contains("assignment_id") == false)
    }

    @Test("The runner opens its session bound to the homework it was given")
    func runnerBindsItsRun() async throws {
        server.handler = sessionThenSummary()
        let runner = VocabStudyRunner(mode: .flashcard, words: words(2), setId: 11, assignmentId: 42, api: api())

        await runner.begin()

        #expect(runner.isStarted)
        #expect(try startBody()["assignment_id"] as? Int == 42)
    }

    @Test("A homework the student cannot claim is a start error with the server's sentence")
    func refusedBindingIsAStartError() async throws {
        server.handler = { _ in
            .json(["detail": "That homework is not assigned to you for this set."], status: 400)
        }
        let runner = VocabStudyRunner(mode: .flashcard, words: words(2), setId: 11, assignmentId: 42, api: api())

        await runner.begin()

        #expect(runner.isStarted == false)
        #expect(runner.startError?.errorDescription == "That homework is not assigned to you for this set.")
    }

    @Test("Trying again after a failed start opens the run")
    func startCanBeRetried() async throws {
        server.handler = { _ in .json(["detail": "offline"], status: 503) }
        let runner = VocabStudyRunner(mode: .flashcard, words: words(2), setId: 11, api: api())
        await runner.begin()
        #expect(runner.startError != nil)

        server.handler = sessionThenSummary()
        await runner.begin()

        #expect(runner.isStarted)
        #expect(runner.startError == nil)
    }

    @Test("Completing twice sends one grading call")
    func completionIsALatch() async throws {
        // The flashcards grade at the final verdict and the outcome screen asks again after
        // the five-second hold. Only the first may reach the server.
        server.handler = sessionThenSummary()
        let runner = VocabStudyRunner(mode: .flashcard, words: words(2), setId: 11, api: api())
        await runner.begin()
        runner.record(wordId: 100, correct: true)
        runner.record(wordId: 101, correct: true)

        await runner.complete()
        await runner.complete()

        let finishes = finishBodies()
        #expect(finishes.count == 1)
        #expect(finishes.first?["partial"] as? Bool == false)
        #expect(runner.isFinished)
        #expect(runner.summary?.modeMastered == true)
    }

    @Test("A partial flush on the wire cannot swallow the grading call")
    func completionQueuesBehindAPartialFlush() async throws {
        server.handler = sessionThenSummary()
        let runner = VocabStudyRunner(mode: .flashcard, words: words(2), setId: 11, api: api())
        await runner.begin()
        runner.record(wordId: 100, correct: true)
        runner.record(wordId: 101, correct: true)

        async let leaving: Void = runner.flush(isPartial: true)
        async let grading: Void = runner.complete()
        _ = await (leaving, grading)

        let finishes = finishBodies()
        #expect(runner.isFinished)
        #expect(finishes.last?["partial"] as? Bool == false)
        // Every answer went out exactly once, whichever request carried it.
        let sent = finishes.flatMap { ($0["results"] as? [[String: Any]]) ?? [] }
        #expect(sent.count == 2)
    }

    @Test("A failed grading call keeps the answers and can be retried")
    func failedCompletionIsRetried() async throws {
        server.handler = sessionThenSummary(status: 500)
        let runner = VocabStudyRunner(mode: .flashcard, words: words(2), setId: 11, api: api())
        await runner.begin()
        runner.record(wordId: 100, correct: true)

        await runner.complete()
        #expect(runner.saveError != nil)
        #expect(runner.isFinished == false)
        #expect(runner.pending.count == 1)

        server.handler = sessionThenSummary()
        await runner.complete()

        #expect(runner.isFinished)
        #expect(runner.saveError == nil)
        #expect(runner.pending.isEmpty)
    }

    @Test("Leaving after a finished round completes it rather than banking it as unfinished")
    func leavingAFinishedRoundCompletesIt() async throws {
        server.handler = sessionThenSummary(status: 500)
        let runner = VocabStudyRunner(mode: .flashcard, words: words(1), setId: 11, api: api())
        await runner.begin()
        runner.record(wordId: 100, correct: true)
        await runner.complete()

        server.handler = sessionThenSummary()
        await runner.flush(isPartial: true)

        #expect(finishBodies().last?["partial"] as? Bool == false)
        #expect(runner.isFinished)
    }

    @Test("Nothing is sent after the run is graded")
    func nothingAfterFinish() async throws {
        server.handler = sessionThenSummary()
        let runner = VocabStudyRunner(mode: .flashcard, words: words(1), setId: 11, api: api())
        await runner.begin()
        runner.record(wordId: 100, correct: true)
        await runner.complete()
        let before = server.requests.count

        runner.record(wordId: 100, correct: false)
        await runner.flush(isPartial: true)

        #expect(server.requests.count == before)
    }
}

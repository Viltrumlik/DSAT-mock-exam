import Foundation
import Testing
@testable import MasterSATKit

@MainActor
struct ExamRunnerTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")

    let server = StubServer()

    private func makeRunner(
        attemptId: Int = 5,
        backend: ExamBackend = .mocks,
        drafts: DraftStoring = InMemoryDraftStore()
    ) -> ExamRunner {
        let client = APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        )
        return ExamRunner(
            attemptId: attemptId,
            api: ExamAPI(client: client, backend: backend),
            backend: backend,
            drafts: drafts
        )
    }

    /// Waits for a condition the network will satisfy, without pinning the test to a fixed
    /// sleep. Fails by timing out rather than hanging the suite.
    private func waitUntil(
        _ condition: @MainActor () -> Bool,
        timeout: TimeInterval = 3
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    // MARK: - Rehydration

    @Test("A draft is merged back in when the module loads")
    func draftIsMergedOnLoad() async {
        // Question 101 was answered and the save never landed. On relaunch it must come
        // back — otherwise it grades Omitted with nothing to show the student why.
        let drafts = InMemoryDraftStore()
        drafts.write(
            attemptId: 5,
            draft: ExamDraft(answers: ["101": "B"], flagged: [101], version: 3, moduleId: 10)
        )
        let runner = makeRunner(drafts: drafts)

        runner.apply(AttemptFixtures.attempt(["current_module_saved_answers": ["100": "A"]]))

        #expect(runner.answers == ["100": "A", "101": "B"])
        #expect(runner.flagged == [101])
    }

    @Test("Advancing to the next module resets the student's work and position")
    func moduleAdvanceResetsState() async {
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt())
        runner.selectAnswer(questionId: 100, value: "A")
        runner.goTo(1)

        // Module 2 arrives with its own saved answers.
        runner.apply(AttemptFixtures.attempt(AttemptFixtures.json(
            state: "MODULE_2_ACTIVE",
            version: 9,
            moduleId: 11,
            moduleOrder: 2,
            savedAnswers: ["200": "C"]
        )))

        // Module 1's answers must not survive: a submit sends the whole map.
        #expect(runner.answers == ["200": "C"])
        #expect(runner.currentIndex == 0)
        #expect(runner.answersModuleId == 11)
    }

    @Test("A stale snapshot is ignored")
    func staleSnapshotIgnored() async {
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt(version: 9, moduleOrder: 2))
        runner.apply(AttemptFixtures.attempt(version: 4, moduleOrder: 1))

        #expect(runner.attempt?.versionNumber == 9)
    }

    // MARK: - Autosave

    @Test("A discrete answer reaches the server without waiting")
    func discreteAnswerIsSavedImmediately() async throws {
        let saved = AttemptFixtures.data(AttemptFixtures.json(version: 4))
        server.handler = { _ in .init(status: 200, body: saved) }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt())

        runner.selectAnswer(questionId: 100, value: "A")

        let sent = await waitUntil {
            server.requests.contains { $0.url?.absoluteString.contains("save_attempt") == true }
        }
        #expect(sent)

        let request = try #require(
            server.requests.first { $0.url?.absoluteString.contains("save_attempt") == true }
        )
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect((json["answers"] as? [String: String]) == ["100": "A"])
        // Pinning the version is what earns the hard 409 instead of a silent overwrite.
        #expect(json["expected_version_number"] as? Int == 3)
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "save.5.10.v3")
    }

    @Test("Answers are always drafted locally, even with no network")
    func answersAreDraftedOffline() async {
        let drafts = InMemoryDraftStore()
        let runner = makeRunner(drafts: drafts)
        runner.apply(AttemptFixtures.attempt())
        runner.isOnline = false

        runner.selectAnswer(questionId: 100, value: "D")

        // Offline sends nothing, but the work must survive the app being killed.
        #expect(drafts.read(attemptId: 5, moduleId: 10)?.answers == ["100": "D"])
        #expect(server.requests.isEmpty)
    }

    @Test("A version conflict adopts the server's attempt instead of retrying blind")
    func versionConflictAdoptsCanonicalAttempt() async {
        // Re-sending the same captured version can only 409 again — the production
        // "409 burst" of an initial save plus three backoff retries, all stale.
        let conflict = AttemptFixtures.data([
            "error": "Version conflict.",
            "attempt": AttemptFixtures.json(version: 77),
        ])
        server.handler = { request in
            request.url?.absoluteString.contains("save_attempt") == true
                ? .init(status: 409, body: conflict)
                : .json([:])
        }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt())

        runner.selectAnswer(questionId: 100, value: "A")

        let adopted = await waitUntil { runner.attempt?.versionNumber == 77 }
        #expect(adopted)
    }

    // MARK: - Leaving

    @Test("A leaving flush is marked background and pins no version")
    func leavingFlushIsBackgroundAndUnversioned() async throws {
        server.handler = { _ in .json([:]) }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt())
        runner.selectAnswer(questionId: 100, value: "A")

        await runner.flushOnLeaving()

        let request = try #require(
            server.requests.last { $0.url?.absoluteString.contains("save_attempt") == true }
        )
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        // `background` tells the server nobody is watching the screen, so it may persist
        // answers but must never advance into the next module's clock.
        #expect(json["background"] as? Bool == true)
        // A fire-and-forget request can neither see a 409 nor retry one, so pinning a
        // version would turn any concurrent autosave into a silently dropped flush.
        #expect(json["expected_version_number"] == nil)
    }

    // MARK: - Submitting

    @Test("Submitting targets the module and clears its draft")
    func submitTargetsModuleAndClearsDraft() async throws {
        let advanced = AttemptFixtures.data(AttemptFixtures.json(
            state: "MODULE_2_ACTIVE", version: 4, moduleId: 11, moduleOrder: 2
        ))
        server.handler = { _ in .init(status: 200, body: advanced) }
        let drafts = InMemoryDraftStore()
        let runner = makeRunner(drafts: drafts)
        runner.apply(AttemptFixtures.attempt())
        runner.selectAnswer(questionId: 100, value: "A")

        await runner.submitModule()

        let request = try #require(
            server.requests.last { $0.url?.absoluteString.contains("submit_module") == true }
        )
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        // Without module_id a retried submit could finalize the module the attempt has
        // since advanced to — how a section gets skipped entirely.
        #expect(json["module_id"] as? Int == 10)
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "submit.5.10.v3")
        // The module is genuinely over, so its draft has nothing left to protect.
        #expect(drafts.read(attemptId: 5, moduleId: 10) == nil)
    }

    @Test("Submitting twice sends one request")
    func doubleSubmitIsIgnored() async {
        server.handler = { _ in .json(AttemptFixtures.json()) }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt())

        async let first: Void = runner.submitModule()
        async let second: Void = runner.submitModule()
        _ = await (first, second)

        let submits = server.requests.filter { $0.url?.absoluteString.contains("submit_module") == true }
        #expect(submits.count == 1)
    }

    // MARK: - Proctoring

    @Test("An unproctored sitting reports, and the server charges nothing for it")
    func unproctoredSittingCostsNothing() async {
        // The client does NOT decide whether leaving counts. It says "they left"; the
        // server answers with the tally. An earlier version gated this on the attempt's
        // `proctored` flag, which is a mock-only field — so the rule was silently off for
        // every midterm, where it is never optional.
        server.handler = { _ in
            .json(["violations": 0, "limit": 3, "grace_seconds": 0, "terminated": false])
        }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt(AttemptFixtures.json(proctored: false)))

        await runner.reportOffscreen()

        #expect(runner.offscreen?.violations == 0, "a solo practice mock burns no strikes")
        #expect(runner.offscreen?.terminated == false)
    }

    @Test("A proctored sitting adopts the server's tally")
    func proctoredSittingAdoptsTally() async throws {
        server.handler = { _ in
            .json(["violations": 2, "limit": 3, "grace_seconds": 30, "terminated": false])
        }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt(AttemptFixtures.json(proctored: true)))

        await runner.reportOffscreen()

        // The count lives on the server precisely because a local tally is cleared by
        // relaunching the app.
        #expect(runner.offscreen?.violations == 2)
        #expect(runner.offscreen?.graceSeconds == 30)
    }

    // MARK: - Elimination

    @Test("Eliminating the chosen option deselects it")
    func eliminatingChosenOptionDeselects() async {
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt())
        runner.selectAnswer(questionId: 100, value: "B")

        runner.toggleEliminate(questionId: 100, optionKey: "B")

        // Keeping both would show a struck-through option as still selected.
        #expect(runner.answers["100"] == nil)
        #expect(runner.eliminated["100"]?.contains("B") == true)
    }
}

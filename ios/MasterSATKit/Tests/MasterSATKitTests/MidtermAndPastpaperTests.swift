import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ExamBackendRulesTests {

    @Test("Only past papers may stop the clock")
    func onlyPastpapersPause() {
        #expect(ExamBackend.exams.supportsPause)
        #expect(ExamBackend.mocks.supportsPause == false)
        #expect(ExamBackend.midterms.supportsPause == false)
    }

    @Test("Leaving is policed on midterms and mocks, never on past papers")
    func offscreenPolicingIsPerBackend() {
        // Past papers have no offscreen endpoint at all — calling it would 404.
        #expect(ExamBackend.exams.policesOffscreen == false)
        // Midterms publish no `proctored` flag because every midterm is invigilated.
        #expect(ExamBackend.midterms.policesOffscreen)
        #expect(ExamBackend.mocks.policesOffscreen)
    }

    @Test("Only the full mock has a break")
    func onlyMocksBreak() {
        #expect(ExamBackend.mocks.hasBreak)
        #expect(ExamBackend.midterms.hasBreak == false)
    }
}

@Suite(.serialized) @MainActor
struct MidtermRunnerTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func makeRunner(backend: ExamBackend) -> ExamRunner {
        let client = APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        )
        return ExamRunner(
            attemptId: 5,
            api: ExamAPI(client: client, backend: backend),
            backend: backend,
            drafts: InMemoryDraftStore()
        )
    }

    private func waitUntil(_ condition: @MainActor () -> Bool, timeout: TimeInterval = 3) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    @Test("A midterm reports leaving even though its payload has no proctored flag")
    func midtermReportsOffscreen() async {
        // The regression this exists for: gating on `attempt.proctored` — a mock-only
        // field — silently switched the rule off for every midterm, while the web runner
        // kept enforcing it. A student could leave a midterm freely on the phone.
        server.handler = { _ in .json(["violations": 1, "limit": 3, "grace_seconds": 30, "terminated": false]) }
        let runner = makeRunner(backend: .midterms)
        runner.apply(AttemptFixtures.attempt(AttemptFixtures.json(proctored: false)))

        await runner.reportOffscreen()

        #expect(runner.offscreen?.violations == 1)
        #expect(server.requests.contains { $0.url?.absoluteString.contains("/midterms/attempts/5/offscreen/") == true })
    }

    @Test("A past paper never reports leaving")
    func pastpaperNeverReportsOffscreen() async {
        // There is no such endpoint on /exams/attempts/; asking would just 404.
        server.handler = { _ in .json([:]) }
        let runner = makeRunner(backend: .exams)
        runner.apply(AttemptFixtures.attempt())

        await runner.reportOffscreen()

        #expect(server.requests.isEmpty)
    }

    @Test("A finished sitting reports nothing")
    func finishedSittingReportsNothing() async {
        // A late event from an app being torn down must be a harmless no-op.
        server.handler = { _ in .json([:]) }
        let runner = makeRunner(backend: .midterms)
        runner.apply(AttemptFixtures.attempt(AttemptFixtures.json(state: "COMPLETED", moduleId: nil, isCompleted: true)))

        await runner.reportOffscreen()

        #expect(server.requests.isEmpty)
    }

    @Test("Leaving a past paper pauses it")
    func leavingPastpaperPauses() async {
        // A past paper is untimed practice; its clock stops. This is the one exam type
        // where walking away costs nothing.
        let paused = AttemptFixtures.data(AttemptFixtures.json(version: 4))
        server.handler = { _ in .init(status: 200, body: paused) }
        let runner = makeRunner(backend: .exams)
        runner.apply(AttemptFixtures.attempt())

        await runner.handleLeavingForeground()

        #expect(server.requests.contains { $0.url?.absoluteString.contains("/pause/") == true })
    }

    @Test("Leaving a midterm reports it and never pauses")
    func leavingMidtermReportsAndNeverPauses() async {
        server.handler = { _ in .json(["violations": 1, "limit": 3, "grace_seconds": 30, "terminated": false]) }
        let runner = makeRunner(backend: .midterms)
        runner.apply(AttemptFixtures.attempt())

        await runner.handleLeavingForeground()

        // Pausing a timed sitting would hand the student unlimited time.
        #expect(server.requests.contains { $0.url?.absoluteString.contains("/pause/") == true } == false)
        #expect(server.requests.contains { $0.url?.absoluteString.contains("/offscreen/") == true })
    }

    @Test("Continue resumes a paused paper even while foregrounded")
    func explicitResumeAlwaysActs() async {
        // The regression: folding the button into the lifecycle handler made "Continue" a
        // no-op, because the app was already foregrounded by the time it was tapped. The
        // student sat looking at a Paused screen that would not go away.
        let running = AttemptFixtures.data(AttemptFixtures.json(version: 9))
        server.handler = { _ in .init(status: 200, body: running) }
        let runner = makeRunner(backend: .exams)
        runner.apply(AttemptFixtures.attempt(["is_paused": true]))

        await runner.resume()

        #expect(server.requests.contains { $0.url?.absoluteString.contains("/resume_pause/") == true })
    }

    @Test("One leave produces one report, not one per scene phase")
    func doubleLeaveReportsOnce() async {
        // iOS passes through `.inactive` before `.background`, so a single home-button tap
        // calls the handler twice. Each off-screen report carries a fresh idempotency key,
        // so two calls means two violations — two thirds of a three-strike allowance
        // burned for one leave.
        server.handler = { _ in .json(["violations": 1, "limit": 3, "grace_seconds": 30, "terminated": false]) }
        let runner = makeRunner(backend: .midterms)
        runner.apply(AttemptFixtures.attempt())

        await runner.handleLeavingForeground()
        await runner.handleLeavingForeground()

        let reports = server.requests.filter { $0.url?.absoluteString.contains("/offscreen/") == true }
        #expect(reports.count == 1)
    }

    @Test("Coming back and leaving again does report again")
    func returningRearmsTheReport() async {
        // The guard must not latch: a second genuine leave is a second violation.
        server.handler = { _ in .json(["violations": 1, "limit": 3, "grace_seconds": 30, "terminated": false]) }
        let runner = makeRunner(backend: .midterms)
        runner.apply(AttemptFixtures.attempt())

        await runner.handleLeavingForeground()
        await runner.handleReturningToForeground()
        await runner.handleLeavingForeground()

        let reports = server.requests.filter { $0.url?.absoluteString.contains("/offscreen/") == true }
        #expect(reports.count == 2)
    }

    @Test("The access code is checked before the clock starts")
    func accessCodeIsVerified() async throws {
        server.handler = { _ in .json(["ok": true, "requires_code": true]) }
        let client = APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        )

        let check = try await ExamAPI(client: client, backend: .midterms)
            .verifyAccessCode(attemptId: 5, code: "123456")

        #expect(check.ok)
        #expect(check.requiresCode)
        let request = try #require(server.requests.first)
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["code"] as? String == "123456")
    }
}

@Suite(.serialized) struct MidtermAndPastpaperListingTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func makeAPI() -> StudentAPI {
        StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
    }

    @Test("The three ways a midterm can be shut are kept apart")
    func blockedReasonsAreDistinct() async throws {
        // Each needs different words in front of a student standing there waiting.
        server.handler = { _ in
            .json(["results": [
                ["midterm_id": 1, "title": "Before", "is_open": false, "is_before_start": true,
                 "awaiting_code": false, "submitted": false, "state": "NOT_STARTED", "results_visible": false],
                ["midterm_id": 2, "title": "Awaiting", "is_open": false, "is_before_start": false,
                 "awaiting_code": true, "submitted": false, "state": "NOT_STARTED", "results_visible": false],
                ["midterm_id": 3, "title": "Closed", "is_open": false, "is_before_start": false,
                 "awaiting_code": false, "submitted": false, "state": "NOT_STARTED", "results_visible": false],
                ["midterm_id": 4, "title": "Open", "is_open": true, "is_before_start": false,
                 "awaiting_code": false, "submitted": false, "state": "NOT_STARTED", "results_visible": false],
            ]])
        }

        let midterms = try await makeAPI().midterms()

        #expect(midterms[0].blockedReason == "Opens later")
        #expect(midterms[1].blockedReason == "Waiting for your teacher to start it")
        #expect(midterms[2].blockedReason == "Closed")
        #expect(midterms[3].blockedReason == nil)
    }

    @Test("A gated midterm reports no score until results are released")
    func gatedMidtermHidesScore() async throws {
        // Classroom results are publish-gated; the row must not imply a missing result is
        // a bad one.
        server.handler = { _ in
            .json(["results": [[
                "midterm_id": 9, "title": "Midterm 4", "subject": "MATH", "flavor": "classroom",
                "attempt_id": 12, "state": "COMPLETED", "submitted": true, "is_open": false,
                "is_before_start": false, "awaiting_code": false, "results_visible": false,
                "score": NSNull(), "certificate": NSNull(),
            ]]])
        }

        let midterm = try #require(try await makeAPI().midterms().first)

        #expect(midterm.submitted)
        #expect(midterm.resultsVisible == false)
        #expect(midterm.score == nil)
        #expect(midterm.blockedReason == nil, "already sat — not a blocked state")
    }

    @Test("A released midterm carries its certificate")
    func releasedMidtermCarriesCertificate() async throws {
        server.handler = { _ in
            .json(["results": [[
                "midterm_id": 9, "title": "Midterm 4", "submitted": true, "state": "COMPLETED",
                "is_open": false, "is_before_start": false, "awaiting_code": false,
                "results_visible": true, "score": 720,
                "certificate": ["available": true, "code": "AB12CD", "download_url": "/classes/certificates/midterm/AB12CD/download/", "rank": 3, "cohort_size": 24],
            ]]])
        }

        let midterm = try #require(try await makeAPI().midterms().first)

        #expect(midterm.score == 720)
        #expect(midterm.certificate?.code == "AB12CD")
        #expect(midterm.certificate?.rank == 3)
    }

    @Test("The past-paper catalogue decodes from a bare array")
    func pastpapersDecodeFromBareArray() async throws {
        // DRF pagination is off, so these endpoints return a plain list.
        server.handler = { _ in
            .json([
                ["id": 3, "title": "March 2024", "subject": "MATH", "label": "Form A",
                 "collection_name": "Official", "practice_date": "2024-03-09",
                 "modules": [["id": 1, "module_order": 1, "time_limit_minutes": 35],
                             ["id": 2, "module_order": 2, "time_limit_minutes": 35]]],
            ])
        }

        let papers = try await makeAPI().pastpapers()

        #expect(papers.count == 1)
        #expect(papers[0].totalMinutes == 70)
    }

    @Test("The past-paper catalogue also decodes from a paginated envelope")
    func pastpapersDecodeFromEnvelope() async throws {
        // So turning pagination on server-side does not require an app release.
        server.handler = { _ in
            .json(["count": 1, "results": [["id": 3, "title": "March 2024", "subject": "MATH", "modules": []]]])
        }

        let papers = try await makeAPI().pastpapers()

        #expect(papers.count == 1)
    }

    @Test("An in-progress pastpaper attempt is recognised")
    func pastpaperAttemptStateIsRecognised() async throws {
        server.handler = { _ in
            .json([
                ["id": 1, "practice_test": 3, "current_state": "MODULE_1_ACTIVE", "is_completed": false, "is_paused": true],
                ["id": 2, "practice_test": 4, "current_state": "COMPLETED", "is_completed": true, "score": 12],
                ["id": 3, "practice_test": 5, "current_state": "ABANDONED", "is_completed": false],
            ])
        }

        let attempts = try await makeAPI().pastpaperAttempts()

        #expect(attempts[0].inProgress)
        #expect(attempts[0].isPaused)
        #expect(attempts[1].inProgress == false)
        // An abandoned attempt is not something to resume — it offers "Start" again.
        #expect(attempts[2].inProgress == false)
    }

    @Test("Starting a midterm and a past paper name their target")
    func startRequestsNameTheirTarget() async throws {
        let attempt = AttemptFixtures.data(AttemptFixtures.json())
        server.handler = { _ in .init(status: 201, body: attempt) }
        let api = makeAPI()

        _ = try await api.startMidtermAttempt(midtermId: 7)
        _ = try await api.startPastpaperAttempt(practiceTestId: 11)

        let bodies = server.requests.compactMap { $0.httpBody }
            .compactMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        #expect(bodies.first?["midterm"] as? Int == 7)
        #expect(bodies.last?["practice_test"] as? Int == 11)
    }
}

@Suite(.serialized) @MainActor
struct MidtermAccessCodeGateTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func makeRunner() -> ExamRunner {
        let client = APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        )
        return ExamRunner(
            attemptId: 5,
            api: ExamAPI(client: client, backend: .midterms),
            backend: .midterms,
            drafts: InMemoryDraftStore()
        )
    }

    @Test("A code-gated start asks for the code instead of failing")
    func codeRequiredIsAStepNotAnError() async {
        // A 403 here is not "you have no access" — the student is holding the code the
        // teacher just read out. Showing them a generic refusal strands them.
        server.handler = { _ in
            .json(["detail": "Enter the access code from your teacher to begin.", "reason": "code_required"], status: 403)
        }
        let runner = makeRunner()
        runner.apply(AttemptFixtures.attempt(AttemptFixtures.json(state: "NOT_STARTED", moduleId: nil)))

        await runner.start()

        #expect(runner.needsAccessCode)
        #expect(runner.lastError == nil, "not an error state")
        #expect(runner.accessCodeMessage == "Enter the access code from your teacher to begin.")
    }

    @Test("A correct code verifies and then starts")
    func correctCodeStarts() async {
        let started = AttemptFixtures.data(AttemptFixtures.json(state: "MODULE_1_ACTIVE"))
        server.handler = { request in
            let url = request.url?.absoluteString ?? ""
            if url.contains("verify_code") { return .json(["ok": true, "requires_code": true]) }
            return .init(status: 200, body: started)
        }
        let runner = makeRunner()

        let ok = await runner.submitAccessCode("123456")

        #expect(ok)
        #expect(runner.needsAccessCode == false)
        #expect(runner.attempt?.isActive == true)
        // The gate is checked BEFORE the clock starts, never after.
        let paths = server.requests.compactMap { $0.url?.absoluteString }
        #expect(paths.first?.contains("verify_code") == true)
        #expect(paths.last?.contains("/start/") == true)
    }

    @Test("A wrong code neither starts the exam nor loses the student")
    func wrongCodeKeepsThemOnTheGate() async {
        server.handler = { request in
            request.url?.absoluteString.contains("verify_code") == true
                ? .json(["ok": false, "requires_code": true, "detail": "Incorrect access code."], status: 403)
                : .json([:])
        }
        let runner = makeRunner()

        let ok = await runner.submitAccessCode("000000")

        #expect(ok == false)
        #expect(runner.lastError?.errorDescription == "Incorrect access code.")
        // Critically: no start was attempted, so the clock did not begin.
        #expect(server.requests.contains { $0.url?.absoluteString.contains("/start/") == true } == false)
    }

    @Test("An ungated midterm starts without ever asking for a code")
    func ungatedMidtermJustStarts() async {
        let started = AttemptFixtures.data(AttemptFixtures.json(state: "MODULE_1_ACTIVE"))
        server.handler = { _ in .init(status: 200, body: started) }
        let runner = makeRunner()

        await runner.start()

        #expect(runner.needsAccessCode == false)
        #expect(runner.attempt?.isActive == true)
    }
}

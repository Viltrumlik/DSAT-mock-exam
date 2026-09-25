import Foundation
import Testing
@testable import MasterSATKit

@Suite struct AppVersionTests {

    @Test("Versions compare as numbers, not strings")
    func numericComparison() throws {
        // The whole reason this type exists: as strings, 1.10.0 sorts BEFORE 1.9.0, and a
        // gate built on that would lock out the newer app.
        let newer = try #require(AppVersion("1.10.0"))
        let older = try #require(AppVersion("1.9.0"))
        #expect(older < newer)
    }

    @Test("Missing parts are zero, and trailing labels are ignored")
    func lenientParsing() {
        #expect(AppVersion("1.4") == AppVersion("1.4.0"))
        #expect(AppVersion("2") == AppVersion(major: 2))
        #expect(AppVersion("2.1.0-rc1") == AppVersion(major: 2, minor: 1))
        #expect(AppVersion("1.3 (40)") == AppVersion(major: 1, minor: 3))
        #expect(AppVersion(" 1.2.3 ") == AppVersion(major: 1, minor: 2, patch: 3))
    }

    @Test("Nothing readable is nil, never 0.0.0")
    func unreadableIsNil() {
        // nil means "no requirement". A typo in the console must not become "0.0.0" and
        // silently allow — or, worse, a garbage minimum that blocks everyone.
        #expect(AppVersion("") == nil)
        #expect(AppVersion(nil) == nil)
        #expect(AppVersion("beta") == nil)
        #expect(AppVersion("1..2") == nil)
        #expect(AppVersion("1.x") == nil)
    }
}

@Suite struct UpdatePolicyTests {

    private let current = AppVersion("1.1.0")

    @Test("Below the minimum is required; below the latest is available")
    func localVerdicts() {
        #expect(ClientConfig(latestVersion: "1.2.0", minimumVersion: "1.1.0").requirement(for: current) == .available)
        #expect(ClientConfig(latestVersion: "1.3.0", minimumVersion: "1.2.0").requirement(for: current) == .required)
        #expect(ClientConfig(latestVersion: "1.1.0", minimumVersion: "1.0.0").requirement(for: current) == .none)
        // Newer than anything the server knows about — a TestFlight build, say — is fine.
        #expect(ClientConfig(latestVersion: "1.0.0", minimumVersion: "1.0.0").requirement(for: current) == .none)
    }

    @Test("An empty policy requires nothing")
    func emptyPolicy() {
        #expect(ClientConfig().requirement(for: current) == .none)
        #expect(ClientConfig(latestVersion: "", minimumVersion: "").requirement(for: current) == .none)
    }

    @Test("The stricter of the server's verdict and the app's own wins")
    func strictestWins() {
        // The server read the version from the header and says "required"; the versions it
        // sent would only say "available". Required wins.
        #expect(ClientConfig(latestVersion: "1.2.0", minimumVersion: "1.0.0", update: "required").requirement(for: current) == .required)
        // And a server that says "none" cannot wave through a build the numbers condemn.
        #expect(ClientConfig(latestVersion: "2.0.0", minimumVersion: "2.0.0", update: "none").requirement(for: current) == .required)
    }

    @Test("An unreadable own version fails open")
    func unreadableCurrentFailsOpen() {
        #expect(ClientConfig(latestVersion: "9.0.0", minimumVersion: "9.0.0").requirement(for: nil) == .none)
    }

    @Test("The config decodes with every field missing")
    func decodesSparse() throws {
        let config = try JSONCoding.decoder.decode(ClientConfig.self, from: Data("{}".utf8))
        #expect(config == ClientConfig())
        let full = try JSONCoding.decoder.decode(ClientConfig.self, from: Data("""
        {"latest_version": "1.2.0", "minimum_version": "1.0.0", "update_url": "https://apps.apple.com/app/id1",
         "message": "New maths tools", "update": "available", "server_time": "2026-09-25T10:00:00Z"}
        """.utf8))
        #expect(full.latestVersion == "1.2.0")
        #expect(full.storeURL?.absoluteString == "https://apps.apple.com/app/id1")
    }

    @Test("Only an https or App Store link is opened")
    func storeURLScheme() {
        #expect(ClientConfig(updateURL: "javascript:alert(1)").storeURL == nil)
        #expect(ClientConfig(updateURL: "").storeURL == nil)
        #expect(ClientConfig(updateURL: "itms-apps://apps.apple.com/app/id1").storeURL != nil)
    }

    @Test("The gentle prompt shows once per version, then every few days")
    func nudgeCadence() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(UpdateNudge.shouldShow(latest: "1.2.0", lastShownVersion: nil, lastShownAt: nil, now: now))
        #expect(!UpdateNudge.shouldShow(latest: "1.2.0", lastShownVersion: "1.2.0", lastShownAt: now.addingTimeInterval(-3600), now: now))
        #expect(UpdateNudge.shouldShow(latest: "1.2.0", lastShownVersion: "1.2.0", lastShownAt: now.addingTimeInterval(-UpdateNudge.interval), now: now))
        // A newer version resets the clock.
        #expect(UpdateNudge.shouldShow(latest: "1.3.0", lastShownVersion: "1.2.0", lastShownAt: now, now: now))
        #expect(!UpdateNudge.shouldShow(latest: nil, lastShownVersion: nil, lastShownAt: nil, now: now))
    }
}

@Suite struct DiagnosticsTests {

    private func tempDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("diag-\(UUID().uuidString)")
    }

    private func report(
        _ kind: DiagnosticReport.Kind = .crash,
        signature: String = "EXC_BAD_ACCESS",
        at seconds: TimeInterval = 0,
        payload: Data? = nil
    ) -> DiagnosticReport {
        DiagnosticReport(
            kind: kind,
            occurredAt: Date(timeIntervalSince1970: 1_700_000_000 + seconds),
            appVersion: "1.1.0",
            build: "2",
            osVersion: "iOS 26.3",
            deviceModel: "iPhone17,1",
            signature: signature,
            message: "Something happened",
            payloadJSON: payload
        )
    }

    @Test("Reports survive on disk and come back oldest first")
    func persistsInOrder() async {
        let directory = tempDirectory()
        let store = DiagnosticsStore(directory: directory)
        await store.enqueue(report(at: 30))
        await store.enqueue(report(at: 10))
        await store.enqueue(report(at: 20))

        // A second store on the same directory is the next launch.
        let reopened = DiagnosticsStore(directory: directory)
        let pending = await reopened.pending()
        #expect(pending.map(\.occurredAt.timeIntervalSince1970) == [1_700_000_010, 1_700_000_020, 1_700_000_030])
    }

    @Test("Removing accepted ids clears only those")
    func removeAccepted() async {
        let store = DiagnosticsStore(directory: tempDirectory())
        let a = report(at: 1), b = report(at: 2)
        await store.enqueue(a)
        await store.enqueue(b)
        await store.remove(ids: [a.id])
        #expect(await store.pending().map(\.id) == [b.id])
    }

    @Test("The same non-fatal error is kept once per launch")
    func errorBudgetPerSignature() async {
        let store = DiagnosticsStore(directory: tempDirectory())
        #expect(await store.enqueue(report(.error, signature: "decoding /classes/")))
        #expect(!(await store.enqueue(report(.error, signature: "decoding /classes/"))))
        #expect(await store.enqueue(report(.error, signature: "decoding /rewards/")))
        // Crashes are never rationed — each one is a real event.
        #expect(await store.enqueue(report(.crash)))
        #expect(await store.enqueue(report(.crash)))
        #expect(await store.count() == 4)
    }

    @Test("Non-fatal errors stop at the per-launch ceiling")
    func errorBudgetPerLaunch() async {
        let store = DiagnosticsStore(directory: tempDirectory())
        for i in 0..<(DiagnosticsLimits.errorsPerLaunch + 5) {
            await store.enqueue(report(.error, signature: "decoding /path/\(i)"))
        }
        #expect(await store.count() == DiagnosticsLimits.errorsPerLaunch)
    }

    @Test("The queue keeps the newest when it overflows")
    func capacityDropsOldest() async {
        let store = DiagnosticsStore(directory: tempDirectory())
        for i in 0..<(DiagnosticsLimits.queueCapacity + 3) {
            await store.enqueue(report(.hang, at: TimeInterval(i)))
        }
        #expect(await store.count() == DiagnosticsLimits.queueCapacity)
        let oldest = await store.pending(limit: 1).first
        #expect(oldest?.occurredAt.timeIntervalSince1970 == 1_700_000_003)
    }

    @Test("A file that no longer decodes is discarded, not left to block the queue")
    func corruptFileIsDropped() async throws {
        let directory = tempDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: directory.appendingPathComponent("broken.json"))
        let store = DiagnosticsStore(directory: directory)
        await store.enqueue(report())
        #expect(await store.pending().count == 1)
        #expect(!FileManager.default.fileExists(atPath: directory.appendingPathComponent("broken.json").path))
    }

    @Test("Oversized payloads are dropped whole and long text is clipped")
    func limitsAreApplied() {
        let big = Data(repeating: 0x20, count: DiagnosticsLimits.payloadBytes + 1)
        let clipped = DiagnosticReport(
            kind: .error, appVersion: "1", build: "1", osVersion: "iOS", deviceModel: "x",
            signature: String(repeating: "s", count: 500),
            message: String(repeating: "m", count: 2000),
            payloadJSON: big
        )
        #expect(clipped.payloadJSON == nil)
        #expect(clipped.signature.count == DiagnosticsLimits.signatureLength)
        #expect(clipped.message.count == DiagnosticsLimits.messageLength)
    }

    @Test("Signatures strip ids so installs group together")
    func signatureNormalisation() {
        #expect(DiagnosticSignature.normalise("/classes/12/assignments/340/") == "/classes/:id/assignments/:id/")
        #expect(DiagnosticSignature.normalise("/vocabulary/words/?q=wary&limit=50") == "/vocabulary/words/")
        #expect(DiagnosticSignature.normalise("/events/3f2b8c1e-9d4a-4b7e-8f00-1234567890ab/") == "/events/:id/")
        #expect(DiagnosticSignature.decoding(path: "/classes/7/") == "decoding /classes/:id/")
    }

    @Test("The wire form carries the payload as JSON, not as base64")
    func wireObject() throws {
        let payload = try JSONSerialization.data(withJSONObject: ["callStackTree": ["x": 1]])
        let object = report(payload: payload).wireObject()
        #expect(object["kind"] as? String == "crash")
        #expect(object["occurred_at"] as? String == "2023-11-14T22:13:20Z")
        #expect((object["payload"] as? [String: Any])?["callStackTree"] != nil)
    }
}

@Suite struct APIClientAppOpsTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/1.1.0")
    let server = StubServer()

    private final class Events: @unchecked Sendable {
        private let lock = NSLock()
        private var _events: [APIClientEvent] = []
        private var _signOuts = 0
        func append(_ e: APIClientEvent) { lock.lock(); _events.append(e); lock.unlock() }
        func signOut() { lock.lock(); _signOuts += 1; lock.unlock() }
        var events: [APIClientEvent] { lock.lock(); defer { lock.unlock() }; return _events }
        var signOuts: Int { lock.lock(); defer { lock.unlock() }; return _signOuts }
    }

    private func makeClient(tokens: TokenPair? = TokenPair(access: "a1", refresh: "r1")) -> (APIClient, InMemoryTokenStorage, Events) {
        let storage = InMemoryTokenStorage(tokens)
        let events = Events()
        let client = APIClient(
            config: config,
            storage: storage,
            session: server.session(),
            onSignOut: { events.signOut() },
            onEvent: { events.append($0) }
        )
        return (client, storage, events)
    }

    @Test("A 426 is typed, carries the store link, and is announced")
    func upgradeRequired() async {
        server.handler = { _ in
            .json(["detail": "Please update.", "code": "update_required",
                   "minimum_version": "1.2.0", "update_url": "https://apps.apple.com/app/id1"], status: 426)
        }
        let (client, _, events) = makeClient()
        do {
            _ = try await client.send(.get("/users/me/"))
            Issue.record("expected upgradeRequired")
        } catch APIError.upgradeRequired(let detail, let minimum, let url) {
            #expect(detail == "Please update.")
            #expect(minimum == "1.2.0")
            #expect(url == "https://apps.apple.com/app/id1")
        } catch {
            Issue.record("unexpected \(error)")
        }
        #expect(events.events.count == 1)
    }

    @Test("A deploy-time 503 reads as 'wait', and is retryable")
    func unavailable() async {
        server.handler = { _ in StubResponse(status: 503, body: Data("<html>maintenance</html>".utf8)) }
        let (client, _, _) = makeClient()
        do {
            _ = try await client.send(.get("/classes/my-assignments/"))
            Issue.record("expected unavailable")
        } catch let error as APIError {
            guard case .unavailable(503) = error else { Issue.record("got \(error)"); return }
            #expect(error.isRetryable)
            #expect(error.errorDescription?.contains("updating") == true)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test("A refresh that meets a deploy keeps the student signed in")
    func refreshDuringDeployKeepsSession() async {
        // Access token expired → 401 → refresh → the server is mid-release and answers 502.
        // Before, any non-2xx refresh cleared the tokens and signed the student out.
        server.handler = { request in
            if request.url?.absoluteString.contains("/auth/refresh/") == true {
                return StubResponse(status: 502, body: Data("<html>Bad gateway</html>".utf8))
            }
            return .json(["detail": "Token expired"], status: 401)
        }
        let (client, storage, events) = makeClient()
        do {
            _ = try await client.send(.get("/users/me/"))
            Issue.record("expected a failure")
        } catch {
            // expected
        }
        #expect(storage.load() != nil)
        #expect(events.signOuts == 0)
    }

    @Test("A refresh the server rejects still ends the session")
    func refreshRejectedSignsOut() async {
        server.handler = { request in
            if request.url?.absoluteString.contains("/auth/refresh/") == true {
                return .json(["detail": "Token is blacklisted"], status: 401)
            }
            return .json(["detail": "Token expired"], status: 401)
        }
        let (client, storage, events) = makeClient()
        _ = try? await client.send(.get("/users/me/"))
        #expect(storage.load() == nil)
        #expect(events.signOuts == 1)
    }

    @Test("A body that does not match its model is announced with its endpoint")
    func decodingFailureIsAnnounced() async {
        server.handler = { _ in .json(["unexpected": true]) }
        let (client, _, events) = makeClient()
        _ = try? await client.send(.get("/users/me/"), as: CurrentUser.self)
        guard case .decodingFailed(let path, _)? = events.events.first else {
            Issue.record("expected decodingFailed, got \(events.events)")
            return
        }
        #expect(path == "/users/me/")
    }

    @Test("Best-effort auth attaches a token but never refreshes or signs out")
    func bestEffortAuth() async throws {
        server.handler = { _ in .json(["detail": "bad token"], status: 401) }
        let (client, storage, events) = makeClient()
        let mobile = MobileAPI(client: client)
        _ = try? await mobile.config(version: "1.1.0", build: "2")

        let request = try #require(server.requests.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer a1")
        #expect(server.requests.count == 1)
        #expect(storage.load() != nil)
        #expect(events.signOuts == 0)
    }

    @Test("Diagnostics upload sends the batch and returns what was accepted")
    func uploadDiagnostics() async throws {
        server.handler = { request in
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            let ids = ((body?["reports"] as? [[String: Any]]) ?? []).compactMap { $0["id"] as? String }
            return .json(["accepted": ids], status: 202)
        }
        let (client, _, _) = makeClient(tokens: nil)
        let reports = (0..<2).map { i in
            DiagnosticReport(kind: .crash, appVersion: "1.1.0", build: "2", osVersion: "iOS 26.3",
                             deviceModel: "iPhone17,1", signature: "sig\(i)", message: "m")
        }
        let accepted = try await MobileAPI(client: client).uploadDiagnostics(installId: "install-1", reports: reports)
        #expect(accepted == reports.map(\.id))

        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/mobile/diagnostics/")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(body["install_id"] as? String == "install-1")
        #expect(body["platform"] as? String == "ios")
    }
}

@Suite struct MetricDiagnosticsTests {

    private let environment = MetricDiagnostics.Environment(
        appVersion: "1.1.0", build: "2", osVersion: "iOS 26.3", deviceModel: "iPhone17,1"
    )

    /// The shape `MXCrashDiagnostic.jsonRepresentation()` produces — Apple's own sample,
    /// with a UIKit frame on top of one of ours.
    private let crashJSON = Data("""
    {
      "callStackTree": {
        "callStackPerThread": true,
        "callStacks": [
          {"threadAttributed": false, "callStackRootFrames": [{"binaryName": "libsystem_kernel.dylib", "offsetIntoBinaryTextSegment": 9}]},
          {"threadAttributed": true, "callStackRootFrames": [
            {"binaryName": "UIKitCore", "offsetIntoBinaryTextSegment": 4096, "address": 1, "sampleCount": 1,
             "subFrames": [{"binaryName": "MasterSAT", "offsetIntoBinaryTextSegment": 123456, "address": 2, "sampleCount": 1}]}
          ]}
        ]
      },
      "diagnosticMetaData": {
        "appBuildVersion": "1", "appVersion": "1.0.0", "osVersion": "iPhone OS 18.1 (22B83)",
        "deviceType": "iPhone15,2", "exceptionType": 1, "signal": 11, "exceptionCode": 0,
        "terminationReason": "Namespace SIGNAL, Code 0xb"
      }
    }
    """.utf8)

    @Test("A crash is signed by its cause and the first frame of our own code")
    func crashSignature() throws {
        let report = try #require(MetricDiagnostics.report(
            kind: .crash, json: crashJSON, occurredAt: Date(timeIntervalSince1970: 0), environment: environment
        ))
        #expect(report.signature == "crash · EXC_BAD_ACCESS/SIGSEGV · MasterSAT+123456")
        #expect(report.message == "Namespace SIGNAL, Code 0xb")
        // The build that CRASHED, not the build now reporting it.
        #expect(report.appVersion == "1.0.0")
        #expect(report.build == "1")
        #expect(report.deviceModel == "iPhone15,2")
        #expect(report.payloadJSON == crashJSON)
    }

    @Test("An Objective-C exception is named by the exception")
    func objcException() throws {
        let json = Data("""
        {"diagnosticMetaData": {"objectiveCexceptionReason": {"exceptionName": "NSInvalidArgumentException",
          "composedMessage": "-[__NSCFNumber length]: unrecognized selector"}, "exceptionType": 10, "signal": 6},
         "callStackTree": {"callStacks": []}}
        """.utf8)
        let report = try #require(MetricDiagnostics.report(kind: .crash, json: json, occurredAt: Date(), environment: environment))
        #expect(report.signature == "crash · NSInvalidArgumentException")
        #expect(report.message.contains("unrecognized selector"))
        // Missing metadata falls back to the running build's.
        #expect(report.appVersion == "1.1.0")
    }

    @Test("A hang carries its duration and a frame")
    func hang() throws {
        let json = Data("""
        {"diagnosticMetaData": {"hangDuration": "4 sec"},
         "callStackTree": {"callStacks": [{"threadAttributed": true, "callStackRootFrames": [{"binaryName": "MasterSAT", "offsetIntoBinaryTextSegment": 77}]}]}}
        """.utf8)
        let report = try #require(MetricDiagnostics.report(kind: .hang, json: json, occurredAt: Date(), environment: environment))
        #expect(report.signature == "hang · hang 4 sec · MasterSAT+77")
    }

    @Test("Garbage is not a report")
    func notJSON() {
        #expect(MetricDiagnostics.report(kind: .crash, json: Data("[]".utf8), occurredAt: Date(), environment: environment) == nil)
        #expect(MetricDiagnostics.report(kind: .crash, json: Data("nope".utf8), occurredAt: Date(), environment: environment) == nil)
    }
}

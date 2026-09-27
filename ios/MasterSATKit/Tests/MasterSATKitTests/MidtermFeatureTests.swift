import Foundation
import Testing
@testable import MasterSATKit

@Suite struct MidtermFeatureTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func client() -> APIClient {
        APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        )
    }

    private func row(_ extra: [String: Any]) throws -> MidtermListing {
        var json: [String: Any] = [
            "midterm_id": 1, "title": "Midterm 2", "subject": "MATH", "scoring_scale": "SCALE_800",
            "score_ceiling": 800, "duration_minutes": 65, "question_count": 44, "flavor": "CLASSROOM",
            "attempt_id": NSNull(), "state": "NOT_STARTED", "submitted": false, "resit_open": false,
            "is_open": false, "is_before_start": false, "awaiting_code": false,
            "available_at": NSNull(), "deadline": NSNull(), "results_visible": false,
            "score": NSNull(), "certificate": NSNull(),
        ]
        for (key, value) in extra { json[key] = value }
        return try JSONCoding.decoder.decode(MidtermListing.self, from: JSONSerialization.data(withJSONObject: json))
    }

    // MARK: - Buckets

    @Test("A granted re-sit goes back to Available, whatever the schedule says")
    func resitIsAvailable() throws {
        let resit = try row([
            "attempt_id": 9, "state": "COMPLETED", "submitted": true, "resit_open": true,
            "results_visible": true, "score": 610,
        ])
        #expect(resit.resitOpen)
        #expect(resit.bucket == .available)
        #expect(resit.badge == "Re-sit available")
        // Never "past" — that would show only the old mark it is about to replace.
        let closedResit = try row(["submitted": true, "resit_open": true, "is_open": false])
        #expect(closedResit.bucket == .available)
    }

    @Test("Rows land where the site puts them")
    func buckets() throws {
        #expect(try row(["is_open": true]).bucket == .available)
        #expect(try row(["is_open": true]).badge == "Available")
        // A begun sitting stays resumable even after the deadline.
        let begun = try row(["attempt_id": 3, "state": "ACTIVE", "is_open": false])
        #expect(begun.bucket == .available)
        #expect(begun.badge == "In progress")
        #expect(try row(["is_before_start": true]).bucket == .scheduled)
        #expect(try row(["is_before_start": true]).badge == "Scheduled")
        let waiting = try row(["awaiting_code": true])
        #expect(waiting.bucket == .scheduled)
        #expect(waiting.badge == "Not started")
        // The window closed with no sitting: "Closed", never "Missed".
        let closed = try row([:])
        #expect(closed.bucket == .closed)
        #expect(closed.badge == "Closed")
        #expect(MidtermBucket.closed.title == "Closed")
        let done = try row(["attempt_id": 4, "state": "COMPLETED", "submitted": true])
        #expect(done.bucket == .past)
        #expect(done.badge == "Completed")
    }

    @Test("A finished row carries the scale it was sat on, and its score only once released")
    func ownScaleAndRelease() throws {
        let sealed = try row([
            "attempt_id": 4, "state": "COMPLETED", "submitted": true,
            "scoring_scale": "SCALE_100", "score_ceiling": 100, "results_visible": false, "score": NSNull(),
        ])
        #expect(sealed.scoringScale == "SCALE_100")
        #expect(sealed.scoreCeiling == 100)
        #expect(sealed.releasedScore == nil)
        let released = try row(["submitted": true, "results_visible": true, "score": 88, "score_ceiling": 100])
        #expect(released.releasedScore == 88)
    }

    @Test("The meta line and the countdown read as the site writes them")
    func wording() throws {
        #expect(try row([:]).metaLine == "1h 5m · 44 questions · Mathematics")
        #expect(try row(["subject": "READING_WRITING", "duration_minutes": 45]).metaLine == "45m · 44 questions · Reading & Writing")
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(MidtermWording.startsIn(now.addingTimeInterval(2 * 86_400 + 4 * 3600 + 600), now: now) == "2d 4h 10m")
        #expect(MidtermWording.startsIn(now.addingTimeInterval(3 * 3600 + 5 * 60 + 9), now: now) == "3h 5m 9s")
        #expect(MidtermWording.startsIn(now.addingTimeInterval(252), now: now) == "4m 12s")
        #expect(MidtermWording.startsIn(now.addingTimeInterval(-1), now: now) == nil)
    }

    // MARK: - Error report

    @Test("The report lists every topic the paper tested, and speaks of topics on a junior paper")
    func coveredAndTopicNoun() throws {
        let data = Data(#"""
        {"attempt_id": 7, "student_name": "Aziza", "date": "21 July 2026",
         "midterm": {"id": 1, "title": "Junior Math 2", "subject": "MATH", "subject_label": "Mathematics",
                     "scoring_scale": "SCALE_100", "score_ceiling": 100, "level": "junior", "midterm_type": "MIDTERM"},
         "score": 80, "correct_count": 16, "total_count": 20, "pass_mark": 60, "passed": true, "is_graded": true,
         "unclassified_total": 0, "unclassified_wrong": 0,
         "skills": [{"skill_id": 3, "skill": "Fractions", "domain": "Number", "total": 5, "wrong": 4}],
         "covered": [{"skill_id": 2, "skill": "Integers", "domain": "Number", "total": 15, "wrong": 0},
                     {"skill_id": 3, "skill": "Fractions", "domain": "Number", "total": 5, "wrong": 4}],
         "topic_noun": "topic"}
        """#.utf8)

        let report = try JSONCoding.decoder.decode(MidtermErrorReport.self, from: data)

        #expect(report.covered.map(\.skill) == ["Integers", "Fractions"])
        #expect(report.covered.first?.correct == 15)
        #expect(report.noun == "topic")
        #expect(report.nounPluralTitle == "Topics")
        #expect(report.accuracyPercent == 80)
        #expect(report.midterm.scoreCeiling == 100)
        #expect(report.passMark == 60)
    }

    @Test("An older report with no coverage still decodes, and speaks of skills")
    func olderReport() throws {
        let data = Data(#"{"midterm": {"id": 1, "title": "M"}, "correct_count": 3, "total_count": 4}"#.utf8)
        let report = try JSONCoding.decoder.decode(MidtermErrorReport.self, from: data)
        #expect(report.covered.isEmpty)
        #expect(report.noun == "skill")
        #expect(report.accuracyPercent == 75)
    }

    @Test("A sealed report and a report with no breakdown are told apart")
    func reportFailures() async throws {
        let results = ResultsAPI(client: client())

        server.handler = { _ in .json(["detail": "Your teacher has not published these results yet.", "released": false], status: 403) }
        do {
            _ = try await results.midtermErrorReport(attemptId: 7)
            Issue.record("a sealed report must not decode")
        } catch {
            #expect(MidtermReportUnavailable(error) == .sealed(message: "Your teacher has not published these results yet."))
        }

        server.handler = { _ in
            .json(["detail": "A skill breakdown is not available for this attempt.", "reason": "not_analysed"], status: 409)
        }
        do {
            _ = try await results.midtermErrorReport(attemptId: 7)
            Issue.record("a report with no breakdown must not decode")
        } catch {
            #expect(MidtermReportUnavailable(error) == .notAnalysed)
        }
    }

    // MARK: - Certificates

    @Test("A download_url is read relative to /api, whatever form it arrives in")
    func certificatePaths() {
        #expect(CertificatePath.apiPath(for: "/classes/certificates/midterm/AB12/download/") == "/classes/certificates/midterm/AB12/download/")
        #expect(CertificatePath.apiPath(for: "/api/classes/certificates/midterm/AB12/download/") == "/classes/certificates/midterm/AB12/download/")
        // The host is dropped: the token only ever goes to the app's own server.
        #expect(CertificatePath.apiPath(for: "https://evil.example/api/classes/certificates/midterm/AB12/download/") == "/classes/certificates/midterm/AB12/download/")
        #expect(CertificatePath.apiPath(for: "classes/certificates/midterm/AB12/download/") == "/classes/certificates/midterm/AB12/download/")
        #expect(CertificatePath.endpoint(for: "/classes/x/?v=2")?.query.first?.value == "2")
        #expect(CertificatePath.apiPath(for: "") == nil)
        #expect(CertificatePath.apiPath(for: "/api/") == nil)
    }

    @Test("The certificate is fetched from our own server, with the student's token")
    func certificateFetch() async throws {
        let pdf = Data("%PDF-1.7\nhello".utf8)
        server.handler = { _ in StubResponse(status: 200, body: pdf, headers: ["Content-Type": "application/pdf"]) }

        let data = try await CertificateAPI(client: client()).pdf(downloadURL: "/classes/certificates/midterm/AB12/download/")

        #expect(data == pdf)
        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/classes/certificates/midterm/AB12/download/")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer A")
    }

    @Test("A page that is not a PDF is refused rather than shown as a blank document")
    func certificateNotPDF() async throws {
        server.handler = { _ in StubResponse(status: 200, body: Data("<html>sign in</html>".utf8)) }
        await #expect(throws: APIError.self) {
            _ = try await CertificateAPI(client: client()).midtermCertificate(code: "AB12")
        }
    }

    @Test("A PDF that could not be produced arrives as 'unavailable', not as a broken file")
    func certificateUnavailable() async throws {
        server.handler = { _ in .json(["detail": "The PDF couldn't be produced right now. Your result is safe."], status: 503) }
        do {
            _ = try await CertificateAPI(client: client()).pastPaperCertificate(attemptId: 5)
            Issue.record("a 503 must throw")
        } catch APIError.unavailable(let status) {
            #expect(status == 503)
        }
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/pastpapers/attempts/5/certificate/pdf/")
    }

    @Test("A share-sheet name keeps the title and nothing a file system dislikes")
    func fileNames() {
        #expect(CertificatePath.fileName("Midterm 2: Math/Algebra") == "Midterm 2 Math Algebra.pdf")
        #expect(CertificatePath.fileName("") == "Certificate.pdf")
        #expect(CertificatePath.fileName("report.PDF") == "report.PDF")
    }
}

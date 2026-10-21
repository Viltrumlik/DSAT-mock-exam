import Foundation
import Testing
@testable import MasterSATKit

@Suite struct UploadProgressTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func form() -> MultipartForm {
        var form = MultipartForm(boundary: "b0undary")
        form.add(file: MultipartForm.File(filename: "page \"1\".jpg", mimeType: "image/jpeg", data: Data(repeating: 0xAB, count: 300), token: "t1"))
        form.add(file: MultipartForm.File(filename: "notes.pdf", mimeType: "application/pdf", data: Data([1, 2, 3]), token: "t2"))
        form.add("file_tokens", "[\"t1\",\"t2\"]")
        form.add("expected_revision", 3)
        return form
    }

    @Test("Each file's range slices exactly its own bytes back out of the body")
    func rangesMatchTheBody() {
        let form = form()
        let body = form.encoded()
        let ranges = form.fileRanges()
        #expect(ranges.count == 2)
        #expect(body.subdata(in: ranges[0]) == form.files[0].data)
        #expect(body.subdata(in: ranges[1]) == form.files[1].data)
        #expect(ranges[0].upperBound < ranges[1].lowerBound, "files go out in order, fields first")
        #expect(ranges[1].upperBound < body.count, "the closing boundary comes after the last file")
    }

    @Test("Per file: nothing of it sent, part of it, all of it — in order")
    func perFile() {
        let ranges = [100..<200, 250..<450]
        #expect(UploadProgress.perFile(sent: 50, ranges: ranges) == [0, 0])
        #expect(UploadProgress.perFile(sent: 150, ranges: ranges) == [0.5, 0])
        #expect(UploadProgress.perFile(sent: 260, ranges: ranges) == [1, 0.05])
        #expect(UploadProgress.perFile(sent: 10_000, ranges: ranges) == [1, 1])
        #expect(UploadProgress.perFile(sent: 5, ranges: [10..<10]) == [0], "an empty file is done once the body passes it")
        #expect(UploadProgress.perFile(sent: 10, ranges: [10..<10]) == [1])
    }

    @Test("A hand-in that reports progress is the same multipart hand-in")
    func handInWithProgress() async throws {
        server.handler = { _ in .json(["id": 5, "revision": 4, "files": []]) }
        let api = StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
        let file = MultipartForm.File(filename: "page1.jpg", mimeType: "image/jpeg", data: Data([0xFF, 0xD8]), token: "tok-1")

        let submission = try await api.submitHomework(
            classroomId: 2, assignmentId: 7, files: [file], expectedRevision: 3,
            onFileProgress: { _ in }
        )

        #expect(submission.revision == 4)
        let body = String(decoding: try #require(server.requests.first?.httpBody), as: UTF8.self)
        #expect(body.contains("filename=\"page1.jpg\""))
        #expect(body.contains("tok-1"))
    }

    @Test("The count reported never runs backwards, even when a retry sends the body from byte zero")
    func countNeverRunsBackwards() {
        let seen = SentLog()
        let progress = BodyProgress { seen.add($0) }
        let task = URLSession.shared.dataTask(with: URL(string: "https://mastersat.uz")!)

        // First send reaches 250 and is rejected; the retry starts again at 0.
        for total: Int64 in [100, 250, 0, 80, 250, 251, 400] {
            progress.urlSession(.shared, task: task, didSendBodyData: 0, totalBytesSent: total, totalBytesExpectedToSend: 400)
        }

        #expect(seen.values == [100, 250, 251, 400], "silent until the retry passes the most already shown")
    }

    @Test("A progress-reporting hand-in still refreshes an expired token and retries once")
    func progressSurvivesTheRefreshRetry() async throws {
        server.handler = { request in
            if request.url?.absoluteString.contains("/auth/refresh/") == true {
                return .json(["access": "access-2", "refresh": "refresh-2"])
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1" {
                return .json(["detail": "Given token not valid"], status: 401)
            }
            return .json(["id": 5, "revision": 4, "files": []])
        }
        let storage = InMemoryTokenStorage(TokenPair(access: "access-1", refresh: "refresh-1"))
        let client = APIClient(config: config, storage: storage, session: server.session())
        let endpoint = Endpoint.upload("/classes/2/assignments/7/submit/", form: form())

        let submission = try await client.send(endpoint, as: Submission.self) { _ in }

        #expect(submission.revision == 4)
        #expect(storage.load()?.access == "access-2")
        #expect(server.requests.count == 3, "original, refresh, retry")
    }
}

/// The byte counts a progress closure was told, in order — it is called off the test's thread.
private final class SentLog: @unchecked Sendable {
    private let lock = NSLock()
    private var log: [Int64] = []

    func add(_ value: Int64) {
        lock.lock(); defer { lock.unlock() }
        log.append(value)
    }

    var values: [Int64] {
        lock.lock(); defer { lock.unlock() }
        return log
    }
}

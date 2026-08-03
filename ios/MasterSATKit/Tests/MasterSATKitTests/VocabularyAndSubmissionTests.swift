import Foundation
import Testing
@testable import MasterSATKit

@Suite struct MultipartFormTests {

    private func text(_ data: Data) -> String { String(decoding: data, as: UTF8.self) }

    @Test("A file part carries its filename and type")
    func filePartIsWellFormed() {
        var form = MultipartForm(boundary: "B")
        form.add(file: .init(filename: "page1.jpg", mimeType: "image/jpeg", data: Data("xy".utf8), token: "t1"))

        let body = text(form.encoded())

        #expect(body.contains("--B\r\n"))
        #expect(body.contains("Content-Disposition: form-data; name=\"files\"; filename=\"page1.jpg\""))
        #expect(body.contains("Content-Type: image/jpeg"))
        #expect(body.hasSuffix("--B--\r\n"))
    }

    @Test("Quotes in a filename cannot break out of the header")
    func filenameQuotesAreStripped() {
        // A quote would end the header value early and corrupt every part after it.
        var form = MultipartForm(boundary: "B")
        form.add(file: .init(filename: "my\"work\".pdf", mimeType: "application/pdf", data: Data(), token: "t"))

        let body = text(form.encoded())

        #expect(body.contains("filename=\"mywork.pdf\""))
    }

    @Test("Binary content survives encoding untouched")
    func binaryIsPreserved() {
        // A JPEG is not UTF-8; building the body as a string would mangle it.
        let bytes = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
        var form = MultipartForm(boundary: "B")
        form.add(file: .init(filename: "p.jpg", mimeType: "image/jpeg", data: bytes, token: "t"))

        let encoded = form.encoded()

        #expect(encoded.range(of: bytes) != nil)
    }

    @Test("Each file gets its own token by default")
    func tokensAreUniquePerFile() {
        // The token is the server's dedupe key; two files sharing one would make the
        // second look like a retry of the first and vanish.
        let a = MultipartForm.File(filename: "a.jpg", mimeType: "image/jpeg", data: Data())
        let b = MultipartForm.File(filename: "b.jpg", mimeType: "image/jpeg", data: Data())
        #expect(a.token != b.token)
    }
}

@Suite(.serialized) struct VocabularyAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func makeAPI() -> StudentAPI {
        StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
    }

    @Test("Vocabulary homework decodes with its sets and completion")
    func vocabularyHomeworkDecodes() async throws {
        server.handler = { _ in
            .json([[
                "assignment_id": 4,
                "assignment_title": "Unit 3 words",
                "classroom_id": 2,
                "classroom_name": "Math ODD",
                "due_at": "2026-08-10T18:00:00Z",
                "sets": [
                    ["id": 11, "title": "Set A", "section_title": "Unit 3", "word_count": 25, "completed": true],
                    ["id": 12, "title": "Set B", "section_title": "Unit 3", "word_count": 25, "completed": false],
                ],
            ]])
        }

        let groups = try await makeAPI().vocabularyHomework()

        let group = try #require(groups.first)
        #expect(group.sets.count == 2)
        #expect(group.isComplete == false, "one set still open")
    }

    @Test("A group with every set done reads as complete")
    func fullyDoneGroupIsComplete() async throws {
        server.handler = { _ in
            .json([[
                "assignment_id": 4, "assignment_title": "Done",
                "sets": [["id": 11, "title": "A", "word_count": 5, "completed": true]],
            ]])
        }

        let group = try #require(try await makeAPI().vocabularyHomework().first)

        #expect(group.isComplete)
    }

    @Test("An empty group is not complete")
    func emptyGroupIsNotComplete() async throws {
        // `allSatisfy` is vacuously true on an empty list, which would paint a set-less
        // assignment as finished.
        server.handler = { _ in .json([["assignment_id": 9, "assignment_title": "Empty", "sets": []]]) }

        let group = try #require(try await makeAPI().vocabularyHomework().first)

        #expect(group.isComplete == false)
    }

    @Test("A set decodes its words and per-word progress")
    func setDetailDecodes() async throws {
        server.handler = { _ in
            .json([
                "id": 11, "title": "Set A", "is_custom": false,
                "section": ["id": 3, "title": "Unit 3"],
                "word_count": 2, "completed": false,
                "words": [
                    ["id": 100, "word": "abate", "definition": "to lessen",
                     "part_of_speech": "verb", "example": "The storm abated.",
                     "synonyms": ["subside", "diminish"], "status": "learning"],
                    ["id": 101, "word": "cogent", "definition": "convincing", "status": "new"],
                ],
            ])
        }

        let set = try await makeAPI().vocabularySet(id: 11)

        #expect(set.words.count == 2)
        #expect(set.words[0].status == .learning)
        #expect(set.words[0].synonyms == ["subside", "diminish"])
        #expect(set.words[1].status == .new)
    }

    @Test("An unfamiliar progress status falls back to new")
    func unknownStatusFallsBack() async throws {
        // A status the app has never heard of must not break the whole set.
        server.handler = { _ in
            .json(["id": 11, "title": "S", "words": [["id": 1, "word": "w", "definition": "d", "status": "banana"]]])
        }

        let set = try await makeAPI().vocabularySet(id: 11)

        #expect(set.words.first?.status == .new)
    }

    @Test("Starting a session names the set and the mode")
    func startSessionNamesSetAndMode() async throws {
        server.handler = { _ in .json(["id": 77, "set_id": 11, "mode": "flashcard"], status: 201) }

        let session = try await makeAPI().startVocabularySession(setId: 11, mode: .flashcard)

        #expect(session.id == 77)
        #expect(session.mode == .flashcard)
        let body = try #require(server.requests.first?.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["set_id"] as? Int == 11)
        #expect(json["mode"] as? String == "flashcard")
    }

    @Test("A partial flush banks answers without completing the set")
    func partialFlushIsMarked() async throws {
        // Walking away after 20 of 25 cards should still count for those 20.
        server.handler = { _ in
            .json(["id": 77, "mode": "flashcard", "correct_count": 18, "total_count": 20,
                   "accuracy": 0.9, "set_completed": false])
        }

        let summary = try await makeAPI().finishVocabularySession(
            id: 77,
            results: [VocabResult(wordId: 100, correct: true)],
            durationMs: 42_000,
            isPartial: true
        )

        #expect(summary.setCompleted == false)
        let body = try #require(server.requests.first?.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["partial"] as? Bool == true)
        #expect(json["duration_ms"] as? Int == 42_000)
        let results = try #require(json["results"] as? [[String: Any]])
        #expect(results.first?["word_id"] as? Int == 100)
        #expect(results.first?["correct"] as? Bool == true)
    }
}

@Suite(.serialized) struct HomeworkSubmissionTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func makeAPI() -> StudentAPI {
        StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
    }

    @Test("A submission decodes its files and its revision")
    func submissionDecodes() async throws {
        server.handler = { _ in
            .json([
                "id": 5, "status": "submitted", "revision": 3,
                "submitted_at": "2026-08-03T10:00:00Z",
                "workflow_status": "submitted",
                "files": [["id": 9, "url": "https://cdn/x.jpg", "file_name": "page1.jpg", "file_type": "image/jpeg"]],
            ])
        }

        let submission = try await makeAPI().mySubmission(classroomId: 2, assignmentId: 7)

        #expect(submission.revision == 3)
        #expect(submission.hasBeenSubmitted)
        #expect(submission.files.first?.displayName == "page1.jpg")
        #expect(submission.files.first?.fileType == "image/jpeg")
    }

    @Test("A returned submission is recognised")
    func returnedSubmissionIsRecognised() async throws {
        // "Ready to revise" is a different screen from "handed in".
        server.handler = { _ in
            .json(["id": 5, "status": "returned", "revision": 4,
                   "return_note": "Please redo question 3.", "returned_at": "2026-08-03T11:00:00Z"])
        }

        let submission = try await makeAPI().mySubmission(classroomId: 2, assignmentId: 7)

        #expect(submission.isReturned)
        #expect(submission.returnNote == "Please redo question 3.")
    }

    @Test("Submitting sends the files, their tokens and the revision it read")
    func submitSendsTokensAndRevision() async throws {
        server.handler = { _ in .json(["id": 5, "revision": 4, "files": []]) }
        let file = MultipartForm.File(
            filename: "page1.jpg", mimeType: "image/jpeg",
            data: Data([0xFF, 0xD8]), token: "tok-1"
        )

        _ = try await makeAPI().submitHomework(
            classroomId: 2, assignmentId: 7, files: [file], expectedRevision: 3
        )

        let request = try #require(server.requests.first)
        let contentType = try #require(request.value(forHTTPHeaderField: "Content-Type"))
        #expect(contentType.hasPrefix("multipart/form-data; boundary="))

        let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
        #expect(body.contains("filename=\"page1.jpg\""))
        // The dedupe key for a retry after a timeout.
        #expect(body.contains("tok-1"))
        // Optimistic locking: without this a stale phone could overwrite a teacher's return.
        #expect(body.contains("name=\"expected_revision\""))
        #expect(body.contains("\r\n\r\n3\r\n"))
    }

    @Test("Removing files names them and needs no upload")
    func removeFilesNamesThem() async throws {
        server.handler = { _ in .json(["id": 5, "revision": 5, "files": []]) }

        _ = try await makeAPI().submitHomework(
            classroomId: 2, assignmentId: 7, removeFileIds: [9, 10], expectedRevision: 4
        )

        let body = String(decoding: try #require(server.requests.first?.httpBody), as: UTF8.self)
        #expect(body.contains("name=\"remove_file_ids\""))
        #expect(body.contains("9,10"))
        // No file parts at all — this is a delete, not an upload.
        #expect(body.contains("filename=") == false)
    }

    @Test("Saving without handing in is possible")
    func canSaveWithoutSubmitting() async throws {
        // Attaching a photo now and handing in later is a normal thing to want.
        server.handler = { _ in .json(["id": 5, "revision": 4, "files": []]) }

        _ = try await makeAPI().submitHomework(
            classroomId: 2, assignmentId: 7, expectedRevision: 3, markAsSubmitted: false
        )

        let body = String(decoding: try #require(server.requests.first?.httpBody), as: UTF8.self)
        #expect(body.contains("name=\"submit\""))
        #expect(body.contains("\r\n\r\nfalse\r\n"))
    }
}

@Suite(.serialized) @MainActor
struct VocabStudyRunnerTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func makeRunner(mode: VocabStudyMode = .flashcard, wordCount: Int = 3) -> VocabStudyRunner {
        let api = StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
        let words = (0..<wordCount).map {
            VocabWord(id: 100 + $0, word: "w\($0)", definition: "d\($0)")
        }
        return VocabStudyRunner(mode: mode, words: words, setId: 11, api: api)
    }

    private func sessionThenSummary() -> @Sendable (URLRequest) -> StubResponse {
        { request in
            request.url?.absoluteString.contains("finish") == true
                ? .json(["id": 77, "mode": "flashcard", "correct_count": 2, "total_count": 3,
                         "accuracy": 0.66, "set_completed": true])
                : .json(["id": 77, "set_id": 11, "mode": "flashcard"], status: 201)
        }
    }

    @Test("Walking away mid-run banks what was answered without completing the set")
    func partialFlushBanksWork() async {
        // 2 of 3 answered. Those two must count; the set must not.
        server.handler = { request in
            request.url?.absoluteString.contains("finish") == true
                ? .json(["id": 77, "correct_count": 1, "total_count": 2, "set_completed": false])
                : .json(["id": 77, "set_id": 11, "mode": "flashcard"], status: 201)
        }
        let runner = makeRunner()
        await runner.begin()
        runner.answer(correct: true)
        runner.answer(correct: false)

        await runner.flush(isPartial: true)

        #expect(runner.summary?.setCompleted == false)
        #expect(runner.isFinished == false)
        #expect(runner.pending.isEmpty, "banked answers must not be sent twice")
    }

    @Test("A finished run completes the set")
    func finishedRunCompletesTheSet() async {
        server.handler = sessionThenSummary()
        let runner = makeRunner()
        await runner.begin()
        runner.answer(correct: true)
        runner.answer(correct: true)
        runner.answer(correct: false)

        await runner.flush(isPartial: false)

        #expect(runner.isFinished)
        #expect(runner.summary?.setCompleted == true)
    }

    @Test("A partial flush with nothing new stays quiet")
    func emptyPartialFlushSendsNothing() async {
        // Backgrounding twice with no answers in between must not spam the server.
        server.handler = { _ in .json(["id": 77, "set_id": 11, "mode": "flashcard"], status: 201) }
        let runner = makeRunner()
        await runner.begin()
        let afterBegin = server.requests.count

        await runner.flush(isPartial: true)

        #expect(server.requests.count == afterBegin)
    }

    @Test("A failed flush keeps the answers for the next attempt")
    func failedFlushKeepsAnswers() async {
        server.handler = { request in
            request.url?.absoluteString.contains("finish") == true
                ? .json(["detail": "boom"], status: 500)
                : .json(["id": 77, "set_id": 11, "mode": "flashcard"], status: 201)
        }
        let runner = makeRunner()
        await runner.begin()
        runner.answer(correct: true)

        await runner.flush(isPartial: true)

        // Dropping them here is how a student's work disappears on a flaky connection.
        #expect(runner.pending.count == 1)
        #expect(runner.lastError != nil)
    }

    @Test("A missed flashcard comes back, and both answers are recorded")
    func missedCardIsRequeued() async {
        server.handler = sessionThenSummary()
        let runner = makeRunner(wordCount: 2)
        await runner.begin()

        runner.requeueCurrentWord()      // got it wrong — see it again later
        runner.answer(correct: false)
        runner.answer(correct: true)
        runner.answer(correct: true)     // the requeued one, second time round

        #expect(runner.words.count == 3)
        #expect(runner.isComplete)
        // Getting it wrong then right is genuinely different from right first time.
        #expect(runner.pending.count == 3)
        #expect(runner.correctCount == 2)
    }

    @Test("Studying still works when the session could not be opened")
    func studyingSurvivesAFailedBegin() async {
        // Offline: the student can still revise, they just are not credited for it.
        server.handler = { _ in .json(["detail": "offline"], status: 503) }
        let runner = makeRunner()

        await runner.begin()
        runner.answer(correct: true)

        #expect(runner.lastError != nil)
        #expect(runner.answeredCount == 1)
        #expect(runner.currentWord?.id == 101)
    }
}

@Suite struct ImageKindTests {

    @Test("A PNG is recognised as a PNG")
    func pngIsDetected() {
        // A screenshot is a PNG. Sending it as "photo.jpg" gives the server a name that
        // disagrees with the bytes — and the server validates by extension.
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        let kind = MultipartForm.imageKind(for: png)
        #expect(kind.extension == "png")
        #expect(kind.mimeType == "image/png")
    }

    @Test("A JPEG is recognised as a JPEG")
    func jpegIsDetected() {
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
        #expect(MultipartForm.imageKind(for: jpeg).extension == "jpg")
    }

    @Test("A HEIC photo is recognised")
    func heicIsDetected() {
        // What a recent iPhone actually produces. Called .jpg it uploads fine and then
        // will not open for the teacher.
        var heic = Data([0x00, 0x00, 0x00, 0x18])
        heic.append(Data("ftypheic".utf8))
        heic.append(Data(repeating: 0, count: 4))
        let kind = MultipartForm.imageKind(for: heic)
        #expect(kind.extension == "heic")
        #expect(kind.mimeType == "image/heic")
    }

    @Test("Unrecognised bytes fall back to JPEG rather than failing")
    func unknownFallsBackToJpeg() {
        // A camera roll item is almost always a JPEG; the server's own validation has the
        // final say either way, and refusing to upload would be worse than a wrong label.
        #expect(MultipartForm.imageKind(for: Data([0x01, 0x02, 0x03])).extension == "jpg")
    }

    @Test("Empty data does not crash the detector")
    func emptyDataIsSafe() {
        #expect(MultipartForm.imageKind(for: Data()).extension == "jpg")
    }
}

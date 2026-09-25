import Foundation
import Testing
@testable import MasterSATKit

/// A real-shaped `/api/classes/roadmap/` body: Math with an own level of Middle (its own-level
/// lessons hydrated, the other rungs bare outlines, Junior unpublished), and English with no
/// own level at all.
private func roadmapPayload() -> [String: Any] {
    [
        "tracks": [
            [
                "subject": "math", "subject_label": "Math",
                "own_level": "middle", "own_level_label": "Middle",
                "own_classroom_id": 34, "current_week": 6,
                "completed_lessons": 2, "total_lessons": 4, "completion_rate": 0.5,
                "next_level": "senior", "next_level_label": "Senior",
                "months_remaining": 3.5,
                "levels": [
                    [
                        "level": "foundation", "level_label": "Foundation", "is_own_level": false,
                        "journal_published": true, "lesson_count": 2, "duration_months": 1,
                        "lessons": [
                            ["lesson_number": 1, "title": "Numbers", "lesson_type": "HOMEWORK", "is_midterm": false],
                            ["lesson_number": 2, "title": "Midterm 2", "lesson_type": "MIDTERM", "is_midterm": true],
                        ],
                    ],
                    [
                        "level": "junior", "level_label": "Junior", "is_own_level": false,
                        "journal_published": false, "lesson_count": 0, "duration_months": 0, "lessons": [],
                    ],
                    [
                        "level": "middle", "level_label": "Middle", "is_own_level": true,
                        "journal_published": true, "lesson_count": 4, "duration_months": 2,
                        "lessons": [
                            [
                                "lesson_number": 1, "title": "Linear equations", "lesson_type": "HOMEWORK",
                                "is_midterm": false, "accessible": true, "state": "completed",
                                "assignment_id": 501, "scheduled_for": "2026-09-01T16:00:00+05:00",
                                "delivery_id": 9001, "has_roadmap": true, "roadmap_read": true,
                            ],
                            [
                                "lesson_number": 2, "title": "Systems", "lesson_type": "HOMEWORK",
                                "is_midterm": false, "accessible": true, "state": "completed",
                                "assignment_id": 502, "scheduled_for": NSNull(),
                                "delivery_id": 9002, "has_roadmap": false, "roadmap_read": false,
                            ],
                            [
                                "lesson_number": 3, "title": "Quadratics", "lesson_type": "HOMEWORK",
                                "is_midterm": false, "accessible": true, "state": "available",
                                "assignment_id": 503, "scheduled_for": "2026-09-08T16:00:00.123456+05:00",
                                "delivery_id": 9003, "has_roadmap": true, "roadmap_read": false,
                            ],
                            [
                                "lesson_number": 4, "title": "Midterm 4", "lesson_type": "MIDTERM",
                                "is_midterm": true, "accessible": true, "state": "available",
                                "assignment_id": NSNull(), "scheduled_for": NSNull(),
                                "delivery_id": 9004, "has_roadmap": false, "roadmap_read": false,
                            ],
                        ],
                    ],
                    [
                        "level": "senior", "level_label": "Senior", "is_own_level": false,
                        "journal_published": true, "lesson_count": 1, "duration_months": 2,
                        "lessons": [["lesson_number": 1, "title": "Advanced", "lesson_type": "HOMEWORK", "is_midterm": false]],
                    ],
                ],
            ],
            [
                "subject": "english", "subject_label": "English",
                "own_level": NSNull(), "own_level_label": NSNull(), "own_classroom_id": NSNull(),
                "current_week": NSNull(), "completed_lessons": 0, "total_lessons": 0,
                "completion_rate": NSNull(), "next_level": NSNull(), "next_level_label": NSNull(),
                "months_remaining": NSNull(),
                "levels": [
                    [
                        "level": "junior", "level_label": "Junior", "is_own_level": false,
                        "journal_published": true, "lesson_count": 1, "duration_months": 3,
                        "lessons": [["lesson_number": 1, "title": "Reading", "lesson_type": "HOMEWORK", "is_midterm": false]],
                    ],
                ],
            ],
        ],
        "months_to_sat": 3.5,
        "months_to_sat_basis": ["math"],
    ]
}

private func decode<T: Decodable>(_ type: T.Type, _ object: Any) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: JSONSerialization.data(withJSONObject: object))
}

@Suite struct RoadmapDecodingTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> RoadmapAPI {
        RoadmapAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("The ladder decodes: the own level hydrated, every other rung a bare outline")
    func ladderDecodes() async throws {
        server.handler = { _ in .json(roadmapPayload()) }
        let roadmap = try await api().roadmap()

        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/roadmap/")
        #expect(roadmap.tracks.map(\.subject) == ["math", "english"])
        #expect(roadmap.monthsToSat == 3.5)
        #expect(roadmap.monthsToSatBasis == ["math"])

        let math = try #require(roadmap.tracks.first)
        #expect(math.ownLevel == "middle")
        #expect(math.ownClassroomId == 34)
        #expect(math.currentWeek == 6)
        #expect(math.completionRate == 0.5)
        #expect(math.nextLevelLabel == "Senior")
        #expect(math.ownLevelIndex == 2)
        #expect(math.levels.map(\.level) == ["foundation", "junior", "middle", "senior"])

        let own = math.levels[2]
        #expect(own.isOwnLevel)
        #expect(own.durationMonths == 2)
        let first = own.lessons[0]
        #expect(first.state == .completed)
        #expect(first.assignmentId == 501)
        #expect(first.deliveryId == 9001)
        #expect(first.hasRoadmap && first.roadmapRead)
        #expect(first.accessible == true)
        #expect(first.scheduledDate != nil)
        // Microseconds and an offset, in one string — the fractional parser has to take it.
        #expect(own.lessons[2].scheduledDate != nil)
        #expect(own.lessons[3].isMidterm)
        #expect(own.lessons[3].assignmentId == nil)

        // A locked rung carries only the four outline keys; the rest must read as absent.
        let outline = math.levels[3].lessons[0]
        #expect(outline.state == nil)
        #expect(outline.assignmentId == nil)
        #expect(outline.deliveryId == nil)
        #expect(outline.accessible == nil)
        #expect(!outline.hasRoadmap && !outline.roadmapRead)

        let english = try #require(roadmap.tracks.last)
        #expect(english.ownLevel == nil)
        #expect(english.ownLevelIndex == nil)
        #expect(english.completionRate == nil)
        #expect(english.monthsRemaining == nil)
    }

    @Test("A student in no class gets exactly {\"tracks\": []} — the month keys are absent, not null")
    func emptyRoadmap() async throws {
        server.handler = { _ in .json(["tracks": []]) }
        let roadmap = try await api().roadmap()
        #expect(roadmap.tracks.isEmpty)
        #expect(roadmap.monthsToSat == nil)
        #expect(roadmap.monthsToSatBasis.isEmpty)
        #expect(roadmap.levelChips.isEmpty)
    }

    @Test("One unreadable lesson or track is dropped; its neighbours survive")
    func lenientLists() throws {
        let body: [String: Any] = [
            "tracks": [
                ["subject_label": "Nameless"],  // no subject: cannot be told apart, dropped
                [
                    "subject": "math", "subject_label": "Math",
                    "levels": [[
                        "level": "junior", "level_label": "Junior", "is_own_level": true, "journal_published": true,
                        "lessons": [
                            ["title": "No number"],
                            ["lesson_number": "2", "title": "  ", "lesson_type": "MIDTERM"],
                            ["lesson_number": 3.0, "title": "Three", "state": "someday"],
                        ],
                    ]],
                ],
            ],
        ]
        let roadmap = try decode(RoadmapResponse.self, body)
        #expect(roadmap.tracks.count == 1)
        let lessons = try #require(roadmap.tracks.first?.levels.first?.lessons)
        #expect(lessons.map(\.lessonNumber) == [2, 3])
        // A blank title gets the server's own fallback, and a MIDTERM type implies the flag.
        #expect(lessons[0].title == "Midterm 2")
        #expect(lessons[0].isMidterm)
        // A state this build does not know is no state — it never becomes "available".
        #expect(lessons[1].state == nil)
    }

    @Test("Numbers arrive as whatever Python sent — decimal strings included")
    func numbersInAnyForm() throws {
        let body: [String: Any] = [
            "tracks": [[
                "subject": "math", "subject_label": "Math",
                "completion_rate": "0.2500", "months_remaining": "1.5", "completed_lessons": 3.0,
                "own_classroom_id": 12, "levels": [],
            ]],
            "months_to_sat": 0,
        ]
        let roadmap = try decode(RoadmapResponse.self, body)
        let track = try #require(roadmap.tracks.first)
        #expect(track.completionRate == 0.25)
        #expect(track.monthsRemaining == 1.5)
        #expect(track.completedLessons == 3)
        // A finished course is a real 0 — not "unknown".
        #expect(roadmap.monthsToSat == 0)
    }

    @Test("Reading: GET decodes the page, POST marks it read on the same path")
    func readingRoundTrip() async throws {
        server.handler = { request in
            .json([
                "delivery_id": 9003, "classroom_id": 34, "lesson_number": 3,
                "title": "Quadratics", "summary": "Why the curve bends",
                "estimated_minutes": 6, "require_read_confirmation": true,
                "read": request.httpMethod == "POST",
                "homework_released": true,
                "homework_assignment_id": request.httpMethod == "POST" ? (503 as Any) : (NSNull() as Any),
                "sections": [
                    ["id": 1, "kind": "TEXT", "heading": "The idea", "body": "One.\n\nTwo.", "caption": "",
                     "image_url": NSNull(), "video_url": NSNull()],
                    ["id": 2, "kind": "IMAGE", "heading": "", "body": "", "caption": "A parabola",
                     "image_url": "https://r2.example/p.png?sig=1", "video_url": NSNull()],
                    ["id": 3, "kind": "VIDEO", "heading": "", "body": "", "caption": "",
                     "image_url": NSNull(), "video_url": "https://youtu.be/abc"],
                    ["id": 4, "kind": "AUDIO", "heading": "", "body": "", "caption": ""],
                ],
            ])
        }
        let reading = try await api().reading(deliveryId: 9003)
        #expect(server.requests.last?.httpMethod == "GET")
        #expect(server.requests.last?.url?.absoluteString == "https://mastersat.uz/api/classes/roadmap/9003/reading/")
        #expect(reading.title == "Quadratics")
        #expect(reading.estimatedMinutes == 6)
        #expect(reading.requireReadConfirmation)
        #expect(!reading.read)
        // Withheld until read: nothing to open yet.
        #expect(reading.homeworkAssignmentId == nil)
        #expect(reading.sections.map(\.kind) == [.text, .image, .video, nil])
        #expect(reading.sections[0].paragraphs == ["One.", "Two."])
        #expect(reading.sections[1].imageURL == "https://r2.example/p.png?sig=1")

        let marked = try await api().markRead(deliveryId: 9003)
        #expect(server.requests.last?.httpMethod == "POST")
        #expect(server.requests.last?.url?.absoluteString == "https://mastersat.uz/api/classes/roadmap/9003/reading/")
        #expect(marked.read)
        #expect(marked.homeworkAssignmentId == 503)
        #expect(marked.classroomId == 34)
    }

    @Test("A lesson that isn't the student's answers 404, and it surfaces as one")
    func readingNotFound() async throws {
        server.handler = { _ in .json(["detail": "No such lesson."], status: 404) }
        do {
            _ = try await api().reading(deliveryId: 1)
            Issue.record("Expected a 404")
        } catch let APIError.http(status, detail) {
            #expect(status == 404)
            #expect(detail == "No such lesson.")
        }
    }
}

@Suite struct RoadmapRulesTests {

    private func mathTrack() throws -> RoadmapTrack {
        try #require(try decode(RoadmapResponse.self, roadmapPayload()).tracks.first)
    }

    @Test("Level state: below your own is done, yours is current, above is locked, unpublished is coming soon")
    func levelStates() throws {
        let track = try mathTrack()
        #expect(RoadmapRules.levelStates(for: track) == [.done, .comingSoon, .current, .locked])
    }

    @Test("With no own level every rung is coming soon — nothing is being withheld")
    func noOwnLevel() throws {
        let roadmap = try decode(RoadmapResponse.self, roadmapPayload())
        let english = try #require(roadmap.tracks.last)
        #expect(RoadmapRules.levelStates(for: english) == [.comingSoon])
        #expect(RoadmapRules.levelState(journalPublished: true, index: 0, ownIndex: nil) == .comingSoon)
        #expect(RoadmapRules.levelState(journalPublished: false, index: 3, ownIndex: 3) == .comingSoon)
    }

    @Test("The pills say what the web says")
    func pills() {
        #expect(RoadmapLevelState.current.pillText == "Your level")
        #expect(RoadmapLevelState.done.pillText == "Completed")
        #expect(RoadmapLevelState.locked.pillText == "Locked")
        #expect(RoadmapLevelState.comingSoon.pillText == "Coming soon")
    }

    @Test("Subtitles: done-of-n on your level, a count elsewhere, and a note when there is nothing")
    func subtitles() throws {
        let track = try mathTrack()
        let states = RoadmapRules.levelStates(for: track)
        #expect(RoadmapRules.subtitle(for: track.levels[2], state: states[2]) == "2 of 4 lessons done")
        #expect(RoadmapRules.subtitle(for: track.levels[0], state: states[0]) == "2 lessons")
        #expect(RoadmapRules.subtitle(for: track.levels[1], state: states[1]) == "Lessons are being prepared")
        #expect(RoadmapRules.opensByDefault(states[2]))
        #expect(!RoadmapRules.opensByDefault(states[0]))
        #expect(!RoadmapRules.opensByDefault(states[3]))
    }

    @Test("Circle states follow the lesson, unless the whole level is locked")
    func nodeStates() {
        let done = RoadmapLesson(lessonNumber: 1, title: "A", state: .completed, assignmentId: 1)
        let open = RoadmapLesson(lessonNumber: 2, title: "B", state: .available, assignmentId: 2)
        let later = RoadmapLesson(lessonNumber: 3, title: "C", state: .upcoming)
        let midterm = RoadmapLesson(lessonNumber: 4, title: "Midterm 4", lessonType: "MIDTERM", isMidterm: true, state: .upcoming)
        let outline = RoadmapLesson(lessonNumber: 5, title: "E")

        #expect(RoadmapRules.nodeState(for: done, levelLocked: false) == .done)
        #expect(RoadmapRules.nodeState(for: open, levelLocked: false) == .current)
        #expect(RoadmapRules.nodeState(for: later, levelLocked: false) == .upcoming)
        #expect(RoadmapRules.nodeState(for: midterm, levelLocked: false) == .milestone)
        #expect(RoadmapRules.nodeState(for: outline, levelLocked: false) == .upcoming)
        #expect(RoadmapRules.nodeState(for: done, levelLocked: true) == .locked)
    }

    @Test("The button table: tag, words, colour, and where it goes")
    func actionTable() {
        let done = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 1, title: "A", state: .completed, assignmentId: 501),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(done.tag == "Finished")
        #expect(done.label == "PRACTISE AGAIN")
        #expect(done.tone == .green)
        #expect(done.target == .homework(classroomId: 34, assignmentId: 501))

        let current = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 2, title: "B", state: .available, assignmentId: 502),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(current.tag == "Open now")
        #expect(current.label == "START LESSON")
        #expect(current.tone == .brand)
        #expect(current.target == .homework(classroomId: 34, assignmentId: 502))

        let upcoming = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 3, title: "C", state: .upcoming),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(upcoming.tag == "Coming soon")
        #expect(upcoming.label == "NOT YET")
        #expect(upcoming.tone == .grey)
        #expect(!upcoming.isEnabled)

        let locked = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 1, title: "A", state: .completed, assignmentId: 501),
            levelLocked: true, ownClassroomId: 34
        )
        #expect(locked.tag == "Locked")
        #expect(locked.label == "LOCKED")
        #expect(!locked.isEnabled)
    }

    @Test("A milestone opens nothing from the roadmap: it says NOT READY YET, never START TEST")
    func milestone() {
        let action = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 4, title: "Midterm 4", lessonType: "MIDTERM", isMidterm: true),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(action.node == .milestone)
        #expect(action.tag == "Big test")
        #expect(action.tone == .gold)
        #expect(action.label == "NOT READY YET")
        #expect(action.target == nil)

        // A midterm with a sitting scheduled is "available" — still no assignment behind it.
        let scheduled = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 4, title: "Midterm 4", isMidterm: true, state: .available, deliveryId: 9),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(scheduled.node == .current)
        #expect(scheduled.label == "NOT READY YET")
        #expect(!scheduled.isEnabled)
    }

    @Test("Unread reading comes first; once read, the homework is the button and the reading a quiet link")
    func readingFirst() {
        let unread = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 3, title: "C", state: .available, assignmentId: 503,
                               deliveryId: 9003, hasRoadmap: true, roadmapRead: false),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(unread.label == "READ FIRST")
        #expect(unread.target == .reading(deliveryId: 9003))
        #expect(unread.readAgainDeliveryId == nil)

        let read = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 3, title: "C", state: .available, assignmentId: 503,
                               deliveryId: 9003, hasRoadmap: true, roadmapRead: true),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(read.label == "START LESSON")
        #expect(read.target == .homework(classroomId: 34, assignmentId: 503))
        #expect(read.readAgainDeliveryId == 9003)

        // Unread reading always has somewhere to go, even before its homework exists.
        let noHomeworkYet = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 3, title: "C", state: .available,
                               deliveryId: 9003, hasRoadmap: true, roadmapRead: false),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(noHomeworkYet.label == "READ FIRST")

        // A lesson whose state forbids opening offers no reading either.
        let notYet = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 5, title: "E", state: .upcoming,
                               deliveryId: 9005, hasRoadmap: true, roadmapRead: false),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(notYet.label == "NOT YET")
        #expect(notYet.target == nil)
        #expect(notYet.readAgainDeliveryId == nil)
    }

    @Test("Open by state but nothing behind it: NOT READY YET")
    func notReadyYet() {
        let noAssignment = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 2, title: "B", state: .available),
            levelLocked: false, ownClassroomId: 34
        )
        #expect(noAssignment.label == "NOT READY YET")
        #expect(!noAssignment.isEnabled)

        // No classroom to open it in is the same situation.
        let noClassroom = RoadmapRules.action(
            for: RoadmapLesson(lessonNumber: 2, title: "B", state: .completed, assignmentId: 7),
            levelLocked: false, ownClassroomId: nil
        )
        #expect(noClassroom.label == "NOT READY YET")
        #expect(noClassroom.target == nil)
    }

    @Test("The reading tag: Read ✓, Reading, or nothing")
    func readingTag() {
        #expect(RoadmapRules.readingTag(for: RoadmapLesson(lessonNumber: 1, title: "A", hasRoadmap: true, roadmapRead: true)) == "Read ✓")
        #expect(RoadmapRules.readingTag(for: RoadmapLesson(lessonNumber: 1, title: "A", hasRoadmap: true)) == "Reading")
        #expect(RoadmapRules.readingTag(for: RoadmapLesson(lessonNumber: 1, title: "A")) == nil)
    }

    @Test("The walked line runs through finished lessons into the next one, and stops at the first gap")
    func walked() {
        #expect(RoadmapRules.walkedThrough([]) == 0)
        #expect(RoadmapRules.walkedThrough([true]) == 0)
        #expect(RoadmapRules.walkedThrough([false, false, false]) == 0)
        // Two done, then the lesson in front of the student: the road reaches it.
        #expect(RoadmapRules.walkedThrough([true, true, false, false]) == 2)
        #expect(RoadmapRules.walkedThrough([true, true, true]) == 2)
        // A first lesson skipped but the next ones done — the web draws this road too.
        #expect(RoadmapRules.walkedThrough([false, true, true, false]) == 3)
        // A stray finished lesson further along must not colour the road leading to it.
        #expect(RoadmapRules.walkedThrough([true, false, false, true]) == 1)
        #expect(RoadmapRules.walkedThrough([false, false, true]) == 0)
    }

    @Test("The path swings centre, right, centre, left")
    func wave() {
        #expect((0..<6).map(RoadmapRules.wave(at:)) == [0, 1, 0, -1, 0, 1])
    }
}

@Suite struct RoadmapChipAndContentTests {

    @Test("Home's level chips: one per subject with an own level, and what comes next")
    func levelChips() throws {
        let body: [String: Any] = [
            "tracks": [
                ["subject": "math", "subject_label": "Math", "own_level_label": "Middle", "next_level_label": "Senior", "levels": []],
                ["subject": "english", "subject_label": "English", "own_level_label": "Senior", "next_level_label": NSNull(), "levels": []],
                ["subject": "physics", "subject_label": "Physics", "own_level_label": NSNull(), "levels": []],
                ["subject": "art", "subject_label": "Art", "own_level_label": "", "levels": []],
            ],
            "months_to_sat": NSNull(), "months_to_sat_basis": [],
        ]
        let chips = try decode(RoadmapResponse.self, body).levelChips
        #expect(chips.map(\.subject) == ["math", "english"])
        #expect(chips[0].subjectLabel == "Math")
        #expect(chips[0].levelLabel == "Middle")
        #expect(chips[0].detail == "Next: Senior")
        #expect(chips[1].detail == "Top level")
    }

    @Test("A passage splits on blank lines only, the way the web prints it")
    func paragraphs() {
        #expect(RoadmapText.paragraphs("One.\n\nTwo.") == ["One.", "Two."])
        // A single line break stays inside its paragraph.
        #expect(RoadmapText.paragraphs("Line one\nline two") == ["Line one\nline two"])
        // Whitespace-only lines, runs of blank lines, CRLF — all just separators.
        #expect(RoadmapText.paragraphs("A\n   \nB\n\n\n\nC") == ["A", "B", "C"])
        #expect(RoadmapText.paragraphs("A\r\n\r\nB") == ["A", "B"])
        #expect(RoadmapText.paragraphs("  \n\n  ").isEmpty)
        #expect(RoadmapText.paragraphs("").isEmpty)
    }

    @Test("YouTube and Vimeo open outside the app; any other address plays in it")
    func videoLinks() {
        #expect(RoadmapVideoLink("https://www.youtube.com/watch?v=abc") == .external(URL(string: "https://www.youtube.com/watch?v=abc")!))
        #expect(RoadmapVideoLink("https://youtu.be/abc") == .external(URL(string: "https://youtu.be/abc")!))
        #expect(RoadmapVideoLink("https://m.youtube.com/shorts/abc") == .external(URL(string: "https://m.youtube.com/shorts/abc")!))
        #expect(RoadmapVideoLink("https://vimeo.com/12345") == .external(URL(string: "https://vimeo.com/12345")!))
        #expect(RoadmapVideoLink("https://player.vimeo.com/video/12345") == .external(URL(string: "https://player.vimeo.com/video/12345")!))

        let signed = "https://bucket.r2.cloudflarestorage.com/journal_roadmap_videos/a.mp4?X-Amz-Signature=1"
        #expect(RoadmapVideoLink(signed) == .file(URL(string: signed)!))
        // Look-alike hosts are not YouTube.
        #expect(RoadmapVideoLink("https://notyoutube.com/v.mp4") == .file(URL(string: "https://notyoutube.com/v.mp4")!))

        #expect(RoadmapVideoLink(nil) == nil)
        #expect(RoadmapVideoLink("  ") == nil)
        #expect(RoadmapVideoLink("/media/relative.mp4") == nil)
        #expect(RoadmapVideoLink("javascript:alert(1)") == nil)
    }
}

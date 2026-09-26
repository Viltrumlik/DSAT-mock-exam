import Foundation
import Testing
@testable import MasterSATKit

// The web's `features/profile/__tests__/profileModel.test.ts`, case for case where the rule is
// the same, pinned to Tashkent the way that suite is.

enum ProfileFixtures {
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Tashkent")!
        return calendar
    }()

    /// Monday 14 September 2026, 15:30 in Tashkent.
    static let now = calendar.date(from: DateComponents(year: 2026, month: 9, day: 14, hour: 15, minute: 30))!

    static func local(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
    }

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    /// `days` whole days (and `hours` hours) from now, as the server writes a timestamp.
    static func at(_ days: Double, hours: Double = 0) -> String {
        iso(now.addingTimeInterval(days * 86_400 + hours * 3_600))
    }

    static func decode<T: Decodable>(_ type: T.Type, _ json: [String: Any]) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: JSONSerialization.data(withJSONObject: json))
    }

    static func homework(_ id: Int, _ title: String, due: String?, status: String, extra: [String: Any] = [:]) throws -> AssignmentListing {
        var json: [String: Any] = ["id": id, "title": title, "workflow_status": status, "due_at": due ?? NSNull()]
        json.merge(extra) { _, new in new }
        return try decode(AssignmentListing.self, json)
    }

    static func lesson(_ date: String, _ time: String, classroom: Int?, type: String = "class") throws -> ScheduleEvent {
        try decode(ScheduleEvent.self, [
            "date": date, "type": type, "title": "Class", "time": time, "classroom_id": classroom ?? NSNull(),
        ])
    }

    static func room(_ json: [String: Any]) throws -> Classroom {
        var full: [String: Any] = ["id": 1, "name": "Math Middle A"]
        full.merge(json) { _, new in new }
        return try decode(Classroom.self, full)
    }

    static func person(_ id: Int, role: String, userId: Int, username: Any = "madina") throws -> ClassroomMember {
        try decode(ClassroomMember.self, [
            "id": id, "role": role, "status": "ACTIVE",
            "user": ["id": userId, "first_name": "Madina", "last_name": "Karimova", "username": username],
        ])
    }
}

// MARK: - Homework

@Suite struct ProfileHomeworkTests {
    typealias F = ProfileFixtures

    @Test("Submitted and graded work is turned in, in either case; a returned piece is not")
    func turnedIn() {
        #expect(ProfileHomework.isTurnedIn("SUBMITTED"))
        #expect(ProfileHomework.isTurnedIn("graded"))
        #expect(ProfileHomework.isTurnedIn("reviewed"))
        #expect(!ProfileHomework.isTurnedIn("RETURNED"))
        #expect(!ProfileHomework.isTurnedIn("in_progress"))
        #expect(!ProfileHomework.isTurnedIn(nil))
    }

    @Test("The work to catch up on comes first, then by due date, undated last")
    func summary() throws {
        let rows = [
            try F.homework(1, "Later", due: F.at(6), status: "NOT_STARTED"),
            try F.homework(2, "Missed", due: F.at(-2), status: "RETURNED"),
            try F.homework(3, "Tomorrow", due: F.at(1), status: "in_progress"),
            try F.homework(4, "Undated", due: nil, status: "not_started"),
            try F.homework(5, "Sent", due: F.at(-4), status: "SUBMITTED"),
            try F.homework(6, "Marked", due: F.at(-5), status: "graded"),
        ]
        let summary = ProfileHomework.summarise(rows, now: F.now)
        #expect(summary.total == 6)
        #expect(summary.turnedIn == 2)
        #expect(summary.toDo.map(\.title) == ["Missed", "Tomorrow", "Later", "Undated"])
        #expect(summary.catchUp == 1)
        #expect(summary.turnedInPercent == 33)
        #expect(ProfileWording.homeworkValue(summary) == "33%")
        #expect(ProfileWording.homeworkDetail(summary) == "2 of 6 turned in")
    }

    @Test("Nothing set is no percentage at all, and says so")
    func nothingSet() {
        let summary = ProfileHomework.summarise([], now: ProfileFixtures.now)
        #expect(summary.turnedInPercent == nil)
        #expect(ProfileWording.homeworkValue(summary) == "—")
        #expect(ProfileWording.homeworkDetail(summary) == "Nothing has been set yet.")
        #expect(ProfileWording.homeworkEmpty(summary) == "No homework has been set for your classes yet.")
    }

    @Test("All handed in is caught up, not empty")
    func caughtUp() throws {
        let summary = ProfileHomework.summarise([try F.homework(1, "Sent", due: F.at(-1), status: "SUBMITTED")], now: F.now)
        #expect(summary.toDo.isEmpty)
        #expect(summary.turnedInPercent == 100)
        #expect(ProfileWording.homeworkEmpty(summary) == "You're all caught up — nothing to hand in right now.")
    }

    @Test("Due dates are labelled without ever saying overdue")
    func dueLabels() {
        let label = { (due: String?) in ProfileHomework.dueLabel(due, now: F.now, calendar: F.calendar) }
        #expect(label(F.at(-2)) == .init(text: "Catch up", tone: .catchUp))
        #expect(label(F.iso(F.local(14, 23))) == .init(text: "Due today", tone: .soon))
        #expect(label(F.at(1)) == .init(text: "Due tomorrow", tone: .soon))
        #expect(label(F.at(3)) == .init(text: "Due in 3 days", tone: .soon))
        #expect(label(F.at(6)) == .init(text: "Due in 6 days", tone: .later))
        #expect(label(nil) == .init(text: "No due date", tone: .none))
        #expect(label("not a date") == .init(text: "No due date", tone: .none))
    }

    @Test("Tomorrow morning is tomorrow even late tonight — calendar days, not 24-hour blocks")
    func calendarDays() {
        let lateTonight = F.local(14, 23, 50)
        let label = ProfileHomework.dueLabel(F.iso(F.local(15, 9)), now: lateTonight, calendar: F.calendar)
        #expect(label.text == "Due tomorrow")
    }

    @Test("A row's size is its question count, only for work made of questions")
    func rowDetail() throws {
        let quiz = try F.homework(1, "Q", due: nil, status: "not_started", extra: [
            "classroom_name": "Math Middle A", "content_type": "assessment", "item_count": 22,
        ])
        #expect(ProfileHomework.rowDetail(quiz) == "Math Middle A · 22 questions")
        let one = try F.homework(2, "Q", due: nil, status: "not_started", extra: ["content_type": "pastpaper", "item_count": 1])
        #expect(ProfileHomework.rowDetail(one) == "1 question")
        let file = try F.homework(3, "Essay", due: nil, status: "not_started", extra: [
            "classroom_name": "English A", "content_type": "file", "item_count": 3,
        ])
        #expect(ProfileHomework.rowDetail(file) == "English A")
    }
}

// MARK: - Lessons

@Suite struct ProfileLessonsTests {
    typealias F = ProfileFixtures

    private func events() throws -> [ScheduleEvent] {
        [
            try F.lesson("2026-09-14", "14:00", classroom: 34),
            try F.lesson("2026-09-16", "14:00", classroom: 34),
            try F.lesson("2026-09-12", "16:00", classroom: 35),
            try F.lesson("2026-09-15", "16:00", classroom: 35),
            try F.lesson("2026-09-15", "", classroom: nil, type: "mock"),
        ]
    }

    private func next(_ events: [ScheduleEvent], _ id: Int, hours: Int?) -> ProfileLessons.Next? {
        ProfileLessons.next(in: events, classroomId: id, hours: hours, now: F.now, calendar: F.calendar)
    }

    private func label(_ lesson: ProfileLessons.Next?) -> String? {
        lesson.map { ProfileLessons.label($0, now: F.now, calendar: F.calendar) }
    }

    @Test("A lesson that has started but not finished is on now")
    func onNow() throws {
        let lesson = next(try events(), 34, hours: 2)
        #expect(lesson?.live == true)
        #expect(label(lesson) == "On now")
    }

    @Test("Once today's lesson is over it moves on to the next one")
    func movesOn() throws {
        let lesson = next(try events(), 34, hours: 1)
        #expect(label(lesson) == "Wed, Sep 16 at 14:00")
    }

    @Test("Tomorrow says tomorrow; a class with nothing ahead has no next lesson")
    func tomorrowAndNone() throws {
        let all = try events()
        #expect(label(next(all, 35, hours: 2)) == "Tomorrow at 16:00")
        #expect(next(all, 99, hours: 2) == nil)
    }

    @Test("A lesson later today is today")
    func today() throws {
        let later = [try F.lesson("2026-09-14", "18:00", classroom: 5)]
        #expect(label(next(later, 5, hours: 2)) == "Today at 18:00")
    }

    @Test("A time given as a range ends at its own end, whatever the class's length")
    func ranges() throws {
        let ranged = [
            try F.lesson("2026-09-14", "13:00-15:00", classroom: 7),
            try F.lesson("2026-09-14", "15:00-16:30", classroom: 8),
            try F.lesson("2026-09-16", "13:00-15:00", classroom: 7),
        ]
        #expect(label(next(ranged, 7, hours: 4)) == "Wed, Sep 16 at 13:00")
        #expect(next(ranged, 8, hours: 1)?.live == true)
    }

    @Test("No length means two hours; a lesson with no time is on all day")
    func defaults() throws {
        // 14:00 + the default 2 hours is still on at 15:30.
        let two = [try F.lesson("2026-09-14", "14:00", classroom: 1)]
        #expect(next(two, 1, hours: nil)?.live == true)
        #expect(next(two, 1, hours: 0)?.live == true)
        let allDay = next([try F.lesson("2026-09-14", "", classroom: 2)], 2, hours: 2)
        #expect(allDay?.live == true)
    }

    @Test("Clock times are read out of free text")
    func clockTimes() {
        #expect(ProfileLessons.clockTimes(in: "8:00-10:00").map { $0.hour } == [8, 10])
        #expect(ProfileLessons.clockTimes(in: "18:30").map { $0.minute } == [30])
        #expect(ProfileLessons.clockTimes(in: "evening").isEmpty)
        #expect(ProfileLessons.clockTimes(in: "25:00").isEmpty)
    }
}

// MARK: - Classes

@Suite struct ProfileClassesTests {
    typealias F = ProfileFixtures

    @Test("The classes are the ones the student holds a seat in")
    func memberships() throws {
        let rooms = [
            try F.room(["id": 1, "my_role": "STUDENT"]),
            try F.room(["id": 2, "my_role": NSNull()]),
            try F.room(["id": 3, "my_role": "TEACHER"]),
            try F.room(["id": 4, "my_role": "REMOVED"]),
            try F.room(["id": 5, "my_role": "CO_TEACHER"]),
        ]
        #expect(ProfileClasses.memberships(rooms).map(\.id) == [1, 3, 5])
    }

    @Test("Classmates are the students, the viewer left out")
    func classmates() throws {
        let people = [
            try F.person(1, role: "TEACHER", userId: 10),
            try F.person(2, role: "STUDENT", userId: 11),
            try F.person(3, role: "STUDENT", userId: 12, username: NSNull()),
            try F.person(4, role: "TA", userId: 13),
        ]
        let mates = ProfileClasses.classmates(people, selfId: 12)
        #expect(mates.map(\.userId) == [11])
        #expect(mates.first?.username == "madina")
        #expect(people[2].username == nil)
    }

    @Test("A card reads subject · level, the teacher, days · time, room · branch, and students")
    func cardLines() throws {
        let room = try F.room([
            "subject": "MATH", "level": "junior", "lesson_days": "ODD", "lesson_time": "14:00",
            "room_number": "204", "branch_name": "Chilonzor", "student_count": 14, "members_count": 16,
            "teacher_details": ["id": 3, "first_name": "Aziz", "last_name": "Karimov", "email": "a@x.uz"],
        ])
        #expect(ProfileClasses.subjectLine(room) == "Math · Junior")
        #expect(ProfileClasses.teacherLine(room) == "Teacher: Aziz Karimov")
        #expect(ProfileClasses.scheduleLine(room) == "Mon, Wed, Fri · 14:00")
        #expect(ProfileClasses.whereLine(room) == "Room 204 · Chilonzor")
        #expect(ProfileClasses.studentsLine(room) == "14 students")

        let bare = try F.room(["subject": "READING_WRITING", "student_count": 1])
        #expect(ProfileClasses.subjectLine(bare) == "English")
        #expect(ProfileClasses.teacherLine(bare) == "Teacher to be confirmed")
        #expect(ProfileClasses.scheduleLine(bare) == "Schedule to be set")
        #expect(ProfileClasses.whereLine(bare) == nil)
        #expect(ProfileClasses.studentsLine(bare) == "1 student")

        // A room typed with its own label is not labelled twice.
        let labelled = try F.room(["room_number": "Room 4"])
        #expect(ProfileClasses.whereLine(labelled) == "Room 4")
    }

    @Test("The lesson length is read from the class, in whatever shape it arrives")
    func lessonHours() throws {
        let whole = try F.room(["lesson_hours": 3])
        let fractional = try F.room(["lesson_hours": 1.5])
        let typed = try F.room(["lesson_hours": "2"])
        let absent = try F.room([:])
        #expect(whole.lessonHours == 3)
        #expect(fractional.lessonHours == 2)
        #expect(typed.lessonHours == 2)
        #expect(absent.lessonHours == nil)
    }
}

// MARK: - Checklist

@Suite struct ProfileChecklistTests {
    private let complete = ProfileChecklist.Input(
        realEmail: "madina@example.com",
        emailVerified: true,
        targetScore: 1400,
        examDate: "2026-11-07",
        photoURL: "https://cdn/p.jpg",
        telegramLinked: true,
        phone: "+998901234567"
    )

    @Test("It ticks what is done and keeps the order of what matters most")
    func order() {
        var input = complete
        input.photoURL = nil
        input.phone = " "
        let items = ProfileChecklist.items(input, telegramAvailable: true)
        #expect(items.map(\.key) == [.email, .goal, .exam, .photo, .telegram, .phone])
        #expect(items.filter { !$0.done }.map(\.key) == [.photo, .phone])
        #expect(ProfileChecklist.progress(items) == "4 of 6 done")
        #expect(items.map(\.action) == ["Confirm", "Set", "Pick", "Add", "Connect", "Add"])
    }

    @Test("A missing email is added; one that is not confirmed is confirmed")
    func email() {
        var missing = complete
        missing.realEmail = ""
        #expect(ProfileChecklist.items(missing, telegramAvailable: true)[0].label == "Add your email")
        #expect(ProfileChecklist.items(missing, telegramAvailable: true)[0].done == false)

        var unconfirmed = complete
        unconfirmed.emailVerified = false
        let first = ProfileChecklist.items(unconfirmed, telegramAvailable: true)[0]
        #expect(first.label == "Confirm your email" && !first.done)
    }

    @Test("A Telegram step nobody here can take is left out — unless it is already done")
    func telegram() {
        var unlinked = complete
        unlinked.telegramLinked = false
        #expect(!ProfileChecklist.items(unlinked, telegramAvailable: false).map(\.key).contains(.telegram))
        #expect(ProfileChecklist.items(complete, telegramAvailable: false).map(\.key).contains(.telegram))
    }

    @Test("Everything done is all set")
    func allDone() {
        let items = ProfileChecklist.items(complete, telegramAvailable: true)
        let allDone = items.allSatisfy { $0.done }
        #expect(allDone)
        #expect(items.map(\.doneLabel) == [
            "Email confirmed", "Target score set", "SAT date picked", "Photo added", "Telegram connected", "Phone number added",
        ])
    }
}

// MARK: - Results and goal

@Suite struct ProfileResultsTests {
    typealias F = ProfileFixtures

    private func attempt(_ id: Int, daysAgo: Double, completed: Bool = true, score: Int? = nil, subject: String = "MATH",
                         mock: Int? = nil, kind: String? = nil) -> ProfileAttempt {
        ProfileAttempt(
            id: id, submittedAt: F.at(-daysAgo), isCompleted: completed, score: score ?? 500 + id,
            subject: subject, mockExamId: mock, mockKind: kind
        )
    }

    @Test("The latest scored tests, newest first, with midterms left to their own page")
    func recent() {
        let unscored = ProfileAttempt(id: 5, submittedAt: F.at(-4), isCompleted: true, score: nil, subject: "MATH")
        let rows = ProfileResults.recent([
            attempt(1, daysAgo: 9),
            attempt(2, daysAgo: 1),
            attempt(3, daysAgo: 2, mock: 8, kind: "MIDTERM"),
            attempt(4, daysAgo: 3, completed: false),
            unscored,
            attempt(6, daysAgo: 5, subject: "READING_WRITING", mock: 4, kind: "MOCK_SAT"),
            attempt(7, daysAgo: 6),
        ])
        #expect(rows.map(\.id) == [2, 6, 7])
    }

    @Test("Subjects and titles are named the way the page says them")
    func naming() {
        #expect(ProfileResults.subjectLabel("READING_WRITING") == "Reading & Writing")
        #expect(ProfileResults.subjectLabel("ENGLISH") == "Reading & Writing")
        #expect(ProfileResults.subjectLabel("MATH") == "Math")
        #expect(ProfileResults.subjectLabel(nil) == "Practice")

        let titled = ProfileAttempt(id: 1, subject: "MATH", title: "  ", collectionName: "October 2025 US")
        #expect(ProfileResults.title(titled) == "October 2025 US")
        #expect(ProfileResults.title(ProfileAttempt(id: 2, subject: "MATH")) == "Math")

        let dated = ProfileAttempt(id: 3, submittedAt: F.iso(F.local(14, 10)), subject: "READING_WRITING")
        #expect(ProfileResults.detail(dated, calendar: F.calendar) == "Reading & Writing · Sep 14")
    }

    @Test("Roles, strikes and coins read as the web writes them")
    func wording() {
        #expect(ProfileWording.roleLabel("support_teacher") == "Support teacher")
        #expect(ProfileWording.roleLabel("student") == "Student")
        #expect(ProfileWording.roleLabel(nil) == "Student")
        #expect(ProfileWording.roleLabel("test_auditor") == "Content team")
        #expect(ProfileWording.strikesDetail(currentStreak: 0, bestStreak: 6) == "Attend your next lesson to start a run.")
        #expect(ProfileWording.strikesDetail(currentStreak: 1, bestStreak: 4) == "1 lesson in a row · best 4")
        #expect(ProfileWording.strikesDetail(currentStreak: 3, bestStreak: 5) == "3 lessons in a row · best 5")
        #expect(ProfileWording.coinsDetail(1) == "1 coin to spend in the shop")
        #expect(ProfileWording.coinsDetail(12) == "12 coins to spend in the shop")
        #expect(ProfileWording.copied(username: "madina") == "@madina is copied.")
    }

    @Test("Days until the SAT count calendar days, so tomorrow is 1 even late tonight")
    func daysUntil() {
        #expect(ProfileGoal.daysUntil("2026-09-14", now: F.now, calendar: F.calendar) == 0)
        #expect(ProfileGoal.daysUntil("2026-09-15", now: F.local(14, 23, 59), calendar: F.calendar) == 1)
        #expect(ProfileGoal.daysUntil("2026-11-07", now: F.now, calendar: F.calendar) == 54)
        #expect(ProfileGoal.daysUntil(nil, now: F.now, calendar: F.calendar) == nil)
        #expect(ProfileGoal.daysUntil("2026-02-31", now: F.now, calendar: F.calendar) == nil)
    }

    @Test("The Test day well: a count, today, or a nudge to pick one")
    func testDay() {
        let day = { (date: String?) in ProfileGoal.testDay(date, now: F.now, calendar: F.calendar) }
        #expect(day("2026-11-07") == .init(value: "54", unit: "days to go", detail: "Sat, Nov 7, 2026"))
        #expect(day("2026-09-15") == .init(value: "1", unit: "day to go", detail: "Tue, Sep 15, 2026"))
        #expect(day("2026-09-14") == .init(value: "Today", unit: nil, detail: "Mon, Sep 14, 2026"))
        #expect(day("2026-09-01") == .init(value: "—", unit: nil, detail: "That date has passed — pick your next one."))
        #expect(day(nil) == .init(value: "—", unit: nil, detail: "Pick the SAT date you're aiming for."))
        #expect(day("") == .init(value: "—", unit: nil, detail: "Pick the SAT date you're aiming for."))
    }

    @Test("The goal's sections line and its button")
    func goal() {
        #expect(ProfileGoal.sectionsLine(total: 1400, english: 690, math: 710) == "English 690 · Math 710")
        #expect(ProfileGoal.sectionsLine(total: 1400, english: nil, math: nil) == "Set your English and Math targets too.")
        #expect(ProfileGoal.sectionsLine(total: nil, english: nil, math: nil) == "Not set yet")
        #expect(ProfileGoal.actionTitle(targetScore: nil) == "Set a goal")
        #expect(ProfileGoal.actionTitle(targetScore: 1400) == "Change goal")
    }

    @Test("The goal sheet starts where Home starts it: the sections, else the total split")
    func sheetStart() {
        let stored = ProfileGoal.sectionTargets(total: 1400, english: 690, math: 710)
        #expect(stored.english == 690 && stored.math == 710)
        let split = ProfileGoal.sectionTargets(total: 1450, english: nil, math: nil)
        #expect(split.english == 730 && split.math == 720)
        let half = ProfileGoal.sectionTargets(total: 1400, english: 650, math: nil)
        #expect(half.english == 650 && half.math == 750)
        let none = ProfileGoal.sectionTargets(total: nil, english: nil, math: nil)
        #expect(none.english == nil && none.math == nil)
    }
}

// MARK: - The request

@Suite struct ProfileAPITests {
    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> ProfileAPI {
        ProfileAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("Sittings are read from /exams/attempts/, a bad row skipped rather than failing the list")
    func attempts() async throws {
        server.handler = { _ in
            .json([
                [
                    "id": 41, "submitted_at": "2026-09-20T10:11:12.345678+05:00", "is_completed": true, "score": 640,
                    "module_results": [["id": 1]], "current_state": "COMPLETED",
                    "practice_test_details": [
                        "id": 9, "subject": "MATH", "title": "October 2025 US", "collection_name": "October 2025",
                        "mock_exam_id": NSNull(), "mock_kind": NSNull(), "modules": [],
                    ],
                ],
                ["submitted_at": NSNull(), "is_completed": false],
                [
                    "id": 42, "submitted_at": NSNull(), "is_completed": true, "score": NSNull(), "results_withheld": true,
                    "practice_test_details": ["subject": "READING_WRITING", "mock_exam_id": 7, "mock_kind": "MIDTERM"],
                ],
                ["id": 43, "is_completed": true, "score": "610", "practice_test_details": NSNull()],
            ])
        }
        let rows = try await api().attempts()
        #expect(rows.map(\.id) == [41, 42, 43])
        #expect(rows[0] == ProfileAttempt(
            id: 41, submittedAt: "2026-09-20T10:11:12.345678+05:00", isCompleted: true, score: 640,
            subject: "MATH", title: "October 2025 US", collectionName: "October 2025"
        ))
        #expect(rows[1].score == nil && rows[1].mockKind == "MIDTERM" && rows[1].mockExamId == 7)
        #expect(rows[2].score == 610 && rows[2].subject == nil)
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/exams/attempts/")
        #expect(server.requests.first?.httpMethod == "GET")
    }

    @Test("A paginated envelope is read too")
    func envelope() async throws {
        server.handler = { _ in .json(["count": 1, "results": [["id": 5, "is_completed": true, "score": 700]]]) }
        let rows = try await api().attempts()
        #expect(rows.map(\.id) == [5])
    }

    @Test("A failed request is an error, never an empty list")
    func failure() async {
        server.handler = { _ in .json(["detail": "Server error"], status: 500) }
        await #expect(throws: (any Error).self) { try await api().attempts() }
    }
}

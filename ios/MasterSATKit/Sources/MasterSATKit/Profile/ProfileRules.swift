import Foundation

// What the profile works out for itself, ported from the web's
// `features/profile/profileModel.ts` and the panels that read it (`OverviewTab.tsx`,
// `ClassesTab.tsx`, `ProfileHero.tsx`). No fetching and no SwiftUI, so every rule is tested on
// its own (`ProfileTests`).
//
// Every "today" / "tomorrow" here is the student's own calendar day: the functions take the
// calendar (and so the time zone) they count in, which is what lets the tests pin Tashkent the
// way the web's suite does.

// MARK: - Homework

public enum ProfileHomework {
    /// Turned in: submitted or graded, in either case — the assessment path serves lowercase,
    /// the submission path uppercase. RETURNED is not: it means "revise and send it back".
    /// `reviewed` counts too, as it does on the app's homework screens; `my-assignments` does
    /// not send it today, and a reviewed piece is certainly not still to do.
    public static func isTurnedIn(_ status: String?) -> Bool {
        let key = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return key == "submitted" || key == "graded" || key == "reviewed"
    }

    /// The colour a due date is drawn in.
    public enum DueTone: Sendable, Equatable {
        /// Past its date — "Catch up", never "Overdue".
        case catchUp
        /// Today, tomorrow, or within three days.
        case soon
        case later
        case none
    }

    public struct Due: Sendable, Equatable {
        public let text: String
        public let tone: DueTone

        public init(text: String, tone: DueTone) {
            self.text = text
            self.tone = tone
        }
    }

    /// "Catch up", "Due today", "Due tomorrow", "Due in 6 days", "No due date".
    ///
    /// Days are calendar days, so work due at nine tonight is "Due today" and work due at nine
    /// tomorrow morning is "Due tomorrow" even late this evening.
    public static func dueLabel(_ dueAt: String?, now: Date = Date(), calendar: Calendar = .current) -> Due {
        guard let dueAt, let due = JSONCoding.parseServerDate(dueAt) else {
            return Due(text: "No due date", tone: .none)
        }
        if due < now { return Due(text: "Catch up", tone: .catchUp) }
        let days = ProfileCalendar.days(from: now, to: due, calendar: calendar)
        switch days {
        case ...0: return Due(text: "Due today", tone: .soon)
        case 1: return Due(text: "Due tomorrow", tone: .soon)
        default: return Due(text: "Due in \(days) days", tone: days <= 3 ? .soon : .later)
        }
    }

    public struct Summary: Sendable, Equatable {
        public let total: Int
        public let turnedIn: Int
        /// Still to do, the one to start next first: work to catch up on, then by due date,
        /// undated last.
        public let toDo: [AssignmentListing]
        /// Of `toDo`, how many are past their date.
        public let catchUp: Int

        /// The Homework tile's figure: the share turned in, whole percent. Nil when nothing
        /// has been set — a 0% there would read as a verdict on work that does not exist.
        public var turnedInPercent: Int? {
            guard total > 0 else { return nil }
            return Int((Double(turnedIn) / Double(total) * 100).rounded())
        }
    }

    public static func summarise(_ rows: [AssignmentListing], now: Date = Date()) -> Summary {
        func due(_ row: AssignmentListing) -> Date {
            row.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
        }
        let toDo = rows
            .filter { !isTurnedIn($0.workflowStatus) }
            .sorted { lhs, rhs in
                let l = due(lhs), r = due(rhs)
                return l != r ? l < r : lhs.id < rhs.id
            }
        return Summary(
            total: rows.count,
            turnedIn: rows.count - toDo.count,
            toDo: toDo,
            catchUp: toDo.filter { due($0) < now }.count
        )
    }

    /// "22 questions" for work that is a set of questions (a quiz, a past paper, a practice
    /// pack, a mock); nil for anything else, or when the server gave no count.
    public static func sizeLabel(_ row: AssignmentListing) -> String? {
        guard let count = row.itemCount, count > 0,
              ["assessment", "pastpaper", "practice", "mock"].contains((row.contentType ?? "").lowercased())
        else { return nil }
        return "\(count) question\(count == 1 ? "" : "s")"
    }

    /// The line under a row's title: "Math Middle A · 22 questions".
    public static func rowDetail(_ row: AssignmentListing) -> String {
        [row.classroomName, sizeLabel(row)]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

// MARK: - Lessons

public enum ProfileLessons {
    /// The next lesson of one class.
    public struct Next: Sendable, Equatable {
        public let start: Date
        /// The lesson is on right now.
        public let live: Bool

        public init(start: Date, live: Bool) {
            self.start = start
            self.live = live
        }
    }

    /// The lesson on now, or the first still to start.
    ///
    /// `hours` is the class's lesson length, so a lesson that began twenty minutes ago reads
    /// as on now rather than as gone — "Next lesson: Wednesday" while the student is sitting
    /// in today's would be wrong in the way that matters. A time given as a range
    /// ("13:00-15:00") ends at its own end instead.
    public static func next(
        in events: [ScheduleEvent],
        classroomId: Int,
        hours: Int?,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Next? {
        // The web's `Math.max(0.5, Number(hours) || 2)`: no length (or zero) means two hours.
        let length = max(0.5, (hours ?? 0) > 0 ? Double(hours ?? 0) : 2)
        var best: Next?
        for event in events where event.type == .classMeeting && event.classroomId == classroomId {
            guard let window = window(of: event, hours: length, calendar: calendar), window.end > now else { continue }
            if best.map({ window.start < $0.start }) ?? true {
                best = Next(start: window.start, live: window.start <= now)
            }
        }
        return best
    }

    /// "On now", "Today at 14:00", "Tomorrow at 16:00", "Wed, Sep 16 at 14:00".
    public static func label(_ lesson: Next, now: Date = Date(), calendar: Calendar = .current) -> String {
        if lesson.live { return "On now" }
        let clock = calendar.dateComponents([.hour, .minute], from: lesson.start)
        let hhmm = String(format: "%02d:%02d", clock.hour ?? 0, clock.minute ?? 0)
        switch ProfileCalendar.days(from: now, to: lesson.start, calendar: calendar) {
        case 0: return "Today at \(hhmm)"
        case 1: return "Tomorrow at \(hhmm)"
        default: return "\(ProfileCalendar.format(lesson.start, "EEE, MMM d", calendar: calendar)) at \(hhmm)"
        }
    }

    /// A lesson's start and end. `time` is a start ("14:00") or a range ("08:00-10:00"); with
    /// only a start the lesson lasts `hours`. A lesson with no time spans its whole day.
    static func window(of event: ScheduleEvent, hours: Double, calendar: Calendar) -> (start: Date, end: Date)? {
        guard let day = ProfileCalendar.date(fromDay: event.date, calendar: calendar) else { return nil }
        let times = clockTimes(in: event.time)
        guard let first = times.first else {
            let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day.addingTimeInterval(86_400)
            return (day, next)
        }
        guard let start = calendar.date(bySettingHour: first.hour, minute: first.minute, second: 0, of: day) else {
            return nil
        }
        var end = start.addingTimeInterval(hours * 3600)
        if times.count > 1,
           let until = calendar.date(bySettingHour: times[1].hour, minute: times[1].minute, second: 0, of: day),
           until > start {
            end = until
        }
        return (start, end)
    }

    /// Every `H:MM` / `HH:MM` in free text, in order — the web's `/(\d{1,2}):(\d{2})/g`.
    static func clockTimes(in text: String) -> [(hour: Int, minute: Int)] {
        guard let pattern = try? NSRegularExpression(pattern: #"(\d{1,2}):(\d{2})"#) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return pattern.matches(in: text, range: range).compactMap { match in
            guard let h = Range(match.range(at: 1), in: text), let m = Range(match.range(at: 2), in: text),
                  let hour = Int(text[h]), let minute = Int(text[m]),
                  (0...23).contains(hour), (0...59).contains(minute) else { return nil }
            return (hour, minute)
        }
    }
}

// MARK: - Classes

public enum ProfileClasses {
    /// Every class the student holds a seat in, in any role — the web's `capabilitiesFor(…)
    /// .isMember`. A removed student's row still comes back from `/classes/` with no role; it
    /// is not their class any more.
    public static func memberships(_ classes: [Classroom]) -> [Classroom] {
        classes.filter { room in
            ["OWNER", "ADMIN", "TEACHER", "CO_TEACHER", "TA", "STUDENT"].contains((room.myRole ?? "").uppercased())
        }
    }

    /// Classmates: the class's students, the viewer left out.
    public static func classmates(_ people: [ClassroomMember], selfId: Int?) -> [ClassroomMember] {
        people.filter { $0.isStudent && $0.userId != selfId }
    }

    /// How many classmates the panel lists before "+N more in the class".
    public static let classmatesShown = 12

    /// "Math · Junior", "English".
    public static func subjectLine(_ room: Classroom) -> String {
        [room.subjectLabel, levelLabel(room.level)].compactMap { $0 }.joined(separator: " · ")
    }

    /// "Foundation", "Junior", "Middle", "Senior"; an unknown level as it came; nil for none.
    public static func levelLabel(_ level: String?) -> String? {
        let raw = (level ?? "").trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return nil }
        switch raw.lowercased() {
        case "foundation": return "Foundation"
        case "junior": return "Junior"
        case "middle": return "Middle"
        case "senior": return "Senior"
        default: return raw
        }
    }

    /// "Teacher: Aziz Karimov", or "Teacher to be confirmed" before one is set.
    public static func teacherLine(_ room: Classroom) -> String {
        let name = (room.teacherName ?? "").trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "Teacher to be confirmed" : "Teacher: \(name)"
    }

    /// "Mon, Wed, Fri · 14:00" — the time as the learning center typed it.
    public static func scheduleLine(_ room: Classroom) -> String {
        let parts = [ClassroomSchedule.daysShort(room.lessonDays), (room.lessonTime ?? "").trimmingCharacters(in: .whitespaces)]
            .filter { !$0.isEmpty }
        return parts.isEmpty ? "Schedule to be set" : parts.joined(separator: " · ")
    }

    /// "Room 204 · Chilonzor"; nil when the class has neither.
    public static func whereLine(_ room: Classroom) -> String? {
        let parts = [ClassroomSchedule.roomLabel(room.roomNumber), (room.branchName ?? "").trimmingCharacters(in: .whitespaces)]
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// "1 student", "14 students" — the enrolled students, never the teaching team.
    public static func studentsLine(_ room: Classroom) -> String {
        let count = room.studentCount ?? 0
        return "\(count) \(count == 1 ? "student" : "students")"
    }
}

// MARK: - Finishing the profile

public enum ProfileChecklist {
    public enum Key: String, Sendable, CaseIterable {
        case email, goal, exam, photo, telegram, phone
    }

    public struct Item: Sendable, Equatable, Identifiable {
        public let key: Key
        public let label: String
        /// What the step reads as once it is done: "Email confirmed".
        public let doneLabel: String
        /// Why it is worth doing — one short reason, never a warning.
        public let hint: String
        public let done: Bool

        public var id: Key { key }

        /// The button beside a step still to do.
        public var action: String {
            switch key {
            case .email: return "Confirm"
            case .goal: return "Set"
            case .exam: return "Pick"
            case .photo, .phone: return "Add"
            case .telegram: return "Connect"
            }
        }
    }

    /// The profile fields the checklist reads.
    public struct Input: Sendable, Equatable {
        /// The address to show, or `""` when there is none.
        public var realEmail: String
        public var emailVerified: Bool
        public var targetScore: Int?
        public var examDate: String?
        public var photoURL: String?
        public var telegramLinked: Bool
        public var phone: String

        public init(
            realEmail: String,
            emailVerified: Bool,
            targetScore: Int?,
            examDate: String?,
            photoURL: String?,
            telegramLinked: Bool,
            phone: String
        ) {
            self.realEmail = realEmail
            self.emailVerified = emailVerified
            self.targetScore = targetScore
            self.examDate = examDate
            self.photoURL = photoURL
            self.telegramLinked = telegramLinked
            self.phone = phone
        }
    }

    /// The steps that make a profile useful, most useful first.
    ///
    /// Telegram is left off where the site offers no Telegram sign-in (`telegramAvailable` is
    /// `TelegramSignInConfig.canConnect`), because a step nobody can take is a step that can
    /// never be ticked — unless it is already done.
    public static func items(_ input: Input, telegramAvailable: Bool) -> [Item] {
        let email = input.realEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        let items = [
            Item(
                key: .email,
                label: email.isEmpty ? "Add your email" : "Confirm your email",
                doneLabel: "Email confirmed",
                hint: "Your results and sign-in codes go there.",
                done: !email.isEmpty && input.emailVerified
            ),
            Item(
                key: .goal,
                label: "Set your target score",
                doneLabel: "Target score set",
                hint: "So you can see how far you've come.",
                done: input.targetScore != nil
            ),
            Item(
                key: .exam,
                label: "Pick your SAT date",
                doneLabel: "SAT date picked",
                hint: "A countdown keeps the plan on track.",
                done: !(input.examDate ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            ),
            Item(
                key: .photo,
                label: "Add a profile photo",
                doneLabel: "Photo added",
                hint: "Your teachers and classmates see it in class.",
                done: !(input.photoURL ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            ),
            Item(
                key: .telegram,
                label: "Connect Telegram",
                doneLabel: "Telegram connected",
                hint: "Sign in with one tap next time.",
                done: input.telegramLinked
            ),
            Item(
                key: .phone,
                label: "Add your phone number",
                doneLabel: "Phone number added",
                hint: "So your learning center can reach you.",
                done: !input.phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ),
        ]
        return telegramAvailable ? items : items.filter { $0.key != .telegram || $0.done }
    }

    /// "2 of 6 done".
    public static func progress(_ items: [Item]) -> String {
        "\(items.filter(\.done).count) of \(items.count) done"
    }
}

// MARK: - Results

public enum ProfileResults {
    /// The latest scored tests, newest first.
    ///
    /// Midterms are left out: their scores are released by the learning center on its own
    /// schedule, and they have a page of their own that knows whether a result is out yet.
    /// Every other sitting is one section scored on its own scale — which is why none of these
    /// is set against the 1600 target.
    public static func recent(_ attempts: [ProfileAttempt], limit: Int = 3) -> [ProfileAttempt] {
        func time(_ attempt: ProfileAttempt) -> Date? { attempt.submittedAt.flatMap(JSONCoding.parseServerDate) }
        return attempts
            .filter { $0.isCompleted && $0.score != nil && time($0) != nil }
            .filter { ($0.mockKind ?? "").uppercased() != "MIDTERM" }
            .sorted { lhs, rhs in
                let l = time(lhs) ?? .distantPast, r = time(rhs) ?? .distantPast
                return l != r ? l > r : lhs.id > rhs.id
            }
            .prefix(max(0, limit))
            .map { $0 }
    }

    /// "Reading & Writing" / "Math" out of the practice test's subject code; "Practice" else.
    public static func subjectLabel(_ subject: String?) -> String {
        switch (subject ?? "").uppercased() {
        case "MATH": return "Math"
        case "READING_WRITING", "ENGLISH": return "Reading & Writing"
        default: return "Practice"
        }
    }

    public static func isMath(_ attempt: ProfileAttempt) -> Bool {
        (attempt.subject ?? "").uppercased() == "MATH"
    }

    /// The row's name: the test's title, else its collection, else its subject.
    public static func title(_ attempt: ProfileAttempt) -> String {
        for candidate in [attempt.title, attempt.collectionName] {
            let text = (candidate ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { return text }
        }
        return subjectLabel(attempt.subject)
    }

    /// "Math · Sep 14".
    public static func detail(_ attempt: ProfileAttempt, calendar: Calendar = .current) -> String {
        let subject = subjectLabel(attempt.subject)
        guard let date = attempt.submittedAt.flatMap(JSONCoding.parseServerDate) else { return subject }
        return "\(subject) · \(ProfileCalendar.format(date, "MMM d", calendar: calendar))"
    }
}

// MARK: - Goal

public enum ProfileGoal {
    /// The goal panel's button.
    public static func actionTitle(targetScore: Int?) -> String {
        targetScore == nil ? "Set a goal" : "Change goal"
    }

    /// The line under the target score.
    public static func sectionsLine(total: Int?, english: Int?, math: Int?) -> String {
        if let english, let math { return "English \(english) · Math \(math)" }
        return total == nil ? "Not set yet" : "Set your English and Math targets too."
    }

    /// Whole days from today to a "YYYY-MM-DD", by the calendar rather than by 24-hour blocks.
    public static func daysUntil(_ day: String?, now: Date = Date(), calendar: Calendar = .current) -> Int? {
        guard let day, let date = ProfileCalendar.date(fromDay: day, calendar: calendar) else { return nil }
        return ProfileCalendar.days(from: now, to: date, calendar: calendar)
    }

    /// The Test day well: the figure, its unit, and the line under it.
    public struct TestDay: Sendable, Equatable {
        /// "54", "Today" or "—".
        public let value: String
        /// "days to go" / "day to go" beside a count; nil otherwise.
        public let unit: String?
        public let detail: String
    }

    public static func testDay(_ examDate: String?, now: Date = Date(), calendar: Calendar = .current) -> TestDay {
        let day = (examDate ?? "").trimmingCharacters(in: .whitespaces)
        let days = daysUntil(day.isEmpty ? nil : day, now: now, calendar: calendar)
        let value: String
        var unit: String?
        if let days, days > 0 {
            value = String(days)
            unit = days == 1 ? "day to go" : "days to go"
        } else if days == 0 {
            value = "Today"
        } else {
            value = "—"
        }
        let detail: String
        if day.isEmpty {
            detail = "Pick the SAT date you're aiming for."
        } else if let days, days < 0 {
            detail = "That date has passed — pick your next one."
        } else {
            detail = examDateLabel(day, calendar: calendar)
        }
        return TestDay(value: value, unit: unit, detail: detail)
    }

    /// "Sat, Nov 7, 2026"; the text as it came when it is not a date.
    public static func examDateLabel(_ day: String, calendar: Calendar = .current) -> String {
        guard let date = ProfileCalendar.date(fromDay: day, calendar: calendar) else { return day }
        return ProfileCalendar.format(date, "EEE, MMM d, yyyy", calendar: calendar)
    }
}

// MARK: - Wording

public enum ProfileWording {
    /// The account's role as a person would say it — the hero's "Profile · Student".
    public static func roleLabel(_ role: String?) -> String {
        switch (role ?? "").trimmingCharacters(in: .whitespaces).lowercased() {
        case "student", "": return "Student"
        case "support_teacher": return "Support teacher"
        case "teacher": return "Teacher"
        case "test_admin", "test_auditor": return "Content team"
        default: return "Staff"
        }
    }

    /// The Strikes tile's line.
    public static func strikesDetail(currentStreak: Int, bestStreak: Int) -> String {
        guard currentStreak > 0 else { return "Attend your next lesson to start a run." }
        return "\(currentStreak) \(currentStreak == 1 ? "lesson" : "lessons") in a row · best \(bestStreak)"
    }

    /// The Points tile's line.
    public static func coinsDetail(_ coins: Int) -> String {
        "\(coins) \(coins == 1 ? "coin" : "coins") to spend in the shop"
    }

    /// The Homework tile's line.
    public static func homeworkDetail(_ summary: ProfileHomework.Summary) -> String {
        summary.total == 0 ? "Nothing has been set yet." : "\(summary.turnedIn) of \(summary.total) turned in"
    }

    /// The Homework tile's figure: "80%", or "—" when nothing has been set.
    public static func homeworkValue(_ summary: ProfileHomework.Summary) -> String {
        summary.turnedInPercent.map { "\($0)%" } ?? "—"
    }

    /// Homework to do's empty answer: all handed in, or nothing set at all.
    public static func homeworkEmpty(_ summary: ProfileHomework.Summary) -> String {
        summary.total > 0
            ? "You're all caught up — nothing to hand in right now."
            : "No homework has been set for your classes yet."
    }

    /// The toast after "Copy username".
    public static func copied(username: String) -> String { "@\(username) is copied." }
}

// MARK: - Calendar arithmetic

/// Counting in the student's own days.
enum ProfileCalendar {
    /// Calendar days from one moment's day to another's: 0 today, 1 tomorrow, -1 yesterday.
    static func days(from start: Date, to end: Date, calendar: Calendar) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: start), to: calendar.startOfDay(for: end)).day ?? 0
    }

    /// Local midnight of a "YYYY-MM-DD" (anything after the date is ignored). A date with no
    /// time is a day on the student's calendar, not a UTC instant.
    static func date(fromDay text: String, calendar: Calendar) -> Date? {
        let parts = text.prefix(10).split(separator: "-")
        guard text.count >= 10, parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              (1...12).contains(month), (1...31).contains(day) else { return nil }
        var components = DateComponents(year: year, month: month, day: day)
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        guard let date = calendar.date(from: components),
              calendar.component(.day, from: date) == day else { return nil }
        return date
    }

    /// English dates the way the web writes them (`toLocaleDateString("en-US", …)`).
    static func format(_ date: Date, _ pattern: String, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}

import Foundation

// The homework page's wording, ported from the web's student view
// (`features/classroom/pages/AssignmentDetail.tsx`, `homeworkApi.ts`).

// MARK: - Hero tiles

public enum HomeworkWording {
    /// "Reading & Writing", "Math", or the raw value; "—" when there is none. The detail's
    /// `subject` is the class's subject, so ENGLISH reads as the SAT section it is.
    public static func sectionLabel(_ subject: String?) -> String {
        guard let subject, !subject.trimmingCharacters(in: .whitespaces).isEmpty else { return "—" }
        switch subject.uppercased() {
        case "READING_WRITING", "ENGLISH", "RW": return "Reading & Writing"
        case "MATH": return "Math"
        default: return subject
        }
    }

    /// The Countdown tile: "No deadline" · "Due today" · "1 day left" · "{n} days left", or,
    /// once the deadline has gone, "Catch up" — the app's wording, where the web page says
    /// "Past due". Work already with the teacher is not something to catch up on, so a
    /// handed-in homework past its deadline reads "Deadline passed".
    ///
    /// Days are counted in calendar days from the start of today, as the web intends. The
    /// web rounds a millisecond difference instead, which calls a deadline this evening
    /// "1 day left" and one that passed last night "Due today"; that is not copied.
    public static func countdown(
        dueAt: String?,
        handedIn: Bool = false,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> String {
        guard let dueAt, let due = JSONCoding.parseServerDate(dueAt) else { return "No deadline" }
        if due <= now { return handedIn ? "Deadline passed" : "Catch up" }
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: due)
        ).day ?? 0
        switch days {
        case ...0: return "Due today"
        case 1: return "1 day left"
        default: return "\(days) days left"
        }
    }

    /// "Jun 30" — the tiles' short date. "—" when there is none.
    public static func shortDate(_ iso: String?, locale: Locale = .autoupdatingCurrent, timeZone: TimeZone = .current) -> String {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// The hero's badge: "Classwork", "Bundle" when more than one thing opens, else the kind
    /// of the one thing ("Quiz", "Past Paper", "Vocabulary", …), "Homework" for a hand-in.
    public static func badge(for assignment: AssignmentListing) -> String {
        if assignment.isClasswork { return "Classwork" }
        if assignment.launcherCount > 1 { return "Bundle" }
        if !assignment.assessmentHomeworks.isEmpty { return "Quiz" }
        if assignment.mockExamId != nil { return "Mock Exam" }
        if !assignment.allPracticePackIds.isEmpty { return "Practice Test" }
        if assignment.practiceTestId != nil || !assignment.practiceTestIds.isEmpty || !assignment.practiceBundleTests.isEmpty {
            return "Past Paper"
        }
        if assignment.moduleId != nil { return "Module Test" }
        if !assignment.vocabHomeworks.isEmpty { return "Vocabulary" }
        return "Homework"
    }
}

// MARK: - Papers sat on a computer

/// A past paper, mock or practice pack inside a homework.
///
/// These are sat on a laptop, under exam conditions — the app never starts one. It still
/// says what is there and where the student stands on it, because "is my past paper done?"
/// is a question worth answering on a phone.
public struct ComputerPaper: Equatable, Sendable, Identifiable {
    public enum Kind: String, Sendable {
        case mock = "Mock Exam"
        case practice = "Practice Test"
        case pastPaper = "Past Paper"
    }

    /// What the web's launcher button would do: open results, carry on, or begin.
    public enum Mode: Equatable, Sendable { case start, resume, review }

    public let id: String
    public let kind: Kind
    public let name: String
    /// "Reading & Writing", "Math", "Reading & Writing · Math"; nil when unknown.
    public let subject: String?
    public let mode: Mode
    /// Sat before this homework was set and not since: it reads "Start again".
    public let retake: Bool
    /// A past-paper section's own sitting — the finished one on a "Review" row.
    public let attemptId: Int?

    /// A finished past-paper section has a certificate the phone can show; a mock's or a
    /// pack's row does not name one sitting, and the server refuses mock sections anyway.
    public var certificateAttemptId: Int? {
        kind == .pastPaper && mode == .review ? attemptId : nil
    }

    /// The web's button words, shown here as a chip: "Review" · "Resume" · "Start again" · "Start".
    public var stateLabel: String {
        switch mode {
        case .review: return "Review"
        case .resume: return "Resume"
        case .start: return retake ? "Start again" : "Start"
        }
    }

    public init(id: String, kind: Kind, name: String, subject: String?, mode: Mode, retake: Bool, attemptId: Int? = nil) {
        self.id = id
        self.kind = kind
        self.name = name
        self.subject = subject
        self.mode = mode
        self.retake = retake
        self.attemptId = attemptId
    }

    static func mode(_ state: String) -> Mode {
        switch state.lowercased() {
        case "completed": return .review
        case "in_progress": return .resume
        default: return .start
        }
    }
}

extension AssignmentListing {
    /// How many launcher cards the web draws — what makes a homework a "Bundle".
    var launcherCount: Int {
        assessmentHomeworks.count + vocabHomeworks.count + computerPapers.count
    }

    /// The papers in this homework that are sat on a computer, in the web launcher's order:
    /// the mock, then the practice pack, otherwise one row per past-paper section.
    ///
    /// The web launcher has no state for a mock or a pack (its button always says "Start"),
    /// but their sections — `practice_bundle_tests` — carry the student's own state, and a
    /// chip that said "Start" on a finished mock would be wrong. So the row takes its state
    /// from its sections: all finished is "Review", anything begun is "Resume".
    public var computerPapers: [ComputerPaper] {
        var out: [ComputerPaper] = []
        var cursor: [String: Int] = [:]
        func title(_ kind: String, fallback: String) -> String {
            let start = cursor[kind] ?? 0
            for index in contents.indices where index >= start && contents[index].kind == kind {
                cursor[kind] = index + 1
                return contents[index].title.isEmpty ? fallback : contents[index].title
            }
            return fallback
        }

        let sections = practiceBundleTests
        let packIds = allPracticePackIds

        if let mockExamId {
            out.append(Self.aggregate(
                id: "mock.\(mockExamId)", kind: .mock, name: title("MOCK", fallback: "Mock Exam"), sections: sections
            ))
        }
        if let packId = packIds.first {
            out.append(Self.aggregate(
                id: "pack.\(packId)", kind: .practice, name: title("PRACTICE", fallback: "Practice Test"), sections: sections
            ))
        } else if mockExamId == nil, practiceTestId != nil || !practiceTestIds.isEmpty || !sections.isEmpty {
            let multi = sections.count > 1
            for section in sections {
                let base = [section.name, section.collectionName ?? "", section.title ?? ""]
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .first { !$0.isEmpty } ?? "Past Paper"
                let subject = HomeworkWording.sectionLabel(section.subject)
                let mode = ComputerPaper.mode(section.state)
                out.append(ComputerPaper(
                    id: "section.\(section.id)",
                    kind: .pastPaper,
                    name: multi && subject != "—" ? "\(base) · \(subject)" : base,
                    subject: subject == "—" ? nil : subject,
                    mode: mode,
                    retake: mode == .start && section.retake,
                    attemptId: section.attemptId
                ))
            }
        }
        return out
    }

    private static func aggregate(
        id: String,
        kind: ComputerPaper.Kind,
        name: String,
        sections: [PracticeBundleTest]
    ) -> ComputerPaper {
        let modes = sections.map { ComputerPaper.mode($0.state) }
        let mode: ComputerPaper.Mode
        if !modes.isEmpty, modes.allSatisfy({ $0 == .review }) {
            mode = .review
        } else if modes.contains(where: { $0 != .start }) {
            mode = .resume
        } else {
            mode = .start
        }
        var subjects: [String] = []
        for section in sections {
            let label = HomeworkWording.sectionLabel(section.subject)
            if label != "—", !subjects.contains(label) { subjects.append(label) }
        }
        return ComputerPaper(
            id: id,
            kind: kind,
            name: name,
            subject: subjects.isEmpty ? nil : subjects.joined(separator: " · "),
            mode: mode,
            retake: mode == .start && sections.contains(where: \.retake)
        )
    }
}

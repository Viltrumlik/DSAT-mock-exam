import Foundation

/// How a student finds one assessment among a hundred — the web's `studentAssessmentNav`.
///
/// The board is navigated by narrowing, not by scrolling: a To-do strip of the homework still
/// open, then the two subjects, then a subject's SAT domains, and only inside a domain the
/// assessments themselves. A student with one subject lands straight in its domains. Search
/// still looks across everything. The rules are pure so they can be tested without a screen.
public enum AssessmentSubjectKey: String, CaseIterable, Sendable, Hashable, Identifiable {
    case english, math

    public var id: String { rawValue }

    /// Sets say `math` / `english`; platform-shaped payloads say `MATH` / `READING_WRITING`.
    /// Anything else is placed nowhere rather than guessed.
    public static func of(_ subject: String?) -> AssessmentSubjectKey? {
        switch (subject ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "MATH": return .math
        case "ENGLISH", "READING_WRITING", "READING", "RW": return .english
        default: return nil
        }
    }

    public var label: String {
        switch self {
        case .english: return "English"
        case .math: return "Math"
        }
    }

    /// The SAT's own domains, in the order the SAT lists them (`assessmentSatTaxonomy.ts`).
    public var domains: [String] {
        switch self {
        case .english:
            return [
                "Craft and Structure",
                "Expression of Ideas",
                "Information and Ideas",
                "Standard English Conventions",
            ]
        case .math:
            return [
                "Algebra",
                "Advanced Math",
                "Problem-Solving and Data Analysis",
                "Geometry and Trigonometry",
            ]
        }
    }
}

/// Where one card sits on the board, read from `progress.workflow_status` the way the web
/// reads it. `state` is only the fallback for a payload without the field.
public enum AssessmentCardState: String, Sendable, Equatable {
    case notStarted, inProgress, submitted, completed

    public enum Column: String, CaseIterable, Sendable, Hashable, Identifiable {
        case todo, inProgress, done
        public var id: String { rawValue }

        public var title: String {
            switch self {
            case .todo: return "To do"
            case .inProgress: return "In progress"
            case .done: return "Completed"
            }
        }

        /// What an empty column says — a fact about where work will appear, never a verdict.
        public var emptyHint: String {
            switch self {
            case .todo: return "New work from your teachers shows up here."
            case .inProgress: return "Anything you've started appears here."
            case .done: return "Finished work lands here."
            }
        }
    }

    public static func of(_ progress: AssessmentProgress?) -> AssessmentCardState {
        guard let progress else { return .notStarted }
        if let workflow = progress.workflowStatus?.lowercased(), !workflow.isEmpty {
            switch workflow {
            case "graded", "completed": return .completed
            case "submitted": return .submitted
            case "in_progress": return .inProgress
            default: return .notStarted
            }
        }
        switch progress.state.lowercased() {
        case "completed": return progress.graded == true ? .completed : .submitted
        case "in_progress": return .inProgress
        default: return .notStarted
        }
    }

    /// Submitted-but-not-marked sits with the finished work: nothing is waiting on the
    /// student, and the card says grading is in progress.
    public var column: Column {
        switch self {
        case .notStarted: return .todo
        case .inProgress: return .inProgress
        case .submitted, .completed: return .done
        }
    }

    public var isDone: Bool { self == .submitted || self == .completed }
}

/// One card: one ASSESSMENT, not one homework — a homework can bundle several.
public struct AssessmentBoardEntry: Identifiable, Sendable, Equatable {
    public let assignment: AssignmentListing
    public let link: AssessmentHomeworkLink

    public var id: Int { link.homeworkId }
    public var progress: AssessmentProgress? { link.progress }
    public var state: AssessmentCardState { AssessmentCardState.of(link.progress) }
    /// The set's own subject — the one the board groups and colours by.
    public var subject: String { link.assessmentSet?.subject ?? assignment.subject ?? "" }
    public var subjectKey: AssessmentSubjectKey? { AssessmentSubjectKey.of(link.assessmentSet?.subject) }
    public var domain: String { AssessmentBoard.domain(of: link.assessmentSet?.category) }
    /// The assessment's own title, falling back to the homework's.
    public var title: String {
        let own = (link.assessmentSet?.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !own.isEmpty { return own }
        return assignment.title.isEmpty ? "Assignment" : assignment.title
    }
    public var classroomName: String {
        if let name = assignment.classroomName, !name.isEmpty { return name }
        return assignment.classroomId.map { "Class #\($0)" } ?? ""
    }
    public var dueAt: String? { assignment.dueAt }
    /// `my-assignments` never sends `question_count`; the progress total IS the count.
    public var questionCount: Int {
        let total = link.progress?.totalQuestions ?? 0
        return total > 0 ? total : link.questionCount
    }
    /// The SAT's pace, and the site's: about a minute and a quarter a question.
    public var estimatedMinutes: Int { max(1, Int((Double(questionCount) * 1.25).rounded())) }
    /// A set carries one category; one written with commas or slashes reads as several tags.
    public var tags: [String] {
        (link.assessmentSet?.category ?? "")
            .split(whereSeparator: { $0 == "," || $0 == "/" || $0 == "·" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .prefix(3)
            .map { $0 }
    }

    /// "Math", "English", or the subject as written — "General" when there is none.
    public var subjectLabel: String {
        if let key = subjectKey { return key.label }
        let raw = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = raw.first else { return "General" }
        return first.uppercased() + raw.dropFirst()
    }

    /// Everything a search should match — title, class, subject and category together.
    var haystack: String {
        [title, classroomName, subjectLabel, link.assessmentSet?.category ?? ""]
            .joined(separator: " ")
            .lowercased()
    }

    public init(assignment: AssignmentListing, link: AssessmentHomeworkLink) {
        self.assignment = assignment
        self.link = link
    }
}

/// The whole board, narrowed the web's way.
public struct AssessmentBoard: Sendable {
    public struct DomainGroup: Identifiable, Sendable {
        public let name: String
        public let entries: [AssessmentBoardEntry]
        public var id: String { name }
    }

    public struct SubjectGroup: Identifiable, Sendable {
        public let key: AssessmentSubjectKey
        public let entries: [AssessmentBoardEntry]
        public let domains: [DomainGroup]
        public var id: AssessmentSubjectKey { key }

        public func domain(named name: String) -> DomainGroup? { domains.first { $0.name == name } }
    }

    /// What a subject or domain holds, so a student can tell where the unfinished work is
    /// before opening it.
    public struct Counts: Equatable, Sendable {
        public let total: Int
        public let todo: Int
        public let done: Int
    }

    /// The label for work whose set carries no category at all.
    public static let otherDomain = "Other"
    /// How many To-do cards the landing shows before "Show all".
    public static let todoPreview = 3

    public let entries: [AssessmentBoardEntry]
    /// English, then Math — the order the learning center names them. A subject the student
    /// has no work in is absent.
    public let subjects: [SubjectGroup]

    public init(assignments: [AssignmentListing]) {
        let entries = assignments.flatMap { assignment in
            assignment.assessmentHomeworks.map { AssessmentBoardEntry(assignment: assignment, link: $0) }
        }
        self.entries = entries
        self.subjects = Self.group(entries)
    }

    /// With exactly one subject there is nothing to choose between: it IS the landing view.
    public var soleSubject: SubjectGroup? { subjects.count == 1 ? subjects[0] : nil }

    public func subject(_ key: AssessmentSubjectKey) -> SubjectGroup? { subjects.first { $0.key == key } }

    /// Homework still open, nearest deadline first — what a student opens the page to find.
    public func todo(now: Date = Date()) -> [AssessmentBoardEntry] {
        entries.enumerated()
            .filter { Self.isOpenTodo(dueAt: $0.element.dueAt, done: $0.element.state.isDone, now: now) }
            .sorted { a, b in
                let order = Self.compareTodo(a.element.dueAt, b.element.dueAt)
                return order == 0 ? a.offset < b.offset : order < 0
            }
            .map(\.element)
    }

    /// Search looks across every subject and domain, not only where the student stands.
    public func search(_ query: String) -> [AssessmentBoardEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return [] }
        return entries.filter { $0.haystack.contains(needle) }
    }

    public static func counts(_ entries: [AssessmentBoardEntry]) -> Counts {
        let done = entries.filter { $0.state.isDone }.count
        return Counts(total: entries.count, todo: entries.count - done, done: done)
    }

    public static func columns(_ entries: [AssessmentBoardEntry]) -> [AssessmentCardState.Column: [AssessmentBoardEntry]] {
        var out: [AssessmentCardState.Column: [AssessmentBoardEntry]] = [.todo: [], .inProgress: [], .done: []]
        for entry in entries { out[entry.state.column, default: []].append(entry) }
        return out
    }

    // MARK: - The rules

    /// A category is stored as `"Domain › Subdomain"`, so the domain is everything before the
    /// `›`. A set with no category lands in "Other" rather than vanishing.
    public static func domain(of category: String?) -> String {
        let head = (category ?? "").components(separatedBy: "›").first ?? ""
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? otherDomain : trimmed
    }

    /// The domains present, in the SAT's order; unknown names follow alphabetically and
    /// "Other" always comes last.
    public static func orderedDomains(_ subject: AssessmentSubjectKey, present: some Sequence<String>) -> [String] {
        let have = Set(present)
        let known = subject.domains
        let unknown = have
            .filter { $0 != otherDomain && !known.contains($0) }
            .sorted { $0.localizedCompare($1) == .orderedAscending }
        return known.filter(have.contains) + unknown + (have.contains(otherDomain) ? [otherDomain] : [])
    }

    /// Belongs in To-do: not yet handed in, and the deadline has not passed. Work with no
    /// deadline has not passed one either, so it stays until it is done.
    public static func isOpenTodo(dueAt: String?, done: Bool, now: Date) -> Bool {
        if done { return false }
        guard let dueAt, !dueAt.isEmpty else { return true }
        guard let due = JSONCoding.parseServerDate(dueAt) else { return true }
        return due >= now
    }

    /// Nearest deadline first; undated work after all of it. 0 when they tie.
    public static func compareTodo(_ a: String?, _ b: String?) -> Int {
        let ka = a.flatMap(JSONCoding.parseServerDate)?.timeIntervalSince1970 ?? .infinity
        let kb = b.flatMap(JSONCoding.parseServerDate)?.timeIntervalSince1970 ?? .infinity
        return ka == kb ? 0 : (ka < kb ? -1 : 1)
    }

    private static func group(_ entries: [AssessmentBoardEntry]) -> [SubjectGroup] {
        var bySubject: [AssessmentSubjectKey: [String: [AssessmentBoardEntry]]] = [:]
        for entry in entries {
            guard let key = entry.subjectKey else { continue }
            bySubject[key, default: [:]][entry.domain, default: []].append(entry)
        }
        return AssessmentSubjectKey.allCases.compactMap { key in
            guard let domains = bySubject[key] else { return nil }
            let ordered = orderedDomains(key, present: domains.keys).map {
                DomainGroup(name: $0, entries: domains[$0] ?? [])
            }
            return SubjectGroup(key: key, entries: ordered.flatMap(\.entries), domains: ordered)
        }
    }
}

/// Which assessments offer the Desmos calculator.
public enum AssessmentTools {
    /// Middle and Senior maths sets only — the web runner's rule, gated on the raw set subject
    /// and level. A Junior or Foundation set is meant to be worked by hand.
    public static func offersCalculator(subject: String?, level: String?) -> Bool {
        let s = (subject ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let l = (level ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return s == "math" && (l == "middle" || l == "senior")
    }
}

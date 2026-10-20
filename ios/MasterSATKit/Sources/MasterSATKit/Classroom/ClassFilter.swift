import Foundation

/// The Class tab's chips, read off the student's classes.
///
/// One chip per subject — "Math", "English" — and, where two classes share a subject, one chip
/// per class by its name instead, so the chips always tell the classes apart. "All" comes first.
/// One class (or none) gets no chips: there is nothing to choose between.
public struct ClassFilter: Sendable, Equatable {
    public struct Chip: Identifiable, Sendable, Equatable {
        public let id: String
        public let label: String
        /// The classes the chip shows.
        public let classroomIds: Set<Int>
        /// The subject it stands for; nil for All.
        public let subject: AssessmentSubjectKey?
    }

    public static let allID = "all"

    public let classrooms: [Classroom]
    public let chips: [Chip]

    public init(classrooms: [Classroom]) {
        self.classrooms = classrooms
        guard classrooms.count > 1 else {
            chips = []
            return
        }
        var chips = [Chip(id: Self.allID, label: "All", classroomIds: Set(classrooms.map(\.id)), subject: nil)]
        for subject in [AssessmentSubjectKey.math, .english] {
            let rooms = classrooms
                .filter { Self.subject(of: $0) == subject }
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            if rooms.count == 1, let room = rooms.first {
                chips.append(Chip(id: subject.rawValue, label: subject.label, classroomIds: [room.id], subject: subject))
            } else {
                chips += rooms.map {
                    Chip(id: "class-\($0.id)", label: $0.name, classroomIds: [$0.id], subject: subject)
                }
            }
        }
        self.chips = chips
    }

    /// Anything that is not maths is an English class — the classes list's own rule.
    static func subject(of room: Classroom) -> AssessmentSubjectKey { room.isMath ? .math : .english }

    public func chip(_ id: String) -> Chip? { chips.first { $0.id == id } }

    /// A chip that has gone (a class left, a reload) reads as All.
    public func resolvedID(_ id: String) -> String { chip(id) == nil ? Self.allID : id }

    public func classes(for chipID: String) -> [Classroom] {
        guard let chip = chip(chipID), chip.id != Self.allID else { return classrooms }
        return classrooms.filter { chip.classroomIds.contains($0.id) }
    }

    /// Work from a class shows under that class's chips; work with no class only under All.
    public func includes(classroomId: Int?, chipID: String) -> Bool {
        guard let chip = chip(chipID), chip.id != Self.allID else { return true }
        return classroomId.map(chip.classroomIds.contains) ?? false
    }

    /// A midterm carries no class, only a subject, so it shows under every chip of its subject.
    public func includes(subject raw: String?, chipID: String) -> Bool {
        guard let chip = chip(chipID), chip.id != Self.allID else { return true }
        return AssessmentSubjectKey.of(raw) == chip.subject
    }
}

/// The Tasks segment's three lists under one chip.
public struct ClassTasks: Sendable, Equatable {
    /// Still to do, in Today's order, then the class's classwork. Classwork is listed here — it
    /// belongs to its class — but it is done in class and never owed: it is never a catch-up,
    /// always comes after the owed homework, and is left out of `owedCount`.
    public let toDo: [WorkItem]
    /// Done, the latest deadline first.
    public let done: [AssignmentListing]
    /// Quizzes handed in — marked, or being marked — the latest deadline first.
    public let assessmentResults: [AssessmentBoardEntry]
    /// Midterms sat, the newest sitting first.
    public let midtermResults: [MidtermListing]

    public init(
        assignments: [AssignmentListing],
        midterms: [MidtermListing],
        filter: ClassFilter,
        chipID: String,
        homeworkXP: Int?,
        now: Date = Date()
    ) {
        let mine = assignments.filter { filter.includes(classroomId: $0.classroomId, chipID: chipID) }
        let open = mine.filter { !HomeworkProgress.isDone($0) }
            .map { WorkItem.homework($0, homeworkXP: homeworkXP, now: now) }
        // Not by date alone: a dated classwork row would otherwise outrank homework due later.
        toDo = WorkItem.ordered(open.filter { !$0.isClasswork }) + WorkItem.ordered(open.filter(\.isClasswork))
        done = mine.filter(HomeworkProgress.isDone).sorted { a, b in
            let da = Self.deadline(a.dueAt), db = Self.deadline(b.dueAt)
            return da != db ? da > db : a.id > b.id
        }
        assessmentResults = AssessmentBoard(assignments: mine).entries
            .filter { $0.state.isDone }
            .sorted { a, b in
                let da = Self.deadline(a.dueAt), db = Self.deadline(b.dueAt)
                return da != db ? da > db : a.id > b.id
            }
        midtermResults = midterms
            .filter { $0.submitted && filter.includes(subject: $0.subject, chipID: chipID) }
            .sorted { ($0.attemptId ?? 0) > ($1.attemptId ?? 0) }
    }

    public var resultsCount: Int { assessmentResults.count + midtermResults.count }

    /// How many of `toDo` are owed: homework only. This, not `toDo.count`, is the To do count.
    public var owedCount: Int { toDo.filter { !$0.isClasswork }.count }

    /// Undated work sorts as the oldest, so it ends a newest-first list.
    static func deadline(_ raw: String?) -> Date { raw.flatMap(JSONCoding.parseServerDate) ?? .distantPast }
}

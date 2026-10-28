import Foundation

// The Class page's session trail (the owner's "Class Detail v4" design): one level's roadmap
// lessons turned into session cards, each a three-step trail — Topic → Classwork → Homework —
// with midterm markers between them. Pure rules over `RoadmapLesson`; the tests pin each one.

/// One step of a session's trail, in the order a student walks it.
public enum SessionStepKind: String, Sendable, Equatable, CaseIterable {
    /// The roadmap reading before the lesson.
    case topic
    /// The in-class work a teacher handed out.
    case classwork
    /// The released homework.
    case homework

    public var title: String {
        switch self {
        case .topic: return "Topic"
        case .classwork: return "Classwork"
        case .homework: return "Homework"
        }
    }
}

/// What a step's node looks like.
public enum SessionStepState: String, Sendable, Equatable {
    case done
    /// The one step to do next on the whole page — the white disc with the "Resume" popover.
    case now
    /// Open and not done, but not the step in front of the student.
    case todo
    /// In a session that has not been released yet.
    case locked
    /// This session has no such step: no reading written, no classwork handed out, or no
    /// homework released. Not drawn as a node, and not counted in "x/n done".
    case notSet
}

/// One node on a session's trail.
public struct SessionStep: Sendable, Equatable, Identifiable {
    public let kind: SessionStepKind
    public let state: SessionStepState

    public var id: SessionStepKind { kind }
    /// False for `.notSet` — the step is not part of this session.
    public var exists: Bool { state != .notSet }
    public var isDone: Bool { state == .done }

    public init(kind: SessionStepKind, state: SessionStepState) {
        self.kind = kind
        self.state = state
    }
}

/// Where a session — or a midterm marker — stands.
public enum TrailSessionState: String, Sendable, Equatable {
    /// Every step it has is done.
    case completed
    /// The first released session not completed yet: the page scrolls to it.
    case now
    /// Released and not completed, but not the first such — a session left behind, or one
    /// released ahead of it.
    case open
    /// Not released yet.
    case locked

    /// The badge on the session card. The design has three; an open session reads as in
    /// progress, because it is.
    public var badgeText: String {
        switch self {
        case .completed: return "Completed"
        case .now, .open: return "In progress"
        case .locked: return "Locked"
        }
    }
}

/// One session card.
public struct TrailSession: Sendable, Equatable, Identifiable {
    public let lesson: RoadmapLesson
    public let state: TrailSessionState
    /// Always three, Topic → Classwork → Homework; a step the session lacks is `.notSet`.
    public let steps: [SessionStep]

    public var id: Int { lesson.lessonNumber }

    /// The steps this session actually has — the "n" of "x/n done".
    public var existingCount: Int { steps.filter(\.exists).count }
    /// The "x" of "x/n done".
    public var doneCount: Int { steps.filter(\.isDone).count }
    /// The step under the "Resume" popover. Only ever set on the `.now` session.
    public var nowStep: SessionStepKind? { steps.first { $0.state == .now }?.kind }

    public func step(_ kind: SessionStepKind) -> SessionStep {
        steps.first { $0.kind == kind } ?? SessionStep(kind: kind, state: .notSet)
    }
}

/// A midterm between the sessions. It is sat in the centre, so it has no steps — only its
/// own state: `.completed` once sat, `.open` once a sitting is scheduled, else `.locked`. It
/// is never `.now`: the trail's "now" is a session.
public struct TrailMidterm: Sendable, Equatable, Identifiable {
    public let lesson: RoadmapLesson
    public let state: TrailSessionState

    public var id: Int { lesson.lessonNumber }
}

/// One row of the trail, in lesson order.
public enum SessionTrailItem: Sendable, Equatable, Identifiable {
    case session(TrailSession)
    case midterm(TrailMidterm)

    /// The lesson number — unique within a level.
    public var id: Int {
        switch self {
        case .session(let session): return session.id
        case .midterm(let midterm): return midterm.id
        }
    }
}

/// One level's lessons as the Class page draws them.
///
/// The rules, in the order they apply:
///
/// * **Steps.** Topic exists when the lesson has a reading (`hasRoadmap`) and is done once
///   it is read (`roadmapRead`). Classwork exists once handed out (`classworkAssignmentId`)
///   and is done on `classworkDone`. Homework exists once released (`assignmentId`) and is
///   done when the lesson's state is `completed`. A missing step is `.notSet`.
/// * **Locked.** A session is locked until it is released: no delivery row and no state
///   past `upcoming`. A lesson with no state at all — an outline, or a state this build does
///   not know — is not a release either. In a locked session the Topic is `.locked` when the
///   lesson has a reading (`.notSet` when it has none), and Classwork and Homework are
///   `.locked`: they are handed out at the lesson, so whether they will exist is not known
///   yet, and the design draws the whole trail locked.
/// * **Completed.** A released session is completed when every step it has is done — and
///   it has at least one, and its homework is not still to come (state `upcoming`). Without
///   those two guards a session whose work has not been handed out yet would read as done,
///   and flip back to "In progress" the moment its homework is released.
/// * **Now.** The first released session that is not completed. Its first step not done,
///   in trail order, is `.now`; its other unfinished steps are `.todo`. Every other released,
///   unfinished session is `.open`, with its unfinished steps `.todo`.
/// * **A level behind the student** (`levelPassed`) is finished whole. Its lessons are bare
///   outlines — the server sends no state for them — so every session is completed and every
///   step done (Topic only where the lesson has a reading), and every midterm sat.
public struct SessionTrail: Sendable, Equatable {
    public let items: [SessionTrailItem]

    public init(lessons: [RoadmapLesson], levelPassed: Bool = false) {
        let ordered = lessons.enumerated()
            .sorted { ($0.element.lessonNumber, $0.offset) < ($1.element.lessonNumber, $1.offset) }
            .map(\.element)

        var items: [SessionTrailItem] = []
        var nowTaken = false
        for lesson in ordered {
            if lesson.isMidterm {
                items.append(.midterm(TrailMidterm(lesson: lesson, state: Self.midtermState(lesson, levelPassed: levelPassed))))
                continue
            }
            let session = Self.session(lesson, levelPassed: levelPassed, isNow: !nowTaken)
            if session.state == .now { nowTaken = true }
            items.append(.session(session))
        }
        self.items = items
    }

    /// Every session, midterms left out.
    public var sessions: [TrailSession] {
        items.compactMap { item in
            if case .session(let session) = item { return session }
            return nil
        }
    }

    /// The session to scroll to on open. Nil when every released session is completed, or
    /// nothing is released at all.
    public var nowSessionId: Int? { sessions.first { $0.state == .now }?.id }

    // MARK: Rules

    /// Released: a delivery row exists, or the server already says it is open or done.
    static func isReleased(_ lesson: RoadmapLesson) -> Bool {
        if lesson.deliveryId != nil { return true }
        return lesson.state == .available || lesson.state == .completed
    }

    /// What the lesson says about one step, before the session's state decides how it is drawn.
    struct StepFact {
        let kind: SessionStepKind
        let exists: Bool
        let done: Bool
    }

    static func stepFacts(_ lesson: RoadmapLesson) -> [StepFact] {
        [
            StepFact(kind: .topic, exists: lesson.hasRoadmap, done: lesson.roadmapRead),
            StepFact(kind: .classwork, exists: lesson.classworkAssignmentId != nil, done: lesson.classworkDone),
            StepFact(kind: .homework, exists: lesson.assignmentId != nil, done: lesson.state == .completed),
        ]
    }

    static func session(_ lesson: RoadmapLesson, levelPassed: Bool, isNow: Bool) -> TrailSession {
        let facts = stepFacts(lesson)

        if levelPassed {
            let steps = facts.map { fact in
                SessionStep(kind: fact.kind, state: (fact.kind == .topic && !fact.exists) ? .notSet : .done)
            }
            return TrailSession(lesson: lesson, state: .completed, steps: steps)
        }

        guard isReleased(lesson) else {
            let steps = facts.map { fact in
                SessionStep(kind: fact.kind, state: (fact.kind == .topic && !fact.exists) ? .notSet : .locked)
            }
            return TrailSession(lesson: lesson, state: .locked, steps: steps)
        }

        let existing = facts.filter(\.exists)
        let completed = !existing.isEmpty && existing.allSatisfy(\.done) && lesson.state != .upcoming
        let state: TrailSessionState = completed ? .completed : (isNow ? .now : .open)

        let firstUndone: SessionStepKind? = state == .now ? existing.first(where: { !$0.done })?.kind : nil
        let steps = facts.map { fact -> SessionStep in
            let stepState: SessionStepState
            if !fact.exists {
                stepState = .notSet
            } else if fact.done {
                stepState = .done
            } else {
                stepState = fact.kind == firstUndone ? .now : .todo
            }
            return SessionStep(kind: fact.kind, state: stepState)
        }
        return TrailSession(lesson: lesson, state: state, steps: steps)
    }

    static func midtermState(_ lesson: RoadmapLesson, levelPassed: Bool) -> TrailSessionState {
        if levelPassed { return .completed }
        switch lesson.state {
        case .completed: return .completed
        case .available: return .open
        case .upcoming, nil: return .locked
        }
    }

    // MARK: The reward pill

    /// The attendance rule's default, when the rules have not loaded.
    public static let defaultAttendanceXP = 5
    /// The homework rule's default maximum, when the rules have not loaded.
    public static let defaultHomeworkXP = 15

    /// "Up to +N XP" on a session card: what attending pays plus the most its homework pays,
    /// read off the live `/rewards/rules/`.
    ///
    /// * Classwork is left out — a teacher prices it per carrier, so there is no ceiling to
    ///   quote.
    /// * An empty list means the rules have not loaded: the defaults, 5 + 15 = 20.
    /// * Once loaded, a rule the server does not serve is switched off, and one that pays no
    ///   XP (`grantsXP == false`) adds nothing — this is an XP pill, not a points pill.
    public static func xpCeiling(_ rules: [RewardRule]) -> Int {
        guard !rules.isEmpty else { return defaultAttendanceXP + defaultHomeworkXP }
        func xp(_ event: String) -> Int {
            guard let rule = rules.first(where: { $0.event == event }), rule.grantsXP else { return 0 }
            return max(0, rule.points)
        }
        return xp("ATTENDANCE_PRESENT") + xp("HOMEWORK")
    }
}

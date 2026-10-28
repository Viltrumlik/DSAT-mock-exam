import Foundation

// The Class tab's level pagers (the owner's "Class Tab" design): per subject, one card per
// rung of the roadmap's ladder — Math Foundation · Junior · Middle · Senior, English Junior ·
// Middle · Senior — each Completed, Current or Locked.

/// One level card.
public struct ClassLevelCard: Sendable, Equatable, Identifiable {
    public enum State: String, Sendable, Equatable {
        case completed
        case current
        case locked

        /// The card's pill.
        public var pillText: String {
            switch self {
            case .completed: return "Completed"
            case .current: return "Current"
            case .locked: return "Locked"
            }
        }
    }

    public let subject: ClassSubject
    /// `foundation`, `junior`, `middle` or `senior`.
    public let level: String
    public let levelLabel: String
    public let state: State
    /// "X / Y lessons covered".
    public let covered: Int
    public let total: Int
    /// 0…100, for the bar and the "%".
    public let percent: Int
    /// The rung below, for a locked card's "Unlocks after <previous>". Nil on every other card,
    /// and on a locked first rung.
    public let unlocksAfter: String?
    /// The section score this level stands for, from `LevelScoreLadder`. Nil when unpriced.
    public let sectionScore: Int?
    public let palette: LevelPalette
    /// False while the level's journal is unpublished: no lessons yet, whatever the state.
    public let lessonsPublished: Bool

    public var id: String { "\(subject.rawValue)-\(level)" }
    /// The current and completed cards open their class page; a locked one does not.
    public var opensClassPage: Bool { state != .locked }
}

/// One subject's pager: its cards in ladder order, and the page it opens on.
public struct ClassLevelPager: Sendable, Equatable, Identifiable {
    public let subject: ClassSubject
    public let subjectLabel: String
    /// The classroom the current level belongs to — where its class page reads from.
    public let classroomId: Int?
    public let cards: [ClassLevelCard]
    /// The current card. Nil when the track names no own level.
    public let currentIndex: Int?

    public var id: String { subject.rawValue }
    /// Where the pager opens: the current card, or the first.
    public var openingIndex: Int { currentIndex ?? 0 }
}

/// The rules, pinned by the tests:
///
/// * **State is the ladder position, never the lessons.** The student's own level (the
///   track's `is_own_level` rung) is current; every rung below it is completed, every rung
///   above it locked. The data can disagree — a level below with no delivery at all (the
///   student joined straight into Middle), an own level whose lessons are all done — and the
///   position still wins: the server hands out only the own level's state, so a rung below
///   cannot be "unfinished" in any way the app can see, and the student is in the class they
///   are in until they are moved.
/// * **No own level** (a class with no level set): every card is locked and the pager opens on
///   the first. Nothing is being withheld, but nothing is the student's to open either.
/// * **Covered.** Completed: the whole level (Y / Y, 100 %, even 0 / 0 for a rung never
///   published). Current: the own level's lessons whose state is `completed` — the server's
///   own `completed_lessons`, midterms included, so the card agrees with the roadmap's ring
///   everywhere else. It is homework done, not the session trail's all-three-steps count:
///   classwork paid by a teacher's hand can lag for days. Locked: 0.
/// * **Percent** rounds as the design does (`Math.round(done / total * 100)`); 0 when a
///   current or locked level has no lessons.
public enum ClassLevelCards {

    /// One pager per subject the build knows, Math first. A track with no levels has no pager.
    public static func pagers(for tracks: [RoadmapTrack]) -> [ClassLevelPager] {
        var seen: Set<ClassSubject> = []
        return tracks
            .compactMap { track -> ClassLevelPager? in
                guard let subject = ClassSubject(trackSubject: track.subject),
                      !seen.contains(subject), !track.levels.isEmpty else { return nil }
                seen.insert(subject)
                return ClassLevelPager(
                    subject: subject,
                    subjectLabel: track.subjectLabel,
                    classroomId: track.ownClassroomId,
                    cards: cards(for: track, subject: subject),
                    currentIndex: track.ownLevelIndex
                )
            }
            .sorted { $0.subject < $1.subject }
    }

    /// One track's cards, in the server's ladder order.
    public static func cards(for track: RoadmapTrack) -> [ClassLevelCard] {
        guard let subject = ClassSubject(trackSubject: track.subject) else { return [] }
        return cards(for: track, subject: subject)
    }

    static func cards(for track: RoadmapTrack, subject: ClassSubject) -> [ClassLevelCard] {
        let own = track.ownLevelIndex
        return track.levels.enumerated().map { index, level in
            let state = self.state(index: index, ownIndex: own)
            let total = max(level.lessonCount, level.lessons.count)
            let covered: Int
            switch state {
            case .completed: covered = total
            case .current: covered = min(total, level.lessons.filter { $0.state == .completed }.count)
            case .locked: covered = 0
            }
            return ClassLevelCard(
                subject: subject,
                level: level.level,
                levelLabel: level.levelLabel,
                state: state,
                covered: covered,
                total: total,
                percent: state == .completed ? 100 : percent(covered, of: total),
                unlocksAfter: (state == .locked && index > 0) ? track.levels[index - 1].levelLabel : nil,
                sectionScore: LevelScoreLadder.sectionScore(subject: subject, level: level.level),
                palette: LevelPalette(subject: subject, level: level.level),
                lessonsPublished: level.journalPublished
            )
        }
    }

    static func state(index: Int, ownIndex: Int?) -> ClassLevelCard.State {
        guard let ownIndex else { return .locked }
        if index < ownIndex { return .completed }
        if index == ownIndex { return .current }
        return .locked
    }

    /// `Math.round(done / total * 100)`, held to 0…100.
    static func percent(_ done: Int, of total: Int) -> Int {
        guard total > 0 else { return 0 }
        return min(100, max(0, RGB.jsRound(Double(done) / Double(total) * 100)))
    }
}

// MARK: - A class's page

extension ClassSubject {
    /// A classroom's `subject` as the server spells it (`MATH`, `ENGLISH`). Nil for a blank or
    /// unknown one.
    public init?(classroomSubject: String?) {
        switch (classroomSubject ?? "").trimmingCharacters(in: .whitespaces).uppercased() {
        case "MATH": self = .math
        case "ENGLISH": self = .english
        default: return nil
        }
    }
}

/// Which class page a link to one class opens (`AppLink.classroom`).
public enum ClassPageTarget {
    /// The rungs a class page can be drawn for.
    public static let levels: Set<String> = ["foundation", "junior", "middle", "senior"]

    /// The class's subject and level code, when both are ones the Class tab draws. Nil for a class
    /// with no level (a centre left it blank), a level code this build does not know, or a subject
    /// it does not: those links keep the classroom page.
    public static func key(for classroom: Classroom) -> (subject: ClassSubject, level: String)? {
        guard let subject = ClassSubject(classroomSubject: classroom.subject) else { return nil }
        let level = (classroom.level ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        guard levels.contains(level) else { return nil }
        return (subject, level)
    }
}

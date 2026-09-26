import Foundation

// The roadmap's rules, ported from the web (`frontend/src/features/roadmap/RoadmapPage.tsx`
// and `RoadmapStage.tsx`) so the phone and the laptop can never disagree about what a
// circle says or where its button goes. Pure functions; the tests pin every branch.

/// Where a rung sits relative to the student. Worked out on the client — the server says
/// only which level is theirs and whether each level's journal is published.
public enum RoadmapLevelState: String, Sendable, Equatable {
    case comingSoon = "coming_soon"
    case done
    case current
    case locked

    /// The status pill on the level's banner.
    public var pillText: String {
        switch self {
        case .comingSoon: return "Coming soon"
        case .done: return "Completed"
        case .current: return "Your level"
        case .locked: return "Locked"
        }
    }
}

/// What a circle on the path looks like. Distinct from the lesson's own state: a locked
/// LEVEL greys out every lesson in it, whatever the lesson itself says.
public enum RoadmapNodeState: String, Sendable, Equatable {
    case done
    case current
    case upcoming
    case milestone
    case locked
}

/// Everything the lesson sheet's button needs: its words, its colour, and where it goes.
public struct RoadmapLessonAction: Sendable, Equatable {
    public enum Target: Sendable, Equatable {
        /// The released homework, in the classroom the own level belongs to.
        case homework(classroomId: Int, assignmentId: Int)
        /// The reading that comes before it.
        case reading(deliveryId: Int)
    }

    /// The web's button classes: `is-green`, the brand default, `is-gold`, `is-grey`.
    public enum Tone: String, Sendable {
        case green, brand, gold, grey
    }

    public let node: RoadmapNodeState
    /// "Finished", "Open now", "Big test", "Coming soon" or "Locked".
    public let tag: String
    /// The button's words — the table's label, or "READ FIRST" / "NOT READY YET".
    public let label: String
    public let tone: Tone
    /// Nil when the button is disabled.
    public let target: Target?
    /// The delivery to re-open from the quiet "Read it again" link, once the reading is done.
    public let readAgainDeliveryId: Int?

    public var isEnabled: Bool { target != nil }
}

public enum RoadmapRules {

    // MARK: Levels

    /// `ownIndex == nil` means the track names no own level — a student between classes, or
    /// one whose classroom has no level set. Everything then reads as coming soon rather
    /// than locked: nothing is being withheld, the ladder just has no "you are here" yet.
    public static func levelState(journalPublished: Bool, index: Int, ownIndex: Int?) -> RoadmapLevelState {
        if !journalPublished { return .comingSoon }
        guard let ownIndex else { return .comingSoon }
        if index < ownIndex { return .done }
        if index == ownIndex { return .current }
        return .locked
    }

    /// Every rung of a track, in order.
    public static func levelStates(for track: RoadmapTrack) -> [RoadmapLevelState] {
        let own = track.ownLevelIndex
        return track.levels.enumerated().map { index, level in
            levelState(journalPublished: level.journalPublished, index: index, ownIndex: own)
        }
    }

    /// The line under a level's name.
    public static func subtitle(for level: RoadmapLevel, state: RoadmapLevelState) -> String {
        let count = level.lessons.count
        guard count > 0 else { return "Lessons are being prepared" }
        guard state == .current else { return "\(count) lessons" }
        let done = level.lessons.filter { $0.state == .completed }.count
        return "\(done) of \(count) lessons done"
    }

    /// Only the student's own level starts open; the page is tall, and opening every rung
    /// would bury the one they came to see.
    public static func opensByDefault(_ state: RoadmapLevelState) -> Bool { state == .current }

    // MARK: Lessons

    public static func nodeState(for lesson: RoadmapLesson, levelLocked: Bool) -> RoadmapNodeState {
        if levelLocked { return .locked }
        if lesson.state == .completed { return .done }
        if lesson.state == .available { return .current }
        // A midterm that is neither done nor open is still worth marking: it is the thing the
        // student is working towards.
        if lesson.isMidterm { return .milestone }
        return .upcoming
    }

    /// The web's `CTA` table, by circle state.
    static func table(_ node: RoadmapNodeState) -> (tag: String, label: String, tone: RoadmapLessonAction.Tone, enabled: Bool) {
        switch node {
        case .done: return ("Finished", "PRACTISE AGAIN", .green, true)
        case .current: return ("Open now", "START LESSON", .brand, true)
        case .milestone: return ("Big test", "START TEST", .gold, true)
        case .upcoming: return ("Coming soon", "NOT YET", .grey, false)
        case .locked: return ("Locked", "LOCKED", .grey, false)
        }
    }

    /// The lesson sheet's button.
    ///
    /// * Reading comes BEFORE the homework: a lesson with unread reading sends the student
    ///   there first ("READ FIRST"), and the homework waits at the bottom of it.
    /// * Once read, the button is the homework again and the reading becomes a quiet
    ///   "Read it again" link.
    /// * A lesson whose state allows opening but that has no homework behind it yet says
    ///   "NOT READY YET" rather than claiming it is not their turn. Midterms always land
    ///   here — their `assignment_id` is always null, and they are sat in the centre.
    public static func action(
        for lesson: RoadmapLesson,
        levelLocked: Bool,
        ownClassroomId: Int?
    ) -> RoadmapLessonAction {
        let node = nodeState(for: lesson, levelLocked: levelLocked)
        let cta = table(node)

        var homework: RoadmapLessonAction.Target?
        if cta.enabled, let assignmentId = positive(lesson.assignmentId), let classroomId = positive(ownClassroomId) {
            homework = .homework(classroomId: classroomId, assignmentId: assignmentId)
        }
        // `delivery_id` is emitted only for the own level, so reading is never offered on a
        // locked one — and never on a lesson whose state forbids opening at all.
        let readingId: Int? = (lesson.hasRoadmap && cta.enabled) ? positive(lesson.deliveryId) : nil
        let readFirst = readingId != nil && !lesson.roadmapRead

        let label: String
        let target: RoadmapLessonAction.Target?
        if readFirst, let readingId {
            label = "READ FIRST"
            target = .reading(deliveryId: readingId)
        } else if cta.enabled && homework == nil {
            label = "NOT READY YET"
            target = nil
        } else {
            label = cta.label
            target = homework
        }

        return RoadmapLessonAction(
            node: node,
            tag: cta.tag,
            label: label,
            tone: cta.tone,
            target: target,
            readAgainDeliveryId: readFirst ? nil : readingId
        )
    }

    /// The reading tag on a lesson's sheet: "Read ✓" once read, "Reading" before, nothing
    /// when there is nothing to read.
    public static func readingTag(for lesson: RoadmapLesson) -> String? {
        guard lesson.hasRoadmap else { return nil }
        return lesson.roadmapRead ? "Read ✓" : "Reading"
    }

    // MARK: The trail

    /// How far along the path the green "walked" line reaches: the index of the last circle
    /// it touches, or 0 for no green at all.
    ///
    /// A segment is walked when it ends on a finished circle, or starts on one — so the line
    /// runs through every finished lesson and on into the next one, the lesson in front of the
    /// student. It stops at the first gap: a stray finished lesson further along must not
    /// colour the road leading to it.
    public static func walkedThrough(_ done: [Bool]) -> Int {
        var reached = 0
        for index in done.indices.dropFirst() {
            guard index == reached + 1, done[index] || done[index - 1] else { break }
            reached = index
        }
        return reached
    }

    /// Horizontal rhythm of the path, as a multiple of its swing: centre, right, centre,
    /// left, and round again — the web's `WAVE`.
    public static func wave(at index: Int) -> Double {
        let pattern: [Double] = [0, 1, 0, -1]
        return pattern[((index % pattern.count) + pattern.count) % pattern.count]
    }

    private static func positive(_ value: Int?) -> Int? {
        guard let value, value > 0 else { return nil }
        return value
    }
}

// MARK: - Home's level chip

/// One level chip for Home's chip row: "Math · Middle · Next: Senior".
///
/// The web draws one per subject that names an own level and links it to the roadmap.
public struct RoadmapLevelChip: Sendable, Equatable, Identifiable {
    public let subject: String
    /// `subject_label` — the chip's small label.
    public let subjectLabel: String
    /// `own_level_label` — the chip's value.
    public let levelLabel: String
    /// "Next: {next_level_label}", or "Top level".
    public let detail: String

    public var id: String { subject }
}

extension RoadmapResponse {
    /// One chip per subject the student actually studies at a level — never a placeholder for
    /// one they do not.
    public var levelChips: [RoadmapLevelChip] {
        tracks.compactMap { track in
            guard let level = track.ownLevelLabel, !level.isEmpty else { return nil }
            let next = track.nextLevelLabel ?? ""
            return RoadmapLevelChip(
                subject: track.subject,
                subjectLabel: track.subjectLabel,
                levelLabel: level,
                detail: next.isEmpty ? "Top level" : "Next: \(next)"
            )
        }
    }
}

// MARK: - Reading content

/// A reading's plain-text passages.
public enum RoadmapText {
    /// Blank lines separate paragraphs and nothing else is interpreted — exactly the web's
    /// `body.split(/\n\s*\n/).map(trim).filter(Boolean)`. A single line break stays inside
    /// its paragraph.
    ///
    /// Since every piece is trimmed afterwards, that regex comes down to one rule: a run of
    /// whitespace holding two or more line feeds is a paragraph break. Scanned by Unicode
    /// scalar, not by `Character` — Swift folds `\r\n` into ONE character, which is not equal
    /// to `"\n"`, and a Windows-typed passage would come out as a single paragraph.
    public static func paragraphs(_ body: String) -> [String] {
        var parts: [String] = []
        var current = String.UnicodeScalarView()
        var pending = String.UnicodeScalarView()
        var lineFeeds = 0
        for scalar in body.unicodeScalars {
            if scalar.properties.isWhitespace {
                pending.append(scalar)
                if scalar == "\n" { lineFeeds += 1 }
                continue
            }
            if lineFeeds >= 2 {
                parts.append(String(current))
                current = String.UnicodeScalarView()
            } else {
                current.append(contentsOf: pending)
            }
            pending = String.UnicodeScalarView()
            lineFeeds = 0
            current.append(scalar)
        }
        parts.append(String(current))
        return parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

/// Where a reading's video plays.
///
/// The web embeds YouTube and Vimeo in an iframe and plays anything else in `<video>`. A
/// phone has no iframe to offer, so those two hosts open in their own app instead, and every
/// other address — an uploaded file's signed URL, in practice — plays in the app.
public enum RoadmapVideoLink: Sendable, Equatable {
    case external(URL)
    case file(URL)

    public init?(_ raw: String?) {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let rawHost = url.host?.lowercased(), !rawHost.isEmpty else { return nil }
        let host = rawHost.hasPrefix("www.") ? String(rawHost.dropFirst(4)) : rawHost
        // Every YouTube and Vimeo address, not just the watch/embed forms the web recognises:
        // a `/shorts/` link is a web page, and handing a page to a video player shows nothing.
        let hosted = ["youtu.be", "youtube.com", "youtube-nocookie.com", "vimeo.com"]
            .contains { host == $0 || host.hasSuffix(".\($0)") }
        self = hosted ? .external(url) : .file(url)
    }

    public var url: URL {
        switch self {
        case .external(let url), .file(let url): return url
        }
    }
}

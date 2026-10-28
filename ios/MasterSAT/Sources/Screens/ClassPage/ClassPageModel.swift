import SwiftUI
import MasterSATKit

/// Everything the class page draws for one subject at one level, read off three sources: the
/// roadmap (the sessions), the student's classes (the class card) and the reward rules (the XP
/// pill). Built by `ClassPageContent.make`, which the model calls once all three have answered.
struct ClassPageContent: Equatable {
    let subject: ClassSubject
    /// "Junior".
    let levelLabel: String
    /// "Math", or the track's own label.
    let subjectLabel: String
    let trail: SessionTrail
    /// The level is behind the student: every session reads as completed (`SessionTrail`).
    let levelPassed: Bool
    /// The student's class at this level — its name, days and time, room and teacher, and the
    /// Class info sheet. Nil on a level behind them that no class of theirs is tagged with: the
    /// card then shows the level's name only, and opens nothing.
    let classroom: Classroom?
    /// `/classes/` has not answered on this page: the card says the class's details did not load
    /// rather than standing there with no days, room or teacher, as if the class had none.
    let classesFailed: Bool
    /// The classroom the sessions' homework and classwork open in. The roadmap names it for the
    /// student's own level (`own_classroom_id`); a level behind them carries no ids to open.
    let workClassroomId: Int?
    /// "Up to +N XP" on every session card (owner's Q2). Nil when the rules did not load: the
    /// cards then show no pill rather than a number the server never said.
    let xpCeiling: Int?

    /// The class card's title: the class's own name, or "Junior Math" when there is no class.
    var title: String {
        if let name = classroom?.name.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        return "\(levelLabel) \(subjectLabel)"
    }

}

extension ClassPageContent {
    /// The page's name before anything has loaded: "Junior Math".
    static func placeholderTitle(for route: ClassPageRoute) -> String {
        "\(ProfileClasses.levelLabel(route.level) ?? route.level.capitalized) \(fallbackSubjectLabel(route.subject))"
    }

    static func fallbackSubjectLabel(_ subject: ClassSubject) -> String {
        subject == .math ? "Math" : "English"
    }

    /// The page for `route`, from what the three sources said.
    ///
    /// * **Track and level** are found by subject and level code. A subject the student does not
    ///   study, or a level the ladder does not have, is a page with no sessions — never an error.
    /// * **Passed** is the Class tab's own rule (`ClassLevelCards`): a rung below the student's
    ///   own level is completed.
    /// * **The class** is the student's membership in that subject at that level. On their own
    ///   level the roadmap's `own_classroom_id` wins over a level tag, which a centre may have left
    ///   blank or got wrong. `classrooms` is nil when `/classes/` failed: the card then shows the
    ///   level's name and says the details did not load, and the sessions still open (their
    ///   classroom id is the roadmap's).
    static func make(
        route: ClassPageRoute,
        roadmap: RoadmapResponse,
        classrooms: [Classroom]?,
        rules: [RewardRule]
    ) -> ClassPageContent {
        let wanted = route.level.lowercased()
        let track = roadmap.tracks.first { ClassSubject(trackSubject: $0.subject) == route.subject }
        let level = track?.levels.first { $0.level.lowercased() == wanted }
        let card = track.flatMap { ClassLevelCards.cards(for: $0).first { $0.level.lowercased() == wanted } }
        let passed = card?.state == .completed
        let isOwnLevel = card?.state == .current

        let rooms = ProfileClasses.memberships(classrooms ?? [])
        let ownId = isOwnLevel ? track?.ownClassroomId : nil
        let tagged = rooms.filter { room in
            room.isMath == (route.subject == .math) && (room.level ?? "").lowercased() == wanted
        }
        let classroom = tagged.first { $0.id == ownId }
            ?? rooms.first { $0.id == ownId }
            ?? tagged.first

        return ClassPageContent(
            subject: route.subject,
            levelLabel: level?.levelLabel ?? ProfileClasses.levelLabel(route.level) ?? route.level.capitalized,
            subjectLabel: track?.subjectLabel ?? fallbackSubjectLabel(route.subject),
            trail: SessionTrail(lessons: level?.lessons ?? [], levelPassed: passed),
            levelPassed: passed,
            classroom: classroom,
            classesFailed: classrooms == nil,
            workClassroomId: ownId ?? classroom?.id,
            xpCeiling: SessionTrail.xpCeiling(rules)
        )
    }
}

/// Where a step's node goes, through the `AppLink`s every tab stack already resolves
/// (`AppLinkPage`): the reading, and the homework page — which is also the classwork page.
enum ClassPageLinks {
    /// Nil for a step that is locked or not set, and for one whose id the server withheld.
    static func link(_ kind: SessionStepKind, in session: TrailSession, classroomId: Int?) -> AppLink? {
        let step = session.step(kind)
        guard step.exists, step.state != .locked, step.state != .notYet else { return nil }
        let lesson = session.lesson
        switch kind {
        case .topic:
            return lesson.deliveryId.map { AppLink.roadmapDelivery(id: $0) }
        case .classwork:
            guard let classroomId, let id = lesson.classworkAssignmentId else { return nil }
            return .homework(classroomId: classroomId, assignmentId: id)
        case .homework:
            guard let classroomId, let id = lesson.assignmentId else { return nil }
            return .homework(classroomId: classroomId, assignmentId: id)
        }
    }

    /// A midterm is sat on a laptop; the app shows its schedule and, once marked, its report —
    /// both on the midterms page. A locked one opens nothing.
    static func link(_ midterm: TrailMidterm) -> AppLink? {
        midterm.state == .locked ? nil : .midterms
    }
}

/// The class page's loading: the three sources together, and the page's one phase.
@MainActor
@Observable
final class ClassPageModel {
    enum Phase: Equatable {
        case loading
        case failed(String)
        case loaded(ClassPageContent)
    }

    private(set) var phase: Phase = .loading
    /// The last refresh failed over a page already on screen. The page stays; one line says so.
    private(set) var refreshFailed = false
    /// The last answers from the two sources that only dress the page. A refresh that loses one
    /// keeps what the page already showed — a real answer, if an older one — instead of
    /// stripping the class card or the XP pills; nothing here is ever a made-up default.
    @ObservationIgnored private var lastClassrooms: [Classroom]?
    @ObservationIgnored private var lastRules: [RewardRule]?

    var content: ClassPageContent? {
        if case .loaded(let content) = phase { return content }
        return nil
    }

    /// Runs on every appearance (a homework finished, a reading read), so the trail moves on
    /// without a pull. The roadmap is the page: its failure is the page's failure, unless the page
    /// is already up. The classes and the rules only dress it: a failure keeps their last answer,
    /// and with none, the card says the details did not load and the XP pills stay hidden.
    func load(route: ClassPageRoute, session: Session) async {
        let roadmapAPI = RoadmapAPI(client: session.client)
        let classroomsAPI = session.classrooms
        let rewardsAPI = session.rewards
        async let roadmapRequest = roadmapAPI.roadmap()
        async let roomsRequest = classroomsAPI.classrooms()
        async let rulesRequest = rewardsAPI.rules()

        let roadmap: RoadmapResponse
        do {
            roadmap = try await roadmapRequest
        } catch where Task.isCancelled {
            // Leaving the page cancels `.task`, and `APIClient` wraps that as a transport failure:
            // nothing is stored, so the page that comes back simply loads again.
            return
        } catch {
            if content == nil {
                phase = .failed(learnMoreMessage(error))
            } else if !refreshFailed {
                refreshFailed = true
            }
            return
        }
        let rooms = try? await roomsRequest
        let rules = try? await rulesRequest
        if Task.isCancelled { return }
        if let rooms { lastClassrooms = rooms }
        if let rules { lastRules = rules }

        let fresh = ClassPageContent.make(
            route: route, roadmap: roadmap, classrooms: lastClassrooms, rules: lastRules ?? []
        )
        // An unchanged page is not written again: the trail would re-render for nothing.
        if phase != .loaded(fresh) { phase = .loaded(fresh) }
        if refreshFailed { refreshFailed = false }
    }

    /// "Try again" from the error state: back to the skeleton while it runs.
    func retry(route: ClassPageRoute, session: Session) async {
        if case .failed = phase { phase = .loading }
        await load(route: route, session: session)
    }
}

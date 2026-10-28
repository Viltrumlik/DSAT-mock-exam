import Foundation
import Testing
@testable import MasterSATKit

/// A lesson on the student's own level. The defaults are a session not released yet.
private func lesson(
    _ number: Int,
    _ state: RoadmapLessonState? = .upcoming,
    delivery: Int? = nil,
    homework: Int? = nil,
    reading: Bool = false,
    read: Bool = false,
    classwork: Int? = nil,
    classworkDone: Bool = false,
    midterm: Bool = false
) -> RoadmapLesson {
    RoadmapLesson(
        lessonNumber: number,
        title: midterm ? "Midterm \(number)" : "Lesson \(number)",
        lessonType: midterm ? "MIDTERM" : "HOMEWORK",
        isMidterm: midterm,
        state: state,
        assignmentId: homework,
        deliveryId: delivery,
        hasRoadmap: reading,
        roadmapRead: read,
        classworkAssignmentId: classwork,
        classworkDone: classworkDone
    )
}

/// A released session with all three steps, and how far through it the student is.
private func released(_ number: Int, topicRead: Bool = false, classworkDone: Bool = false, homeworkDone: Bool = false) -> RoadmapLesson {
    lesson(
        number, homeworkDone ? .completed : .available,
        delivery: 900 + number, homework: 500 + number,
        reading: true, read: topicRead,
        classwork: 700 + number, classworkDone: classworkDone
    )
}

private func states(_ session: TrailSession) -> [SessionStepState] { session.steps.map(\.state) }

@Suite struct SessionTrailTests {

    @Test("Each step exists only when the lesson has it, and is done on its own flag")
    func steps() throws {
        let trail = SessionTrail(lessons: [released(1, topicRead: true)])
        let session = try #require(trail.sessions.first)
        #expect(session.steps.map(\.kind) == [.topic, .classwork, .homework])
        #expect(states(session) == [.done, .now, .todo])
        #expect(session.state == .now)
        #expect(session.nowStep == .classwork)
        #expect(session.doneCount == 1)
        #expect(session.existingCount == 3)
        #expect(session.step(.homework).state == .todo)
        #expect(trail.nowSessionId == 1)
    }

    @Test("No reading: Topic is not set and not counted, and the trail starts at Classwork")
    func noReading() throws {
        let noTopic = lesson(1, .available, delivery: 901, homework: 501, classwork: 701, classworkDone: true)
        let session = try #require(SessionTrail(lessons: [noTopic]).sessions.first)
        #expect(states(session) == [.notSet, .done, .now])
        #expect(!session.step(.topic).exists)
        #expect(session.doneCount == 1)
        #expect(session.existingCount == 2)
        #expect(session.nowStep == .homework)
    }

    @Test("No classwork handed out: the trail goes from Topic straight to Homework")
    func noClasswork() throws {
        let noClasswork = lesson(1, .available, delivery: 901, homework: 501, reading: true, read: true)
        let session = try #require(SessionTrail(lessons: [noClasswork]).sessions.first)
        #expect(states(session) == [.done, .notSet, .now])
        #expect(session.doneCount == 1)
        #expect(session.existingCount == 2)
    }

    @Test("Everything done: every session completed, every step checked, nothing to scroll to")
    func everythingDone() {
        let trail = SessionTrail(lessons: [
            released(1, topicRead: true, classworkDone: true, homeworkDone: true),
            lesson(2, .completed, delivery: 902, homework: 502),  // homework only, done
        ])
        #expect(trail.sessions.map(\.state) == [.completed, .completed])
        #expect(states(trail.sessions[0]) == [.done, .done, .done])
        #expect(states(trail.sessions[1]) == [.notSet, .notSet, .done])
        #expect(trail.sessions[1].doneCount == 1)
        #expect(trail.sessions[1].existingCount == 1)
        #expect(trail.sessions.allSatisfy { $0.nowStep == nil })
        #expect(trail.nowSessionId == nil)
    }

    @Test("Nothing released: every session locked — Topic only where there is a reading, the rest locked")
    func nothingReleased() {
        let trail = SessionTrail(lessons: [lesson(1, reading: true), lesson(2)])
        #expect(trail.sessions.map(\.state) == [.locked, .locked])
        #expect(states(trail.sessions[0]) == [.locked, .locked, .locked])
        #expect(states(trail.sessions[1]) == [.notSet, .locked, .locked])
        #expect(trail.sessions[0].existingCount == 3)
        #expect(trail.sessions[1].existingCount == 2)
        #expect(trail.sessions.allSatisfy { $0.doneCount == 0 })
        #expect(trail.nowSessionId == nil)
    }

    @Test("A lesson with no state and no delivery — an outline — is not a release")
    func outlineIsLocked() {
        let trail = SessionTrail(lessons: [lesson(1, nil, reading: true)])
        #expect(trail.sessions.first?.state == .locked)
        // A delivery row is a release even before the homework is: the teacher has been there.
        #expect(SessionTrail.isReleased(lesson(2, .upcoming, delivery: 902)))
        #expect(!SessionTrail.isReleased(lesson(3, .upcoming)))
        #expect(SessionTrail.isReleased(lesson(4, .available)))
    }

    @Test("Only the FIRST released, unfinished session is now; a later one is open, with no now step")
    func onlyOneNow() {
        let trail = SessionTrail(lessons: [
            released(1, topicRead: true, classworkDone: true, homeworkDone: true),
            released(2, topicRead: true),
            released(3),
            lesson(4, reading: true),
        ])
        #expect(trail.sessions.map(\.state) == [.completed, .now, .open, .locked])
        #expect(states(trail.sessions[1]) == [.done, .now, .todo])
        #expect(states(trail.sessions[2]) == [.todo, .todo, .todo])
        #expect(trail.sessions[2].nowStep == nil)
        #expect(trail.nowSessionId == 2)
        #expect(trail.items.filter { if case .session(let s) = $0 { return s.nowStep != nil } else { return false } }.count == 1)
    }

    @Test("A session left behind stays open; the now is the first gap, not the class's furthest lesson")
    func leftBehind() {
        let trail = SessionTrail(lessons: [
            released(1, topicRead: true, classworkDone: true),  // homework never finished
            released(2, topicRead: true, classworkDone: true, homeworkDone: true),
            released(3),
        ])
        #expect(trail.sessions.map(\.state) == [.now, .completed, .open])
        #expect(trail.sessions[0].nowStep == .homework)
        #expect(trail.nowSessionId == 1)
    }

    @Test("A midterm in between becomes a marker with its own state, and is never the now session")
    func midtermMarker() {
        let trail = SessionTrail(lessons: [
            released(11, topicRead: true, classworkDone: true, homeworkDone: true),
            lesson(12, .available, delivery: 912, midterm: true),
            released(13),
            lesson(24, .upcoming, midterm: true),
        ])
        #expect(trail.items.map(\.id) == [11, 12, 13, 24])
        guard case .midterm(let open) = trail.items[1], case .midterm(let later) = trail.items[3] else {
            Issue.record("midterms must be markers")
            return
        }
        #expect(open.state == .open)
        #expect(later.state == .locked)
        #expect(trail.sessions.map(\.id) == [11, 13])
        #expect(trail.nowSessionId == 13)

        let sat = SessionTrail(lessons: [lesson(12, .completed, delivery: 912, midterm: true)])
        #expect(sat.items == [.midterm(TrailMidterm(lesson: lesson(12, .completed, delivery: 912, midterm: true), state: .completed))])
        #expect(sat.nowSessionId == nil)
    }

    @Test("Not completed while work is still to come: homework unreleased, or nothing handed out yet")
    func completionGuards() {
        // Read and classwork done in class, homework not released yet (state upcoming).
        let homeworkPending = lesson(1, .upcoming, delivery: 901, reading: true, read: true, classwork: 701, classworkDone: true)
        // Delivered, and nothing handed out at all.
        let nothingYet = lesson(2, .upcoming, delivery: 902)
        let trail = SessionTrail(lessons: [homeworkPending, nothingYet])
        #expect(trail.sessions.map(\.state) == [.now, .open])
        #expect(states(trail.sessions[0]) == [.done, .done, .notSet])
        #expect(trail.sessions[0].doneCount == 2)
        #expect(trail.sessions[0].existingCount == 2)
        #expect(trail.sessions[0].nowStep == nil)
        #expect(trail.sessions[1].existingCount == 0)
        #expect(trail.nowSessionId == 1)
    }

    @Test("Rows come out in lesson order, whatever order they arrive in")
    func lessonOrder() {
        let trail = SessionTrail(lessons: [lesson(3), lesson(1, .available, delivery: 901, homework: 501), lesson(2, .upcoming, midterm: true)])
        #expect(trail.items.map(\.id) == [1, 2, 3])
        #expect(trail.nowSessionId == 1)
    }

    @Test("A level behind the student is finished whole, though its lessons are bare outlines")
    func passedLevel() {
        let trail = SessionTrail(
            lessons: [lesson(1, nil, reading: true), lesson(2, nil), lesson(3, nil, midterm: true)],
            levelPassed: true
        )
        #expect(trail.sessions.map(\.state) == [.completed, .completed])
        #expect(states(trail.sessions[0]) == [.done, .done, .done])
        #expect(states(trail.sessions[1]) == [.notSet, .done, .done])
        guard case .midterm(let midterm) = trail.items[2] else {
            Issue.record("the midterm must stay a marker")
            return
        }
        #expect(midterm.state == .completed)
        #expect(trail.nowSessionId == nil)
    }

    @Test("Badges: three words for four states")
    func badges() {
        #expect(TrailSessionState.completed.badgeText == "Completed")
        #expect(TrailSessionState.now.badgeText == "In progress")
        #expect(TrailSessionState.open.badgeText == "In progress")
        #expect(TrailSessionState.locked.badgeText == "Locked")
        #expect(SessionStepKind.allCases.map(\.title) == ["Topic", "Classwork", "Homework"])
    }

    @Test("Empty level: no rows, nothing to scroll to")
    func empty() {
        let trail = SessionTrail(lessons: [])
        #expect(trail.items.isEmpty)
        #expect(trail.nowSessionId == nil)
    }
}

@Suite struct SessionXPCeilingTests {

    @Test("Rules not loaded: the defaults, 5 + 15")
    func defaults() {
        #expect(SessionTrail.xpCeiling([]) == 20)
    }

    @Test("Live rules: attendance plus the homework maximum — classwork is teacher-priced and left out")
    func liveRules() {
        let rules = [
            RewardRule(event: "ATTENDANCE_PRESENT", label: "Attended", points: 7),
            RewardRule(event: "HOMEWORK", label: "Homework", points: 25),
            RewardRule(event: "CLASSWORK_MANUAL", label: "Classwork", points: 50),
            RewardRule(event: "ATTENDANCE_LATE", label: "Late", points: 3),
        ]
        #expect(SessionTrail.xpCeiling(rules) == 32)
    }

    @Test("A rule that pays no XP, or is switched off, adds nothing")
    func noXP() {
        let pointsOnly = [
            RewardRule(event: "ATTENDANCE_PRESENT", label: "Attended", points: 5, grantsXP: false),
            RewardRule(event: "HOMEWORK", label: "Homework", points: 15),
        ]
        #expect(SessionTrail.xpCeiling(pointsOnly) == 15)

        let noHomework = [RewardRule(event: "ATTENDANCE_PRESENT", label: "Attended", points: 5)]
        #expect(SessionTrail.xpCeiling(noHomework) == 5)

        let negative = [RewardRule(event: "HOMEWORK", label: "Homework", points: -4)]
        #expect(SessionTrail.xpCeiling(negative) == 0)
    }
}

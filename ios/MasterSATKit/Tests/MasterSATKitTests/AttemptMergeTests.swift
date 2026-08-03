import Foundation
import Testing
@testable import MasterSATKit

/// State must only ever move forward. The runner learns the attempt's state from the poll,
/// from submit responses and from autosave responses at once, and a slow response can land
/// after a newer one — applying it would rewind the student's exam.
@Suite struct AttemptMergeTests {

    @Test("The first snapshot is always accepted")
    func firstSnapshotAccepted() {
        let next = AttemptFixtures.attempt(version: 1, moduleOrder: 1)
        #expect(AttemptMerge.shouldAccept(previous: nil, next: next))
    }

    @Test("An older version is rejected")
    func olderVersionRejected() {
        let previous = AttemptFixtures.attempt(version: 5, moduleOrder: 1)
        let stale = AttemptFixtures.attempt(version: 4, moduleOrder: 1)
        #expect(AttemptMerge.shouldAccept(previous: previous, next: stale) == false)
        #expect(AttemptMerge.merge(previous: previous, next: stale) == previous)
    }

    @Test("An equal version is accepted")
    func equalVersionAccepted() {
        // Equal versions are not a regression — a status poll and a save response can
        // legitimately describe the same version, and refusing one would strand the runner.
        let previous = AttemptFixtures.attempt(version: 5, moduleOrder: 1)
        let next = AttemptFixtures.attempt(version: 5, moduleOrder: 1)
        #expect(AttemptMerge.shouldAccept(previous: previous, next: next))
    }

    @Test("A module regression while active is rejected")
    func moduleRegressionRejected() {
        // A stale poll issued before the module advanced would drag the student back into
        // Module 1 — with Module 2's clock still running on the server.
        let previous = AttemptFixtures.attempt(version: 9, moduleOrder: 2)
        let stale = AttemptFixtures.attempt(version: 9, moduleOrder: 1)
        #expect(AttemptMerge.shouldAccept(previous: previous, next: stale) == false)
    }

    @Test("A module advance is accepted")
    func moduleAdvanceAccepted() {
        let previous = AttemptFixtures.attempt(version: 9, moduleOrder: 1)
        let next = AttemptFixtures.attempt(version: 10, moduleOrder: 2)
        #expect(AttemptMerge.shouldAccept(previous: previous, next: next))
    }

    @Test("A completed snapshot is accepted despite having no active module")
    func completedSnapshotAccepted() {
        // SCORING and COMPLETED legitimately have no module payload; treating that as a
        // module regression would leave the runner stuck on the last question forever.
        let previous = AttemptFixtures.attempt(version: 9, moduleOrder: 2)
        let finished = AttemptFixtures.attempt(
            AttemptFixtures.json(state: "COMPLETED", version: 10, moduleId: nil, isCompleted: true)
        )
        #expect(AttemptMerge.shouldAccept(previous: previous, next: finished))
    }

    // MARK: - Derived state

    @Test("Active states are recognised")
    func activeStatesRecognised() {
        #expect(AttemptFixtures.attempt(["current_state": "MODULE_1_ACTIVE"]).isActive)
        #expect(AttemptFixtures.attempt(["current_state": "MODULE_2_ACTIVE"]).isActive)
        #expect(AttemptFixtures.attempt(["current_state": "SCORING"]).isActive == false)
    }

    @Test("Active with no module payload is an error state")
    func missingModulePayloadIsAnError() {
        // "Active but no questions" must surface as a recovery screen, never as a blank
        // exam the student silently fails.
        let broken = AttemptFixtures.attempt(AttemptFixtures.json(state: "MODULE_1_ACTIVE", moduleId: nil))
        #expect(broken.isModulePayloadMissing)
    }

    @Test("Scoring without a module is not an error state")
    func scoringWithoutModuleIsFine() {
        let scoring = AttemptFixtures.attempt(AttemptFixtures.json(state: "SCORING", moduleId: nil))
        #expect(scoring.isModulePayloadMissing == false)
        #expect(scoring.isTerminal)
    }
}

import Foundation
import Testing
@testable import MasterSATKit

/// The delay table is the app's answer to "har bir savol save bo'lsin" — every answer gets
/// saved. These tests pin the numbers, because the failure they prevent is silent: an
/// answer held a moment too long simply grades Omitted, with nothing in the UI to show for
/// it.
@Suite struct AutosavePolicyTests {

    let policy = AutosavePolicy()
    let now = Date(timeIntervalSince1970: 1_000_000)

    private func context(
        changed: [String] = ["100"],
        textIds: Set<String> = [],
        dirtySince: Date? = nil,
        lastIssuedAt: Date? = nil,
        isEnabled: Bool = true,
        isActive: Bool = true,
        liveModuleId: Int? = 10,
        answersModuleId: Int? = 10,
        isSubmitting: Bool = false,
        isOnline: Bool = true,
        acceptedSignature: String? = nil,
        pendingSignature: String = "pending"
    ) -> AutosavePolicy.Context {
        AutosavePolicy.Context(
            isEnabled: isEnabled,
            isAttemptActive: isActive,
            liveModuleId: liveModuleId,
            answersModuleId: answersModuleId,
            isSubmitting: isSubmitting,
            isOnline: isOnline,
            acceptedSignature: acceptedSignature,
            pendingSignature: pendingSignature,
            changedQuestionIds: changed,
            textInputQuestionIds: textIds,
            dirtySince: dirtySince,
            lastIssuedAt: lastIssuedAt,
            now: now
        )
    }

    private func isClose(_ a: TimeInterval, _ b: TimeInterval) -> Bool { abs(a - b) < 0.0001 }

    // MARK: - The delay table

    @Test("A discrete choice is sent immediately")
    func discreteChoiceIsImmediate() {
        // Choosing an option is one discrete, final act. Sitting on it for a debounce is
        // how an answer given in a module's last second reaches only the submit payload.
        #expect(policy.delay(for: context(changed: ["100"])) == 0)
    }

    @Test("Grid-in typing coalesces for 400ms")
    func gridInCoalesces() {
        #expect(isClose(policy.delay(for: context(changed: ["101"], textIds: ["101"], dirtySince: now)), 0.4))
    }

    @Test("Grid-in typing is never held past the 1.2s max wait")
    func gridInRespectsMaxWait() {
        // A second of continuous typing has already elapsed: only 0.2s of the 1.2s cap is
        // left, and that — not the 0.4s debounce — is what may still be waited.
        let dirtySince = now.addingTimeInterval(-1.0)
        #expect(isClose(policy.delay(for: context(changed: ["101"], textIds: ["101"], dirtySince: dirtySince)), 0.2))
    }

    @Test("Grid-in past the max wait goes out at once")
    func gridInPastMaxWaitIsImmediate() {
        let dirtySince = now.addingTimeInterval(-5)
        #expect(policy.delay(for: context(changed: ["101"], textIds: ["101"], dirtySince: dirtySince)) == 0)
    }

    @Test("A flag-only change takes the full debounce")
    func flagOnlyTakesDebounce() {
        // Nothing changed among the answers — flags are not graded, so they can wait.
        #expect(isClose(policy.delay(for: context(changed: [])), 1.5))
    }

    @Test("A bulk change takes the full debounce")
    func bulkTakesDebounce() {
        // Many answers at once is rehydration, not a student: a student answers one at a
        // time. Blasting a freshly-restored map at the server instantly is how a module's
        // saved work gets overwritten before it has even been shown.
        #expect(isClose(policy.delay(for: context(changed: ["100", "101", "102"])), 1.5))
    }

    // MARK: - Rate floor

    @Test("The rate floor spaces out rapid changes")
    func rateFloorSpacesRapidChanges() {
        // A save was issued 100ms ago, so the next one waits out the remaining 200ms.
        #expect(isClose(policy.delay(for: context(changed: ["100"], lastIssuedAt: now.addingTimeInterval(-0.1))), 0.2))
    }

    @Test("The first change is not delayed by the rate floor")
    func firstChangeIsNotFloored() {
        #expect(policy.delay(for: context(changed: ["100"], lastIssuedAt: nil)) == 0)
    }

    @Test("The rate floor lapses once the interval has passed")
    func rateFloorLapses() {
        #expect(policy.delay(for: context(changed: ["100"], lastIssuedAt: now.addingTimeInterval(-2))) == 0)
    }

    // MARK: - Guards

    @Test("A client that does not own the attempt neither sends nor drafts")
    func disabledClientDoesNothing() {
        let decision = policy.decide(context(isEnabled: false))
        #expect(decision.action == .stayPut(.notOwner))
        // Nothing is written either: the answers cannot be trusted to belong here.
        #expect(decision.shouldWriteDraft == false)
    }

    @Test("Answers from another module are never sent")
    func moduleMismatchIsRefused() {
        // save_attempt REPLACES the module's answer map, so writing Module 1's answers
        // after the attempt advanced would destroy Module 2's real work.
        let decision = policy.decide(context(liveModuleId: 11, answersModuleId: 10))
        #expect(decision.action == .stayPut(.moduleMismatch))
        #expect(decision.shouldWriteDraft == false)
    }

    @Test("A submit in flight stands the autosave down but still drafts")
    func submittingStandsDown() {
        let decision = policy.decide(context(isSubmitting: true))
        #expect(decision.action == .stayPut(.submitting))
        // The draft is the crash-safety copy and must survive the submit either way.
        #expect(decision.shouldWriteDraft)
    }

    @Test("Offline keeps the work locally")
    func offlineKeepsWorkLocal() {
        let decision = policy.decide(context(isOnline: false))
        #expect(decision.action == .stayPut(.offline))
        #expect(decision.shouldWriteDraft)
    }

    @Test("An already-accepted payload is not re-sent")
    func alreadySentIsNotResent() {
        // Re-sending only churns version_number, which is what turns a concurrent flush
        // into a 409 burst.
        let decision = policy.decide(context(acceptedSignature: "same", pendingSignature: "same"))
        #expect(decision.action == .stayPut(.alreadySent))
    }

    @Test("A changed payload is sent")
    func changedPayloadIsSent() {
        let decision = policy.decide(context(acceptedSignature: "old", pendingSignature: "new"))
        #expect(decision.action == .send(after: 0))
        #expect(decision.shouldWriteDraft)
    }
}

@Suite struct AutosavePayloadTests {

    @Test("The signature is order-independent")
    func signatureIsOrderIndependent() {
        let a = AutosavePayload.signature(answers: ["1": "A", "2": "B"], flagged: [5, 3])
        let b = AutosavePayload.signature(answers: ["2": "B", "1": "A"], flagged: [3, 5])
        #expect(a == b)
    }

    @Test("The signature distinguishes payloads a naive join would confuse")
    func signatureDistinguishesAmbiguousPayloads() {
        // The regression this exists for: with a separator that can occur in the data,
        // {"3":"12"} + flagged[5] and {"3":"125"} + flagged[] sign identically — so a
        // changed answer reads as "already sent" and is dropped in silence.
        let a = AutosavePayload.signature(answers: ["3": "12"], flagged: [5])
        let b = AutosavePayload.signature(answers: ["3": "125"], flagged: [])
        #expect(a != b)
    }

    @Test("The signature changes when an answer changes")
    func signatureTracksAnswerChanges() {
        let before = AutosavePayload.signature(answers: ["1": "A"], flagged: [])
        let after = AutosavePayload.signature(answers: ["1": "B"], flagged: [])
        #expect(before != after)
    }

    @Test("Changed ids cover addition, removal and edit")
    func changedIdsCoverEveryKind() {
        let changed = AutosavePayload.changedAnswerIds(
            from: ["1": "A", "2": "B", "3": "C"],
            to: ["1": "A", "2": "Z", "4": "D"]
        )
        // 2 edited, 3 removed, 4 added; 1 untouched.
        #expect(changed == ["2", "3", "4"])
    }

    @Test("No change reads as empty")
    func noChangeIsEmpty() {
        #expect(AutosavePayload.changedAnswerIds(from: ["1": "A"], to: ["1": "A"]).isEmpty)
    }
}

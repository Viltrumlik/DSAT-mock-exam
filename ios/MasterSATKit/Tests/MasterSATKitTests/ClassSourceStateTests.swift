import Testing
@testable import MasterSATKit

/// Every mutating call is made on its own line, never inside `#expect`.
@Suite struct ClassSourceStateTests {

    private func finished(_ start: ClassSourceState, succeeded: Bool) -> ClassSourceState {
        var state = start
        state.finish(succeeded: succeeded)
        return state
    }

    @Test("A list that arrives is loaded, whatever it was")
    func succeeds() {
        for start in [ClassSourceState.pending, .loaded, .failed] {
            #expect(finished(start, succeeded: true) == .loaded)
        }
    }

    @Test("A failure with nothing to keep is failed — a retry, never an empty state")
    func failsEmpty() {
        #expect(finished(.pending, succeeded: false) == .failed)
        #expect(finished(.failed, succeeded: false) == .failed)
    }

    @Test("A failure after a good load keeps what is on screen")
    func failureKeepsLoaded() {
        #expect(finished(.loaded, succeeded: false) == .loaded)
    }

    @Test("A source that failed and was retried is loaded once it arrives")
    func retry() {
        var state = ClassSourceState.pending
        state.finish(succeeded: false)
        #expect(state == .failed)
        state = .pending
        state.finish(succeeded: true)
        #expect(state == .loaded)
        state.finish(succeeded: false)
        #expect(state == .loaded, "the last good data stays")
    }
}

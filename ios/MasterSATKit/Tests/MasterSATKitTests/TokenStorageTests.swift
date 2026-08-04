import Foundation
import Testing
@testable import MasterSATKit

/// Storage that refuses every write, standing in for a locked device or a build with no
/// keychain entitlement — which is exactly how this was found: the app signed in, the
/// keychain silently refused the write, and the very next request said "please sign in".
private final class RefusingPersistence: TokenPersisting, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var writeAttempts = 0

    func read() -> TokenPair? { nil }

    func write(_ pair: TokenPair) throws {
        lock.lock(); writeAttempts += 1; lock.unlock()
        throw TokenPersistenceError(status: -34018) // errSecMissingEntitlement
    }

    func delete() {}
}

private final class RecordingPersistence: TokenPersisting, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: TokenPair?
    private(set) var deleteCount = 0

    init(seed: TokenPair? = nil) { stored = seed }

    func read() -> TokenPair? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    func write(_ pair: TokenPair) throws {
        lock.lock(); defer { lock.unlock() }
        stored = pair
    }

    func delete() {
        lock.lock(); defer { lock.unlock() }
        stored = nil
        deleteCount += 1
    }
}

@Suite struct WriteThroughTokenStorageTests {

    @Test("A refused write still leaves the session usable")
    func refusedWriteKeepsSessionAlive() {
        // The failure policy: a student mid-exam must not be thrown out of a timed module
        // by a storage error they can neither see nor fix. They finish the exam, and sign
        // in again next launch.
        let persistence = RefusingPersistence()
        let storage = WriteThroughTokenStorage(persistence: persistence)

        storage.save(TokenPair(access: "A", refresh: "R"))

        #expect(storage.load() == TokenPair(access: "A", refresh: "R"))
        #expect(persistence.writeAttempts == 1)
    }

    @Test("A refused write is recorded rather than swallowed")
    func refusedWriteIsRecorded() {
        // Discarding the status is what made this invisible in the first place.
        let storage = WriteThroughTokenStorage(persistence: RefusingPersistence())

        storage.save(TokenPair(access: "A", refresh: "R"))

        #expect(storage.lastPersistenceError != nil)
    }

    @Test("A successful write clears an earlier failure")
    func successClearsFailure() {
        let storage = WriteThroughTokenStorage(persistence: RecordingPersistence())

        storage.save(TokenPair(access: "A", refresh: "R"))

        #expect(storage.lastPersistenceError == nil)
    }

    @Test("A stored pair is restored on the next launch")
    func storedPairIsRestored() {
        let persistence = RecordingPersistence(seed: TokenPair(access: "A", refresh: "R"))

        // A fresh storage instance stands in for the next launch.
        let storage = WriteThroughTokenStorage(persistence: persistence)

        #expect(storage.load() == TokenPair(access: "A", refresh: "R"))
    }

    @Test("Signing out is not undone by a stale read")
    func clearIsNotUndoneByPersistence() {
        // The cache starts empty, so a naive implementation would fall back to persistence
        // on the first `load()` after `clear()` and resurrect the session.
        let persistence = RecordingPersistence(seed: TokenPair(access: "A", refresh: "R"))
        let storage = WriteThroughTokenStorage(persistence: persistence)

        storage.clear()

        #expect(storage.load() == nil)
        #expect(persistence.deleteCount == 1)
    }

    @Test("Rotation overwrites the stored pair")
    func rotationOverwrites() {
        let persistence = RecordingPersistence()
        let storage = WriteThroughTokenStorage(persistence: persistence)

        storage.save(TokenPair(access: "A1", refresh: "R1"))
        storage.save(TokenPair(access: "A2", refresh: "R2"))

        #expect(storage.load() == TokenPair(access: "A2", refresh: "R2"))
        #expect(persistence.read() == TokenPair(access: "A2", refresh: "R2"))
    }
}

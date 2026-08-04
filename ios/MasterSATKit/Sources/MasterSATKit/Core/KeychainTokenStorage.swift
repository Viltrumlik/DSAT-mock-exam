#if canImport(Security)
import Foundation
import Security

/// The raw persistence behind `WriteThroughTokenStorage` — the part that can fail.
public protocol TokenPersisting: Sendable {
    func read() -> TokenPair?
    /// Throws when the pair could not be written.
    func write(_ pair: TokenPair) throws
    func delete()
}

public struct TokenPersistenceError: Error, Sendable {
    public let status: OSStatus
}

/// Keychain-backed persistence.
///
/// `kSecAttrAccessibleAfterFirstUnlock` rather than `WhenUnlocked`: the app refreshes its
/// token from a background task, and an exam autosave can fire while the screen is locked.
/// `WhenUnlocked` would make the pair unreadable exactly then.
public struct KeychainPersistence: TokenPersisting {
    private let service: String
    private let account: String

    public init(service: String = "uz.mastersat.app", account: String = "auth.tokens") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func read() -> TokenPair? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONCoding.decoder.decode(TokenPair.self, from: data)
    }

    public func write(_ pair: TokenPair) throws {
        guard let data = try? JSONCoding.encoder.encode(pair) else {
            throw TokenPersistenceError(status: errSecParam)
        }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let updated = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw TokenPersistenceError(status: updated) }

        var insert = baseQuery
        insert.merge(attributes) { _, new in new }
        let added = SecItemAdd(insert as CFDictionary, nil)
        // Discarding this status is how a failed save becomes invisible: the app looks
        // signed in, then cannot authenticate a single request. Seen for real on an
        // unsigned simulator build, where the keychain refuses everything.
        guard added == errSecSuccess else { throw TokenPersistenceError(status: added) }
    }

    public func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
#endif

/// Token storage that keeps a live copy in memory and writes through to persistence.
///
/// The mirror is not an optimisation, it is the failure policy. If the keychain refuses a
/// write — locked device, missing entitlement, full store — the session must still work
/// for as long as the app is running. A student mid-exam whose keychain write fails should
/// finish their exam and be asked to sign in again next launch; they should not be thrown
/// out of a timed module by a storage error they cannot see or fix.
public final class WriteThroughTokenStorage: TokenStorage, @unchecked Sendable {
    private let lock = NSLock()
    private let persistence: TokenPersisting
    private var cached: TokenPair?
    private var loadedFromPersistence = false
    private var failure: Error?

    public init(persistence: TokenPersisting) {
        self.persistence = persistence
    }

    /// The last persistence failure, if any. Non-fatal by design — surfaced so the app can
    /// warn ("you will need to sign in again next time") rather than fail silently.
    public var lastPersistenceError: Error? {
        lock.lock(); defer { lock.unlock() }
        return failure
    }

    public func load() -> TokenPair? {
        lock.lock(); defer { lock.unlock() }
        if let cached { return cached }
        // Only consult persistence until it has answered once; a nil after a `clear()`
        // must not be re-read as "still signed in".
        if !loadedFromPersistence {
            loadedFromPersistence = true
            cached = persistence.read()
        }
        return cached
    }

    public func save(_ pair: TokenPair) {
        lock.lock()
        cached = pair
        loadedFromPersistence = true
        lock.unlock()

        do {
            try persistence.write(pair)
            lock.lock(); failure = nil; lock.unlock()
        } catch {
            lock.lock(); failure = error; lock.unlock()
        }
    }

    public func clear() {
        lock.lock()
        cached = nil
        loadedFromPersistence = true
        failure = nil
        lock.unlock()
        persistence.delete()
    }
}

#if canImport(Security)
public extension WriteThroughTokenStorage {
    /// The storage the app ships with.
    static func keychain(service: String = "uz.mastersat.app") -> WriteThroughTokenStorage {
        WriteThroughTokenStorage(persistence: KeychainPersistence(service: service))
    }
}
#endif

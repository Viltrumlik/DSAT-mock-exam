import Foundation

/// The token pair the app holds on the student's behalf.
public struct TokenPair: Sendable, Equatable, Codable {
    public var access: String
    public var refresh: String

    public init(access: String, refresh: String) {
        self.access = access
        self.refresh = refresh
    }
}

/// Where the pair is kept between launches.
///
/// A protocol rather than a hard Keychain dependency so the whole auth path — including
/// the refresh race — is testable in a plain process with no entitlements.
public protocol TokenStorage: Sendable {
    func load() -> TokenPair?
    func save(_ pair: TokenPair)
    func clear()
}

/// Test/preview storage. Also the correct choice for a "don't remember me" session.
public final class InMemoryTokenStorage: TokenStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var pair: TokenPair?

    public init(_ pair: TokenPair? = nil) {
        self.pair = pair
    }

    public func load() -> TokenPair? {
        lock.lock(); defer { lock.unlock() }
        return pair
    }

    public func save(_ pair: TokenPair) {
        lock.lock(); defer { lock.unlock() }
        self.pair = pair
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        pair = nil
    }
}

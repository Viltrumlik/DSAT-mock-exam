#if canImport(Security)
import Foundation
import Security

/// Keychain-backed token storage — the real one the app ships with.
///
/// `kSecAttrAccessibleAfterFirstUnlock` rather than `WhenUnlocked`: the app refreshes its
/// token from a background task (and an exam autosave can fire while the screen is
/// locked), and `WhenUnlocked` would make the pair unreadable exactly then.
public final class KeychainTokenStorage: TokenStorage, @unchecked Sendable {
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

    public func load() -> TokenPair? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONCoding.decoder.decode(TokenPair.self, from: data)
    }

    public func save(_ pair: TokenPair) {
        guard let data = try? JSONCoding.encoder.encode(pair) else { return }

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = baseQuery
            insert.merge(attributes) { _, new in new }
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
#endif

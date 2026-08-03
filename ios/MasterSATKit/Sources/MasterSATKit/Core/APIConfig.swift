import Foundation

/// Where the app talks to, and how it identifies itself.
public struct APIConfig: Sendable {
    /// Origin only — no path. `/api` is appended by `Endpoint`.
    public let baseURL: URL

    /// Value of the `X-MasterSAT-Client` header. Its presence (plus the absence of auth
    /// cookies) is what lets the backend skip CSRF for this client; see
    /// `users.auth_cookies.is_native_client`. Sent on EVERY request, not just auth ones,
    /// so server-side telemetry can tell app traffic from browser traffic.
    public let clientIdentifier: String

    public init(baseURL: URL, clientIdentifier: String) {
        self.baseURL = baseURL
        self.clientIdentifier = clientIdentifier
    }

    /// Students sign in on the apex host. Teachers are refused there by the login funnel
    /// and must use the teacher portal, so a teacher build needs its own base URL.
    public static func production(appVersion: String) -> APIConfig {
        APIConfig(
            baseURL: URL(string: "https://mastersat.uz")!,
            clientIdentifier: "ios/\(appVersion)"
        )
    }
}

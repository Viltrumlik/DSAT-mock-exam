import Foundation

/// The app talking about itself: its release policy, and what went wrong on the phone.
///
/// Both calls work signed in or out — a build that is too old must be told so on the sign-in
/// screen, and a crash on the way in is still a crash — so neither may ever refresh a token
/// or end a session. See `Endpoint.attachesTokenIfAvailable`.
public struct MobileAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// The server's release policy for this platform. The version travels in the
    /// `X-MasterSAT-Client` header every request carries; it is repeated in the query so the
    /// answer can be checked by eye in a log.
    public func config(version: String, build: String) async throws -> ClientConfig {
        let endpoint = Endpoint(
            path: "/mobile/config/",
            query: [
                URLQueryItem(name: "platform", value: "ios"),
                URLQueryItem(name: "version", value: version),
                URLQueryItem(name: "build", value: build),
            ],
            isUnauthenticated: true,
            attachesTokenIfAvailable: true
        )
        return try await client.send(endpoint, as: ClientConfig.self)
    }

    /// Hand a batch of reports to the server. Returns the ids it accepted — including ones it
    /// already had, so a batch retried after a lost response is cleared, not re-sent forever.
    public func uploadDiagnostics(installId: String, reports: [DiagnosticReport]) async throws -> [String] {
        guard !reports.isEmpty else { return [] }
        let body: [String: Any] = [
            "install_id": installId,
            "platform": "ios",
            "reports": reports.map { $0.wireObject() },
        ]
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        let endpoint = Endpoint(
            path: "/mobile/diagnostics/",
            method: .post,
            body: data,
            isUnauthenticated: true,
            attachesTokenIfAvailable: true
        )
        let response = try await client.send(endpoint, as: DiagnosticsUploadResponse.self)
        return response.accepted
    }
}

struct DiagnosticsUploadResponse: Decodable, Sendable {
    let accepted: [String]
}

import Foundation

/// Certificates and report sheets, as PDFs.
///
/// Every one of these sits behind the student's own session: a certificate is the owner's
/// (and only once the teacher has released the result), a report is the owner's. So none of
/// them can be handed to Safari as a link — the browser has no token and gets a 401. The app
/// fetches the bytes with its own client, Bearer and all, and shows them itself.
public struct CertificateAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// A PDF by the `download_url` the server handed out — `mine` rows and the midterm
    /// result carry one. It is relative to `/api` (`/classes/certificates/midterm/<code>/download/`);
    /// an absolute or `/api`-prefixed form is accepted too.
    public func pdf(downloadURL: String) async throws -> Data {
        guard let endpoint = CertificatePath.endpoint(for: downloadURL) else {
            throw APIError.transport(underlying: "This certificate link cannot be opened.")
        }
        return try await fetchPDF(endpoint)
    }

    /// A midterm certificate by its code.
    public func midtermCertificate(code: String) async throws -> Data {
        // Not escaped here: the endpoint builder escapes the path once, and doing it twice
        // would send "%25".
        try await fetchPDF(.get("/classes/certificates/midterm/\(code)/download/"))
    }

    /// A past paper's certificate for one sitting; created on its first download.
    public func pastPaperCertificate(attemptId: Int) async throws -> Data {
        try await fetchPDF(.get("/classes/pastpapers/attempts/\(attemptId)/certificate/pdf/"))
    }

    /// A midterm's error report, as the centre prints it.
    public func midtermErrorReport(attemptId: Int) async throws -> Data {
        try await fetchPDF(.get("/midterms/attempts/\(attemptId)/error-report/pdf/"))
    }

    /// Fetch, and refuse anything that is not a PDF. A 200 carrying an HTML page (a proxy's
    /// sign-in page, the site's own fallback) would otherwise be handed to the viewer, which
    /// shows it as a blank or broken document with no explanation.
    private func fetchPDF(_ endpoint: Endpoint) async throws -> Data {
        let data = try await client.send(endpoint)
        guard CertificatePath.isPDF(data) else {
            throw APIError.decoding(context: endpoint.path, underlying: "The server did not send a PDF.")
        }
        return data
    }
}

public enum CertificatePath {
    /// The endpoint for a `download_url`, whatever form it arrived in:
    /// - `/classes/certificates/midterm/X/download/` — relative to `/api`, the form sent today;
    /// - `/api/classes/…` — relative to the host;
    /// - `https://mastersat.uz/api/classes/…` — absolute.
    ///
    /// The host of an absolute URL is dropped on purpose: the Bearer token only ever goes to
    /// the app's own server, never to a host named in a payload. A query string is kept.
    public static func endpoint(for downloadURL: String) -> Endpoint? {
        let raw = downloadURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let components = URLComponents(string: raw) else { return nil }
        var path = components.percentEncodedPath
        guard !path.isEmpty else { return nil }
        if !path.hasPrefix("/") { path = "/" + path }
        if path == "/api" || path.hasPrefix("/api/") { path = String(path.dropFirst(4)) }
        guard path.count > 1, let decoded = path.removingPercentEncoding else { return nil }
        return .get(decoded, query: components.queryItems ?? [])
    }

    /// The path an Endpoint would be built from — for tests and logging.
    public static func apiPath(for downloadURL: String) -> String? {
        endpoint(for: downloadURL)?.path
    }

    /// A PDF starts `%PDF-`, possibly after a few bytes of junk the format tolerates.
    public static func isPDF(_ data: Data) -> Bool {
        let head = data.prefix(1024)
        return head.range(of: Data("%PDF-".utf8)) != nil
    }

    /// A file name for the share sheet: "Certificate — Midterm 3.pdf", with anything a file
    /// system dislikes taken out.
    public static func fileName(_ title: String, fallback: String = "Certificate") -> String {
        let banned = CharacterSet(charactersIn: "/\\:?%*|\"<>\n\r\t")
        let cleaned = title.components(separatedBy: banned).joined(separator: " ")
            .split(separator: " ", omittingEmptySubsequences: true)
            .joined(separator: " ")
        let base = cleaned.isEmpty ? fallback : String(cleaned.prefix(80))
        return base.lowercased().hasSuffix(".pdf") ? base : base + ".pdf"
    }
}

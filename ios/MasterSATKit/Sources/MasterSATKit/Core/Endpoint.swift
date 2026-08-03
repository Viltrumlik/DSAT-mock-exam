import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

/// One API call, described rather than performed.
///
/// The body is carried as already-encoded `Data` so an endpoint stays `Sendable` and can be
/// captured by the retry path without re-encoding — a retry must send byte-identical
/// content, or an `Idempotency-Key` would be dedupe-ing two different payloads.
public struct Endpoint: Sendable {
    public var path: String
    public var method: HTTPMethod
    public var query: [URLQueryItem]
    public var body: Data?
    public var idempotencyKey: String?
    /// Skip the Authorization header entirely (login, refresh).
    public var isUnauthenticated: Bool
    /// Overrides the default `application/json` when the body is not JSON.
    public var contentType: String?

    public init(
        path: String,
        method: HTTPMethod = .get,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        idempotencyKey: String? = nil,
        isUnauthenticated: Bool = false,
        contentType: String? = nil
    ) {
        self.path = path
        self.method = method
        self.query = query
        self.body = body
        self.idempotencyKey = idempotencyKey
        self.isUnauthenticated = isUnauthenticated
        self.contentType = contentType
    }

    /// POST a `multipart/form-data` body — file uploads.
    public static func upload(
        _ path: String,
        form: MultipartForm,
        idempotencyKey: String? = nil
    ) -> Endpoint {
        Endpoint(
            path: path,
            method: .post,
            body: form.encoded(),
            idempotencyKey: idempotencyKey,
            contentType: form.contentType
        )
    }

    public static func get(_ path: String, query: [URLQueryItem] = []) -> Endpoint {
        Endpoint(path: path, method: .get, query: query)
    }

    /// POST with a JSON body. Encoding happens here so callers deal in values, not `Data`.
    public static func post(
        _ path: String,
        json: some Encodable & Sendable,
        idempotencyKey: String? = nil
    ) throws -> Endpoint {
        Endpoint(
            path: path,
            method: .post,
            body: try JSONCoding.encoder.encode(json),
            idempotencyKey: idempotencyKey
        )
    }

    public static func post(_ path: String, idempotencyKey: String? = nil) -> Endpoint {
        Endpoint(path: path, method: .post, body: Data("{}".utf8), idempotencyKey: idempotencyKey)
    }

    public static func patch(_ path: String, json: some Encodable & Sendable) throws -> Endpoint {
        Endpoint(path: path, method: .patch, body: try JSONCoding.encoder.encode(json))
    }

    public static func delete(_ path: String) -> Endpoint {
        Endpoint(path: path, method: .delete)
    }

    func url(relativeTo base: URL) throws -> URL {
        // Every route on this platform is namespaced under /api; keeping the prefix here
        // rather than in each path means an endpoint string matches the Django urlconf
        // one-for-one and is greppable across both codebases.
        let normalized = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard var components = URLComponents(
            url: base.appendingPathComponent("api").appendingPathComponent(normalized),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.transport(underlying: "Could not build a URL for /api/\(normalized)")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else {
            throw APIError.transport(underlying: "Could not build a URL for /api/\(normalized)")
        }
        return url
    }
}

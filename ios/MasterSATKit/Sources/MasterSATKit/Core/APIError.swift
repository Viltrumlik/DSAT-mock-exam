import Foundation

/// Everything a request can fail with, in the shape callers actually branch on.
public enum APIError: Error, Sendable {
    /// Transport failure — no HTTP response at all. The caller is offline or the request
    /// timed out; a runner treats this as "keep the local answer and retry".
    case transport(underlying: String)

    /// 401. The access token was rejected and a refresh either failed or was not possible.
    case unauthorized

    /// 403. Distinguished from `unauthorized` because retrying or refreshing never helps —
    /// it is the frozen-account gate, the console boundary, or a results-not-ready guard.
    ///
    /// `reason` is the server's machine-readable code where it sends one. It matters
    /// because two 403s can mean very different things to the student in front of the
    /// screen: "enter the code your teacher just read out" is a step they can take, while
    /// "this closed an hour ago" is not.
    case forbidden(detail: String, reason: String?)

    /// 409. Something else wrote first — another device, or the same one twice.
    case conflict(detail: String)

    /// 400 carrying DRF's field-error map: `{"email": ["user with this email already
    /// exists."]}`. Distinguished from `http` because that shape has no `detail` key at
    /// all, so a caller reading only `detail` shows "Request failed (400)." to a student
    /// whose real problem is one sentence long and entirely fixable.
    ///
    /// `code` is the serializer's machine-readable branch where it sends one — registration
    /// refuses a duplicate full name with `duplicate_full_name`, and the screen turns that
    /// into a link to sign in rather than a dead end.
    case validation(detail: String, code: String?, fields: [String: [String]])

    /// 426. This build is older than the server's minimum and must be updated before the
    /// API will talk to it. Distinct from every other failure because no retry, refresh or
    /// re-sign-in can fix it — only the App Store can.
    case upgradeRequired(detail: String, minimumVersion: String?, updateURL: String?)

    /// 502/503/504 — the server is being deployed or is briefly down. What a student sees
    /// during a release, so it must read as "wait a minute", never as a broken app, and
    /// it is always worth retrying.
    case unavailable(status: Int)

    /// Any other non-2xx, with whatever `detail` the API supplied.
    case http(status: Int, detail: String)

    /// The response decoded to something that violates the wire contract. Loud on purpose:
    /// silently tolerating a malformed payload is how a runner ends up showing a blank
    /// question instead of an error.
    case decoding(context: String, underlying: String)

    /// Signed out locally — there is no token to send and no refresh to attempt.
    case notAuthenticated
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .transport(let underlying):
            return "Network error: \(underlying)"
        case .unauthorized:
            return "Your session has expired. Please sign in again."
        case .forbidden(let detail, _):
            return detail.isEmpty ? "You do not have access to this." : detail
        case .conflict(let detail):
            return detail.isEmpty ? "This was updated somewhere else." : detail
        case .validation(let detail, _, _):
            return detail.isEmpty ? "Please check the details you entered." : detail
        case .upgradeRequired(let detail, _, _):
            return detail.isEmpty ? "This version of the app is no longer supported. Please update it." : detail
        case .unavailable:
            return "MasterSAT is updating right now. Please try again in a minute."
        case .http(let status, let detail):
            return detail.isEmpty ? "Request failed (\(status))." : detail
        case .decoding(let context, let underlying):
            return "Unexpected response from the server (\(context)): \(underlying)"
        case .notAuthenticated:
            return "Please sign in."
        }
    }

    /// Whether retrying the identical request could plausibly succeed. A 403 or a
    /// decoding failure must not be retried forever.
    public var isRetryable: Bool {
        switch self {
        case .transport, .unavailable:
            return true
        case .http(let status, _):
            return status >= 500 || status == 429
        case .unauthorized, .forbidden, .conflict, .validation, .decoding, .notAuthenticated, .upgradeRequired:
            return false
        }
    }
}

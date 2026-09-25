import Foundation

/// A refusal the server explained with a machine-readable code:
/// `{"code": "full", "detail": "That event is full. A seat opens if somebody cancels."}`.
///
/// `APIError` has no slot for that code on a 400 or a 409 — `.http` and `.conflict` carry
/// only the sentence — and a screen that has to tell "full" from "started" must never read
/// English back out of `detail` to do it: that is how a copy edit on the server becomes a
/// bug in the app. Thrown only by `APIClient.sendCoded`, so every other call keeps the
/// mapping it was written against.
///
/// Deliberately narrow:
/// - a 403 already carries its code (`APIError.forbidden(reason:)`), and a 401 or 426 means
///   something no code can change, so none of those is ever a refusal;
/// - the code must be a plain string. A serializer's `{"code": ["…"], "email": ["…"]}` is a
///   field-error map, and `APIError.validation` already reads that shape properly.
public struct APIRefusal: Error, Sendable, Equatable {
    public let status: Int
    public let code: String
    /// The sentence written for people. May be empty.
    public let detail: String

    public init(status: Int, code: String, detail: String) {
        self.status = status
        self.code = code
        self.detail = detail
    }

    /// The refusal in `body`, or nil when this response is not one.
    init?(status: Int, body: Data) {
        guard (400..<500).contains(status), ![401, 403, 426].contains(status) else { return nil }
        guard let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let code = object["code"] as? String,
              !code.isEmpty else { return nil }
        self.init(status: status, code: code, detail: (object["detail"] as? String) ?? "")
    }
}

extension APIRefusal: LocalizedError {
    public var errorDescription: String? {
        detail.isEmpty ? "That couldn't be done right now." : detail
    }
}

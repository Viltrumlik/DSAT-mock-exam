import Foundation

/// The token exchange worked — the password was right — and reading the account afterwards
/// (`/users/me/`) answered 401.
///
/// A distinct error because on the sign-in form a bare 401 means "wrong email or password" and
/// nothing else can; this one must not be read that way, or a student with a correct password is
/// sent hunting for a typo.
public struct AccountDidNotLoad: Error, Sendable, Equatable {
    public init() {}

    /// What a failure of `/me` right after a good token exchange is called. Only a 401 changes —
    /// every other failure (offline, a deploy, a 5xx) already reads as what it is.
    public static func after(_ error: Error) -> Error {
        if case APIError.unauthorized = error { return AccountDidNotLoad() }
        return error
    }
}

/// The sentence to show when a sign-in or a sign-up fails, and whether trying the same thing again
/// could work. A port of the web's `classifyLoginError`.
public enum AuthErrorCopy {
    public static func classify(_ error: Error) -> (message: String, retryable: Bool) {
        if error is AccountDidNotLoad {
            // The credentials are still in the form, so one tap tries again.
            return ("You're signed in, but your account didn't load — try again", true)
        }
        guard let api = error as? APIError else {
            return (error.localizedDescription, false)
        }
        switch api {
        case .transport:
            return ("Cannot connect to the server. Check your internet connection and try again.", true)
        case .unauthorized:
            // On this screen a 401 is a wrong password, not an expired session — the
            // student has no session yet. `APIError`'s own wording is written for the
            // other case and would send them looking for a problem they do not have.
            // (A 401 AFTER the token exchange is `AccountDidNotLoad`, not this.)
            return ("The email or password you entered is incorrect.", false)
        case .forbidden(let detail, _):
            // The server's own words: a teacher signing in here is told to use the teacher
            // portal, and a frozen account is told it is frozen.
            return (detail.isEmpty ? "Your account has been restricted. Contact support." : detail, false)
        case .validation(let detail, _, _):
            return (detail.isEmpty ? "Please check the details you entered." : detail, false)
        case .http(let status, let detail) where status == 429:
            return (detail.isEmpty ? "Too many attempts. Please wait a minute before trying again." : detail, false)
        case .http(let status, let detail) where status >= 500:
            return (detail.isEmpty ? "Server error. Please try again in a moment." : detail, true)
        case .http(_, let detail):
            return (detail.isEmpty ? "Something went wrong. Please try again." : detail, true)
        case .conflict(let detail):
            return (detail.isEmpty ? "Something went wrong. Please try again." : detail, false)
        case .unavailable:
            // A release in progress. The words say "wait", because that is all it takes.
            return (api.errorDescription ?? "MasterSAT is updating right now. Please try again in a minute.", true)
        case .upgradeRequired:
            // The update screen is already covering this one; this is only its caption.
            return (api.errorDescription ?? "Please update the app to sign in.", false)
        case .decoding, .notAuthenticated:
            return (api.errorDescription ?? "Something went wrong. Please try again.", false)
        }
    }
}

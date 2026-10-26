import Foundation
import Testing
@testable import MasterSATKit

/// What the sign-in form says when something fails — and, above all, that a 401 which follows a
/// GOOD password is never read as a wrong one.
@Suite struct AuthErrorCopyTests {

    @Test("A refused token exchange blames what was typed, without naming which of the three")
    func wrongPassword() {
        let copy = AuthErrorCopy.classify(APIError.unauthorized)
        #expect(copy.message == "The details you entered are incorrect.")
        // The one identity field takes a phone number or a username too, so the sentence cannot
        // name an email: a student who typed their phone would go hunting for an email account.
        #expect(!copy.message.lowercased().contains("email"))
        #expect(!copy.retryable)
    }

    @Test("A 401 from /me right after a good token exchange says the account did not load")
    func accountDidNotLoad() {
        // The exchange worked, so the password was right; only reading the account failed.
        let afterExchange = AccountDidNotLoad.after(APIError.unauthorized)
        #expect(afterExchange is AccountDidNotLoad)
        let copy = AuthErrorCopy.classify(afterExchange)
        #expect(copy.message == "You're signed in, but your account didn't load — try again")
        // The credentials are still in the form: one tap tries again.
        #expect(copy.retryable)
        #expect(!copy.message.lowercased().contains("incorrect"))
    }

    @Test("Any other failure of /me is left to say what it is")
    func otherFailuresPassThrough() {
        let offline = APIError.transport(underlying: "offline")
        let wrapped = AccountDidNotLoad.after(offline)
        guard case APIError.transport = wrapped else {
            Issue.record("a transport failure must stay a transport failure")
            return
        }
        #expect(AuthErrorCopy.classify(wrapped).retryable)
        #expect(AuthErrorCopy.classify(wrapped).message.hasPrefix("Cannot connect"))
        // Nothing but a 401 is rewritten.
        #expect(!(AccountDidNotLoad.after(APIError.http(status: 500, detail: "")) is AccountDidNotLoad))
        #expect(!(AccountDidNotLoad.after(APIError.notAuthenticated) is AccountDidNotLoad))
    }

    @Test("The server's own words for a refusal reach the form")
    func serverWordsPassThrough() {
        #expect(AuthErrorCopy.classify(APIError.forbidden(detail: "Use the teacher portal.", reason: nil)).message
                == "Use the teacher portal.")
        #expect(AuthErrorCopy.classify(APIError.forbidden(detail: "", reason: nil)).message
                == "Your account has been restricted. Contact support.")
        #expect(AuthErrorCopy.classify(APIError.validation(detail: "", code: nil, fields: [:])).message
                == "Please check the details you entered.")
        #expect(AuthErrorCopy.classify(APIError.conflict(detail: "")).message
                == "Something went wrong. Please try again.")
    }

    @Test("What is worth retrying is offered a retry, and what is not is not")
    func retryable() {
        #expect(AuthErrorCopy.classify(APIError.transport(underlying: "x")).retryable)
        #expect(AuthErrorCopy.classify(APIError.http(status: 503, detail: "")).retryable)
        #expect(AuthErrorCopy.classify(APIError.http(status: 418, detail: "")).retryable)
        #expect(AuthErrorCopy.classify(APIError.unavailable(status: 503)).retryable)
        #expect(!AuthErrorCopy.classify(APIError.http(status: 429, detail: "")).retryable)
        #expect(!AuthErrorCopy.classify(APIError.forbidden(detail: "", reason: nil)).retryable)
        #expect(!AuthErrorCopy.classify(APIError.validation(detail: "", code: nil, fields: [:])).retryable)
        #expect(AuthErrorCopy.classify(APIError.http(status: 429, detail: "")).message
                == "Too many attempts. Please wait a minute before trying again.")
        #expect(AuthErrorCopy.classify(APIError.http(status: 500, detail: "")).message
                == "Server error. Please try again in a moment.")
    }

    @Test("An error that is not the API's reads as its own description")
    func foreignError() {
        struct Odd: LocalizedError { var errorDescription: String? { "Odd failure" } }
        let copy = AuthErrorCopy.classify(Odd())
        #expect(copy.message == "Odd failure")
        #expect(!copy.retryable)
    }
}

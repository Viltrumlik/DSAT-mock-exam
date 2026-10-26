import Foundation

/// The student's own side of lc-up's finance — the only part of `/api/lcup/` the app calls.
public struct FinanceAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// `GET /lcup/me/finance/` — this student's balance, monthly price and payments, or
    /// `unlinked` when the learning center has not tied their account to lc-up yet.
    ///
    /// Open to a frozen student on purpose: the frozen screen names the debt, and a student
    /// locked out for an unpaid month must be able to read what the unpaid month is.
    public func mine() async throws -> MyFinanceState {
        try await client.send(.get("/lcup/me/finance/"), as: MyFinanceState.self)
    }
}

import Foundation

/// The student's side of `/api/livequiz/` — everything that is not the game itself.
///
/// The code is sent here, once, over HTTPS, and exchanged for a session id; the socket never
/// sees it (`backend/livequiz/views.py`).
public struct LiveQuizAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Take a place in the room with this code — or get back the place already held. A game
    /// already under way can be joined; the student is only late for the questions asked.
    ///
    /// - Throws: `LiveQuizRefusal` (`badCode`, `notInClass`, `removed`, `roomFull`,
    ///   `featureOff`, …) when the server says no; `APIError` for everything else.
    public func join(code: String) async throws -> LiveQuizJoin {
        let endpoint = try Endpoint.post("/livequiz/join/", json: JoinRequest(code: LiveQuizCode.normalized(code)))
        return try await coded { try await client.sendCoded(endpoint, as: LiveQuizJoin.self) }
    }

    /// Rooms running right now in the student's classes (at most 20), newest first. Without
    /// their codes: the list is for getting back into a room, not for getting into one.
    ///
    /// - Throws: `LiveQuizRefusal(.featureOff)` while live quizzes are switched off.
    public func mine() async throws -> [LiveQuizSummary] {
        try await coded { try await client.sendCoded(.get("/livequiz/mine/"), as: ListEnvelope.self) }.results
    }

    /// Whether live quizzes are switched on for this server: nil when that could not be
    /// learnt (offline, a server fault) — which is not the same as off.
    public func isEnabled() async -> Bool? {
        do {
            _ = try await mine()
            return true
        } catch let refusal as LiveQuizRefusal where refusal.reason == .featureOff {
            return false
        } catch {
            return nil
        }
    }

    /// The room and the student's own row of its report.
    public func results(sessionId: Int) async throws -> LiveQuizResults {
        try await coded {
            try await client.sendCoded(.get("/livequiz/sessions/\(sessionId)/results/"), as: LiveQuizResults.self)
        }
    }

    /// Every `AppError` on this app arrives with status 400 whatever it was declared as (a
    /// frozen-dataclass quirk in `core/errors/api.py`), so the code is all there is to branch
    /// on. A 403 carrying one — what a fixed server would send — reads the same way.
    private func coded<T: Sendable>(_ call: () async throws -> T) async throws -> T {
        do {
            return try await call()
        } catch let refusal as APIRefusal {
            throw LiveQuizRefusal(code: refusal.code, detail: refusal.detail, status: refusal.status)
        } catch APIError.forbidden(let detail, let reason?) {
            throw LiveQuizRefusal(code: reason, detail: detail, status: 403)
        }
    }

    private struct JoinRequest: Encodable, Sendable {
        let code: String
    }

    private struct ListEnvelope: Decodable, Sendable {
        let results: [LiveQuizSummary]

        private enum CodingKeys: String, CodingKey { case results }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            results = (try? c.decodeIfPresent(LiveQuizLossyList<LiveQuizSummary>.self, forKey: .results))?.elements ?? []
        }
    }
}

// MARK: - The code

/// The six characters on the board.
public enum LiveQuizCode {
    public static let length = 6

    /// What the field keeps as the student types: upper-case letters and digits, at most six
    /// — the web's `toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)`. Nobody should have
    /// to think about case; the code on the board is upper-case.
    ///
    /// One addition: a Cyrillic letter that looks like a Latin one is read as that letter.
    /// Plenty of phones here carry a Russian keyboard, and "КН3У8U" typed off the board is
    /// the code the student meant, not four letters to silently drop.
    public static func normalized(_ raw: String) -> String {
        var kept = String.UnicodeScalarView()
        for scalar in raw.uppercased().unicodeScalars {
            let latin = cyrillicLookalikes[scalar] ?? scalar
            guard ("A"..."Z").contains(latin) || ("0"..."9").contains(latin) else { continue }
            kept.append(latin)
            if kept.count == length { break }
        }
        return String(kept)
    }

    /// Complete enough to send.
    public static func isComplete(_ raw: String) -> Bool {
        normalized(raw).count == length
    }

    private static let cyrillicLookalikes: [Unicode.Scalar: Unicode.Scalar] = [
        "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
        "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
    ]
}

// MARK: - Refusals

/// Why the server would not let the student in — from `join/`, `mine/` or `results/`.
///
/// `detail` is the server's own sentence, written for people; `reason` is what to branch on.
public struct LiveQuizRefusal: Error, Sendable, Equatable {
    public enum Reason: Sendable, Equatable {
        /// No live room has that code (or it has finished — the server will not say which).
        case badCode
        case notInClass
        /// A teacher of the class cannot also play.
        case hostCannotPlay
        /// The teacher took this student out of the room; the code no longer lets them back.
        case removed
        /// Sixty players.
        case roomFull
        /// `LIVE_QUIZ_ENABLED` is off on the server.
        case featureOff
        /// The room is over (`bad_state`).
        case finished
        case notFound
        case other(String)

        public init(code: String) {
            switch code {
            case "bad_code": self = .badCode
            case "not_in_class": self = .notInClass
            case "host_cannot_play": self = .hostCannotPlay
            case "removed": self = .removed
            case "room_full": self = .roomFull
            case "feature_off": self = .featureOff
            case "bad_state": self = .finished
            case "not_found": self = .notFound
            default: self = .other(code)
            }
        }
    }

    public let reason: Reason
    public let detail: String
    public let status: Int

    public init(reason: Reason, detail: String = "", status: Int = 400) {
        self.reason = reason
        self.detail = detail
        self.status = status
    }

    public init(code: String, detail: String, status: Int) {
        self.init(reason: Reason(code: code), detail: detail, status: status)
    }
}

extension LiveQuizRefusal: LocalizedError {
    /// The server's sentence; its wording from `livequiz/views.py` and `services.py` when it
    /// sent none.
    public var errorDescription: String? {
        if !detail.isEmpty { return detail }
        switch reason {
        case .badCode: return "That code does not match a live quiz."
        case .notInClass: return "This live quiz belongs to a class you are not in."
        case .hostCannotPlay: return "You are hosting this quiz, so you cannot also play it."
        case .removed: return "The host removed you from this quiz."
        case .roomFull: return "This live quiz is full."
        case .featureOff: return "Live quizzes are not switched on yet."
        case .finished: return "That live quiz has finished."
        case .notFound: return "That quiz is no longer running."
        case .other: return "Couldn't join that quiz. Try again."
        }
    }
}

import Foundation

/// Results for papers the student sat somewhere else.
///
/// The app does not host the timed sittings — mocks, midterms, past papers and practice
/// packs are sat on a laptop under exam conditions. A score, though, is worth checking
/// anywhere, so the result surfaces come to the phone even though the paper does not.
public struct ResultsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func midtermResult(attemptId: Int) async throws -> MidtermResult {
        try await client.send(.get("/midterms/attempts/\(attemptId)/review/"), as: MidtermResult.self)
    }

    /// A midterm certificate by its public code.
    public func certificate(code: String) async throws -> CertificateDetail {
        try await client.send(.get("/classes/certificates/midterm/\(code)/"), as: CertificateDetail.self)
    }
}

/// A finished midterm.
///
/// `released` is the gate, and it is not the same as "graded": a classroom midterm is
/// scored the moment it is submitted but stays sealed until the teacher publishes it.
public struct MidtermResult: Decodable, Sendable, Equatable {
    public let scoreOnly: Bool
    public let released: Bool
    public let subject: String?
    public let scoringScale: String?
    public let totalScore: Double?
    public let scoreCeiling: Double?
    public let certificate: CertificateInfo?

    private enum CodingKeys: String, CodingKey {
        case released, subject, certificate
        case scoreOnly = "score_only"
        case scoringScale = "scoring_scale"
        case totalScore = "total_score"
        case scoreCeiling = "score_ceiling"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        scoreOnly = (try? c.decodeIfPresent(Bool.self, forKey: .scoreOnly)) as? Bool ?? true
        released = (try? c.decodeIfPresent(Bool.self, forKey: .released)) as? Bool ?? false
        subject = try? c.decodeIfPresent(String.self, forKey: .subject)
        scoringScale = try? c.decodeIfPresent(String.self, forKey: .scoringScale)
        totalScore = try? c.decodeIfPresent(Double.self, forKey: .totalScore)
        scoreCeiling = try? c.decodeIfPresent(Double.self, forKey: .scoreCeiling)
        certificate = try? c.decodeIfPresent(CertificateInfo.self, forKey: .certificate)
    }
}

/// A certificate looked up by code. The download itself is a PDF the app opens in a
/// browser rather than decoding.
public struct CertificateDetail: Decodable, Sendable, Equatable {
    public let code: String
    public let studentName: String?
    public let midtermTitle: String?
    public let score: Double?
    public let scoreCeiling: Double?
    public let rank: Int?
    public let cohortSize: Int?
    public let issuedAt: String?
    public let downloadURL: String?

    private enum CodingKeys: String, CodingKey {
        case code, score, rank
        case studentName = "student_name"
        case midtermTitle = "midterm_title"
        case scoreCeiling = "score_ceiling"
        case cohortSize = "cohort_size"
        case issuedAt = "issued_at"
        case downloadURL = "download_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = (try? c.decodeIfPresent(String.self, forKey: .code)) as? String ?? ""
        studentName = try? c.decodeIfPresent(String.self, forKey: .studentName)
        midtermTitle = try? c.decodeIfPresent(String.self, forKey: .midtermTitle)
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
        scoreCeiling = try? c.decodeIfPresent(Double.self, forKey: .scoreCeiling)
        rank = try? c.decodeIfPresent(Int.self, forKey: .rank)
        cohortSize = try? c.decodeIfPresent(Int.self, forKey: .cohortSize)
        issuedAt = try? c.decodeIfPresent(String.self, forKey: .issuedAt)
        downloadURL = try? c.decodeIfPresent(String.self, forKey: .downloadURL)
    }
}

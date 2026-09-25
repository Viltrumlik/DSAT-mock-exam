import Foundation

public struct SubmissionFile: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let url: String?
    public let fileName: String?
    public let fileType: String?
    public let createdAt: String?

    /// What to put in front of the student. Falls back only when the server genuinely
    /// sent nothing — a file the student uploaded should always show its own name.
    public var displayName: String {
        let name = fileName ?? ""
        return name.isEmpty ? "Attachment" : name
    }

    private enum CodingKeys: String, CodingKey {
        case id, url
        case fileName = "file_name"
        case fileType = "file_type"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        url = try? c.decodeIfPresent(String.self, forKey: .url)
        fileName = try? c.decodeIfPresent(String.self, forKey: .fileName)
        fileType = try? c.decodeIfPresent(String.self, forKey: .fileType)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

/// The teacher's mark on a handed-in homework.
///
/// DRF sends the DecimalFields as strings (`"7.50"`), so both forms are read — a student told
/// they scored nothing because a number arrived in quotes is the worst possible bug here.
public struct SubmissionReview: Decodable, Sendable, Equatable {
    public let grade: Double?
    public let maxScore: Double?
    public let feedback: String?
    public let reviewedAt: String?
    /// Marked by the platform (a finished quiz or past paper), not by a teacher.
    public let isAuto: Bool
    /// `current` for the review of THIS hand-in, `previous_cycle` when the work was sent back
    /// and the mark belongs to the attempt before — the two read differently to a student.
    public let reviewContext: String?

    private enum CodingKeys: String, CodingKey {
        case grade, feedback
        case maxScore = "max_score"
        case reviewedAt = "reviewed_at"
        case isAuto = "is_auto"
        case reviewContext = "review_context"
    }

    public init(
        grade: Double?, maxScore: Double?, feedback: String?, reviewedAt: String?,
        isAuto: Bool = false, reviewContext: String? = nil
    ) {
        self.grade = grade
        self.maxScore = maxScore
        self.feedback = feedback
        self.reviewedAt = reviewedAt
        self.isAuto = isAuto
        self.reviewContext = reviewContext
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        grade = Self.number(c, .grade)
        maxScore = Self.number(c, .maxScore)
        feedback = try? c.decodeIfPresent(String.self, forKey: .feedback)
        reviewedAt = try? c.decodeIfPresent(String.self, forKey: .reviewedAt)
        isAuto = (try? c.decodeIfPresent(Bool.self, forKey: .isAuto)) as? Bool ?? false
        reviewContext = try? c.decodeIfPresent(String.self, forKey: .reviewContext)
    }

    private static func number(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Double? {
        if let d = try? c.decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? c.decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }

    /// "8 / 10", or just "8" when the homework has no maximum.
    public var scoreText: String? {
        guard let grade else { return nil }
        func fmt(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
        guard let maxScore, maxScore > 0 else { return fmt(grade) }
        return "\(fmt(grade)) / \(fmt(maxScore))"
    }
}

/// The student's own submission for one assignment.
///
/// `revision` is the load-bearing field: every write sends the revision it read, and the
/// server refuses a write built on a stale one. Without it, a phone that submitted while
/// offline could silently overwrite a teacher's return.
public struct Submission: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let status: String?
    public let revision: Int
    public let returnNote: String?
    public let returnedAt: String?
    public let submittedAt: String?
    public let files: [SubmissionFile]
    /// Server-computed. The client never recomputes it — the rule lives with grading.
    public let workflowStatus: String?
    /// The teacher's mark and comment, once the work has been reviewed.
    public let review: SubmissionReview?

    public var isReturned: Bool { (status ?? "").lowercased() == "returned" || returnedAt != nil }

    public var hasBeenSubmitted: Bool { submittedAt != nil }

    private enum CodingKeys: String, CodingKey {
        case id, status, revision, files, review
        case returnNote = "return_note"
        case returnedAt = "returned_at"
        case submittedAt = "submitted_at"
        case workflowStatus = "workflow_status"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        revision = (try? c.decodeIfPresent(Int.self, forKey: .revision)) as? Int ?? 0
        returnNote = try? c.decodeIfPresent(String.self, forKey: .returnNote)
        returnedAt = try? c.decodeIfPresent(String.self, forKey: .returnedAt)
        submittedAt = try? c.decodeIfPresent(String.self, forKey: .submittedAt)
        files = (try? c.decodeIfPresent([SubmissionFile].self, forKey: .files)) as? [SubmissionFile] ?? []
        workflowStatus = try? c.decodeIfPresent(String.self, forKey: .workflowStatus)
        review = (try? c.decodeIfPresent(SubmissionReview.self, forKey: .review)) ?? nil
    }
}

/// `my-submission` answers `200 {}` when nothing has been handed in — not a 404. That empty
/// object failed to decode as a `Submission` (it has no `id`), so every homework without a
/// submission yet opened to an error screen. An object with no `id` is "nothing yet".
struct MaybeSubmission: Decodable, Sendable {
    let submission: Submission?

    private enum Probe: String, CodingKey { case id }

    init(from decoder: Decoder) throws {
        let probe = try decoder.container(keyedBy: Probe.self)
        submission = probe.contains(.id) ? try Submission(from: decoder) : nil
    }
}

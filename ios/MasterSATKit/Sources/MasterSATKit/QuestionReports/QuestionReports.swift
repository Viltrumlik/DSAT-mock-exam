import Foundation

/// Reporting a problem with one question — the site's `/question-reports/` feature, unchanged.
///
/// The reports land in one ops queue that staff read on Telegram, so the app must speak the
/// website's vocabulary exactly: the same five categories, the same wire names, the same
/// `system` discriminator. A category the app invented, or a label worded a little better,
/// would split that queue in two and make the counts meaningless.

/// Which question-id namespace the report is about.
///
/// The platform has two independent exam engines and therefore two id spaces: `exam` is the
/// shared runner's (`exams.Question` — pastpaper, practice, mock, midterm) and `assessment`
/// is the homework runner's (`assessments.AssessmentQuestion`). The server resolves the
/// title, the number and the question-bank id from the id itself, but only once it knows
/// which of the two it is in. Both app surfaces today are assessments.
public enum QuestionReportSystem: String, Codable, Sendable, CaseIterable {
    case exam
    case assessment
}

/// What looks wrong. The five the website offers, in the website's order — `wrongAnswer`
/// first, because it is what a student notices and the queue is sorted by it.
public enum QuestionReportCategory: String, Codable, Sendable, CaseIterable, Identifiable {
    case wrongAnswer = "wrong_answer"
    case answerKey = "answer_key"
    case typoUnclear = "typo_unclear"
    case imageFigure = "image_figure"
    case other

    public var id: String { rawValue }

    /// The website's own wording (`REPORT_CATEGORIES`), to the word. Staff triage by these
    /// labels; rephrasing one here would describe a different complaint than the web sends.
    public var label: String {
        switch self {
        case .wrongAnswer: return "Wrong / no correct answer"
        case .answerKey: return "Answer key looks wrong"
        case .typoUnclear: return "Typo / unclear wording"
        case .imageFigure: return "Image / figure problem"
        case .other: return "Something else"
        }
    }
}

/// One report, as it goes on the wire.
///
/// `attemptId` is the runner's to send and the review's to leave out — the website's two call
/// sites differ exactly there, and the queue uses its presence to tell "reported mid-sitting"
/// from "reported while reading the marked paper".
public struct QuestionReport: Encodable, Sendable, Equatable {
    public var system: QuestionReportSystem
    public var questionId: Int
    public var category: QuestionReportCategory
    /// Free text, optional. Trimmed, and dropped entirely when nothing is left: a body of
    /// spaces is not a detail, and the serializer's own default is the empty string.
    public var message: String
    public var attemptId: Int?

    public init(
        system: QuestionReportSystem,
        questionId: Int,
        category: QuestionReportCategory,
        message: String = "",
        attemptId: Int? = nil
    ) {
        self.system = system
        self.questionId = questionId
        self.category = category
        self.message = message
        self.attemptId = attemptId
    }

    /// What the server will actually store: the message with its edges cut off.
    public var trimmedMessage: String {
        message.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The most the server accepts (`max_length=2000`). The field enforces it while typing so
    /// a long report is never refused after the student has written it.
    public static let messageLimit = 2000

    /// `text`, cut to what the server will take.
    ///
    /// Counted in unicode scalars, not characters: DRF's `max_length` counts Python code
    /// points while Swift's `count` counts grapheme clusters — one family emoji is a single
    /// character here and several code points there. Counting the Swift way would let a message
    /// through the field and have the server refuse it, which is the one thing the cap exists
    /// to prevent. Cutting on a scalar boundary can only ever be stricter than the server.
    public static func clampedMessage(_ text: String) -> String {
        var scalars = text.unicodeScalars
        guard scalars.count > messageLimit else { return text }
        scalars.removeLast(scalars.count - messageLimit)
        return String(scalars)
    }

    private enum CodingKeys: String, CodingKey {
        case system
        case category
        case questionId = "question_id"
        case message
        case attemptId = "attempt_id"
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(system, forKey: .system)
        try container.encode(questionId, forKey: .questionId)
        try container.encode(category, forKey: .category)
        let text = trimmedMessage
        if !text.isEmpty { try container.encode(text, forKey: .message) }
        // Absent, not null: the review surface has no attempt to name, and `null` would read
        // as "an attempt that is not known" rather than "not about an attempt at all".
        if let attemptId { try container.encode(attemptId, forKey: .attemptId) }
    }
}

/// What came back. `deduped` is the server saying the same student already reported this
/// question within its five-minute window — a success, not a failure, but it is thanked
/// differently so a student does not think the first one went nowhere.
public struct QuestionReportResult: Decodable, Sendable, Equatable {
    public let id: Int
    public let status: String?
    public let deduped: Bool

    public init(id: Int, status: String? = nil, deduped: Bool = false) {
        self.id = id
        self.status = status
        self.deduped = deduped
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        // A fresh report carries `status` and no `deduped` key at all; absent means new.
        deduped = try container.decodeIfPresent(Bool.self, forKey: .deduped) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, deduped
    }
}

public struct QuestionReportsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Send one report. 201 for a new one, 200 with `deduped` for a repeat.
    public func submit(_ report: QuestionReport) async throws -> QuestionReportResult {
        try await client.send(
            try .post("/question-reports/reports/", json: report),
            as: QuestionReportResult.self
        )
    }
}

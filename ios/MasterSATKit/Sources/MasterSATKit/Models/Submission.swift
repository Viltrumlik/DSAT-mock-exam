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

    public var isReturned: Bool { (status ?? "").lowercased() == "returned" || returnedAt != nil }

    public var hasBeenSubmitted: Bool { submittedAt != nil }

    private enum CodingKeys: String, CodingKey {
        case id, status, revision, files
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
    }
}

import Foundation

/// What one homework hand-in may carry.
///
/// The server refuses anything over these, but only after the upload: a student on mobile
/// data would send 70 MB of photos to be told "File too large" at the end. Checked on the
/// phone first, so the refusal comes before the wait — and in words that say what to do.
///
/// Newer servers send their own numbers as `submission_limits` on the assignment; until then
/// `standard` is the server's own default (`classes/submission_limits.py`): 50 files, 50 MB a
/// file, and 60 MB in one request, because nginx (`client_max_body_size 60M`) refuses a
/// bigger body with an HTML 413 before Django ever sees it.
public struct SubmissionLimits: Decodable, Sendable, Equatable {
    public let maxFilesPerSubmission: Int
    public let maxFileBytes: Int
    public let maxBatchBytes: Int
    /// Lower-case, with the dot: ".pdf".
    public let allowedExtensions: [String]

    public static let standard = SubmissionLimits(
        maxFilesPerSubmission: 50,
        maxFileBytes: 50 * 1024 * 1024,
        maxBatchBytes: 60 * 1024 * 1024,
        allowedExtensions: [".doc", ".docx", ".gif", ".jpeg", ".jpg", ".pdf", ".png",
                            ".ppt", ".pptx", ".txt", ".webp", ".xls", ".xlsx"]
    )

    public init(maxFilesPerSubmission: Int, maxFileBytes: Int, maxBatchBytes: Int, allowedExtensions: [String]) {
        self.maxFilesPerSubmission = maxFilesPerSubmission
        self.maxFileBytes = maxFileBytes
        self.maxBatchBytes = maxBatchBytes
        self.allowedExtensions = allowedExtensions.map(Self.normalise).filter { $0.count > 1 }
    }

    private enum CodingKeys: String, CodingKey {
        case maxFilesPerSubmission = "max_files_per_submission"
        case maxFileBytes = "max_file_bytes"
        case maxBatchBytes = "max_batch_bytes"
        case allowedExtensions = "allowed_extensions"
    }

    /// Any field the server leaves out, or sends as nonsense, keeps the standard value — a
    /// limit of zero would refuse every file.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func positive(_ key: CodingKeys, _ fallback: Int) -> Int {
            let value = (try? c.decodeIfPresent(Int.self, forKey: key)) ?? nil
            return (value ?? 0) > 0 ? value! : fallback
        }
        let standard = Self.standard
        let extensions = ((try? c.decodeIfPresent([String].self, forKey: .allowedExtensions)) ?? nil) ?? []
        self.init(
            maxFilesPerSubmission: positive(.maxFilesPerSubmission, standard.maxFilesPerSubmission),
            maxFileBytes: positive(.maxFileBytes, standard.maxFileBytes),
            maxBatchBytes: positive(.maxBatchBytes, standard.maxBatchBytes),
            allowedExtensions: extensions.isEmpty ? standard.allowedExtensions : extensions
        )
    }

    private static func normalise(_ ext: String) -> String {
        let trimmed = ext.trimmingCharacters(in: .whitespaces).lowercased()
        return trimmed.hasPrefix(".") ? trimmed : "." + trimmed
    }

    // MARK: - Checking

    /// Something that would be refused.
    public enum Problem: Equatable, Sendable {
        case typeNotAccepted(fileName: String)
        case fileTooLarge(fileName: String, bytes: Int)
        case tooManyFiles(total: Int)
        case uploadTooLarge(bytes: Int)
    }

    /// One file, as it is picked: is it a type the server takes, and small enough?
    public func problem(fileName: String, bytes: Int) -> Problem? {
        let ext = Self.extensionOf(fileName)
        if ext.isEmpty || !allowedExtensions.contains(ext) { return .typeNotAccepted(fileName: fileName) }
        if bytes > maxFileBytes { return .fileTooLarge(fileName: fileName, bytes: bytes) }
        return nil
    }

    /// The whole upload, just before it is sent: every file again, the count the submission
    /// would reach, and the size of the one request.
    public func problem(files: [(name: String, bytes: Int)], alreadyHandedIn: Int) -> Problem? {
        for file in files {
            if let problem = problem(fileName: file.name, bytes: file.bytes) { return problem }
        }
        let total = alreadyHandedIn + files.count
        if total > maxFilesPerSubmission { return .tooManyFiles(total: total) }
        let bytes = files.reduce(0) { $0 + $1.bytes }
        if bytes > maxBatchBytes { return .uploadTooLarge(bytes: bytes) }
        return nil
    }

    /// What to tell the student — what happened, and what to do instead.
    public func message(for problem: Problem) -> String {
        switch problem {
        case .typeNotAccepted(let name):
            return "“\(name)” can't be handed in as it is. Files that work: \(allowedExtensions.joined(separator: ", "))."
        case .fileTooLarge(let name, let bytes):
            return "“\(name)” is \(Self.megabytes(bytes)). Each file can be up to \(Self.megabytes(maxFileBytes)) — a smaller photo or a PDF will go through."
        case .tooManyFiles(let total):
            let over = total - maxFilesPerSubmission
            return "A hand-in holds up to \(maxFilesPerSubmission) files, and this would make \(total). Remove \(over) and send again."
        case .uploadTooLarge(let bytes):
            return "These files come to \(Self.megabytes(bytes)), and one upload can carry \(Self.megabytes(maxBatchBytes)). Send some now and the rest after."
        }
    }

    /// ".pdf" from "Essay.PDF"; empty when there is no extension.
    public static func extensionOf(_ fileName: String) -> String {
        let base = fileName.split(separator: "/").last.map(String.init) ?? fileName
        guard let dot = base.lastIndex(of: "."), dot != base.index(before: base.endIndex) else { return "" }
        return String(base[dot...]).lowercased()
    }

    /// "72 MB", "2.4 MB", "680 KB" — the web's `formatBytes`.
    public static func megabytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let kb = Double(bytes) / 1024
        if kb < 1024 { return "\(Int(kb.rounded())) KB" }
        let mb = kb / 1024
        return mb >= 10 ? "\(Int(mb.rounded())) MB" : String(format: "%.1f MB", mb)
    }
}

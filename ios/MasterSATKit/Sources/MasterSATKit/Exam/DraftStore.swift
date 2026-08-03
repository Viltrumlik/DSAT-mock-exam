import Foundation

/// The student's work for one module, as last seen locally.
public struct ExamDraft: Codable, Sendable, Equatable {
    public var answers: [String: String]
    public var flagged: [Int]
    /// The server `version_number` this draft was based on. Nil when unknown.
    public var version: Int?
    public var moduleId: Int

    public init(answers: [String: String], flagged: [Int], version: Int?, moduleId: Int) {
        self.answers = answers
        self.flagged = flagged
        self.version = version
        self.moduleId = moduleId
    }
}

public protocol DraftStoring: Sendable {
    func read(attemptId: Int, moduleId: Int) -> ExamDraft?
    func write(attemptId: Int, draft: ExamDraft)
    func clear(attemptId: Int, moduleId: Int)
}

/// Offline-safe local draft of per-module work. Port of `services/draftStore.ts`.
///
/// This is a *backup*; the server is always authoritative. It exists because an answer that
/// lives only in memory is an answer that grades Omitted if the app is killed — and iOS
/// kills backgrounded apps without warning, which is a sharper version of the same risk the
/// web runner has.
///
/// Scoped by (attempt, module) so Module 1 work can never bleed into Module 2.
public struct FileDraftStore: DraftStoring {
    private let directory: URL

    public init(directory: URL? = nil) {
        if let directory {
            self.directory = directory
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? URL(fileURLWithPath: NSTemporaryDirectory())
            self.directory = base.appendingPathComponent("MasterSAT/ExamDrafts", isDirectory: true)
        }
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }

    private func url(attemptId: Int, moduleId: Int) -> URL {
        directory.appendingPathComponent("draft.\(attemptId).\(moduleId).json")
    }

    public func read(attemptId: Int, moduleId: Int) -> ExamDraft? {
        guard let data = try? Data(contentsOf: url(attemptId: attemptId, moduleId: moduleId)),
              let draft = try? JSONCoding.decoder.decode(ExamDraft.self, from: data),
              // Belt and braces: the filename already scopes it, but a draft that claims a
              // different module must never be applied to this one.
              draft.moduleId == moduleId
        else { return nil }
        return draft
    }

    public func write(attemptId: Int, draft: ExamDraft) {
        guard let data = try? JSONCoding.encoder.encode(draft) else { return }
        // `.atomic` so a crash mid-write cannot leave a truncated draft — the one moment
        // the file matters most is the moment the app is being killed.
        try? data.write(to: url(attemptId: attemptId, moduleId: draft.moduleId), options: .atomic)
    }

    public func clear(attemptId: Int, moduleId: Int) {
        try? FileManager.default.removeItem(at: url(attemptId: attemptId, moduleId: moduleId))
    }
}

/// Test double.
public final class InMemoryDraftStore: DraftStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var drafts: [String: ExamDraft] = [:]

    public init() {}

    private func key(_ attemptId: Int, _ moduleId: Int) -> String { "\(attemptId).\(moduleId)" }

    public func read(attemptId: Int, moduleId: Int) -> ExamDraft? {
        lock.lock(); defer { lock.unlock() }
        return drafts[key(attemptId, moduleId)]
    }

    public func write(attemptId: Int, draft: ExamDraft) {
        lock.lock(); defer { lock.unlock() }
        drafts[key(attemptId, draft.moduleId)] = draft
    }

    public func clear(attemptId: Int, moduleId: Int) {
        lock.lock(); defer { lock.unlock() }
        drafts[key(attemptId, moduleId)] = nil
    }
}

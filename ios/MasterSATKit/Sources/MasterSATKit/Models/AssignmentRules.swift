import Foundation

/// What a teacher gave for a piece of classwork. Classwork is paid only by this award.
public struct ClassworkAward: Decodable, Sendable, Equatable {
    public let points: Int
    public let xp: Int
    public let awardedAt: String?
    public let note: String

    private enum CodingKeys: String, CodingKey {
        case points, xp, note
        case awardedAt = "awarded_at"
    }

    public init(points: Int, xp: Int, awardedAt: String?, note: String) {
        self.points = points
        self.xp = xp
        self.awardedAt = awardedAt
        self.note = note
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        points = (try? c.decodeIfPresent(Int.self, forKey: .points)) as? Int ?? 0
        xp = (try? c.decodeIfPresent(Int.self, forKey: .xp)) as? Int ?? 0
        awardedAt = try? c.decodeIfPresent(String.self, forKey: .awardedAt)
        note = (try? c.decodeIfPresent(String.self, forKey: .note)) as? String ?? ""
    }
}

extension AssignmentListing {
    /// This list row, with the content only the detail endpoint carries.
    ///
    /// Not a replacement: the detail is the teacher's view of the assignment and knows
    /// nothing about THIS student — no `classroom_id`, no `workflow_status`, no per-student
    /// progress on its quizzes and word sets. Swapping the row for it lost the classroom (the
    /// page then said "This homework has no classroom") and every progress badge. So the row
    /// keeps what it knows about the student, and takes what the teacher wrote.
    public func merging(detail: AssignmentListing) -> AssignmentListing {
        var merged = self
        if !detail.title.isEmpty { merged.title = detail.title }
        merged.instructions = detail.instructions ?? instructions
        merged.dueAt = detail.dueAt ?? dueAt
        merged.subject = detail.subject ?? subject
        merged.attachments = detail.attachments.isEmpty ? attachments : detail.attachments
        merged.externalURLs = detail.externalURLs.isEmpty ? externalURLs : detail.externalURLs
        merged.externalURLLabels = detail.externalURLLabels.isEmpty ? externalURLLabels : detail.externalURLLabels
        merged.videoURL = detail.videoURL ?? videoURL
        merged.videoFileURL = detail.videoFileURL ?? videoFileURL
        merged.locksFileUpload = detail.locksFileUpload
        merged.allowFileUpload = detail.allowFileUpload ?? allowFileUpload
        merged.category = detail.category ?? category
        merged.maxScore = detail.maxScore ?? maxScore
        merged.classworkAward = detail.classworkAward ?? classworkAward
        merged.mockExamId = detail.mockExamId ?? mockExamId
        merged.practiceTestPackId = detail.practiceTestPackId ?? practiceTestPackId
        merged.practiceTestPackIds = detail.practiceTestPackIds.isEmpty ? practiceTestPackIds : detail.practiceTestPackIds
        merged.practiceTestId = detail.practiceTestId ?? practiceTestId
        merged.practiceTestIds = detail.practiceTestIds.isEmpty ? practiceTestIds : detail.practiceTestIds
        merged.moduleId = detail.moduleId ?? moduleId
        merged.submissionLimits = detail.submissionLimits ?? submissionLimits
        if !detail.contents.isEmpty { merged.contents = detail.contents }
        // Past-paper sections carry the student's own state and only the detail lists them.
        if !detail.practiceBundleTests.isEmpty { merged.practiceBundleTests = detail.practiceBundleTests }
        return merged
    }

    /// This row, told which class it belongs to — for rows from a per-class list, which
    /// never say. What the row already knows wins.
    public func inClassroom(id: Int, name: String?) -> AssignmentListing {
        var stamped = self
        if stamped.classroomId == nil { stamped.classroomId = id }
        if (stamped.classroomName ?? "").isEmpty, let name, !name.isEmpty { stamped.classroomName = name }
        return stamped
    }

    public var isClasswork: Bool { (category ?? "").uppercased() == "CLASSWORK" }

    /// Every practice pack attached, the legacy single one included.
    public var allPracticePackIds: [Int] {
        var ids = practiceTestPackIds
        if let practiceTestPackId, !ids.contains(practiceTestPackId) { ids.insert(practiceTestPackId, at: 0) }
        return ids
    }

    /// Anything the student opens and works through, rather than hands in.
    public var hasLaunchableContent: Bool {
        !assessmentHomeworks.isEmpty || !vocabHomeworks.isEmpty || !practiceBundleTests.isEmpty
            || mockExamId != nil || !allPracticePackIds.isEmpty
            || practiceTestId != nil || !practiceTestIds.isEmpty || moduleId != nil
    }

    /// Whether to offer a file hand-in — the web's own rule: the teacher allowed one, or
    /// there is nothing else to do and it is not classwork.
    ///
    /// The old app offered an upload box on EVERY homework, quizzes included, and the server
    /// took those files — work handed in that no teacher was ever going to look for.
    public var offersFileUpload: Bool {
        if allowFileUpload == true { return true }
        return !hasLaunchableContent && !isClasswork
    }

    /// Links with the names the teacher gave them; an unnamed link shows its address.
    public var namedLinks: [(url: String, label: String)] {
        externalURLs.enumerated().map { index, url in
            let label = index < externalURLLabels.count
                ? externalURLLabels[index].trimmingCharacters(in: .whitespaces) : ""
            return (url, label)
        }
    }

    /// Whether a file hand-in has closed.
    ///
    /// The server refuses any change after `due_at` unless the work was sent back for a
    /// revision, and a reviewed submission is locked for good. Saying so before the student
    /// picks five photos beats letting them upload and then refusing.
    public func isHandInClosed(submissionStatus: String?, now: Date = Date()) -> Bool {
        let status = (submissionStatus ?? "").uppercased()
        if status == "REVIEWED" { return true }
        if status == "RETURNED" { return false }
        guard let dueAt, let due = JSONCoding.parseServerDate(dueAt) else { return false }
        return now >= due
    }
}

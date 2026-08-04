import Foundation

/// The per-skill breakdown of one sat midterm, from
/// `/api/midterms/attempts/<id>/error-report/`.
///
/// It answers one question — *which skills cost me the paper?* — and it is built from the
/// results frozen at scoring time, never re-graded. Midterm content is live-synced from the
/// builder, so a report rebuilt later could disagree with the score the student was given.
///
/// It sits behind the same release gate as the score, and deliberately so: it carries
/// strictly more than the score does. Before publication the server answers 403 with a
/// sentence to show, not a silent empty report.
public struct MidtermErrorReport: Decodable, Sendable, Equatable {
    public let attemptId: Int
    public let studentName: String
    /// Already written the way a person writes a date — "21 July 2026".
    public let date: String
    public let midterm: Paper
    public let score: Double?
    public let correctCount: Int
    public let totalCount: Int
    public let passMark: Int?
    public let passed: Bool?
    /// Pre-midterms are diagnostics: scored, never judged. There is no pass mark to show.
    public let isGraded: Bool
    /// Questions carrying no skill tag. Disclosed rather than folded into a skill row —
    /// quietly under-reporting a skill's question count would misdirect the revision.
    public let unclassifiedTotal: Int
    public let unclassifiedWrong: Int
    /// Only the skills that actually cost marks; a fully-correct skill is not an error.
    /// Already sorted by the server: most marks lost first.
    public let skills: [SkillRow]

    public struct Paper: Decodable, Sendable, Equatable {
        public let id: Int
        public let title: String
        public let subject: String
        public let subjectLabel: String
        public let scoreCeiling: Double?
        public let level: String
        public let midtermType: String?

        private enum CodingKeys: String, CodingKey {
            case id, title, subject, level
            case subjectLabel = "subject_label"
            case scoreCeiling = "score_ceiling"
            case midtermType = "midterm_type"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = (try? c.decode(Int.self, forKey: .id)) ?? 0
            title = (try? c.decode(String.self, forKey: .title)) ?? ""
            subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) as? String ?? ""
            subjectLabel = (try? c.decodeIfPresent(String.self, forKey: .subjectLabel)) as? String ?? ""
            scoreCeiling = try? c.decodeIfPresent(Double.self, forKey: .scoreCeiling)
            level = (try? c.decodeIfPresent(String.self, forKey: .level)) as? String ?? ""
            midtermType = try? c.decodeIfPresent(String.self, forKey: .midtermType)
        }
    }

    public struct SkillRow: Decodable, Sendable, Equatable, Identifiable {
        public let skillId: Int?
        public let skill: String
        public let domain: String?
        public let total: Int
        public let wrong: Int

        /// Stable even when the taxonomy row has been retired and only the frozen name
        /// survives — which is exactly when `skillId` is nil.
        public var id: String { skillId.map(String.init) ?? "name:\(skill)" }

        public var correct: Int { max(0, total - wrong) }

        /// How much of this skill the student got right, 0…1. A skill with no questions
        /// cannot appear here, but the guard costs nothing and NaN draws as nothing.
        public var accuracy: Double {
            total > 0 ? Double(correct) / Double(total) : 0
        }

        private enum CodingKeys: String, CodingKey {
            case skill, domain, total, wrong
            case skillId = "skill_id"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            skillId = try? c.decodeIfPresent(Int.self, forKey: .skillId)
            skill = (try? c.decodeIfPresent(String.self, forKey: .skill)) as? String ?? "Unclassified"
            domain = try? c.decodeIfPresent(String.self, forKey: .domain)
            total = (try? c.decodeIfPresent(Int.self, forKey: .total)) as? Int ?? 0
            wrong = (try? c.decodeIfPresent(Int.self, forKey: .wrong)) as? Int ?? 0
        }
    }

    private enum CodingKeys: String, CodingKey {
        case date, midterm, score, skills, passed
        case attemptId = "attempt_id"
        case studentName = "student_name"
        case correctCount = "correct_count"
        case totalCount = "total_count"
        case passMark = "pass_mark"
        case isGraded = "is_graded"
        case unclassifiedTotal = "unclassified_total"
        case unclassifiedWrong = "unclassified_wrong"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attemptId = (try? c.decode(Int.self, forKey: .attemptId)) ?? 0
        studentName = (try? c.decodeIfPresent(String.self, forKey: .studentName)) as? String ?? ""
        date = (try? c.decodeIfPresent(String.self, forKey: .date)) as? String ?? ""
        midterm = try c.decode(Paper.self, forKey: .midterm)
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
        correctCount = (try? c.decodeIfPresent(Int.self, forKey: .correctCount)) as? Int ?? 0
        totalCount = (try? c.decodeIfPresent(Int.self, forKey: .totalCount)) as? Int ?? 0
        passMark = try? c.decodeIfPresent(Int.self, forKey: .passMark)
        passed = try? c.decodeIfPresent(Bool.self, forKey: .passed)
        isGraded = (try? c.decodeIfPresent(Bool.self, forKey: .isGraded)) as? Bool ?? false
        unclassifiedTotal = (try? c.decodeIfPresent(Int.self, forKey: .unclassifiedTotal)) as? Int ?? 0
        unclassifiedWrong = (try? c.decodeIfPresent(Int.self, forKey: .unclassifiedWrong)) as? Int ?? 0
        skills = (try? c.decodeIfPresent([SkillRow].self, forKey: .skills)) as? [SkillRow] ?? []
    }

    /// Marks lost across every tagged skill, plus the untagged ones. This is the number the
    /// header leads with, and it must agree with `correctCount` — so it is derived from the
    /// same totals rather than summed out of the skill rows, which exclude perfect skills.
    public var wrongCount: Int { max(0, totalCount - correctCount) }
}

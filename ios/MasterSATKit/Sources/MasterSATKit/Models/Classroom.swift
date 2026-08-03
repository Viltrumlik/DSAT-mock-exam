import Foundation

/// One classroom the student belongs to, from `/api/classes/`.
public struct Classroom: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let subject: String?
    public let level: String?
    public let scheduleSummary: String?
    public let lessonTime: String?
    public let roomNumber: String?
    public let membersCount: Int?
    public let isActive: Bool
    public let teacherName: String?
    public let teacherPhotoURL: String?
    /// The viewer's membership role. Nil once they have been removed — the list still
    /// returns the row, so the app must not assume a row means access.
    public let myRole: String?

    public var isStudent: Bool { (myRole ?? "").uppercased() == "STUDENT" }

    private enum CodingKeys: String, CodingKey {
        case id, name, subject, level
        case scheduleSummary = "schedule_summary"
        case lessonTime = "lesson_time"
        case roomNumber = "room_number"
        case membersCount = "members_count"
        case isActive = "is_active"
        case teacherDetails = "teacher_details"
        case myRole = "my_role"
    }

    private enum TeacherKeys: String, CodingKey {
        case name
        case firstName = "first_name"
        case lastName = "last_name"
        case email
        case profileImageURL = "profile_image_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        subject = try? c.decodeIfPresent(String.self, forKey: .subject)
        level = try? c.decodeIfPresent(String.self, forKey: .level)
        scheduleSummary = try? c.decodeIfPresent(String.self, forKey: .scheduleSummary)
        lessonTime = try? c.decodeIfPresent(String.self, forKey: .lessonTime)
        roomNumber = try? c.decodeIfPresent(String.self, forKey: .roomNumber)
        membersCount = try? c.decodeIfPresent(Int.self, forKey: .membersCount)
        isActive = (try? c.decodeIfPresent(Bool.self, forKey: .isActive)) as? Bool ?? true
        myRole = try? c.decodeIfPresent(String.self, forKey: .myRole)

        // The teacher arrives as a nested object whose name may be pre-composed or split.
        if let t = try? c.nestedContainer(keyedBy: TeacherKeys.self, forKey: .teacherDetails) {
            let composed = [
                try? t.decodeIfPresent(String.self, forKey: .firstName),
                try? t.decodeIfPresent(String.self, forKey: .lastName),
            ]
            .compactMap { $0 ?? nil }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            let given = (try? t.decodeIfPresent(String.self, forKey: .name)) ?? nil
            let email = (try? t.decodeIfPresent(String.self, forKey: .email)) ?? nil
            teacherName = [given, composed.isEmpty ? nil : composed, email]
                .compactMap { $0 }
                .first { !$0.isEmpty }
            teacherPhotoURL = (try? t.decodeIfPresent(String.self, forKey: .profileImageURL)) ?? nil
        } else {
            teacherName = nil
            teacherPhotoURL = nil
        }
    }
}

/// One person in a classroom, from `/api/classes/{id}/people/`.
public struct ClassroomMember: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let role: String
    public let status: String?
    public let joinedAt: String?
    public let userId: Int
    public let name: String
    public let email: String?
    public let photoURL: String?

    /// Staff, in the roles the classroom actually stores. Legacy `ADMIN`/`CO_TEACHER`
    /// still appear on older classrooms, so match them too rather than only the new names.
    public var isStaff: Bool {
        ["OWNER", "TEACHER", "TA", "ADMIN", "CO_TEACHER"].contains(role.uppercased())
    }

    public var roleLabel: String {
        switch role.uppercased() {
        case "OWNER", "ADMIN": return "Owner"
        case "TEACHER": return "Teacher"
        case "TA", "CO_TEACHER": return "Teaching Assistant"
        case "STUDENT": return "Student"
        default: return role.capitalized
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, role, status, user
        case joinedAt = "joined_at"
    }

    private enum UserKeys: String, CodingKey {
        case id, email, username
        case firstName = "first_name"
        case lastName = "last_name"
        case profileImageURL = "profile_image_url"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        role = (try? c.decodeIfPresent(String.self, forKey: .role)) as? String ?? "STUDENT"
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        joinedAt = try? c.decodeIfPresent(String.self, forKey: .joinedAt)

        let u = try c.nestedContainer(keyedBy: UserKeys.self, forKey: .user)
        userId = (try? u.decode(Int.self, forKey: .id)) ?? 0
        email = try? u.decodeIfPresent(String.self, forKey: .email)
        photoURL = try? u.decodeIfPresent(String.self, forKey: .profileImageURL)
        let full = [
            try? u.decodeIfPresent(String.self, forKey: .firstName),
            try? u.decodeIfPresent(String.self, forKey: .lastName),
        ]
        .compactMap { $0 ?? nil }
        .filter { !$0.isEmpty }
        .joined(separator: " ")
        let username = (try? u.decodeIfPresent(String.self, forKey: .username)) ?? nil
        name = [full.isEmpty ? nil : full, username, email]
            .compactMap { $0 }
            .first { !$0.isEmpty } ?? "Student"
    }
}

/// A file the teacher shared with the class.
public struct ClassroomMaterial: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let title: String
    public let description: String?
    public let fileURL: String?
    public let fileName: String?
    public let fileSize: Int?
    public let teacherName: String?
    public let createdAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, description
        case fileURL = "file_url"
        case fileName = "file_name"
        case fileSize = "file_size"
        case teacherName = "teacher_name"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        fileURL = try? c.decodeIfPresent(String.self, forKey: .fileURL)
        fileName = try? c.decodeIfPresent(String.self, forKey: .fileName)
        fileSize = try? c.decodeIfPresent(Int.self, forKey: .fileSize)
        teacherName = try? c.decodeIfPresent(String.self, forKey: .teacherName)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

/// Which leaderboard. SAT ranks on pastpaper scores; Academic on classwork.
public enum RankingKind: String, Sendable, CaseIterable {
    case sat = "SAT"
    case academic = "ACADEMIC"

    public var path: String { rawValue.lowercased() }
    public var label: String { self == .sat ? "SAT" : "Academic" }
}

public struct RankingRow: Decodable, Sendable, Equatable, Identifiable {
    public let rank: Int
    public let isMe: Bool
    public let name: String
    public let photoURL: String?
    /// Nil means either the class hides scores or this student has no result yet —
    /// `hasResult` is the only way to tell those apart, and they need different words.
    public let score: Double?
    public let hasResult: Bool
    public let previousRank: Int?
    public let rankChange: Int?
    public let trend: String?
    public let percentile: Double?

    public var id: String { "\(rank).\(name)" }

    private enum CodingKeys: String, CodingKey {
        case rank, name, score, trend, percentile
        case isMe = "is_me"
        case photoURL = "profile_image_url"
        case hasResult = "has_result"
        case previousRank = "previous_rank"
        case rankChange = "rank_change"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank = (try? c.decodeIfPresent(Int.self, forKey: .rank)) as? Int ?? 0
        isMe = (try? c.decodeIfPresent(Bool.self, forKey: .isMe)) as? Bool ?? false
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) as? String ?? ""
        photoURL = try? c.decodeIfPresent(String.self, forKey: .photoURL)
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
        hasResult = (try? c.decodeIfPresent(Bool.self, forKey: .hasResult)) as? Bool ?? (score != nil)
        previousRank = try? c.decodeIfPresent(Int.self, forKey: .previousRank)
        rankChange = try? c.decodeIfPresent(Int.self, forKey: .rankChange)
        trend = try? c.decodeIfPresent(String.self, forKey: .trend)
        percentile = try? c.decodeIfPresent(Double.self, forKey: .percentile)
    }

    public init(
        rank: Int,
        isMe: Bool = false,
        name: String,
        photoURL: String? = nil,
        score: Double? = nil,
        hasResult: Bool = true,
        previousRank: Int? = nil,
        rankChange: Int? = nil,
        trend: String? = nil,
        percentile: Double? = nil
    ) {
        self.rank = rank
        self.isMe = isMe
        self.name = name
        self.photoURL = photoURL
        self.score = score
        self.hasResult = hasResult
        self.previousRank = previousRank
        self.rankChange = rankChange
        self.trend = trend
        self.percentile = percentile
    }
}

public struct RankingBoard: Decodable, Sendable, Equatable {
    public let kind: String
    public let rows: [RankingRow]
    public let my: RankingRow?
    /// FULL / ANONYMOUS / HIDDEN. A hidden board is a class setting, not an error.
    public let leaderboardMode: String
    public let hideScoreValues: Bool
    /// False for foundation/junior/untagged classes, which do not rank on SAT at all.
    public let satAvailable: Bool

    public var isHidden: Bool { leaderboardMode.uppercased() == "HIDDEN" }
    public var isAnonymous: Bool { leaderboardMode.uppercased() == "ANONYMOUS" }

    private enum CodingKeys: String, CodingKey {
        case kind, rows, my, config
        case satAvailable = "sat_available"
    }

    private enum ConfigKeys: String, CodingKey {
        case leaderboardMode = "leaderboard_mode"
        case hideScoreValues = "hide_score_values"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) as? String ?? "ACADEMIC"
        rows = (try? c.decodeIfPresent([RankingRow].self, forKey: .rows)) as? [RankingRow] ?? []
        my = try? c.decodeIfPresent(RankingRow.self, forKey: .my)
        satAvailable = (try? c.decodeIfPresent(Bool.self, forKey: .satAvailable)) as? Bool ?? true
        if let cfg = try? c.nestedContainer(keyedBy: ConfigKeys.self, forKey: .config) {
            leaderboardMode = (try? cfg.decodeIfPresent(String.self, forKey: .leaderboardMode))
                .flatMap { $0 } ?? "FULL"
            hideScoreValues = (try? cfg.decodeIfPresent(Bool.self, forKey: .hideScoreValues))
                .flatMap { $0 } ?? false
        } else {
            leaderboardMode = "FULL"
            hideScoreValues = false
        }
    }
}

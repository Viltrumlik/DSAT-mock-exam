import Foundation

// The classroom's wording rules, ported from the web (`features/classroom/capabilities.ts`,
// `pages/ClassesHome.tsx`, `shell/ClassroomShell.tsx`, `pages/Classwork.tsx`). Kept here, and
// tested, because each one has already been got wrong once somewhere.

// MARK: - Staff titles

/// What a member of the teaching team is called.
///
/// Named after the person's ACCOUNT, never the membership. The membership role is a
/// permission tier, not a job title: an ownership transfer demotes the admin who made the
/// class to TEACHER and promotes the class's teacher to OWNER, and a support teacher joins as
/// a TA. Read as titles, those were wrong almost everywhere. Four titles, the four the
/// learning center uses — there is no "Teaching assistant".
public enum StaffTitle {
    /// The order the teaching team is listed in: the owner first, then down the house.
    public static let order = ["Owner", "Admin", "Teacher", "Support teacher"]

    /// Nil for a student, or for a membership role that grants no seat at all.
    public static func title(membershipRole: String, accountRole: String?) -> String? {
        switch membershipRole.uppercased() {
        case "OWNER", "ADMIN", "TEACHER", "TA", "CO_TEACHER": break
        default: return nil
        }
        switch (accountRole ?? "").trimmingCharacters(in: .whitespaces).lowercased() {
        case "super_admin": return "Owner"
        case "admin": return "Admin"
        case "teacher": return "Teacher"
        case "support_teacher": return "Support teacher"
        default:
            // An account whose role names no staff job is titled by the seat its membership
            // gives it — and never "Owner", which belongs to the learning center's owner alone.
            let seat = membershipRole.uppercased()
            return seat == "TA" || seat == "CO_TEACHER" ? "Support teacher" : "Teacher"
        }
    }

    /// The teaching team in title order. Stable: people sharing a title keep the server's
    /// order among themselves.
    public static func sorted(_ staff: [ClassroomMember]) -> [ClassroomMember] {
        staff.enumerated()
            .sorted { lhs, rhs in
                let l = rank(lhs.element), r = rank(rhs.element)
                return l != r ? l < r : lhs.offset < rhs.offset
            }
            .map(\.element)
    }

    private static func rank(_ member: ClassroomMember) -> Int {
        order.firstIndex(of: member.staffTitle ?? "Teacher") ?? order.count
    }
}

// MARK: - Schedule wording

extension Classroom {
    public var isMath: Bool { (subject ?? "").uppercased() == "MATH" }

    /// "Math" or "English" — anything that is not maths is an English class on this site.
    public var subjectLabel: String { isMath ? "Math" : "English" }

    /// "Mon, Wed, Fri" for ODD, "Tue, Thu, Sat" for EVEN; anything else as it came.
    public var lessonDaysShort: String { ClassroomSchedule.daysShort(lessonDays) }

    /// The class card's line: "Tue, Thu, Sat · 5:00 PM · Room 204", falling back to the
    /// subject when the class has no schedule at all.
    public var cardScheduleLine: String {
        let parts = [lessonDaysShort, ClassroomSchedule.time12h(lessonTime), ClassroomSchedule.roomLabel(roomNumber)]
            .filter { !$0.isEmpty }
        return parts.isEmpty ? subjectLabel : parts.joined(separator: " · ")
    }

    /// The class header's line: "Tue, Thu, Sat · 18:00" — the time exactly as the centre
    /// wrote it. The room is drawn beside it with its own icon.
    public var headerScheduleLine: String {
        let days = lessonDaysShort
        let time = (lessonTime ?? "").trimmingCharacters(in: .whitespaces)
        guard !days.isEmpty else { return "" }
        return time.isEmpty ? days : "\(days) · \(time)"
    }
}

public enum ClassroomSchedule {
    public static func daysShort(_ raw: String?) -> String {
        switch (raw ?? "").trimmingCharacters(in: .whitespaces) {
        case "ODD": return "Mon, Wed, Fri"
        case "EVEN": return "Tue, Thu, Sat"
        case let other: return other
        }
    }

    /// "18:00" → "6:00 PM". Free text that is not a clock time is returned as typed.
    public static func time12h(_ raw: String?) -> String {
        let text = (raw ?? "").trimmingCharacters(in: .whitespaces)
        let parts = text.split(separator: ":", maxSplits: 1)
        guard parts.count == 2,
              let hour = Int(parts[0]), (0...23).contains(hour),
              parts[1].count >= 2, let _ = Int(parts[1].prefix(2)) else { return text }
        let minutes = parts[1].prefix(2)
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve):\(minutes) \(hour >= 12 ? "PM" : "AM")"
    }

    /// "204" → "Room 204"; a value that already says "Room …" is left alone. The web's
    /// test is `/^room\b/i`, so "Room-4" counts as already labelled and "Room4" does not.
    public static func roomLabel(_ raw: String?) -> String {
        let text = (raw ?? "").trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return "" }
        let lower = text.lowercased()
        if lower.hasPrefix("room") {
            let rest = lower.dropFirst(4)
            guard let next = rest.first else { return text }
            if !(next.isLetter || next.isNumber || next == "_") { return text }
        }
        return "Room \(text)"
    }
}

/// The classes list's filter: All · English · Math. Anything that is not maths counts as
/// English, the same rule the web's counts use.
public enum ClassroomSubjectFilter: String, CaseIterable, Sendable {
    case all, english, math

    public var title: String {
        switch self {
        case .all: return "All"
        case .english: return "English"
        case .math: return "Math"
        }
    }

    public func matches(_ classroom: Classroom) -> Bool {
        switch self {
        case .all: return true
        case .english: return !classroom.isMath
        case .math: return classroom.isMath
        }
    }
}

// MARK: - Materials

/// What kind of file a class material is, read from its name — the web's `materialMeta`.
public struct MaterialKind: Equatable, Sendable {
    /// The filter a material falls under on the Materials tab.
    public enum Category: String, CaseIterable, Sendable {
        case document = "Document"
        case slides = "Slides"
        case audio = "Audio"
    }

    /// The family its icon and colour come from.
    public enum Family: Sendable { case pdf, text, sheet, image, slides, audio, other }

    /// "PDF", "DOCX" … or "FILE" when the name has no extension.
    public let label: String
    public let category: Category
    public let family: Family

    public init(fileName: String?) {
        let ext = Self.extensionOf(fileName)
        label = ext.isEmpty ? "FILE" : ext.uppercased()
        switch ext {
        case "ppt", "pptx", "key", "odp": (category, family) = (.slides, .slides)
        case "mp3", "m4a", "wav", "aac", "ogg": (category, family) = (.audio, .audio)
        case "pdf": (category, family) = (.document, .pdf)
        case "doc", "docx", "rtf", "txt": (category, family) = (.document, .text)
        case "xls", "xlsx", "csv": (category, family) = (.document, .sheet)
        case "png", "jpg", "jpeg": (category, family) = (.document, .image)
        default: (category, family) = (.document, .other)
        }
    }

    /// Lower-case extension of a file name or URL, without the dot; query and fragment ignored.
    static func extensionOf(_ nameOrURL: String?) -> String {
        guard let nameOrURL, !nameOrURL.isEmpty else { return "" }
        let clean = nameOrURL.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? nameOrURL
        let base = clean.split(separator: "/").last.map(String.init) ?? clean
        guard let dot = base.lastIndex(of: ".") else { return "" }
        return String(base[base.index(after: dot)...]).lowercased()
    }
}

extension ClassroomMaterial {
    public var kind: MaterialKind { MaterialKind(fileName: fileName ?? fileURL) }

    /// "2.4 MB · Jun 3" — size and date, whichever the server could give.
    public func metaLine(locale: Locale = .autoupdatingCurrent, timeZone: TimeZone = .current) -> String {
        var parts: [String] = []
        if let fileSize, fileSize > 0 { parts.append(SubmissionLimits.megabytes(fileSize)) }
        let date = HomeworkWording.shortDate(createdAt, locale: locale, timeZone: timeZone)
        if date != "—" { parts.append(date) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Classwork

/// A student's outcome for one piece of classwork.
///
/// Null and `{points: 0}` are different answers and must stay different: null is "no teacher
/// has looked at this yet", zero is "a teacher marked this lesson". Never test `points > 0`
/// to decide whether an award exists, and never dress a zero up as XP the student lost.
public enum ClassworkAwardState: Equatable, Sendable {
    case notMarked
    case reviewed
    case earned(points: Int)

    public init(_ award: ClassworkAward?) {
        guard let award else { self = .notMarked; return }
        self = award.points > 0 ? .earned(points: award.points) : .reviewed
    }

    /// The row badge: "Not marked yet" · "Reviewed" · "+8 XP".
    public var badge: String {
        switch self {
        case .notMarked: return "Not marked yet"
        case .reviewed: return "Reviewed"
        case .earned(let points): return "+\(points) XP"
        }
    }

    /// The hero tile under "XP": "Not marked yet" · "Reviewed" · "+8".
    public var tileValue: String {
        switch self {
        case .notMarked: return "Not marked yet"
        case .reviewed: return "Reviewed"
        case .earned(let points): return "+\(points)"
        }
    }

    public var isMarked: Bool { self != .notMarked }
}

extension AssignmentListing {
    public var classworkAwardState: ClassworkAwardState { ClassworkAwardState(classworkAward) }

    /// How many openable things a classwork bundled: its contents plus its word sets.
    public var activityCount: Int { contents.count + vocabHomeworks.count }

    /// "3 activities", "1 activity"; nil when there is nothing to open.
    public var activityLabel: String? {
        let n = activityCount
        guard n > 0 else { return nil }
        return "\(n) \(n == 1 ? "activity" : "activities")"
    }
}

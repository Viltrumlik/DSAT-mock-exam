import Foundation

// Surveys — `/api/surveys/…`. The form engine is `backend/surveys/`; the rules that decide
// what is shown and what is still missing are in `SurveyRules`.

// MARK: - Answers

/// One answer, in the three shapes the server stores it (`SurveyAnswer.value` is JSON):
/// text (short/long text, a date as "YYYY-MM-DD", the picked option of a single choice),
/// a number (scale and slider), or a list of option texts (checkboxes).
///
/// There is no "unanswered" case: an unanswered question simply has no entry, which is what
/// the server's `null`, `""` and `[]` all mean.
public enum SurveyAnswer: Sendable, Equatable, Hashable, Codable {
    case text(String)
    case number(Int)
    case choices([String])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) {
            self = .number(n)
        } else if let d = try? c.decode(Double.self), let n = CommunityDecoding.integer(d) {
            // Python's `int()` truncates toward zero, and so does this.
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .text(s)
        } else if let list = try? c.decode([CommunityLooseString].self) {
            self = .choices(list.compactMap(\.value))
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not a survey answer")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .choices(let list): try c.encode(list)
        }
    }
}

// MARK: - Questions

public enum SurveyQuestionType: Sendable, Equatable, Hashable {
    case shortText, longText, singleChoice, multiChoice, scale, rating, date
    /// A type this build does not know. Rendered as a text box, as the web's default branch
    /// renders one — a new type must not blank the whole form.
    case other(String)

    public init(raw: String) {
        switch raw.uppercased() {
        case "SHORT_TEXT": self = .shortText
        case "LONG_TEXT": self = .longText
        case "SINGLE_CHOICE": self = .singleChoice
        case "MULTI_CHOICE": self = .multiChoice
        case "SCALE": self = .scale
        case "RATING": self = .rating
        case "DATE": self = .date
        default: self = .other(raw)
        }
    }

    /// `SurveyQuestion.CHOICE_TYPES` — answered from `options`.
    public var isChoice: Bool { self == .singleChoice || self == .multiChoice }
    /// `SurveyQuestion.NUMERIC_TYPES` — a number inside `scaleMin…scaleMax`.
    public var isNumeric: Bool { self == .scale || self == .rating }
}

/// "Show this question only when an EARLIER one was answered a certain way."
public enum SurveyConditionOperator: Sendable, Equatable, Hashable {
    case answered, atLeast, below, anyOf, noneOf
    /// An operator this build does not know. The server shows such a question whenever its
    /// source is answered, and `SurveyRules` does exactly the same.
    case other(String)

    /// Nil for the blank operator, which means "no condition".
    public init?(raw: String) {
        switch raw.uppercased() {
        case "": return nil
        case "ANSWERED": self = .answered
        case "AT_LEAST": self = .atLeast
        case "BELOW": self = .below
        case "ANY_OF": self = .anyOf
        case "NONE_OF": self = .noneOf
        default: self = .other(raw)
        }
    }
}

/// `condition_value`: a number for the score rules, a list of option texts for the choice
/// rules, null for ANSWERED. It is a JSONField, so it arrives in whichever of those shapes
/// was stored — and a score posted as "7" is stored as the string "7".
public enum SurveyConditionValue: Sendable, Equatable, Hashable, Decodable {
    case number(Int)
    case text(String)
    case options([String])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) {
            self = .number(n)
        } else if let d = try? c.decode(Double.self), let n = CommunityDecoding.integer(d) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .text(s)
        } else if let list = try? c.decode([CommunityLooseString].self) {
            self = .options(list.compactMap(\.value))
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not a condition value")
        }
    }
}

public struct SurveyQuestion: Decodable, Identifiable, Sendable, Equatable, Hashable {
    public let id: Int
    public let order: Int
    public let prompt: String
    public let helpText: String
    public let type: SurveyQuestionType
    public let isRequired: Bool
    /// The stored answer IS the option text, so these strings are compared exactly.
    public let options: [String]
    /// Checkboxes only: the most a student may tick. 0 means no limit.
    public let maxSelections: Int
    public let scaleMin: Int
    public let scaleMax: Int
    /// Signed and expiring (~1h). Never cache it.
    public let imageURL: String?
    /// The sentences under each end of a slider. Blank means no label.
    public let scaleLowLabel: String
    public let scaleHighLabel: String
    /// Scores strictly BELOW this open the follow-up box. Nil means never.
    public let followUpThreshold: Int?
    /// What the empty follow-up box says — a real placeholder, gone once they type.
    public let followUpPlaceholder: String
    public let followUpRequired: Bool
    /// Which options open the follow-up box when picked.
    public let followUpOptions: [String]
    /// The earlier question this one depends on. Nil means always shown.
    public let conditionQuestion: Int?
    public let conditionOperator: SurveyConditionOperator?
    public let conditionValue: SurveyConditionValue?

    public init(
        id: Int,
        order: Int = 0,
        prompt: String = "",
        helpText: String = "",
        type: SurveyQuestionType,
        isRequired: Bool = false,
        options: [String] = [],
        maxSelections: Int = 0,
        scaleMin: Int = 1,
        scaleMax: Int = 5,
        imageURL: String? = nil,
        scaleLowLabel: String = "",
        scaleHighLabel: String = "",
        followUpThreshold: Int? = nil,
        followUpPlaceholder: String = "",
        followUpRequired: Bool = false,
        followUpOptions: [String] = [],
        conditionQuestion: Int? = nil,
        conditionOperator: SurveyConditionOperator? = nil,
        conditionValue: SurveyConditionValue? = nil
    ) {
        self.id = id
        self.order = order
        self.prompt = prompt
        self.helpText = helpText
        self.type = type
        self.isRequired = isRequired
        self.options = options
        self.maxSelections = maxSelections
        self.scaleMin = scaleMin
        self.scaleMax = scaleMax
        self.imageURL = imageURL
        self.scaleLowLabel = scaleLowLabel
        self.scaleHighLabel = scaleHighLabel
        self.followUpThreshold = followUpThreshold
        self.followUpPlaceholder = followUpPlaceholder
        self.followUpRequired = followUpRequired
        self.followUpOptions = followUpOptions
        self.conditionQuestion = conditionQuestion
        self.conditionOperator = conditionOperator
        self.conditionValue = conditionValue
    }

    private enum CodingKeys: String, CodingKey {
        case id, order, prompt, options
        case helpText = "help_text"
        case questionType = "question_type"
        case isRequired = "is_required"
        case maxSelections = "max_selections"
        case scaleMin = "scale_min"
        case scaleMax = "scale_max"
        case imageURL = "image_url"
        case scaleLowLabel = "scale_low_label"
        case scaleHighLabel = "scale_high_label"
        case followUpThreshold = "follow_up_threshold"
        case followUpPlaceholder = "follow_up_placeholder"
        case followUpRequired = "follow_up_required"
        case followUpOptions = "follow_up_options"
        case conditionQuestion = "condition_question"
        case conditionOperator = "condition_operator"
        case conditionValue = "condition_value"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        order = (try? c.decodeIfPresent(Int.self, forKey: .order)) ?? 0
        prompt = (try? c.decodeIfPresent(String.self, forKey: .prompt)) ?? ""
        helpText = (try? c.decodeIfPresent(String.self, forKey: .helpText)) ?? ""
        type = SurveyQuestionType(raw: (try? c.decodeIfPresent(String.self, forKey: .questionType)) ?? "")
        isRequired = (try? c.decodeIfPresent(Bool.self, forKey: .isRequired)) ?? false
        // Loose: rows saved before the serializer cleaned its input may hold numbers.
        options = ((try? c.decodeIfPresent([CommunityLooseString].self, forKey: .options)) ?? [])
            .compactMap(\.value)
        maxSelections = (try? c.decodeIfPresent(Int.self, forKey: .maxSelections)) ?? 0
        // The model's own defaults, so a missing key draws the form the author would see.
        scaleMin = (try? c.decodeIfPresent(Int.self, forKey: .scaleMin)) ?? 1
        scaleMax = (try? c.decodeIfPresent(Int.self, forKey: .scaleMax)) ?? 5
        imageURL = (try? c.decodeIfPresent(String.self, forKey: .imageURL)).flatMap {
            $0.isEmpty ? nil : $0
        }
        scaleLowLabel = (try? c.decodeIfPresent(String.self, forKey: .scaleLowLabel)) ?? ""
        scaleHighLabel = (try? c.decodeIfPresent(String.self, forKey: .scaleHighLabel)) ?? ""
        followUpThreshold = (try? c.decodeIfPresent(Int.self, forKey: .followUpThreshold)) ?? nil
        followUpPlaceholder = (try? c.decodeIfPresent(String.self, forKey: .followUpPlaceholder)) ?? ""
        followUpRequired = (try? c.decodeIfPresent(Bool.self, forKey: .followUpRequired)) ?? false
        followUpOptions = ((try? c.decodeIfPresent([CommunityLooseString].self, forKey: .followUpOptions)) ?? [])
            .compactMap(\.value)
        conditionQuestion = (try? c.decodeIfPresent(Int.self, forKey: .conditionQuestion)) ?? nil
        conditionOperator = SurveyConditionOperator(
            raw: (try? c.decodeIfPresent(String.self, forKey: .conditionOperator)) ?? ""
        )
        conditionValue = (try? c.decodeIfPresent(SurveyConditionValue.self, forKey: .conditionValue)) ?? nil
    }
}

// MARK: - Surveys

/// A row of `/surveys/open/` — what a student sees before opening one.
public struct SurveyBrief: Decodable, Identifiable, Sendable, Equatable, Hashable {
    public let id: Int
    public let title: String
    public let description: String
    public let closesAt: String?
    public let questionCount: Int
    public let allowAnonymous: Bool
    public let imageURL: String?
    /// What finishing it pays, in points. 0 is legitimate and means it pays nothing, so this
    /// is read wherever the number is shown — never assumed to be the old flat 40.
    public let pointsAward: Int

    public var closesDate: Date? { closesAt.flatMap(JSONCoding.parseServerDate) }

    public init(
        id: Int, title: String, description: String = "", closesAt: String? = nil,
        questionCount: Int = 0, allowAnonymous: Bool = false, imageURL: String? = nil,
        pointsAward: Int = 0
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.closesAt = closesAt
        self.questionCount = questionCount
        self.allowAnonymous = allowAnonymous
        self.imageURL = imageURL
        self.pointsAward = pointsAward
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description
        case closesAt = "closes_at"
        case questionCount = "question_count"
        case allowAnonymous = "allow_anonymous"
        case imageURL = "image_url"
        case pointsAward = "points_award"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        closesAt = (try? c.decodeIfPresent(String.self, forKey: .closesAt)) ?? nil
        questionCount = (try? c.decodeIfPresent(Int.self, forKey: .questionCount)) ?? 0
        allowAnonymous = (try? c.decodeIfPresent(Bool.self, forKey: .allowAnonymous)) ?? false
        imageURL = (try? c.decodeIfPresent(String.self, forKey: .imageURL)).flatMap {
            $0.isEmpty ? nil : $0
        }
        pointsAward = (try? c.decodeIfPresent(Int.self, forKey: .pointsAward)) ?? 0
    }
}

/// The form, from `/surveys/<id>/`.
public struct Survey: Decodable, Identifiable, Sendable, Equatable {
    public let id: Int
    public let title: String
    public let description: String
    /// "DRAFT" | "PUBLISHED" | "CLOSED".
    public let status: String
    public let opensAt: String?
    public let closesAt: String?
    /// Whether the student may ask for their name to be kept off the results.
    public let allowAnonymous: Bool
    public let imageURL: String?
    public let pointsAward: Int
    /// In the order the server evaluates them: `order`, then id.
    public let questions: [SurveyQuestion]
    public let questionCount: Int
    public let isOpen: Bool
    public let alreadyCompleted: Bool

    public init(
        id: Int, title: String, description: String = "", status: String = "PUBLISHED",
        opensAt: String? = nil, closesAt: String? = nil, allowAnonymous: Bool = false,
        imageURL: String? = nil, pointsAward: Int = 0, questions: [SurveyQuestion],
        isOpen: Bool = true, alreadyCompleted: Bool = false
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.status = status
        self.opensAt = opensAt
        self.closesAt = closesAt
        self.allowAnonymous = allowAnonymous
        self.imageURL = imageURL
        self.pointsAward = pointsAward
        self.questions = SurveyRules.ordered(questions)
        self.questionCount = questions.count
        self.isOpen = isOpen
        self.alreadyCompleted = alreadyCompleted
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, status, questions
        case opensAt = "opens_at"
        case closesAt = "closes_at"
        case allowAnonymous = "allow_anonymous"
        case imageURL = "image_url"
        case pointsAward = "points_award"
        case questionCount = "question_count"
        case isOpen = "is_open"
        case alreadyCompleted = "already_completed"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? ""
        opensAt = (try? c.decodeIfPresent(String.self, forKey: .opensAt)) ?? nil
        closesAt = (try? c.decodeIfPresent(String.self, forKey: .closesAt)) ?? nil
        allowAnonymous = (try? c.decodeIfPresent(Bool.self, forKey: .allowAnonymous)) ?? false
        imageURL = (try? c.decodeIfPresent(String.self, forKey: .imageURL)).flatMap {
            $0.isEmpty ? nil : $0
        }
        pointsAward = (try? c.decodeIfPresent(Int.self, forKey: .pointsAward)) ?? 0
        // Lossy: one malformed question must cost that question, not the form — an empty
        // list would read as "this survey has no questions yet", which is not the truth.
        let decoded = (try? c.decodeIfPresent(CommunityLossyList<SurveyQuestion>.self, forKey: .questions))?
            .elements ?? []
        questions = SurveyRules.ordered(decoded)
        questionCount = (try? c.decodeIfPresent(Int.self, forKey: .questionCount)) ?? decoded.count
        isOpen = (try? c.decodeIfPresent(Bool.self, forKey: .isOpen)) ?? false
        alreadyCompleted = (try? c.decodeIfPresent(Bool.self, forKey: .alreadyCompleted)) ?? false
    }
}

/// A student's saved-but-unsubmitted answers, from `/surveys/<id>/draft/`.
public struct SurveyDraft: Decodable, Sendable, Equatable {
    public let answers: [Int: SurveyAnswer]
    public let followUps: [Int: String]
    public let savedAt: String?

    public init(answers: [Int: SurveyAnswer] = [:], followUps: [Int: String] = [:], savedAt: String? = nil) {
        self.answers = answers
        self.followUps = followUps
        self.savedAt = savedAt
    }

    private enum CodingKeys: String, CodingKey {
        case answers
        case followUps = "follow_ups"
        case savedAt = "saved_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Keyed by question id as a STRING on the wire. A key that is not a number, or a value
        // that is not an answer, is skipped rather than failing the whole draft.
        let rawAnswers = (try? c.decodeIfPresent([String: CommunityOptional<SurveyAnswer>].self, forKey: .answers)) ?? nil
        var answers: [Int: SurveyAnswer] = [:]
        for (key, value) in rawAnswers ?? [:] {
            if let id = Int(key), let answer = value.value { answers[id] = answer }
        }
        self.answers = answers

        let rawNotes = (try? c.decodeIfPresent([String: CommunityOptional<String>].self, forKey: .followUps)) ?? nil
        var notes: [Int: String] = [:]
        for (key, value) in rawNotes ?? [:] {
            if let id = Int(key), let note = value.value, !note.isEmpty { notes[id] = note }
        }
        followUps = notes
        savedAt = (try? c.decodeIfPresent(String.self, forKey: .savedAt)) ?? nil
    }
}

/// What `POST /surveys/<id>/respond/` answers with.
public struct SurveySubmitResult: Decodable, Sendable, Equatable {
    public let detail: String
    public let responseId: Int?
    /// What the SERVER recorded — it differs from what was asked for when the author never
    /// turned anonymity on, and the thank-you card must not claim otherwise.
    public let isAnonymous: Bool

    private enum CodingKeys: String, CodingKey {
        case detail
        case responseId = "response_id"
        case isAnonymous = "is_anonymous"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        detail = (try? c.decodeIfPresent(String.self, forKey: .detail)) ?? ""
        responseId = (try? c.decodeIfPresent(Int.self, forKey: .responseId)) ?? nil
        isAnonymous = (try? c.decodeIfPresent(Bool.self, forKey: .isAnonymous)) ?? false
    }
}

/// The two maps a draft save and a submission both send, keyed by question id as a string.
public struct SurveyPayload: Sendable, Equatable {
    public let answers: [String: SurveyAnswer]
    public let followUps: [String: String]

    public init(answers: [String: SurveyAnswer], followUps: [String: String]) {
        self.answers = answers
        self.followUps = followUps
    }
}

// MARK: - "YYYY-MM-DD"

/// A DATE question's answer is a calendar day written "YYYY-MM-DD" — not an instant, so it
/// is read and written in the student's own calendar rather than parsed as a timestamp.
public enum SurveyDate {
    public static func string(from date: Date, calendar: Calendar = SurveyDate.calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Nil unless `string` is a real day in that exact form. "2026-02-30" is not.
    public static func date(from string: String, calendar: Calendar = SurveyDate.calendar) -> Date? {
        let pieces = string.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3, pieces[0].count == 4, (1...2).contains(pieces[1].count),
              (1...2).contains(pieces[2].count),
              let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]) else {
            return nil
        }
        let wanted = DateComponents(year: year, month: month, day: day)
        guard let date = calendar.date(from: wanted) else { return nil }
        // `Calendar` rolls an impossible day over into the next month; reject it instead.
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return date
    }

    /// Gregorian in the device's time zone: the day the student picked is the day stored.
    public static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }
}

// MARK: - Decoding helpers (shared by the community models)

enum CommunityDecoding {
    /// A JSON number as Python's `int()` would read it, or nil when it cannot be one.
    static func integer(_ value: Double) -> Int? {
        guard value.isFinite, abs(value) < 1e15 else { return nil }
        return Int(value)
    }
}

/// A list element that is a string, or a number written as one — `str(v)` on the server.
struct CommunityLooseString: Decodable, Sendable {
    let value: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            value = s
        } else if let i = try? c.decode(Int.self) {
            value = String(i)
        } else if let d = try? c.decode(Double.self) {
            value = String(d)
        } else {
            value = nil
        }
    }
}

/// A value that may fail to decode without failing its container.
struct CommunityOptional<Wrapped: Decodable & Sendable>: Decodable, Sendable {
    let value: Wrapped?

    init(from decoder: Decoder) throws {
        value = try? Wrapped(from: decoder)
    }
}

/// An array that keeps the elements it can read and skips the rest.
struct CommunityLossyList<Element: Decodable & Sendable>: Decodable, Sendable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        while !c.isAtEnd {
            if let element = try? c.decode(Element.self) {
                out.append(element)
            } else {
                // A failed decode does not advance the container; this always succeeds and does.
                _ = try? c.decode(Skip.self)
            }
        }
        elements = out
    }

    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }
}

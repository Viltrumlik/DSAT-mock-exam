import Foundation

/// What a survey form shows, what opens a follow-up box, and what still stands between the
/// student and Submit.
///
/// **The server's rules, not the web's copy of them.** `backend/surveys` decides, at submit,
/// which questions were visible (it DROPS answers to hidden ones and never requires them),
/// which follow-up notes are required, and what counts as blank. A client that disagreed
/// with it in the "hide" direction would build a dead end: the server would refuse the
/// submission over a required question the student was never shown. So every function here
/// is a port of a named server function, including its edge cases:
///
/// - `normalized` ← `services.normalize_answer` (without the raising): whitespace is blank, and
///   a checkbox answer is de-duplicated in order.
/// - `isVisible` ← `SurveyQuestion.is_visible_given`: an unanswered source hides the question
///   for every rule but ANSWERED; a condition whose numbers cannot be read fails OPEN.
/// - `visibleQuestions` ← the ordered pass in `services.submit_response`: a hidden question
///   counts as unanswered for the questions after it.
/// - `wantsFollowUp` ← `SurveyQuestion.wants_follow_up`.
/// - `gaps` ← what `submit_response` would refuse, in page order.
public enum SurveyRules {

    // MARK: Order

    /// `SurveyQuestion.Meta.ordering`: `order`, then id. One pass in this order is enough
    /// because a condition may only point at an EARLIER question.
    public static func ordered(_ questions: [SurveyQuestion]) -> [SurveyQuestion] {
        questions.sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    // MARK: Blank or not

    /// The answer as the server would store it, or nil when it would store "skipped".
    public static func normalized(_ answer: SurveyAnswer?, for question: SurveyQuestion) -> SurveyAnswer? {
        guard let answer else { return nil }
        switch answer {
        case .text(let raw):
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return nil }
            switch question.type {
            case .shortText, .longText, .other:
                return .text(trimmed)
            case .scale, .rating:
                // A slider posts "7" as readily as 7; anything else is not a number at all.
                return pythonInt(raw).map(SurveyAnswer.number)
            case .multiChoice:
                return .choices([raw])
            case .date, .singleChoice:
                return .text(raw)
            }
        case .number(let value):
            switch question.type {
            case .scale, .rating: return .number(value)
            case .multiChoice: return .choices([String(value)])
            default: return .text(String(value))
            }
        case .choices(let list):
            if list.isEmpty { return nil }
            // Deduplicated but order-preserving, as the server stores a checkbox answer.
            return question.type == .multiChoice ? .choices(unique(list)) : .choices(list)
        }
    }

    /// Whether this question has an answer at all. `0` is one — the bottom of a slider.
    public static func isAnswered(_ answer: SurveyAnswer?, for question: SurveyQuestion) -> Bool {
        normalized(answer, for: question) != nil
    }

    // MARK: Visibility

    /// `SurveyQuestion.is_visible_given`. `seen` holds the NORMALISED answers of the questions
    /// above; a missing entry means unanswered (or hidden, which is the same thing).
    public static func isVisible(_ question: SurveyQuestion, given seen: [Int: SurveyAnswer]) -> Bool {
        guard let sourceId = question.conditionQuestion, sourceId != 0,
              let rule = question.conditionOperator else {
            // Unconditional — or its source was deleted (the FK is SET_NULL): shown to everyone.
            return true
        }
        let source = seen[sourceId]
        if rule == .answered { return source != nil }
        // A skipped source satisfies nothing else: "no answer" is not a low score.
        guard let source else { return false }

        switch rule {
        case .atLeast, .below:
            guard let score = integer(source), let bar = integer(question.conditionValue) else {
                // Half-configured, or the source's type changed under it: fail OPEN.
                return true
            }
            return rule == .atLeast ? score >= bar : score < bar
        case .anyOf, .noneOf:
            let wanted = Set(optionList(question.conditionValue))
            let hit = strings(source).contains { wanted.contains($0) }
            return rule == .anyOf ? hit : !hit
        case .answered, .other:
            return true
        }
    }

    /// The questions on screen, top to bottom.
    public static func visibleQuestions(
        _ questions: [SurveyQuestion],
        answers: [Int: SurveyAnswer]
    ) -> [SurveyQuestion] {
        var seen: [Int: SurveyAnswer] = [:]
        var shown: [SurveyQuestion] = []
        for question in ordered(questions) {
            // Hidden: recorded as unanswered, so a question depending on it is hidden too
            // rather than reading a stale value.
            guard isVisible(question, given: seen) else { continue }
            seen[question.id] = normalized(answers[question.id], for: question)
            shown.append(question)
        }
        return shown
    }

    // MARK: Follow-up box

    /// `SurveyQuestion.wants_follow_up`: a score strictly below the threshold, or a picked
    /// option that is one of `followUpOptions`.
    public static func wantsFollowUp(_ question: SurveyQuestion, answer: SurveyAnswer?) -> Bool {
        guard let value = normalized(answer, for: question) else { return false }
        if question.type.isNumeric {
            guard let threshold = question.followUpThreshold, let score = integer(value) else { return false }
            return score < threshold
        }
        if question.type.isChoice {
            let triggers = Set(question.followUpOptions)
            if triggers.isEmpty { return false }
            return strings(value).contains { triggers.contains($0) }
        }
        return false
    }

    // MARK: What is still missing

    /// What `submit_response` would refuse, in page order. Empty means ready to send.
    public static func gaps(
        in questions: [SurveyQuestion],
        answers: [Int: SurveyAnswer],
        followUps: [Int: String]
    ) -> [SurveyGap] {
        var gaps: [SurveyGap] = []
        for question in visibleQuestions(questions, answers: answers) {
            let value = normalized(answers[question.id], for: question)
            if question.isRequired && value == nil {
                gaps.append(SurveyGap(questionId: question.id, kind: .answer))
                continue
            }
            // A follow-up the author made mandatory is as blocking as the answer above it.
            if question.followUpRequired, wantsFollowUp(question, answer: value),
               (followUps[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                gaps.append(SurveyGap(questionId: question.id, kind: .note))
            }
        }
        return gaps
    }

    // MARK: Payloads

    /// What Submit sends: visible questions only, normalised, and a note only where its box
    /// is open. The server would drop the rest anyway; not sending it keeps a stale answer to
    /// a question the student hid off the wire entirely.
    public static func submission(
        _ questions: [SurveyQuestion],
        answers: [Int: SurveyAnswer],
        followUps: [Int: String]
    ) -> SurveyPayload {
        var outAnswers: [String: SurveyAnswer] = [:]
        var outNotes: [String: String] = [:]
        for question in visibleQuestions(questions, answers: answers) {
            let value = normalized(answers[question.id], for: question)
            if let value { outAnswers[String(question.id)] = value }
            let note = (followUps[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !note.isEmpty, wantsFollowUp(question, answer: value) {
                outNotes[String(question.id)] = note
            }
        }
        return SurveyPayload(answers: outAnswers, followUps: outNotes)
    }

    /// What the autosave sends: everything the student has put down, hidden or not.
    ///
    /// Hidden answers are kept here on purpose, as the web keeps them. The server rewrites
    /// every question on each save, so leaving one out would erase it — and a student who
    /// moves a score back up expects the answer they typed below it to still be there.
    public static func draft(
        _ questions: [SurveyQuestion],
        answers: [Int: SurveyAnswer],
        followUps: [Int: String]
    ) -> SurveyPayload {
        var outAnswers: [String: SurveyAnswer] = [:]
        var outNotes: [String: String] = [:]
        for question in questions {
            if let value = normalized(answers[question.id], for: question) {
                outAnswers[String(question.id)] = value
            }
            if let note = followUps[question.id],
               !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                outNotes[String(question.id)] = note
            }
        }
        return SurveyPayload(answers: outAnswers, followUps: outNotes)
    }

    // MARK: Restoring a draft

    /// A saved answer, if it still fits the question as it is NOW.
    ///
    /// An author can rename an option, narrow a scale or lower a checkbox cap after a student
    /// saved a draft. Restoring the stale value would draw no selection yet count as answered
    /// — and the server would refuse the whole submission over it. Dropped (or trimmed to fit)
    /// instead, so the form shows exactly what will be sent.
    public static func restored(_ answer: SurveyAnswer, for question: SurveyQuestion) -> SurveyAnswer? {
        switch question.type {
        case .scale, .rating:
            guard let value = integer(answer), value >= question.scaleMin, value <= question.scaleMax else {
                return nil
            }
            return .number(value)
        case .singleChoice:
            guard let picked = strings(answer).first, strings(answer).count == 1,
                  question.options.contains(picked) else { return nil }
            return .text(picked)
        case .multiChoice:
            var picked = unique(strings(answer)).filter { question.options.contains($0) }
            if question.maxSelections > 0 { picked = Array(picked.prefix(question.maxSelections)) }
            return picked.isEmpty ? nil : .choices(picked)
        case .date:
            guard case .text(let raw) = answer, SurveyDate.date(from: raw) != nil else { return nil }
            return .text(raw)
        case .shortText, .longText, .other:
            switch answer {
            case .text(let raw): return raw.isEmpty ? nil : .text(raw)
            case .number(let value): return .text(String(value))
            case .choices: return nil
            }
        }
    }

    /// The draft laid onto the form. Answers already on screen win: a draft that arrives
    /// after the student started typing must not stamp an older copy over their work.
    public static func merge(
        draft: SurveyDraft,
        into answers: [Int: SurveyAnswer],
        followUps: [Int: String],
        questions: [SurveyQuestion]
    ) -> (answers: [Int: SurveyAnswer], followUps: [Int: String]) {
        let byId = Dictionary(questions.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var mergedAnswers = answers
        for (id, saved) in draft.answers where mergedAnswers[id] == nil {
            guard let question = byId[id], let value = restored(saved, for: question) else { continue }
            mergedAnswers[id] = value
        }
        var mergedNotes = followUps
        for (id, note) in draft.followUps where byId[id] != nil {
            if (mergedNotes[id] ?? "").isEmpty { mergedNotes[id] = note }
        }
        return (mergedAnswers, mergedNotes)
    }

    // MARK: - Reading values the way Python does

    /// `int(x)` for the shapes an answer or a condition value can take, or nil where Python
    /// would raise.
    static func integer(_ answer: SurveyAnswer) -> Int? {
        switch answer {
        case .number(let value): return value
        case .text(let raw): return pythonInt(raw)
        case .choices: return nil
        }
    }

    static func integer(_ value: SurveyConditionValue?) -> Int? {
        switch value {
        case .number(let n)?: return n
        case .text(let raw)?: return pythonInt(raw)
        case .options?, nil: return nil
        }
    }

    /// `str(p) for p in …` over an answer.
    static func strings(_ answer: SurveyAnswer) -> [String] {
        switch answer {
        case .choices(let list): return list
        case .text(let raw): return [raw]
        case .number(let value): return [String(value)]
        }
    }

    /// The option list of an ANY_OF / NONE_OF rule. The serializer only ever stores a list;
    /// anything else matches nothing.
    static func optionList(_ value: SurveyConditionValue?) -> [String] {
        switch value {
        case .options(let list)?: return list
        case .text(let raw)?: return [raw]
        case .number?, nil: return []
        }
    }

    /// Python's `int("…")`: surrounding whitespace allowed, a sign allowed, no decimals.
    static func pythonInt(_ raw: String) -> Int? {
        Int(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func unique(_ list: [String]) -> [String] {
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }
}

/// One thing standing between the student and Submit.
public struct SurveyGap: Sendable, Equatable, Hashable {
    public enum Kind: Sendable, Equatable, Hashable {
        /// A required question with no answer.
        case answer
        /// An open follow-up box the author made mandatory, still empty.
        case note
    }

    public let questionId: Int
    public let kind: Kind

    public init(questionId: Int, kind: Kind) {
        self.questionId = questionId
        self.kind = kind
    }
}

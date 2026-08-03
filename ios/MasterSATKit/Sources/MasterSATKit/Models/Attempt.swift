import Foundation

/// Canonical engine states. Mirrors the backend state machine as it appears *on the wire*.
///
/// Note the full mock reports its four modules as `MODULE_1_ACTIVE`/`MODULE_2_ACTIVE`
/// (English M1/M2 then Math M1/M2) and its break as `MODULE_2_SUBMITTED` + `is_on_break`.
/// That is deliberate on the server side — see `mocks.state_machine.WIRE_STATE` — so the
/// same runner drives pastpapers, midterms and mocks. Never infer "which section am I in"
/// from this value; read `practice_test_details.subject`.
public enum AttemptState: String, Codable, Sendable {
    case notStarted = "NOT_STARTED"
    case module1Active = "MODULE_1_ACTIVE"
    case module1Submitted = "MODULE_1_SUBMITTED"
    case module2Active = "MODULE_2_ACTIVE"
    case module2Submitted = "MODULE_2_SUBMITTED"
    case scoring = "SCORING"
    case completed = "COMPLETED"
    case abandoned = "ABANDONED"
}

/// One answer option. The API sends `{"text": ..., "image": ...}`, but older rows and some
/// import paths send a bare string, so accept both rather than failing the whole module.
public struct QuestionOption: Codable, Sendable, Equatable {
    public let text: String
    public let image: String?

    public init(text: String, image: String? = nil) {
        self.text = text
        self.image = image
    }

    public init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let raw = try? single.decode(String.self) {
            self.text = raw
            self.image = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.text = (try? container.decodeIfPresent(String.self, forKey: .text)) as? String ?? ""
        self.image = try? container.decodeIfPresent(String.self, forKey: .image)
    }

    private enum CodingKeys: String, CodingKey {
        case text, image
    }
}

public struct ExamQuestion: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let questionType: String
    public let questionText: String
    public let questionPrompt: String?
    public let questionImage: String?
    /// Grid-in / student-produced response: answered by typing, not by choosing. Drives
    /// both the input UI and the autosave delay (typed answers coalesce, choices don't).
    public let isMathInput: Bool
    public let options: [String: QuestionOption]?

    public init(
        id: Int,
        questionType: String,
        questionText: String,
        questionPrompt: String? = nil,
        questionImage: String? = nil,
        isMathInput: Bool = false,
        options: [String: QuestionOption]? = nil
    ) {
        self.id = id
        self.questionType = questionType
        self.questionText = questionText
        self.questionPrompt = questionPrompt
        self.questionImage = questionImage
        self.isMathInput = isMathInput
        self.options = options
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        questionType = (try? c.decode(String.self, forKey: .questionType)) ?? "READING"
        questionText = (try? c.decode(String.self, forKey: .questionText)) ?? ""
        questionPrompt = try? c.decodeIfPresent(String.self, forKey: .questionPrompt)
        questionImage = try? c.decodeIfPresent(String.self, forKey: .questionImage)
        isMathInput = (try? c.decodeIfPresent(Bool.self, forKey: .isMathInput)) as? Bool ?? false
        options = try? c.decodeIfPresent([String: QuestionOption].self, forKey: .options)
    }

    /// Option letters in the order they must be shown. Never rely on dictionary order.
    public var orderedOptionKeys: [String] {
        guard let options else { return [] }
        return ["A", "B", "C", "D", "E"].filter { options[$0] != nil }
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case questionType = "question_type"
        case questionText = "question_text"
        case questionPrompt = "question_prompt"
        case questionImage = "question_image"
        case isMathInput = "is_math_input"
        case options
    }
}

public struct ActiveModule: Codable, Sendable, Equatable {
    public let id: Int
    public let moduleOrder: Int
    public let timeLimitMinutes: Int
    public let questions: [ExamQuestion]

    public init(id: Int, moduleOrder: Int, timeLimitMinutes: Int, questions: [ExamQuestion]) {
        self.id = id
        self.moduleOrder = moduleOrder
        self.timeLimitMinutes = timeLimitMinutes
        self.questions = questions
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case moduleOrder = "module_order"
        case timeLimitMinutes = "time_limit_minutes"
        case questions
    }
}

public struct ModuleSummary: Codable, Sendable, Equatable {
    public let id: Int
    public let moduleOrder: Int
    public let timeLimitMinutes: Int

    public init(id: Int, moduleOrder: Int, timeLimitMinutes: Int) {
        self.id = id
        self.moduleOrder = moduleOrder
        self.timeLimitMinutes = timeLimitMinutes
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case moduleOrder = "module_order"
        case timeLimitMinutes = "time_limit_minutes"
    }
}

public struct PracticeTestDetails: Codable, Sendable, Equatable {
    public let id: Int
    public let subject: String
    public let title: String
    public let mockExamId: Int?
    /// "MOCK", "MIDTERM", or absent for a pastpaper/practice test.
    public let mockKind: String?
    /// Midterm difficulty tier. Only `/midterms/attempts` sends it.
    public let level: String?
    /// Server-decided Desmos gate. The client must not decide this for itself.
    public let calculatorEnabled: Bool?
    public let totalQuestionCount: Int?
    public let modules: [ModuleSummary]

    public init(
        id: Int,
        subject: String,
        title: String,
        mockExamId: Int? = nil,
        mockKind: String? = nil,
        level: String? = nil,
        calculatorEnabled: Bool? = nil,
        totalQuestionCount: Int? = nil,
        modules: [ModuleSummary] = []
    ) {
        self.id = id
        self.subject = subject
        self.title = title
        self.mockExamId = mockExamId
        self.mockKind = mockKind
        self.level = level
        self.calculatorEnabled = calculatorEnabled
        self.totalQuestionCount = totalQuestionCount
        self.modules = modules
    }

    public var isMath: Bool { subject.uppercased() == "MATH" }

    private enum CodingKeys: String, CodingKey {
        case id, subject, title, level, modules
        case mockExamId = "mock_exam_id"
        case mockKind = "mock_kind"
        case calculatorEnabled = "calculator_enabled"
        case totalQuestionCount = "total_question_count"
    }
}

/// Full attempt snapshot — the server's word on state, timing and concurrency.
///
/// The client renders this. It never invents timing: `remaining_seconds` paired with
/// `server_now` is the only clock, because a device clock can be wrong (or set wrong on
/// purpose) and a locally-counted timer drifts across a backgrounded app.
public struct Attempt: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let currentState: AttemptState
    public let versionNumber: Int
    public let practiceTestDetails: PracticeTestDetails

    public let currentModule: Int?
    public let currentModuleDetails: ActiveModule?
    public let currentModuleStartTime: String?

    public let serverNow: String
    public let remainingSeconds: Int?
    public let moduleDurationSeconds: Int?

    public let currentModuleSavedAnswers: [String: String]?
    public let currentModuleFlaggedQuestions: [Int]?

    public let isCompleted: Bool
    public let isExpired: Bool
    public let isPaused: Bool
    public let canSubmit: Bool?
    public let canResume: Bool?
    public let resultsReady: Bool?
    public let score: Double?
    public let completedModules: [Int]?

    // ── mock-specific ──
    public let isOnBreak: Bool?
    public let breakRemainingSeconds: Int?
    /// The mock's true phase (`ENGLISH_M1_ACTIVE` …). `currentState` is the shared wire
    /// value and cannot distinguish English M1 from Math M1.
    public let mockPhase: String?

    // ── proctoring ──
    /// Travels with the ATTEMPT, not the URL, so a resume or a relaunch cannot drop it.
    public let proctored: Bool?
    public let sessionId: Int?
    public let offscreenViolations: Int?
    public let offscreenLimit: Int?
    public let offscreenGraceSeconds: Int?
    public let terminatedReason: String?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        currentState = try c.decode(AttemptState.self, forKey: .currentState)
        versionNumber = try c.decode(Int.self, forKey: .versionNumber)
        practiceTestDetails = try c.decode(PracticeTestDetails.self, forKey: .practiceTestDetails)

        currentModule = try c.decodeIfPresent(Int.self, forKey: .currentModule)
        currentModuleDetails = try c.decodeIfPresent(ActiveModule.self, forKey: .currentModuleDetails)
        currentModuleStartTime = try c.decodeIfPresent(String.self, forKey: .currentModuleStartTime)

        serverNow = try c.decode(String.self, forKey: .serverNow)
        remainingSeconds = try c.decodeIfPresent(Int.self, forKey: .remainingSeconds)
        moduleDurationSeconds = try c.decodeIfPresent(Int.self, forKey: .moduleDurationSeconds)

        // Saved answers arrive as `Record<string, unknown>`: a grid-in answer that looks
        // numeric can decode as a number, and the runner compares answers as strings
        // everywhere else. Coerce once, here, so nothing downstream has to care.
        currentModuleSavedAnswers = try c.decodeIfPresent(StringCoercedDictionary.self, forKey: .currentModuleSavedAnswers)?.values
        currentModuleFlaggedQuestions = try c.decodeIfPresent([Int].self, forKey: .currentModuleFlaggedQuestions)

        isCompleted = try c.decode(Bool.self, forKey: .isCompleted)
        isExpired = try c.decode(Bool.self, forKey: .isExpired)
        isPaused = (try? c.decodeIfPresent(Bool.self, forKey: .isPaused)) as? Bool ?? false
        canSubmit = try c.decodeIfPresent(Bool.self, forKey: .canSubmit)
        canResume = try c.decodeIfPresent(Bool.self, forKey: .canResume)
        resultsReady = try c.decodeIfPresent(Bool.self, forKey: .resultsReady)
        score = try? c.decodeIfPresent(Double.self, forKey: .score)
        completedModules = try c.decodeIfPresent([Int].self, forKey: .completedModules)

        isOnBreak = try c.decodeIfPresent(Bool.self, forKey: .isOnBreak)
        breakRemainingSeconds = try c.decodeIfPresent(Int.self, forKey: .breakRemainingSeconds)
        mockPhase = try c.decodeIfPresent(String.self, forKey: .mockPhase)

        proctored = try c.decodeIfPresent(Bool.self, forKey: .proctored)
        sessionId = try c.decodeIfPresent(Int.self, forKey: .sessionId)
        offscreenViolations = try c.decodeIfPresent(Int.self, forKey: .offscreenViolations)
        offscreenLimit = try c.decodeIfPresent(Int.self, forKey: .offscreenLimit)
        offscreenGraceSeconds = try c.decodeIfPresent(Int.self, forKey: .offscreenGraceSeconds)
        terminatedReason = try c.decodeIfPresent(String.self, forKey: .terminatedReason)
    }

    private enum CodingKeys: String, CodingKey {
        case id, score, proctored
        case currentState = "current_state"
        case versionNumber = "version_number"
        case practiceTestDetails = "practice_test_details"
        case currentModule = "current_module"
        case currentModuleDetails = "current_module_details"
        case currentModuleStartTime = "current_module_start_time"
        case serverNow = "server_now"
        case remainingSeconds = "remaining_seconds"
        case moduleDurationSeconds = "module_duration_seconds"
        case currentModuleSavedAnswers = "current_module_saved_answers"
        case currentModuleFlaggedQuestions = "current_module_flagged_questions"
        case isCompleted = "is_completed"
        case isExpired = "is_expired"
        case isPaused = "is_paused"
        case canSubmit = "can_submit"
        case canResume = "can_resume"
        case resultsReady = "results_ready"
        case completedModules = "completed_modules"
        case isOnBreak = "is_on_break"
        case breakRemainingSeconds = "break_remaining_seconds"
        case mockPhase = "mock_phase"
        case sessionId = "session_id"
        case offscreenViolations = "offscreen_violations"
        case offscreenLimit = "offscreen_limit"
        case offscreenGraceSeconds = "offscreen_grace_seconds"
        case terminatedReason = "terminated_reason"
    }
}

// MARK: - Derived state

public extension Attempt {
    var isActive: Bool {
        currentState == .module1Active || currentState == .module2Active
    }

    var isScoring: Bool { currentState == .scoring }

    var isFinished: Bool { currentState == .completed && isCompleted }

    var isTerminal: Bool { isScoring || isFinished }

    /// The engine says a module is running but sent no questions — an error state, not an
    /// empty exam. The runner shows a recovery screen rather than a blank page.
    var isModulePayloadMissing: Bool { isActive && currentModuleDetails == nil }

    var questions: [ExamQuestion] { currentModuleDetails?.questions ?? [] }

    var activeModuleId: Int? { currentModuleDetails?.id }

    var isProctored: Bool { proctored ?? false }

    var wasTerminated: Bool { !(terminatedReason ?? "").isEmpty }

    var onBreak: Bool { isOnBreak ?? false }

    /// Answers normalized to the string form the runner works in.
    var savedAnswers: [String: String] { currentModuleSavedAnswers ?? [:] }

    var flaggedQuestions: [Int] { currentModuleFlaggedQuestions ?? [] }
}

/// Decodes `Record<string, unknown>` into `[String: String]`, mirroring the frontend's
/// `normalizeSavedAnswers`. Nulls are dropped; scalars are stringified.
private struct StringCoercedDictionary: Decodable {
    let values: [String: String]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: AnyKey.self)
        var out: [String: String] = [:]
        for key in container.allKeys {
            if let s = try? container.decode(String.self, forKey: key) {
                out[key.stringValue] = s
            } else if let i = try? container.decode(Int.self, forKey: key) {
                out[key.stringValue] = String(i)
            } else if let d = try? container.decode(Double.self, forKey: key) {
                out[key.stringValue] = String(d)
            } else if let b = try? container.decode(Bool.self, forKey: key) {
                out[key.stringValue] = String(b)
            }
            // null / object / array: skip. There is no sane string for them and an answer
            // the runner cannot represent must not become the literal text "null".
        }
        values = out
    }

    private struct AnyKey: CodingKey {
        let stringValue: String
        let intValue: Int? = nil
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
}

import Foundation
@testable import MasterSATKit

/// Builds attempt JSON in exactly the shape `mocks.serializers.MockAttemptSerializer`
/// emits, so decoding is tested against the real contract rather than a Swift-shaped
/// approximation of it.
enum AttemptFixtures {

    static func json(
        id: Int = 1,
        state: String = "MODULE_1_ACTIVE",
        version: Int = 3,
        moduleId: Int? = 10,
        moduleOrder: Int = 1,
        timeLimitMinutes: Int = 32,
        questions: [[String: Any]] = [Self.question(id: 100), Self.question(id: 101, isMathInput: true)],
        remainingSeconds: Int? = 1_800,
        savedAnswers: [String: Any] = [:],
        flagged: [Int] = [],
        isCompleted: Bool = false,
        isExpired: Bool = false,
        subject: String = "READING_WRITING",
        mockKind: String = "MOCK",
        isOnBreak: Bool = false,
        breakRemainingSeconds: Int? = nil,
        proctored: Bool = false,
        offscreenViolations: Int = 0,
        terminatedReason: String = ""
    ) -> [String: Any] {
        var moduleDetails: Any = NSNull()
        if let moduleId {
            moduleDetails = [
                "id": moduleId,
                "module_order": moduleOrder,
                "time_limit_minutes": timeLimitMinutes,
                "questions": questions,
            ] as [String: Any]
        }

        return [
            "id": id,
            "current_state": state,
            "version_number": version,
            "practice_test_details": [
                "id": 7,
                "subject": subject,
                "title": "Full Mock 3",
                "mock_exam_id": NSNull(),
                "mock_kind": mockKind,
                "modules": [
                    ["id": 10, "module_order": 1, "time_limit_minutes": 32],
                    ["id": 11, "module_order": 2, "time_limit_minutes": 32],
                ],
            ] as [String: Any],
            "current_module": moduleId as Any? ?? NSNull(),
            "current_module_details": moduleDetails,
            "current_module_start_time": "2026-08-03T09:00:00Z",
            "server_now": "2026-08-03T09:12:44.123456Z",
            "remaining_seconds": remainingSeconds as Any? ?? NSNull(),
            "module_duration_seconds": timeLimitMinutes * 60,
            "current_module_saved_answers": savedAnswers,
            "current_module_flagged_questions": flagged,
            "is_completed": isCompleted,
            "is_expired": isExpired,
            "is_paused": false,
            "can_submit": !isExpired,
            "can_resume": true,
            "results_ready": isCompleted,
            "score": NSNull(),
            "completed_modules": [],
            "is_on_break": isOnBreak,
            "break_remaining_seconds": breakRemainingSeconds as Any? ?? NSNull(),
            "mock_phase": "ENGLISH_M1_ACTIVE",
            "proctored": proctored,
            "session_id": NSNull(),
            "offscreen_violations": offscreenViolations,
            "offscreen_limit": 3,
            "offscreen_grace_seconds": 30,
            "terminated_reason": terminatedReason,
        ]
    }

    static func question(id: Int, isMathInput: Bool = false) -> [String: Any] {
        var q: [String: Any] = [
            "id": id,
            "question_type": isMathInput ? "MATH" : "READING",
            "question_text": "Question \(id)",
            "question_prompt": "",
            "question_image": NSNull(),
            "is_math_input": isMathInput,
        ]
        q["options"] = isMathInput ? NSNull() : [
            "A": ["text": "Alpha", "image": NSNull()],
            "B": ["text": "Beta", "image": NSNull()],
            "C": ["text": "Gamma", "image": NSNull()],
            "D": ["text": "Delta", "image": NSNull()],
        ]
        return q
    }

    static func data(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object)
    }

    static func attempt(_ overrides: [String: Any] = [:]) -> Attempt {
        var object = json()
        for (k, v) in overrides { object[k] = v }
        return try! JSONCoding.decoder.decode(Attempt.self, from: data(object))
    }

    /// Attempt with a specific version and module order — the two axes `AttemptMerge` cares about.
    static func attempt(version: Int, moduleOrder: Int, isCompleted: Bool = false) -> Attempt {
        let object = json(
            version: version,
            moduleId: moduleOrder == 0 ? nil : 10 + moduleOrder,
            moduleOrder: max(1, moduleOrder),
            isCompleted: isCompleted
        )
        return try! JSONCoding.decoder.decode(Attempt.self, from: data(object))
    }
}

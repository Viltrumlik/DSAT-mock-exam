import Foundation

/// Deterministic idempotency keys, so a retry never double-applies a mutation.
/// Port of `utils/idempotency.ts`.
public enum IdempotencyKeys {

    /// Derived from (attempt, module, version): an automatic retry of the *same* submit is
    /// deduped by the server, while a genuinely new submit gets a new key.
    public static func submit(attemptId: Int, moduleId: Int, version: Int, suffix: String = "") -> String {
        let tail = suffix.isEmpty ? "" : ".\(suffix)"
        return "submit.\(attemptId).\(moduleId).v\(version)\(tail)"
    }

    public static func save(attemptId: Int, moduleId: Int, version: Int) -> String {
        "save.\(attemptId).\(moduleId).v\(version)"
    }

    /// Start is keyed per attempt and *persisted*, so relaunching the app mid-start reuses
    /// the key and the server dedupes instead of starting the exam twice.
    public static func start(attemptId: Int, defaults: UserDefaults = .standard) -> String {
        let storageKey = "ts.idem.start.\(attemptId)"
        if let existing = defaults.string(forKey: storageKey), !existing.isEmpty { return existing }
        let fresh = "start.\(attemptId).\(UUID().uuidString)"
        defaults.set(fresh, forKey: storageKey)
        return fresh
    }

    /// One key per off-screen event, so a retried report cannot burn two of the student's
    /// three chances.
    public static func offscreen(attemptId: Int, eventId: UUID = UUID()) -> String {
        "offscreen.\(attemptId).\(eventId.uuidString)"
    }
}

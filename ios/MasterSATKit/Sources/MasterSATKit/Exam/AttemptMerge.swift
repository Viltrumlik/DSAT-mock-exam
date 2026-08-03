import Foundation

/// Pure snapshot-merge rules. Port of `state/attemptMerge.ts`.
///
/// The runner learns the attempt's state from several places at once — the status poll, a
/// submit response, an autosave response. A slow in-flight response can land *after* a
/// newer one, and applying it would rewind the student's exam. These guards make state
/// move forward only.
public enum AttemptMerge {

    /// Whether `next` should replace `prev`.
    ///
    /// * no previous → accept
    /// * lower version → reject (an older snapshot arriving late)
    /// * module-order regression while still active → reject (a stale module poll).
    ///   SCORING/COMPLETED legitimately have no active module, so they are exempt.
    public static func shouldAccept(previous: Attempt?, next: Attempt) -> Bool {
        guard let previous else { return true }
        if next.versionNumber < previous.versionNumber { return false }

        let previousOrder = previous.currentModuleDetails?.moduleOrder ?? 0
        let nextOrder = next.currentModuleDetails?.moduleOrder ?? 0
        if previousOrder > 0, nextOrder > 0, nextOrder < previousOrder, !next.isCompleted {
            return false
        }
        return true
    }

    public static func merge(previous: Attempt?, next: Attempt) -> Attempt {
        shouldAccept(previous: previous, next: next) ? next : previous!
    }
}

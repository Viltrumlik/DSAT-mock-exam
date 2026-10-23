import Foundation

/// Where one source of the Class tab's Tasks lists stands — homework, or midterms. Only `loaded`
/// may say "nothing here": a list that has not arrived, or could not, is a spinner or a retry,
/// never an empty state.
public enum ClassSourceState: Sendable, Equatable {
    case pending, loaded, failed

    /// A fetch ended. A failure keeps what was already loaded (the last good data stays on
    /// screen) and, with nothing to keep, becomes `failed`.
    public mutating func finish(succeeded: Bool) {
        if succeeded { self = .loaded } else if self != .loaded { self = .failed }
    }
}

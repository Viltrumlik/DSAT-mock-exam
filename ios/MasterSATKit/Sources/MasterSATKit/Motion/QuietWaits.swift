import Foundation

/// Work waiting for the celebrations to finish (`CelebrationCenter.whenQuiet`), one per key.
///
/// A newer ask replaces an older one under the same key that has not run yet — a reload asked
/// twice runs once — but never one under another key: the welcome-back check's reload and the
/// Rewards hub's own hero read wait side by side, and neither is lost to the other. Handed out
/// in the order their keys were first asked.
public struct QuietWaits<Action> {
    private var waiting: [(key: String, action: Action)] = []

    public init() {}

    public var isEmpty: Bool { waiting.isEmpty }

    public var keys: [String] { waiting.map(\.key) }

    public mutating func put(_ key: String, _ action: Action) {
        if let index = waiting.firstIndex(where: { $0.key == key }) {
            waiting[index].action = action
        } else {
            waiting.append((key, action))
        }
    }

    /// Everything waiting, once: the caller runs it, and anything asked while it runs waits anew.
    public mutating func takeAll() -> [Action] {
        let actions = waiting.map(\.action)
        waiting.removeAll()
        return actions
    }
}

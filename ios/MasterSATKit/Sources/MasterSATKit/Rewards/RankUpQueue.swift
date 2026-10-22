import Foundation

/// The trophy card's turn: at most one rise waiting for the stage, one on screen — and never the
/// same news twice.
///
/// A rise is the same news when it has the same from and to as the card already shown AND the
/// place noted before its board answered is already that rise's `to`. That is a check whose
/// baseline still held the old place — it began before the card was shown, or the baseline
/// could not move because a board read was out or failed — reading a board that has not changed.
/// Once the student has been noted anywhere else (overtaken back to the old place, say), the
/// same from and to is a new climb, and gets its card.
public struct RankUpQueue: Sendable, Equatable {
    public private(set) var waiting: Rise?
    public private(set) var showing: Rise?
    private var lastShown: Rise?

    public init() {}

    /// No card waiting and none up.
    public var isIdle: Bool { waiting == nil && showing == nil }

    /// A check found a better place. `placeBefore` is the place noted before this board answered
    /// (the store's, read before it takes the new one). A newer rise replaces one still waiting.
    /// Returns false for a replay, which is dropped.
    @discardableResult
    public mutating func rose(_ rise: Rise, placeBefore: Int?) -> Bool {
        if rise == lastShown, placeBefore == rise.to { return false }
        waiting = rise
        return true
    }

    /// The waiting rise goes up — called once the caller has found the stage clear. Nil while a
    /// card is up or nothing waits.
    public mutating func show() -> Rise? {
        guard showing == nil, let rise = waiting else { return nil }
        waiting = nil
        showing = rise
        lastShown = rise
        return rise
    }

    /// Puts the card away, and returns it. A rise with the same from and to still waiting behind
    /// it is the one just seen, and goes with it.
    @discardableResult
    public mutating func dismiss() -> Rise? {
        guard let shown = showing else { return nil }
        showing = nil
        if waiting == shown { waiting = nil }
        return shown
    }
}

import Foundation

/// A piece of work the app celebrates every time it is finished — effort, never a score.
public enum FinishedWork: String, Sendable, CaseIterable, Equatable {
    case homework, assessment, vocabSession, survey

    /// What VoiceOver says, since the check and the confetti cannot be seen.
    public var announcement: String {
        switch self {
        case .homework: return "Homework handed in. Well done."
        case .assessment: return "Assessment handed in. Well done."
        case .vocabSession: return "Round finished. Well done."
        case .survey: return "Survey sent. Thank you."
        }
    }
}

/// Celebrations waiting for the student to be able to see them.
///
/// A task can finish where the root overlay cannot be seen — inside the assessment runner or a
/// word game (full-screen covers), or under the Me sheet. Its check and confetti then wait until
/// the stage is clear. Its "+N XP" waits longer: for the post-task refresh to confirm a gain, for
/// the check to have played, and for a header pill on screen to catch it. Until it lands the gain
/// is HELD: the header shows the old number and rolls when the flight lands.
public struct CelebrationQueue: Sendable, Equatable {
    public struct Flight: Sendable, Equatable, Identifiable {
        public let id: Int
        public let amount: Int
    }

    struct Entry: Sendable, Equatable {
        let id: Int
        let work: FinishedWork
        let xpBefore: Int?
        var effortShown: Bool
        /// Nil while the refresh is out; 0 once it said nothing was earned, or nothing may fly.
        var gain: Int?
    }

    private(set) var entries: [Entry] = []
    private(set) var flying: [Flight] = []
    private var nextID = 1
    /// The highest total a task has been measured against, so two tasks whose refreshes read
    /// the same total do not both claim the same gain.
    private var measuredUpTo: Int?

    public init() {}

    /// XP the header holds back: confirmed, and not landed yet.
    public var held: Int {
        entries.reduce(0) { $0 + ($1.gain ?? 0) } + flying.reduce(0) { $0 + $1.amount }
    }

    public var isEmpty: Bool { entries.isEmpty && flying.isEmpty }

    /// A check and confetti still waiting for the stage.
    public var hasHiddenEffort: Bool { entries.contains { !$0.effortShown } }

    /// A confirmed gain not yet in the air.
    public var hasConfirmedGain: Bool { entries.contains { ($0.gain ?? 0) > 0 } }

    public func isFlying(_ id: Int) -> Bool { flying.contains { $0.id == id } }

    /// A task was finished. Its check plays now only when the stage can be seen; otherwise
    /// `takeEfforts` hands it out later.
    @discardableResult
    public mutating func record(_ work: FinishedWork, xpBefore: Int?, stageVisible: Bool) -> (id: Int, playNow: Bool) {
        let id = nextID
        nextID += 1
        entries.append(Entry(id: id, work: work, xpBefore: xpBefore, effortShown: stageVisible, gain: nil))
        return (id, stageVisible)
    }

    /// The checks still to show, now that the stage can be seen. Each is handed out once.
    public mutating func takeEfforts(stageVisible: Bool) -> [FinishedWork] {
        guard stageVisible else { return [] }
        var shown: [FinishedWork] = []
        for index in entries.indices where !entries[index].effortShown {
            entries[index].effortShown = true
            shown.append(entries[index].work)
        }
        dropSettled()
        return shown
    }

    /// The refresh after a task came back. Nothing earned — or no flights allowed — holds nothing.
    public mutating func resolve(_ id: Int, xpAfter: Int?, allowsFlights: Bool) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        let floor = entries[index].xpBefore.map { max($0, measuredUpTo ?? $0) }
        let gain = XPDelta.gain(before: floor, after: xpAfter)
        if let xpAfter { measuredUpTo = max(measuredUpTo ?? xpAfter, xpAfter) }
        entries[index].gain = allowsFlights ? gain : 0
        dropSettled()
    }

    /// One flight carrying every confirmed gain whose check has played — when the stage can be
    /// seen and a pill is on screen to catch it. Without flights, gives everything back.
    public mutating func takeFlight(stageVisible: Bool, pillVisible: Bool, allowsFlights: Bool) -> Flight? {
        guard allowsFlights else {
            if held > 0 { releaseHeld() }
            return nil
        }
        guard stageVisible, pillVisible else { return nil }
        let ready = entries.filter { $0.effortShown && ($0.gain ?? 0) > 0 }
        guard !ready.isEmpty else { return nil }
        let readyIDs = Set(ready.map(\.id))
        entries.removeAll { readyIDs.contains($0.id) }
        let flight = Flight(id: nextID, amount: ready.reduce(0) { $0 + ($1.gain ?? 0) })
        nextID += 1
        flying.append(flight)
        return flight
    }

    /// The flight reached its pill: what it carried is no longer held.
    public mutating func land(_ id: Int) {
        flying.removeAll { $0.id == id }
    }

    /// Flights became impossible (Reduce Motion): nothing is held back any more.
    public mutating func releaseHeld() {
        for index in entries.indices where (entries[index].gain ?? 0) > 0 {
            entries[index].gain = 0
        }
        flying.removeAll()
        dropSettled()
    }

    /// An entry is finished with once its check has played and nothing is left to fly.
    private mutating func dropSettled() {
        entries.removeAll { $0.effortShown && $0.gain == 0 }
    }
}

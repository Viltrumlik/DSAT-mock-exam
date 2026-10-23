import Foundation
import Testing
@testable import MasterSATKit

/// The decision table behind "while you were away"'s baseline: what is written, given what the
/// header shows, what is held back from it and what is still in the air.
@Suite struct LastSeenRuleTests {

    private typealias Shown = LastSeenRule.Shown
    private typealias InFlight = LastSeenRule.InFlight

    private let old = LastSeen(xp: 100, streak: 4, rank: 57, newestAwardID: 900)

    private func baseline(
        old: LastSeen?, shown: Shown, inFlight: InFlight = InFlight()
    ) -> LastSeen? {
        LastSeenRule.baseline(old: old, shown: shown, inFlight: inFlight)
    }

    @Test("Before anything has loaded there is nothing to write, whatever else is known")
    func nothingLoaded() {
        let shown = Shown(xp: nil, streak: 6, rank: 40, newestAwardID: 950)
        #expect(baseline(old: old, shown: shown) == nil)
        #expect(baseline(old: nil, shown: shown) == nil)
    }

    @Test("The first baseline is what the header shows")
    func firstBaseline() {
        let shown = Shown(xp: 120, streak: 5, rank: 40, newestAwardID: 950)
        #expect(baseline(old: nil, shown: shown) == LastSeen(xp: 120, streak: 5, rank: 40, newestAwardID: 950))
    }

    @Test("What is not known yet is left out, not made up: no streak is none, no place is none")
    func firstBaselineGaps() {
        let shown = Shown(xp: 0, streak: nil, rank: nil, newestAwardID: nil)
        #expect(baseline(old: nil, shown: shown) == LastSeen(xp: 0, streak: 0, rank: nil, newestAwardID: nil))
    }

    @Test("XP held for a flight is not seen yet: the baseline is the number on the pill")
    func heldXP() {
        let shown = Shown(xp: 130, streak: 4, rank: 57, newestAwardID: 950)
        let written = baseline(old: old, shown: shown, inFlight: InFlight(heldXP: 30))
        #expect(written?.xp == 100)
        #expect(baseline(old: old, shown: shown, inFlight: InFlight(heldXP: 500))?.xp == 0, "never below zero")
    }

    @Test("While XP is in the air the caption keeps its starting point, so a kill before it lands flies both again")
    func heldXPKeepsTheCaptionStart() {
        let shown = Shown(xp: 130, streak: 4, rank: 57, newestAwardID: 950)
        #expect(baseline(old: old, shown: shown, inFlight: InFlight(heldXP: 30))?.newestAwardID == 900)
        #expect(baseline(old: nil, shown: shown, inFlight: InFlight(heldXP: 30))?.newestAwardID == nil)
        #expect(baseline(old: old, shown: shown, inFlight: InFlight(heldXP: 0))?.newestAwardID == 950,
                "nothing held: the newest row has been seen")
        let none = Shown(xp: 130, streak: 4, rank: 57, newestAwardID: nil)
        #expect(baseline(old: old, shown: none)?.newestAwardID == 900, "no row applied yet keeps the old one")
    }

    @Test("The streak is the one the flame shows, a drop included; unknown keeps the old; nothing at all is 0")
    func streak() {
        #expect(baseline(old: old, shown: Shown(xp: 100, streak: 6))?.streak == 6)
        #expect(baseline(old: old, shown: Shown(xp: 100, streak: 1))?.streak == 1,
                "a restarted run grows from the restart, never from the old best")
        #expect(baseline(old: old, shown: Shown(xp: 100, streak: nil))?.streak == 4)
        #expect(baseline(old: nil, shown: Shown(xp: 100, streak: nil))?.streak == 0)
    }

    @Test("A place read this time is the new baseline — a place that fell too; unknown keeps the old")
    func rankRead() {
        let answered = InFlight(rankReadFailed: false)
        #expect(baseline(old: old, shown: Shown(xp: 100, rank: 40), inFlight: answered)?.rank == 40)
        #expect(baseline(old: old, shown: Shown(xp: 100, rank: 80), inFlight: answered)?.rank == 80,
                "a lower place is simply the new baseline")
        #expect(baseline(old: old, shown: Shown(xp: 100, rank: nil), inFlight: answered)?.rank == 57)
        #expect(baseline(old: nil, shown: Shown(xp: 100, rank: nil), inFlight: answered)?.rank == nil)
        #expect(baseline(old: old, shown: Shown(xp: 100, rank: 40), inFlight: answered)?.rankUnread == false)
    }

    @Test("A board read that failed, or is still out, keeps the place the student last saw — and says it is unread")
    func rankReadFailed() {
        let failed = InFlight(rankReadFailed: true)
        let written = baseline(old: old, shown: Shown(xp: 130, rank: 40), inFlight: failed)
        #expect(written?.rank == 57, "the hub may have noted 40; the baseline still measures from 57")
        #expect(written?.rankUnread == true)
        #expect(baseline(old: nil, shown: Shown(xp: 130, rank: 40), inFlight: failed)?.rank == nil)
        #expect(baseline(old: nil, shown: Shown(xp: 130, rank: 40), inFlight: failed)?.rankUnread == true)
    }

    @Test("With no board read this launch, the stored unread bit stands")
    func rankNotReadThisLaunch() {
        let unread = LastSeen(xp: 100, streak: 4, rank: 57, newestAwardID: 900, rankUnread: true)
        let held = baseline(old: unread, shown: Shown(xp: 100, rank: 40))
        #expect(held?.rank == 57)
        #expect(held?.rankUnread == true)

        let settled = baseline(old: old, shown: Shown(xp: 100, rank: 40))
        #expect(settled?.rank == 40)
        #expect(settled?.rankUnread == false)

        let first = baseline(old: nil, shown: Shown(xp: 100, rank: 40))
        #expect(first?.rank == 40)
        #expect(first?.rankUnread == false)
    }

    @Test("A board read that answered clears an unread place from an earlier launch")
    func answeredClearsUnread() {
        let unread = LastSeen(xp: 100, streak: 4, rank: 57, newestAwardID: 900, rankUnread: true)
        let written = baseline(old: unread, shown: Shown(xp: 100, rank: 40), inFlight: InFlight(rankReadFailed: false))
        #expect(written?.rank == 40)
        #expect(written?.rankUnread == false)
    }

    @Test("A rank-up whose card has not been shown keeps the baseline at the place the student last saw")
    func rankCardWaiting() {
        let waiting = Rise(from: 57, to: 40)
        // However the read went, and whatever the hub has noted meanwhile.
        for failed in [nil, false, true] as [Bool?] {
            let written = baseline(
                old: old, shown: Shown(xp: 100, rank: 40),
                inFlight: InFlight(rankNotShown: waiting, rankReadFailed: failed)
            )
            #expect(written?.rank == 57)
            #expect(written?.rankUnread == true, "the next launch reads the board again")
        }
        let firstLaunch = baseline(old: nil, shown: Shown(xp: 100, rank: 40), inFlight: InFlight(rankNotShown: waiting))
        #expect(firstLaunch?.rank == 57, "the place the card is about to leave behind")
    }

    @Test("Everything at once: held XP, a held place and a waiting card each decide only their own field")
    func independentFields() {
        let written = baseline(
            old: old,
            shown: Shown(xp: 140, streak: 5, rank: 30, newestAwardID: 960),
            inFlight: InFlight(heldXP: 40, rankNotShown: Rise(from: 57, to: 30), rankReadFailed: false)
        )
        #expect(written == LastSeen(xp: 100, streak: 5, rank: 57, newestAwardID: 900, rankUnread: true))
    }

    @Test("A baseline with no place and no award, written and read back, is the same baseline")
    func nilRoundTrip() {
        let name = "lastseen-rule-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let book = LastSeenBook(defaults: defaults)

        let first = LastSeenRule.baseline(old: nil, shown: Shown(xp: 0, streak: nil, rank: nil, newestAwardID: nil), inFlight: InFlight())
        let written = LastSeen(xp: 0, streak: 0, rank: nil, newestAwardID: nil)
        #expect(first == written)
        book.write(written, userID: 5)
        let readBack = book.read(userID: 5)
        #expect(readBack == written)
        #expect(readBack?.rank == nil)
        #expect(readBack?.newestAwardID == nil)

        // A baseline that is waiting on a place has a rank and no award: only one of them is nil.
        let half = LastSeen(xp: 20, streak: 1, rank: 9, newestAwardID: nil, rankUnread: true)
        book.write(half, userID: 5)
        #expect(book.read(userID: 5) == half)

        // And the next launch's decision, made from what was read back, keeps the nil.
        let next = LastSeenRule.baseline(old: book.read(userID: 5), shown: Shown(xp: 20, streak: 1, rank: nil, newestAwardID: nil), inFlight: InFlight())
        #expect(next == half)
    }
}

/// `WelcomeBack.historyWindow` mirrors a constant the server owns, and nothing but this test
/// ties the two together: if the server's page grows, the caption's "+ N more" would count a
/// window that is no longer full as if it were.
@Suite struct HistoryWindowDriftTests {

    /// The test skips only when the backend is not checked out at all (a kit-only clone). With
    /// `backend/` present, a moved or renamed file FAILS: a skip would end the mirror silently.
    static let backendFolder = "backend"
    static let backendFile = "backend/rewards/views.py"

    /// Every module-level `HISTORY_LIMIT = <int>` in a Python source.
    static func historyLimits(in source: String) -> [Int] {
        source.split(whereSeparator: \.isNewline).compactMap { line in
            guard line.hasPrefix("HISTORY_LIMIT") else { return nil }
            let parts = line.split(separator: "=", maxSplits: 1)
            guard parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces) == "HISTORY_LIMIT" else { return nil }
            return Int(parts[1].trimmingCharacters(in: .whitespaces).prefix { $0.isNumber })
        }
    }

    @Test("The reader finds a module-level constant and nothing that only looks like one")
    func reader() {
        #expect(Self.historyLimits(in: "import x\nHISTORY_LIMIT = 50\n\nclass V:\n    pass\n") == [50])
        #expect(Self.historyLimits(in: "HISTORY_LIMIT=7  # newest first\n") == [7])
        #expect(Self.historyLimits(in: "    HISTORY_LIMIT = 9\nOTHER_HISTORY_LIMIT = 3\nHISTORY_LIMIT_MAX = 4\nrows = rows[:HISTORY_LIMIT]\n").isEmpty)
        #expect(Self.historyLimits(in: "").isEmpty)
    }

    @Test(
        "The kit's history window is the server's HISTORY_LIMIT",
        .enabled(if: RepoPaths.exists(HistoryWindowDriftTests.backendFolder), "backend/ is not checked out beside the kit")
    )
    func matchesTheBackend() throws {
        try #require(
            RepoPaths.exists(Self.backendFile),
            "\(Self.backendFile) is gone but backend/ is here — point backendFile at the module that defines HISTORY_LIMIT"
        )
        let source = try String(contentsOf: RepoPaths.file(Self.backendFile), encoding: .utf8)
        let limits = Self.historyLimits(in: source)
        let limit = try #require(limits.first, "\(Self.backendFile) no longer defines HISTORY_LIMIT")
        #expect(limits.count == 1, "one constant, so there is one number to mirror")
        #expect(WelcomeBack.historyWindow == limit, "WelcomeBack.historyWindow mirrors HISTORY_LIMIT in \(Self.backendFile) — change them together")
    }
}

import Testing
@testable import MasterSATKit

/// Every mutating call is made on its own line, never inside `#expect` (as `CelebrationQueueTests`).
@Suite struct QuietWaitsTests {

    @Test("One wait per key: a newer ask replaces the older under its key and leaves the others")
    func onePerKey() {
        var waits = QuietWaits<String>()
        #expect(waits.isEmpty)
        waits.put("reload", "reload 1")
        waits.put("hero", "hero 1")
        waits.put("reload", "reload 2")
        #expect(waits.keys == ["reload", "hero"], "the order the keys were first asked in")
        let taken = waits.takeAll()
        #expect(taken == ["reload 2", "hero 1"])
        #expect(waits.isEmpty)
        let again = waits.takeAll()
        #expect(again.isEmpty, "each is handed out once")
    }

    @Test("A key asked again after its wait ran waits again")
    func askedAgain() {
        var waits = QuietWaits<Int>()
        waits.put("hero", 1)
        let first = waits.takeAll()
        waits.put("hero", 2)
        let second = waits.takeAll()
        #expect(first == [1])
        #expect(second == [2])
    }
}

/// Every mutating call is made on its own line, never inside `#expect`.
@Suite struct RankUpQueueTests {

    @Test("A rise waits, is shown once, and is put away")
    func showOnce() {
        var cards = RankUpQueue()
        #expect(cards.isIdle)
        let taken = cards.rose(Rise(from: 10, to: 5), placeBefore: 10)
        #expect(taken)
        #expect(cards.waiting == Rise(from: 10, to: 5))
        #expect(!cards.isIdle)
        let shown = cards.show()
        #expect(shown == Rise(from: 10, to: 5))
        #expect(cards.waiting == nil)
        #expect(cards.showing == Rise(from: 10, to: 5))
        let twice = cards.show()
        #expect(twice == nil, "one card at a time")
        let dismissed = cards.dismiss()
        #expect(dismissed == Rise(from: 10, to: 5))
        #expect(cards.isIdle)
        let nothing = cards.dismiss()
        #expect(nothing == nil)
    }

    @Test("A newer rise replaces one still waiting; one that arrives while a card is up waits behind it")
    func newerRise() {
        var cards = RankUpQueue()
        cards.rose(Rise(from: 10, to: 7), placeBefore: 10)
        cards.rose(Rise(from: 10, to: 4), placeBefore: 10)
        let shown = cards.show()
        #expect(shown == Rise(from: 10, to: 4))
        cards.rose(Rise(from: 4, to: 2), placeBefore: 4)
        let blocked = cards.show()
        #expect(blocked == nil)
        cards.dismiss()
        let next = cards.show()
        #expect(next == Rise(from: 4, to: 2))
    }

    @Test("The same rise from a check that read the old baseline is never shown again — card up or put away")
    func replay() {
        // A check that began before the card was shown read the place from before it, and the
        // store had already noted the new place (#5) when its board answered.
        var up = RankUpQueue()
        up.rose(Rise(from: 10, to: 5), placeBefore: 10)
        _ = up.show()
        let whileUp = up.rose(Rise(from: 10, to: 5), placeBefore: 5)
        #expect(!whileUp)
        let dismissed = up.dismiss()
        #expect(dismissed == Rise(from: 10, to: 5))
        let replayed = up.show()
        #expect(replayed == nil, "putting the card away never replays it")
        #expect(up.isIdle)

        var gone = RankUpQueue()
        gone.rose(Rise(from: 10, to: 5), placeBefore: 10)
        _ = gone.show()
        gone.dismiss()
        let afterwards = gone.rose(Rise(from: 10, to: 5), placeBefore: 5)
        #expect(!afterwards)
        #expect(gone.isIdle)

        // Taken while the card is up (no place was noted before it): putting the card away
        // still drops it — the student has just read that very card.
        var racing = RankUpQueue()
        racing.rose(Rise(from: 10, to: 5), placeBefore: 10)
        _ = racing.show()
        racing.rose(Rise(from: 10, to: 5), placeBefore: nil)
        racing.dismiss()
        let behind = racing.show()
        #expect(behind == nil)
        #expect(racing.isIdle)
    }

    @Test("The same from and to after the student was seen somewhere else is news again")
    func sameRiseAgain() {
        var cards = RankUpQueue()
        cards.rose(Rise(from: 10, to: 5), placeBefore: 10)
        _ = cards.show()
        cards.dismiss()
        // Overtaken back to #10 — noted there — and then up to #5 once more.
        let again = cards.rose(Rise(from: 10, to: 5), placeBefore: 10)
        #expect(again)
        let shown = cards.show()
        #expect(shown == Rise(from: 10, to: 5))
    }

    @Test("A different rise is never taken for a replay")
    func differentRise() {
        var cards = RankUpQueue()
        cards.rose(Rise(from: 10, to: 5), placeBefore: 10)
        _ = cards.show()
        cards.dismiss()
        let further = cards.rose(Rise(from: 10, to: 3), placeBefore: 5)
        #expect(further)
        let fromElsewhere = cards.rose(Rise(from: 8, to: 5), placeBefore: 5)
        #expect(fromElsewhere)
    }
}

# iOS — the Leaderboard page from the owner's "Rewards Tab" design

Owner, 2026-10-29: sent `~/Downloads/Rewards Tab.dc.html` — "rewardsni shunday qiling".
Asked where the hub's coins, Convert, XP history and Shop go:

> avvalgidek alohida tursin rewards ichida leaderboard va boshqalar

**The Rewards tab stays the hub it is.** The design is the **Leaderboard page inside it** — the
page `AppLink.leaderboard` opens from the hub's hero, from Today's rank card and from the
leaderboard sheet's "See the full board". Build the owner's design; do not mock it up again.

## The design (bundled page, unpacked in the session scratchpad)
- Blue band: "Leaderboard" (Archivo 32), bell, avatar, the drifting shield. A pushed page here,
  so the band also carries the glass back button (`ClassPageBackButton`'s look).
- A summary line, "XP · This Week · Global", and a white 42-pt `tune` button → the filter sheet.
- The podium card: a deep-blue gradient (`#173F86 → #2A68C0 → #3A7AD4`), three light beams, a
  gold glow behind the winner, five four-point sparkles, a bobbing crown. Avatars in a gold /
  silver / bronze ring with a rank badge; first name; a value pill (gold / silver / copper).
  Steps 76 / 56 / 42 tall, glass, a coloured top edge, the numeral inside; they grow up from
  the bottom with a springy overshoot, third first and the winner last.
- Rows from 4 down: rank numeral (Archivo 22, the row's ink), a 40-pt tinted disc with a white
  ring, the full name, the value (+ "XP", or a blue strike disc on the strike board). The row is
  a gradient from the student's tint to white at 62 %.
- **Your row** is blue (`#2A68C0 → #3A7AD4`): `#rank`, the white disc, the name, "N XP to next
  rank", the value. It sits in its place in the list, and sticks to the bottom (over the tab
  bar) while that place is below the screen. When the student is past the page it is always
  pinned.
- Filter sheet: METRIC (XP | Strikes, segmented), TIME (This Week · This Month · All Time chips,
  the chosen one blue), SCOPE (Global | My Class, segmented), Done.
- Motion: band row drops in; podium people rise with a spring 90 ms apart; rows fade up 35 ms
  apart; a filter change fades the board out for 170 ms and back in. Reduce Motion: no
  entrance, no loops, an instant swap.

## Owner decisions
- **"This Week" comes back on the server** (owner chose it). `WINDOW_WEEK = 7 days` in
  `rewards/leaderboard.py`, served first in `/leaderboard/filters/` (week · month · all). No
  migration → zero-downtime hot-patch (`leaderboard.py` + `views.py`). The web reads the
  served chips, so it gains "This week" too; its TS union is widened.
- Scope "My Class Batch" = the server's `GROUP` board (the student's class roster), shown as
  "My Class". Global = `GLOBAL`. The old page's "My Branch", Subject and Branch filters are
  not in the design and go.
- Strikes are a run — the server ignores the window there. With Strikes chosen the Time chips
  are dimmed with one line saying why, and the summary drops the time part.
- "N XP to next rank" / "N strikes to next rank": against the row directly above, plus one, only
  when that row is in the answer (the kit's goal rule, for both metrics).

## Rules carried over
Ranks are the server's; no email is ever a name; an error is not an empty board; a failed
refresh keeps the board and says so in a line; growth-oriented words; Reduce Motion never
restructures the tree; the status bar is white over the band (`StatusBarChrome`).

## Order
1. Server: the week window + tests. 2. Kit: week label, per-metric value, the next-rank climb +
tests. 3. App: the page, the sheet, the sticky row. 4. Simulator: light, dark, Reduce Motion,
SE; screenshots. 5. One PR. 6. Hot-patch the server half only on the owner's yes.

# Live Quiz: the owner's design canvas, built

Owner, 2026-11-02: "dizaynni shu artifactdagi live quizga o'xshatib bering" — the 13 Live Quiz boards on
the canvas "MasterSAT ekranlari" (https://claude.ai/artifact/KhEQPpaASfRiLAzpHwbnzB, page "Live Quiz").

Three PRs, in the canvas's own order. Nothing deploys without the owner's OK.

## PR 1 — groups 0 + 1: the look (no migration)

| Board | What changes |
| --- | --- |
| A1 Host lobby | Code card + player count + Start side by side; players as big avatar cards, newest first, "Just joined" on the newest |
| A2 Question | Top bar with the student's avatar + score; timer on its own row; tiles get a shape + a number badge; power-ups as a row of equal buttons with real icons (no emoji glyphs) |
| A3 Summary | Exact numbers: accuracy "of the N you answered", gem breakdown line by line, "N of 300 today", "Next: <look>" with its real progress |
| A4 Reconnect | After a few failed tries, a full screen: what is known, attempt count, Try again, Enter a different code. Also replaces the endless "Joining the quiz…" |
| A5 Team podium | Teams and top players side by side in two panels |
| B1 Skin tiers | Rare: warm glow. Epic: ring + twinkling stars. Legendary: gold halo, sweeping shine, three sparkles in orbit. Four faces: waiting, right answer, thinking, not this time. Small sizes stay still and simple |
| B2 Correct | The student's avatar above the card, wearing the face that fits |
| B3 Shop | A look opens a try-on page: scene tabs (Lobby / Right answer / Podium), price, real progress to it, the other looks |
| D2 layout only | The non-team podium: bigger stage, places 4+ as chips (hats, frames, titles arrive in PR 2 and 3) |

Decisions the boards leave open:

- "attempt 3 of 5" becomes "attempt 3": the socket keeps retrying past five, so a limit on screen would be untrue.
- Team 3 is renamed Meteors, as drawn. Team names are not stored anywhere; they come from the index.
- "about two games" estimates 100 gems a game.

## PR 2 — group 2: hats, frames, emotes, Locker (migration)

Boards C1, C2. Hats sit on any character. Frames ring the avatar. Emotes show on the podium and the reveal.
`AvatarLook` gains `hat`, `frame`, `emote`; items are new key kinds in the code catalog; prices as drawn.

## PR 3 — group 3: titles, limited items, the full podium (migration)

Boards D1, D2. Titles are earned by playing and never sold: Streak master, Team captain, Lightning, Word wise,
Perfect game, with the thresholds drawn. Limited items sell only inside their window (Winter beanie Dec–Feb,
Navro'z tulips March). The final podium shows frame, hat, emote and title together.

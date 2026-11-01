# Live Quiz, rebuilt to play like Wayground — plan

Owner's ask (2026-11-01, before an exam, no questions allowed): *study Wayground and rebuild our
Live Quiz to work like it.* Questions were parked (bottom of this file); every open choice below
was made with the recommended default so the work could proceed.

## What Wayground does that we did not

Researched from the Wayground help centre (help.wayground.com):

| Wayground | Our Live Quiz before |
|---|---|
| **Student-paced by default** ("Classic"): everyone starts together, then each student answers at their own speed with instant feedback | Teacher-paced only: one question for the room, the host advances |
| Score = **600 + up to 400 for speed** (600–1000); no timer = flat 600 | 100 + up to 50 |
| **Show answer after each question**: Off / Validate only / On | Correct/incorrect only after the room's question closes |
| **Power-ups** (≤3 held, one use each, current question only): 2X, 50-50, Eraser, Streak Saver, Time Freeze, … | None |
| Streak counter; rank shown after every question | None |
| Shuffle questions **and answers** per student | Shuffle questions once for the room |
| Live dashboard: class accuracy meter, per-student score/accuracy, per-question accuracy, colour grid (green/red) | Answer count only |
| Podium + per-student summary (accuracy %, rank, streak, review of questions) | Final table |
| Teacher-led mode still exists | (that was all we had) |

Not taken (parked or out of scope): Team mode, Mastery Peak, Strike & Shield / attacks on other
players (Glitch, Gift…), memes (image sets), music tracks, nicknames/avatars (we are roster-only
and names are real), redemption question, AI explanations, paper mode.

We copy **mechanics**, not branding: our own colours, words and visuals.

## Decisions made without asking (defaults; each is reversible)

1. **Two modes.** `student_paced` (new default) and `instructor_paced` (the existing engine, kept
   unchanged in behaviour). A "Test" preset in the host console = student-paced, no timer, no
   leaderboard, no answers shown, no power-ups.
2. **Rooms created before this ship stay teacher-paced** — config without a `mode` key falls back
   to `instructor_paced` and the old 100-point scale. New rooms get `NEW_SESSION_DEFAULTS`.
3. **Scale** 600 + up to 400 (`point_scale` 600, `speed_bonus_ratio` 2/3). No streak *bonus points*
   (Wayground publishes none); streak is a counter that earns power-ups.
4. **Power-ups**: five that only touch the student's own question — double, fifty_fifty, eraser,
   streak_saver, time_freeze. Earned one per 3-in-a-row, max 3 held, random. Student-paced only.
   No attacks on classmates.
5. **Feedback pause** of 3 s after each answer; the next question's clock starts when it appears.
6. **Per-student shuffle** of question order (server) and option order (client display only;
   choice ids unchanged, so grading and tallies are untouched).
7. **The game ends itself** once every student still in the room has finished (owner, 2026-11-01:
   "O'zi tugasin"), 3 s after the last answer so its result shows; the host can still end it early.
8. **Missed questions** (clock ran out) are written as `timed_out` rows: in the report, not counted
   as answered. A student away when their clock ran out has one question marked missed on return,
   then the next opens fresh.
9. **No XP/coins** — the owner's original v1 decision stands until they say otherwise.
10. **iOS untouched.** The protocol is additive; a student-paced room reuses `QUESTION_ACTIVE`,
    `question_started` and `answer_result`, sent per student, so the current app keeps playing
    (without the new feedback screens).

## Architecture

- Session row: `status` = `QUESTION_ACTIVE` means "in play" for the whole student-paced round.
- Participant row gains: `question_order`, `position`, own `question_started_at/ends_at`,
  `finished_at`, `streak/best_streak`, `powerups`, `armed`. Answer row gains `timed_out`,
  `powerups_used`. Migration `0002_per_student_play` is additive only.
- `livequiz/paced.py`: every student move under `select_for_update` on that student's row
  (answer, time-out, power-up) — whoever locks second finds them moved on.
- Socket: each student's sockets join `livequiz.<session>.p<participant>`; personal frames go there.
  Each socket arms its own timer from `ends_in_ms`; the first to fire times out, the rest no-op.
  Host socket refreshes the room's leaderboard every 3 s when it changed. Room-wide frames never
  carry the host's answer board.
- Frames carry `starts_in_ms` / `ends_in_ms` so phone clock skew does not matter.
- Fixed on the way: a student could read every answer key via `GET …/results/` mid-game; now
  409 until the quiz is over.

## Tasks

- [x] Backend: config, modes, scoring scale, `paced.py`, `powerups.py`, events, consumer, migration
- [x] Backend tests (`tests_paced.py`) — full `livequiz` suite green
- [x] Frontend: game theme + answer tiles + top bar + feedback splash + power-up bar
- [x] Frontend: student-paced player screen; teacher-paced player restyled
- [x] Frontend: host console (mode cards + settings), lobby, live dashboard, podium
- [x] Frontend: student end summary + review; results page uses new fields
- [x] Reducer tests; tsc / eslint / vitest green
- [x] Browser check of both modes end to end
- [x] PR #337 (draft) — **no deploy**: deploying needs the owner's OK and the open-attempts census

## Verified (2026-11-01)

- Backend `livequiz` suite 142 OK; frontend 2123 tests green; tsc / eslint / api-layer clean.
- Real-wire probe against real uvicorn (JWT auth, REST + WebSocket): 25/25 — own questions,
  server time-outs, power-ups, latecomer, pause/resume clocks, podium, results privacy.
- Real browsers (Playwright, 3 users, both modes) against that uvicorn: every screen shot, 0 server
  tracebacks. Found and fixed: join race (500), host stuck on "Get ready…", canvas under the shell,
  stale correct count, toggles, tile padding.

## Parked questions for the owner (asked one at a time after the exam)

1. ~~★ Default mode for a new room~~ — **answered 2026-11-01: student-paced stays the default** (as built).
2. ~~★ XP/coins?~~ — **answered: neither — a currency of its own (Gems) and an avatar shop** → PR #338.
3. ~~Power-ups~~ — **answered: keep all five.**
4. ~~Auto-end~~ — **answered: the game ends itself when everyone is done** (built in this PR).
5. ~~Redemption question~~ — **answered: yes** → built as "second chance": one missed question
   (two on a paper over 15) comes back at the end; right = base points and counts as right; off in
   test rooms and teacher-paced rooms.
6. ~~Memes / music~~ — **answered: not needed.**
7. ~~Question sources~~ — **answered: SAT questions too, from assessment sets** (the homework sets;
   copied into the room with images; 90 s default timer).
8. ~~iOS new look~~ — **answered: not now.**
9. ~~Team mode~~ — **answered: yes, team score = SUM of members** → built: 2–6 teams, smallest-team
   assignment at join, host moves players in the lobby, team podium.

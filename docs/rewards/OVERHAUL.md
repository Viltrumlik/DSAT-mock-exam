# Reward overhaul — design brief

The school's instruction, in full: points must land **immediately** for everything except
homework; homework pays **at 100% before the deadline, or at the deadline for whatever was
reached by then, and never for work done after it**; the homework percentage becomes
**weighted and adaptive**; vocabulary is scored **per game by accuracy**; assessment
**retries do not count**; attendance pays **on save**; **XP follows points everywhere**; and
journals **classwork** becomes student-visible, manually assignable, deadline-less, and paid
**only by a teacher's hand**.

Everything below is a decision, not a suggestion. Where a decision reverses an earlier one,
it says so and says why.

---

## 0. The three invariants that survive

1. **An award never raises into its caller.** `services.award` runs in its own savepoint and
   swallows. Five hook sites depend on it (`midterms/models.py:779-786` is the sharp one).
2. **Awarding is idempotent on `idempotency_key`.** Re-running any hook corrects in place.
3. **The ledger is event-sourced.** Nothing recomputes a balance from source rows.

## 1. Homework percent: weighted and adaptive

`bundle_percent` becomes a **weighted mean over items**, each item carrying its own achieved
percent rather than a 0-or-100 boolean.

```
percent = Σ(item.percent × item.weight) / Σ(item.weight)
```

Weights are all `1.0` today, so N items each take a `100/N` share — the school's worked
example (1 assessment + 1 vocab, assessment at 95% → 50 + 47.5 = 97.5%) falls straight out.
`weight` is a field on `BundleItem` **because the requirement says the split must be
flexible**: a per-item weight set by a teacher is then a data change, not a rewrite.

Per-kind percent, replacing the current booleans:

| kind | percent today | percent now |
|---|---|---|
| assessment | best full-length attempt | **first** full-length graded attempt (§3) |
| vocabulary | 100 if any mode completed | **per-game accuracy × coverage** (§4) |
| SAT content | 100 if every section sat | unchanged — 100 or 0 |
| hand-in | 100 if submitted | unchanged — 100 or 0 |

SAT content and hand-in stay binary deliberately. A pastpaper's score is a 200-floored SAT
scale with no stored denominator (`exams/models.py:1440-1450`), and recomputing a max means
re-checking every answer (`get_module_results`) on a path that already runs on every save.
A hand-in has no grade until a teacher marks it, and a student must not lose points waiting
on a teacher's backlog.

**Points are proportional, not banded.** `EVENT_HOMEWORK_FULL/HIGH/MID` and the 60% floor
are retired: the instruction is "at the deadline, whatever percent they reached is what they
get". A new event `HOMEWORK` is priced at a maximum and scaled:

```
points = round(max_points × percent / 100)
```

The three old event codes stay in `EVENT_CHOICES` so historical rows and their seeded
`RewardRule`s keep reading. **Do not delete them** — `PointAward.event` values outside the
choice set are a data problem, and migration `0002` seeded those rules.

## 2. Timing: immediate at 100%, else at the deadline, never after

`recompute_bundle` becomes a **gate**, because the four item hooks all converge on it and a
hook firing a week late currently raises the award (`hooks.py:254`).

```
if category == CLASSWORK            -> return (manual only, §7)
if due_at is None                   -> settle live at whatever it is
if now <= due_at and percent >= 100 -> settle now
if now <= due_at and percent < 100  -> WRITE NOTHING, wait for the deadline
if now >  due_at                    -> settle as of due_at
```

"As of `due_at`" is a real cutoff, not a freeze flag: every item kind carries a completion
timestamp, so `bundle_items(assignment, student, as_of=due_at)` filters each one and
post-deadline work simply never enters the arithmetic. That is idempotent and re-runnable,
which a frozen snapshot column would not be.

**Writing nothing before the deadline is load-bearing, not an optimisation.** XP is a
high-water mark (`services.py:147`), so any interim award at a transient high percent banks
that XP permanently even after the points fall to the deadline figure.

Timestamps used for the cutoff, one per kind:

| kind | cutoff field |
|---|---|
| assessment | `AssessmentAttempt.submitted_at`, falling back to `started_at` |
| vocabulary | `VocabStudySession.completed_at` |
| SAT content | `TestAttempt.completed_at` |
| hand-in | `Submission.submitted_at` |

Assessment items currently apply **no** time floor at all while vocab and SAT content do
(`homework.py:64-70` vs `:124`, `:158`). Add the floor so all four kinds agree on "did this
FOR this homework".

### The sweep
`settle_due_homework` becomes the only path that settles a partially-done bundle, so its
gaps stop being harmless:

- cadence `crontab(minute=25)` → `crontab(minute="*/10")`; an hour's lag is not "at the
  deadline". Guarded by skipping bundles already settled at the same percent (the upsert
  already writes nothing when unchanged, so this is only a query-count concern).
- roster `STATUS_ACTIVE` → `NON_REMOVED_STATUSES`, matching the hooks (`hooks.py:187`).
  Today the two paths settle different populations.
- a management command `settle_due_homework --lookback-days N`, because
  `SWEEP_LOOKBACK_DAYS = 7` silently and permanently loses everything older after an outage
  and nothing today can pass that argument.

## 3. Assessments: the first attempt, not the best

`_assessment_items` takes the **earliest** full-length graded attempt ordered by
`(started_at, id)` — `id` because `started_at` is a Python-side default, not `auto_now_add`,
so only `id` is strictly monotonic.

This **inverts a documented anti-farming principle** (`homework.py:48-53`: "best, never
latest", so a deliberate bad retry cannot confiscate banked points). The school asked for it
explicitly. Two consequences to state plainly rather than paper over:

- a student whose first sitting was weak can no longer improve their homework points;
- `tests_homework.py:258-264` (`test_the_best_full_attempt_wins_not_the_latest`) is now
  wrong and must be rewritten to assert the opposite.

The full-length guard stays exactly as it is — compare the student's attempts to **each
other**, never to the set's live question count, or archiving one question makes every
banked attempt read as a subset and the hourly sweep confiscates points.

**Known hole, must be reported not silently left:** `POST /api/assessments/attempts/abandon/`
(`views_attempt.py:579-602`) needs nothing but ownership, and an abandoned attempt never
produces a result. Under a first-attempt rule that is a one-request way to discard a bad
first sitting. Harmless under the old best-attempt rule; live under this one.

## 4. Vocabulary: per game, by accuracy, with coverage

There are exactly four modes — `flashcard`, `matching`, `speed`, `test`
(`vocabulary/models.py:278-287`) — and `VocabStudySession` already stores `correct_count`,
`total_count` and `accuracy`. No new table is needed.

```
set_percent = Σ over the 4 modes (game_percent) / 4
game_percent = accuracy × coverage        (0 for a mode never completed)
coverage     = min(1, distinct_words_answered / set_word_count)
```

**Coverage is the whole of "kuchaytiring" and is not optional.** Raw `accuracy` is not
comparable across the four games and is trivially farmable:

- **Speed** only ever reports prompts answered before the 60s clock expires
  (`SpeedMode.tsx:85-100`). Two of twenty words answered correctly stores `accuracy = 100`.
- **Flashcards** re-drill the missed pile into the *same* session and report every verdict
  of every round (`FlashcardMode.tsx:62-91`), so a 10-word set can report 18 results — the
  denominator is card-views, not words.
- **Matching** marks *both* clicked words wrong on one mis-click (`MatchingMode.tsx:231`).

Coverage needs one new column, `VocabStudySession.distinct_words`, filled server-side from
the `word_id`s the finish endpoint already receives. One small migration; no client change
is required for it to start working.

Per-mode selection when a student replays: **the first completed session for that (set,
mode)**, matching the assessment rule. Replays create new rows (`ModeChrome.tsx:153, 206`)
and nothing in the schema picks one today.

Keep the per-mode time floor: each game must have completed at or after
`assignment.created_at`, or last term's run fills this term's 25% slot.

**`is_completed_by` ("any one mode completes the set") stays as it is.** It drives the set
list, the launcher state and a badge (`vocabulary/models.py:145`,
`classes/serializers.py:509-534`, `SetOverview.tsx:154`, `ModeChrome.tsx:481`). Scoring and
"done" are now different questions and are allowed to differ; changing both at once would
silently restate four unrelated surfaces.

## 5. Flashcards: a 5-second cooldown

After a verdict, hold the card for 5 seconds before advancing, with a visible countdown.
Two things this must get right, both already established by the research:

- **the keyboard is a third entry point.** `useModeKeys` binds `1`/`ArrowLeft`/`2`/
  `ArrowRight` at the window (`useModeKeys.ts:29-37`); disabling the buttons alone throttles
  nothing.
- **the timer must clear on unmount.** The mode is a full-screen takeover the student leaves
  by a client-side `<Link>` (`ModeChrome.tsx:66-73`), and `FlashcardMode` has no timer
  plumbing at all today.

Also add the re-entrancy guard `MatchingMode` already has: `answer` reads `results`/`missed`
from closure state, so a double-click or a held key drops a verdict
(`FlashcardMode.tsx:62-82`).

## 6. Attendance pays on save — and what that costs

Drop the `session.status != FINALIZED` gate in `sync_attendance_record`.

**This forces a change to the XP rule, and it must be made deliberately.** `revoke()` zeroes
points and deliberately leaves XP standing (`services.py:192-196`). With payment moved to
save-time, one mis-click — or one **Mark all present** press, which writes a PRESENT row for
the entire roster with no confirmation (`views_attendance.py:169-177`) — permanently grants
XP to every absentee, and no correction can take it back.

Decision: **a withdrawn fact clears XP; a smaller fact does not.**

- `revoke()` (the fact never happened: PRESENT → ABSENT, survey withdrawn, session
  un-held) now zeroes `xp` alongside `points`.
- `award()` keeps `max(previous_xp, …)` (the fact got smaller: a re-grade dropping a
  homework percent) — XP still never falls for a downgrade.

This narrows the school's "XP is never taken away" rule to "XP is never taken away for doing
worse". Without it, "attendance pays on save" and "XP only ever climbs" cannot both hold.

Strikes stay `FINALIZED`-gated. `strikes.recompute` re-derives a student's whole history,
zeroes `spent_in_streak` and writes a visible `KIND_RESET` row (`strikes.py:99`); running
that on every toggle would break and rebuild a student's streak under the teacher's cursor.
Points are per-record and idempotent, so they can move; a streak is not.

## 7. Classwork: visible, assignable, deadline-less, manual-only

**It already pays automatically, which is a live bug.** The classwork carrier is a
PUBLISHED `classes.Assignment` (`journals/delivery.py:378`), and `recompute_bundle` has no
category filter, so students already earn homework-band points for in-class work nobody
decided to pay for. `recompute_bundle` gains a first-line
`if assignment.category == CATEGORY_CLASSWORK: return None`.

The carrier also **drops every authored field except instructions**
(`delivery.py:372-380`) — no title, no links, no video, no attachment. Making classwork
student-visible means copying them across.

Manual award: **one per (classwork assignment, student)** — the carrier is one Assignment
per lesson shared by every granted item (`delivery.py:363-366`), so there is no per-item row
to key on. Event `CLASSWORK_MANUAL`, teacher-supplied points, `actor` set, audited.

Two hard constraints on where it lives:

- the endpoint **must** be mounted under `/api/classes/`. `/api/journals/` is host-guarded
  to the admin console and `CanManageJournals` excludes teachers by design
  (`host_guard.py:150-151`); a route under it 403s before DRF runs.
- the gate is `can_manage_class` (OWNER + TEACHER), **not** `is_staff`.
  `can_grade`/`can_manage_assignments` include TAs (`capabilities.py:71-76`), and
  `_is_reward_staff` in `rewards/views.py` excludes teachers entirely, so neither is reusable.

Deadline: none, ever. Giving the carrier a `due_at` silently enrols it in
`settle_due_homework` (`tasks.py:43`) and switches automatic scoring back on.

## 8. XP for every event

`XP_EXCLUDED_EVENTS` is emptied — the school asked for XP on everything. To keep the earlier
decision reachable without a deploy, XP becomes a per-rule flag: `RewardRule.grants_xp`
(default `True`). `xp_for` consults the rule, falling back to the constant.

Note what this costs and do not hide it: `SURVEY` is worth 40 points, so one questionnaire
becomes worth two midterm passes on the XP board — exactly the failure the old exclusion
comment named. The school asked for it; the flag is how they undo it.

Migration `0004` hardcodes the excluded events as a literal tuple **on purpose**. Do not
edit it. Any backfill is a new migration.

## 9. Fixes carried along (found while reading, cheap, in the blast radius)

- `rewards/admin.py:24,35-38` — `xp`, `previous_xp` and `new_xp` are missing from
  `readonly_fields`, so an append-only audit table renders as editable inputs.
- `rewards/homework.py:126-127, 156` — dead unreachable branches (`assignment.created_at` is
  `auto_now_add`, never falsy). One of them encodes the exact rule the surrounding code
  exists to prevent.
- `rewards/homework.py:123-127` — vocab sessions match on `vocab_set_id` alone while
  `VocabStudySession.homework` is populated and unused, so finishing a set for class B
  credits class A's homework.
- `rewards/homework.py:172` — `allow_file_upload` is never consulted, so an upload-only
  homework has no hand-in item at all; and only the singular `external_url` is read when
  `external_urls` is documented as the source of truth.
- `tests_homework.py:97,405` — fixtures use `mode="flashcards"`, which is not a valid choice.
  Django does not enforce `choices` on `create()`, so these rows exist and would give a false
  green to any logic branching on mode.
- `settings.py` — no `CELERY_TIMEZONE`, so hour-pinned beat entries fire 5h off intent
  (`hour=3` runs 08:15 Asia/Tashkent). Set it; do not re-pin the hours.

## 10. Out of scope, reported not fixed

- the self-abandon score eraser (§3) — needs a product decision on what an abandoned first
  sitting is worth.
- `notifications.prune_push_subscriptions`, `realtime.cleanup_realtime_events` and the
  midterm attempt reaper are all defined and scheduled nowhere.
- nothing alerts on `sat-celery-beat` being dead; under a deadline-frozen model that is now
  a silent "homework never pays" outage.

# Rewards epic — points & coins

Replaces the school's informal point system with an explicit, auditable reward economy, and
adds a spendable coin currency on top of it.

Grounded in a code audit of six subsystems (2026-08-06). Every "already exists" claim below
was verified against the checked-out tree; refuted claims were removed.

---

## 0. The single most important finding

**What the codebase calls "points" today is not a reward balance.**

`RankingSnapshot.score` (`backend/classes/models_ranking.py:114`) is a *leaderboard cache*.
For `kind=ACADEMIC` it holds a re-derived sum of raw `AssessmentResult.score_points` plus
hand-graded `SubmissionReview.grade`, recomputed from scratch **every 20 minutes** by
`classes.tasks.recompute_classroom_rankings` (`backend/config/settings.py:397`). Nothing is
ever *awarded*; nothing is ever *spent*; there is no per-student total outside a
`(classroom, kind, period_key)` row.

Three consequences that shape the whole design:

1. **Reward points must never be computed inside the ranking pipeline.** That pipeline is a
   pure re-derivation that `update_or_create`s and even *deletes* snapshot rows
   (`backend/classes/ranking/service.py:81`). Points written there would silently change
   whenever a rule or a source row changed. Rewards are **event-sourced**: written by hooks,
   only ever *read* by boards.

2. **"Reset everyone's points" is nearly a no-op.** There is no stored balance to clear — the
   new ledger starts empty. The real cutover decision is whether to *backfill* historical
   events (past attendance, past midterms, past homework) or start from zero. See §6.

3. **The academic leaderboard migrates onto reward points** (school's decision). The board
   keeps its four student-facing surfaces — classroom header "Your pts", Overview standing
   cards, the rankings podium/board, the iOS class board — but its currency becomes the new
   reward points, and the old assessment-derived points are cleared.

   This is the largest structural consequence in the epic: `RankingSnapshot(kind=ACADEMIC)`
   stops being derived from `assessment_points_per_student` and becomes a *projection of the
   reward ledger*. `backend/classes/ranking/rules.py:134-254` (and `_hand_graded_points`)
   goes out of service for ACADEMIC; `service.py::_recompute_academic` reads
   `PointAward` totals instead. SAT ranking is untouched.

   Because reward points are global and the board is per classroom, the projection sums the
   ledger rows whose `classroom` matches — which is exactly why every award carries a
   nullable classroom FK (§1). Classroom-less awards (surveys, midterms) count toward the
   student's global balance but not toward any single class board. **Open:** whether the
   school wants midterm/survey points on the class board too — if so, awards need a
   "home classroom" resolution rule.

---

## 1. Point rules (as specified)

| Event | Points | Condition |
|---|---|---|
| Lesson attended | 5 | per finalized attendance session |
| Support-teacher session | 10 | when the session is **confirmed as held** |
| Survey completed | 40 | once per (student, published survey) |
| Lesson attended **late** | 3 | partial credit for `LATE` |
| Midterm passed | 20 | score ≥ pass mark, any score above it |
| Midterm **retake** passed | 5 | only a separate `midterm_type=RETAKE` exam; a `MidtermResit` re-sit of the same paper still earns the full 20 |
| Homework 100% | 15 | per **bundle**, see §1.1 |
| Homework 80–99% | 10 | |
| Homework 60–79% | 5 | |
| Homework ≤59% | 0 | no ledger row at all |

### 1.1 Homework is scored per **bundle**, not per item

One `classes.Assignment` can bundle several contents — assessments, pastpapers, vocab sets,
files and links (`Assignment.content_count`, `backend/classes/models.py:415`). The school's
rule is that the **whole homework** yields one percentage, and the band applies to that.

Per-item completion signals all exist, but **only assessments carry a real percent**:

| Item | "done" signal | percent? |
|---|---|---|
| Assessment | attempt `STATUS_GRADED` | ✅ `AssessmentResult.percent` (`assessments/models.py:525`) |
| Pastpaper / practice test | `TestAttempt.is_completed` | ❌ raw SAT-ish score (`200 + Σ question.score`) |
| Mock exam | attempt completed | ❌ raw scaled score |
| Vocab set | `VocabSet.is_completed_by(user)` (`vocabulary/models.py:144`) | ❌ boolean only |
| File / link | submission | ❌ no score |

So "average each item's solved-percent" is not computable for four of the five item types.
The rule that **is** computable, and that reproduces the school's own worked example:

```
item_percent = AssessmentResult.percent      for an assessment
             = 100 if done else 0            for every other item type
homework_percent = mean(item_percent for every item in the bundle)   # not-done counts as 0
```

Worked example (the school's): 4 items — 2 assessments, 1 pastpaper, 1 vocab; 3 done, 1
assessment not done → `(100 + 100 + 100 + 0) / 4 = 75%` → **5 points**. If the completed
assessment had scored 60%, → `(60 + 100 + 100 + 0) / 4 = 65%` → still 5 points.

**Bug to fix first:** `Assignment.content_count` does **not** count `vocab_homeworks`
(`backend/classes/models.py:419-450`), so the school's own 4-item example currently
denominates as 3. Vocab must be added to the count before it can be a denominator.

**Trigger:** recompute the bundle percent on every item completion and upsert the award
(keyed `homework:<assignment_id>:<student_id>`), then force one final recompute at the
deadline for students who never finished. Because the award is an upsert, recomputing is
self-correcting and cannot stack.

Note `Assignment.is_multi_content` currently documents the opposite policy — "the classroom
assignment is NOT auto-finalized into one combined grade (graded manually)"
(`backend/classes/models.py:453-458`). This epic changes that policy for reward purposes
only; the teacher's manual grade is untouched.

**Coins**: earned by conversion at a configurable rate, default **10 points = 1 coin**.
Points are a lifetime, non-decreasing score. Coins are a wallet: they go down when spent.

**Scope**: points are **global per student**, not per classroom. Every ledger row still
records the classroom it happened in (nullable — surveys and midterms often have none), so a
per-classroom board remains possible later without a migration.

---

## 2. New app: `backend/rewards/`

Mirrors the repo's established append-only audit-event pattern (`AccessGrantEvent`,
`SubmissionAuditEvent`, `AssessmentAttemptAuditEvent`, `GovernanceEvent`, `JournalAuditEvent`).

### 2.1 Models

**`RewardSeason`** — makes "reset everyone's points" a one-click, reversible operation
instead of a destructive `DELETE`.
`name, started_at, ended_at (null = current), is_current (unique-true), created_by`.
Balances read only from the current season; history survives forever.

**`RewardRule`** — the point values as data, not magic numbers (repo convention: constants
marked *(tunable)* are config).
`event (unique), points, is_active, updated_by, updated_at`. Seeded by migration from §1.

**`PointAward`** — the current value of one earning event. **Not** append-only; this is the
row an upsert replaces so a re-grade *corrects* rather than *stacks*.
```
student FK, season FK, event, points (int),
classroom FK (null), source_type, source_id,
idempotency_key  ← UNIQUE, the whole correctness story
awarded_at, updated_at, created_by (null = system), note
```
`idempotency_key` formats (one per hook, deterministic, never time-based):
```
attendance:<attendance_record_id>
homework:<homework_id>:<student_id>      ← per homework, NOT per attempt (anti-farming)
homework-review:<submission_id>
midterm:<midterm_outcome_id>
survey:<survey_response_id>
support:<support_session_id>
manual:<uuid>
```

**`PointAwardAudit`** — append-only, one row per *change* in value (grant, correction,
revocation). This is the student's "history" feed and the ops audit trail.
`award FK, previous_points, new_points, reason, actor (null = system), created_at`.

**`StudentWallet`** — O2O with the user.
`coins_balance, coins_credited_from_points, lifetime_points_cache, updated_at`.
Conversion is monotonic and idempotent:
```
earned_total = floor(lifetime_points / rate)
new_coins    = earned_total - coins_credited_from_points   # never negative
```
Spending decrements `coins_balance` only; it never touches points.

**`CoinTransaction`** — append-only.
`wallet FK, kind (EARN|SPEND|ADMIN_GRANT|ADMIN_REVOKE|SEASON_RESET), amount, balance_after,
reference, actor, created_at`.

### 2.2 Service — the only way points are ever written

`backend/rewards/services.py`

```python
award(student, event, *, source, idempotency_key, classroom=None,
      points=None, actor=None, note="") -> PointAward | None
revoke(idempotency_key, *, reason, actor=None) -> None      # sets points to 0 + audit
recompute_wallet(student) -> StudentWallet
```

Contract, each clause driven by a hazard the audit found:

- `update_or_create` on `idempotency_key` inside `transaction.atomic`. A re-run **replaces**
  the value; it never adds.
- Writes a `PointAwardAudit` row **only when the value actually changes** — so backfill
  commands and Celery redeliveries are silent no-ops.
- `points=0` still writes the row (so "you did this homework and got 0" is visible and, more
  importantly, so a later re-grade upgrades it) — except where §3 says otherwise.
- **Never raises into the caller.** Several hook sites sit inside `try/except` blocks that
  swallow exceptions by design (`backend/midterms/models.py:785`); an award failure must
  never un-complete a scored attempt. Failures are logged and counted, not propagated.
- Refuses to write outside the current `RewardSeason`.

---

## 3. Hook points (all verified against real code)

| Event | Hook | Idempotency key | Hazard handled |
|---|---|---|---|
| **Attendance** | `AttendanceFinalizeView.post` — `backend/classes/views_attendance.py:150` | `attendance:<record_id>` | Finalize is **not** idempotent today (unconditional save, no transaction). Must be hardened first — see §4.1. |
| **Homework bundle** (§1.1) | a new `rewards.homework.recompute_bundle(assignment, student)` called from each item's completion path: `grade_attempt` (`backend/assessments/grading_service.py:40`, after the status flip at :132), `TestAttempt` completion, `VocabStudySession` completion, and submission review | `homework:<assignment_id>:<student_id>` | `grade_attempt` is genuinely idempotent (early-returns on `STATUS_GRADED` at :66) and writes a real stored `AssessmentResult.percent` (`assessments/models.py:525`). The other three item types have completion booleans only. Recompute-and-upsert makes every one of these paths safe to fire repeatedly. **Farming risk, see below.** |
| **Homework deadline** | a periodic sweep (mirror `classes.tasks` beat entries) | same key as above | Forces a final recompute for students who never finished, so a 2-of-4 bundle settles at 50% instead of never awarding. |
| **Midterm** | `MidtermOutcome.record_for` — `backend/midterms/models.py:905` | `midterm:<outcome_id>` | The single place `passed` is computed (:923). `pass_mark` is **inclusive (≥)** and per-*midterm-object*, not per-level. `record_for` is an `update_or_create` also called by `backfill_midterm_outcomes` — the key makes that safe. |
| **Support session** | new `SupportSession` → `CONFIRMED` | `support:<session_id>` | New code; copy the `OPEN → FINALIZED` terminal-transition shape from `AttendanceSession`. |
| **Survey** | new `SurveySubmitView.post` | `survey:<response_id>` | Unique `(survey, student)` at the DB level. Only a **PUBLISHED** survey earns, or an author previewing a draft mints points. |

**Never hook** `classes/ranking/service.py` or `classes/tasks.py:50` — see §0.1.

### Homework farming — the biggest single hazard

Assessment attempts are **unlimited**, and "retry incorrect only" mints a fresh attempt over a
*subset* of questions whose `percent` is computed **over that subset**. A naive hook lets a
student score 100% on one remaining question and collect 15 points, repeatedly, forever.

Three guards, all required:

1. Key on **`homework:<assignment_id>:<student_id>`** — one award per *bundle*, recomputed
   and upserted, so no number of retries can add a second row.
2. Per assessment item, use the student's **best** `AssessmentResult.percent`, never the
   latest — otherwise a deliberate bad retry lowers a banked award.
3. **Reject subset attempts**: compare the attempt's `question_order` length to the
   assessment set's full question count and ignore partial re-tries when picking the best
   percent. Without this, "retry incorrect only" on one remaining question reads as 100%.

### Paths that must NOT be hooked

- `classes/ranking/service.py`, `classes/tasks.py:50` — the re-derivation pipeline (§0.1).
- `homework_auto_submit._auto_grade` (`backend/classes/homework_auto_submit.py:31`) and
  `_apply_assessment_sync` (:271). Both are reachable from plain `GET` handlers
  (`backend/classes/views.py:2878`, `:2933`) — a teacher merely opening a page would mint
  points. Note also that `_apply_sync` (:93) grades pastpaper/mock homework with
  `sum(attempt.score)`, a **raw scaled SAT score** and not a percent; §1.1 deliberately treats
  pastpaper items as done/not-done rather than trying to read a percentage out of it.

---

## 4. Prerequisites the school named

### 4.1 Attendance — a revival, not a build

The backend is **complete**: `AttendanceSession` / `AttendanceRecord`, an 8-endpoint REST
surface, a scoring service, real tables (migration `classes/0020`) and 184 lines of passing
tests. A full 267-line teacher marking UI also exists —
`frontend/src/features/classroom/pages/Attendance.tsx` (session list, create, P/A/L/E roster
grid, mark-all-present, finalize, summary). Commit `e0bcfe08` removed the `attendance` entry
from `CLASSROOM_TABS`, so **the component is imported by nothing** and
`ClassroomWorkspace` redirects `?tab=attendance` back to Overview.

Work required:

- Re-register the tab and re-wire the existing component.
- **`unique(classroom, date)`** on `AttendanceSession` — there is none today, so one lesson
  can be recorded as two sessions and each would pay 5 points independently.
- Make `AttendanceFinalizeView.post` idempotent and atomic (today: unconditional
  `status = FINALIZED` + save, no transaction, no guard).
- Guard `AttendanceMarkView` **and** `AttendanceMarkAllPresentView` against writing to a
  FINALIZED session (mark-all-present has no guard at all today) — and route legitimate
  owner corrections through `revoke`/`award` so PRESENT→ABSENT gives the points back.
- Attendance stays **staff-only** — the school's decision. It is a register the teaching team
  keeps, not something a student browses. The `GET attendance/me/` endpoint and the page's
  student-self-view branch both survive unused, so reopening it later is a one-line change.
- Optional: FK to `journals.ClassroomLesson` so a session is tied to a real delivered lesson
  (`lesson_index` is a free integer the UI never sends).

**Open**: does `LATE` earn 5, 0, or a partial award? The model's only opinion is
`SCORE_WEIGHT = {PRESENT: 1.0, LATE: 0.5, ABSENT: 0.0}`; `EXCUSED` is excluded from the
denominator entirely.

### 4.2 `support_teacher` role

There is **no** `support_teacher` anywhere in the repo (grepped backend, frontend, iOS: zero
hits). But `ClassroomMembership.ROLE_TA` **already is** a working per-classroom support
teacher, with a finalized capability matrix (`backend/classes/capabilities.py`), DRF classes,
a frontend mirror (`features/classroom/capabilities.ts`) and a passing test matrix
(`classes/tests_ta_permissions.py`).

A TA today **can**: create/edit/publish/archive assignments, grade, take attendance, post
announcements, view analytics, recompute rankings.
A TA **cannot**: delete assignments, change class settings, manage the roster, configure
ranking, appoint TAs, delete the class.

**Recommendation: add the global role, reuse the classroom-local one.** Introduce global
`support_teacher` (so the account type exists, can log into the teacher portal, and can be
filtered in ops), and use the existing `ROLE_TA` membership for the classroom slot — relabelled
"Support Teacher" in the UI. This gets the school exactly the "some of the teacher
permissions" it asked for, with a matrix that is already written and tested.

Adding a global role is **not** a one-line change. Every chokepoint below hard-denies or
silently downgrades an unknown role:

| File | What must change |
|---|---|
| `backend/access/constants.py:55-75` | add to `CANONICAL_ROLES` — otherwise `normalized_role` downgrades it to `student` |
| `backend/access/services.py:84-128` | add to `_role_permissions_map()` |
| `backend/access/services.py:713-804` | role branch in `authorize()` (fail-closed default) |
| `backend/access/services.py:310-399` | `has_global_subject_access`, `has_access_for_classroom` |
| `backend/users/models.py:53-65` and `:210-237` | the two subject-invariant ladders (`UserManager.create_user`, `User.clean`) |
| `backend/users/serializers.py:581-589` | `_ROLE_RANK` — **security**: an unlisted role ranks 1, so any role-assigner could mint it |
| teacher-subdomain gates ×3 | host-guard middleware, the login endpoint, and the SPA `AuthGuard` each hardcode the literal tuple `("teacher", "super_admin")` |

Also needed: a way to **assign** a support teacher to a classroom from ops. Do **not** reuse
`AssignTeacherView` (`backend/classes/views_assign.py:218`) — it rejects any role but
`teacher`/`super_admin` **and** overwrites the single `Classroom.teacher` FK, so it would
silently evict the real teacher.

### 4.3 Ops classrooms — drill-down and presets

Today `/ops/classrooms` is one flat, unpaginated list of every classroom, with a client-side
substring search on name+subject and nothing else. No subject facet, no level facet, no
grouping, no drill-down. Creation is a modal posting 7 fields; `description` is in **no**
classroom serializer, so it cannot be set through the API at all.

Target: **subject → level → classrooms**, plus create-from-preset at the leaf.

- Subjects: `{ENGLISH, MATH}`. Levels: `{foundation, junior, middle, senior}` — and English
  has **no** foundation (`Classroom.LEVELS_BY_SUBJECT`). Level is optional/blank, so existing
  untagged rows need a bucket.
- There is **no** template/preset concept in the repo. The nearest analog is
  `backend/journals/structure.py::COURSE_STRUCTURE`, which already enumerates the 7 valid
  (subject, level) courses and their duration — the natural seed for presets.
- Server-side filtering and pagination should land with this, since the flat list is already
  every classroom in the school.

### 4.4 Support-teacher booking

Fully greenfield — a repo-wide grep for booking/appointment/timeslot/reservation returns zero
non-vendor hits. Closest precedent: `MockSession` + `MockSessionParticipant` (request →
approve) and `backend/mocks/idempotency.py`.

Shape:
- `SupportAvailability` — a support teacher's bookable slots.
- `SupportBooking` — student requests a slot. **Constraint: a student may only book a support
  teacher assigned to a classroom that student is an active member of.**
- `SupportSession` — `OPEN → CONFIRMED | NO_SHOW | CANCELLED`. The award fires on
  `CONFIRMED`, i.e. the support teacher marks the session as actually held.

### 4.5 Surveys

Fully greenfield. No survey, poll, questionnaire or feedback subsystem exists, and **no
reusable dynamic-form-builder of any kind** (`formbuilder|form-builder|dynamic form|FieldSchema|
form_schema` → zero hits).

The assessment authoring stack is *not* reusable as a component: 4 hardcoded question types,
a mandatory `correct_answer`/`points`/grading path, a dense-order unique constraint, and a
builder UI coupled to Question-Bank linking and review-status approval. Reusable as a *visual
pattern* only.

Google-Forms-like build:
- `Survey` (`title, description, status DRAFT|PUBLISHED|CLOSED, created_by, opens_at, closes_at`)
- `SurveyQuestion` (`type: SHORT_TEXT|LONG_TEXT|SINGLE_CHOICE|MULTI_CHOICE|SCALE|DATE`,
  `required`, `order`, `options JSON`)
- `SurveyResponse` (**unique `(survey, student)`**) + `SurveyAnswer`
- Authoring restricted to `super_admin`. Note: the ops nav has **no per-item role gating
  mechanism at all** today, so that gate has to be built, not configured.
- The subdomain host guard **will 403** a new `/api/surveys/` namespace on `admin.*` and
  `teacher.*` until it is explicitly allowlisted (`backend/access/host_guard.py`, cf. the
  journals allow at :150).

---

## 5. Delivery — 8 PRs

**PR 0 — rebase.** The working tree (`feat/ios-app`) is **5 commits behind `origin/main`** and
does **not** contain the `MidtermResit` model at all. Every retake rule below depends on it.
Branch from `origin/main`, not from here.

| PR | Scope | Depends on |
|---|---|---|
| 1 | ✅ **Attendance revival** — re-wire the orphaned UI, `unique(classroom, date)`, idempotent atomic finalize, finalized-session guards. Staff-only | 0 |
| 2 | ✅ **`rewards` core** — app, models (season/rule/award/audit), award service, Django admin, `/api/rewards/` read surfaces, student **Points** page. Wires the two hooks that need nothing new: attendance (5 / 3 late) and midterm (20 / 5) | 1 |
| 3 | ✅ **Homework bundle scoring** — `recompute_bundle` over assessments + vocab + pastpaper + hand-in, four item-completion hooks, hourly deadline sweep, anti-farming guards, `content_count` vocab fix | 2 |
| 4 | ✅ **`support_teacher` role** — global role across **9** chokepoints, teacher-portal access, ops role lists, and a classroom assignment endpoint (**not** `AssignTeacherView`) | 0 |
| 5 | ✅ **Ops classrooms** — subject → level drill-down, server-side `subject`/`level` filters + `?group=1` tallies, create-from-preset, support-teacher staffing | 4 |
| 6 | ✅ **Support booking** — availability slots, booking gated on a shared classroom, confirm-as-held → 10-point hook | 4, 2 |
| 7 | ✅ **Surveys** — six question types, super_admin authoring, student fill, host-guard allowlist → 40-point hook | 2 |
| 8 | **Coins** — wallet, conversion at the configured rate, transactions, spend surface, ops grant/revoke | 2 |
| 9 | **Cutover** — open season 1, **repoint the academic leaderboard at the reward ledger and clear the old points** (§0.3), iOS surface, docs | all |

PR 9 is the risky one: it retires `assessment_points_per_student` as the ACADEMIC currency
and changes a number every student already sees. It ships last, behind the rest, so the
ledger has real data in it before the board starts reading from it.

### Notes from building PR 2

- Hooks are **signal receivers**, not calls edited into views. Attendance alone has three
  write paths (`mark/`, `mark-all-present/`, `finalize/`) and midterm verdicts are written by
  the runtime *and* by `backfill_midterm_outcomes`; hanging off the model save catches all of
  them without asking every future caller to remember. Safe only because awarding is
  idempotent and self-correcting.
- `award()` runs inside its own `transaction.atomic()` with the `except` **outside** it. A
  bare try/except would leave the caller's transaction aborted on PostgreSQL — and every hook
  site is inside somebody else's transaction.
- Awards carry a nullable `classroom`. Attendance records one; midterms do not (§0.3's open
  question). `balances_for(..., classroom=...)` therefore returns class-earned points only.
- Zeroed (revoked) awards are filtered out of the student's feed. A row reading
  "Attended a lesson — 0" is a punishment notice, not a history entry.

### Notes from building PR 3

- **Blank `question_order` is not a subset.** The anti-farming guard rejects a re-try whose
  `question_order` is shorter than the set — but an *empty* one means "not recorded" (older
  rows, and any path that never pinned an order). Treating blank as a subset would silently
  discard a student's only real attempt. The guard now requires a non-empty order.
- **Reward item granularity is defined in `rewards/homework.py`, not borrowed from
  `Assignment.content_count`.** That property counts display slots and expands packs
  pack-by-pack; for points, "one pastpaper" is one thing a student sits. The two numbers
  answer different questions and are allowed to differ. (`content_count` was still fixed —
  it had been missing vocabulary entirely since vocab homework shipped.)
- **Unpublishing does not confiscate points.** Never-published work earns nothing, but a
  teacher toggling a published assignment back to draft does not take back points a student
  genuinely earned. Deliberate asymmetry, pinned by a test.
- A hand-in counts as done at **submitted**, not at graded — a student must not lose points
  to their teacher's marking backlog.
- The deadline sweep exists because the item hooks only fire when a student *finishes*
  something: a student who did two of four items and stopped would otherwise never be scored
  at all, rather than being scored 50%.

### Notes from building PR 4

- The audit said seven chokepoints; there were **nine**. The two it missed are the ones that
  fail silently: `user_domain_subject` (returns `None` for an unlisted role, so every
  subject-alignment check denies it regardless of the subject on its row) and
  `_sync_global_user_access` (no global `UserAccess` row → `has_global_subject_access` is
  always `False`).
- `_ROLE_RANK` is the security one: `.get(rc, 1)` means an unlisted role ranks as *student*,
  so any actor holding `assign_access` could mint it. Two tests now walk `CANONICAL_ROLES`
  and assert every member has both a rank and a permission set — the rule, not the instance.
- Bare `== ROLE_TEACHER` is the anti-pattern. Subject rules now test membership of
  `SUBJECT_SCOPED_STAFF_ROLES`; the teacher-portal gate (previously the literal tuple
  `("teacher", "super_admin")` in three independent layers) is `TEACHER_PORTAL_ROLES`.
- Assignment goes through a dedicated endpoint, not `AssignTeacherView`: that one overwrites
  the single `Classroom.teacher` FK (evicting the real teacher) and cannot hold more than one
  person anyway. Subject alignment is checked at assignment, so a mismatch is a 400 rather
  than a wasted appointment later.

### Notes from building PR 6

- **Two models, not three.** The plan sketched availability → booking → session, but a booking
  with a terminal status *is* the session. A third table would duplicate the booking's own
  lifecycle and give the reward hook two rows to disagree about.
- The open question above is settled by building both readings at once: **eligibility** needs
  only *a* shared classroom (the school's sentence), and the booking **records which** shared
  classroom it went through — auto-resolved when there is exactly one, left null rather than
  guessed when there are several. The ledger gets its classroom either way.
- **Eligibility is computed live, never snapshotted onto the booking.** A student removed from
  a class loses the entitlement immediately; a snapshot would keep the door open until someone
  noticed.
- **Re-booking a cancelled slot reuses the same row** (unique on `(availability, student)`).
  The reward key is the booking id, so a second row would be a second award.
- Withdrawing a slot cancels the bookings on it — otherwise a student keeps a
  confirmed-looking appointment nobody is going to attend.
- Settling is the support teacher's, explicitly not the student's: `HELD` is what pays, so
  letting the student set it would be self-service.

---

## 6. Decisions

**Settled by the school (2026-08-06):**

- Coins convert from points at a configurable rate, default **10 points = 1 coin**.
- Points are **global per student**.
- The support-teacher award fires when the **session is confirmed as held**, not at booking.
- The **academic leaderboard migrates onto reward points**; the old points are cleared (§0.3).
- Midterm **retake = a separate `midterm_type=RETAKE` exam only**. A `MidtermResit` re-sit of
  the same paper earns the full 20.
- `LATE` attendance earns **3**.
- Homework is scored **per bundle** across assessments, pastpapers and vocab (§1.1).

**Working assumptions — flagged, will proceed unless corrected:**

- **Start from zero** at cutover; no backfill of historical attendance/midterms/homework.
  Backfilling would pay for work done under different rules against uneven historical data.
- **Surveys: 40 points each, no periodic cap** (each survey is authored once by super_admin,
  so volume is already controlled at the source).
- **Pastpaper/mock/vocab/file items contribute 100-or-0** to a bundle percent, since none of
  them carries a percent (§1.1).

**Still needed:**

- **What coins buy.** Required to scope PR 7's spend surface. Everything up to and including
  the wallet and conversion can be built without it.
- **Do midterm and survey points appear on the per-classroom board**, or only in the global
  balance? (§0.3)

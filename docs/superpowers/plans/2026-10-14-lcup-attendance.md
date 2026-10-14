# lc-up Part 2: attendance — implementation plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD: write the test, see it fail, implement, see it pass, commit as Viltrumlik.

**Goal:** our registers and lc-up's attendance agree. History is copied from lc-up. From now on, a closed register takes lc-up's marks, and whatever lc-up lacks is sent to lc-up once. Class rosters mirror lc-up exactly.

**Architecture:** one reconcile rule, `lcup/attendance.py`, works per (group, day) and has two modes:
- **history mode:** mirror lc-up on the days lc-up recorded;
- **gap-fill mode:** lc-up wins, and ours-only marks are pushed.

Three callers use it:
- a one-time history command;
- a new `attendance` stage of the 15-minute sync;
- the push, which runs inside that stage.

Every POST is written to an outbox table (`LcupAttendancePush`). The client gains exactly one write method, `post_attendance`.

**Tech stack:** Django 6 / DRF, the existing `lcup` sync and client, `FakeLcupClient`, Next.js + TanStack Query.

**Design:** approved in chat on 2026-10-14. There is no spec doc; the owner works plan-then-code. The owner's answers, verbatim where it matters:

1. **When to push:** "Davomat yopilganda bir marta", i.e. once, when our register closes. The register closes at lesson end + 120 min; the sync runs every 15 minutes, so the push lands within 15 minutes of the close.
2. **Students:** "o'quvchilar soni lc-upga sinxron bo'lishi kerak. o'quvchi lc-upda bo'lmasa bizdan ham chiqib ketsin…" — the roster mirrors lc-up, and students who are not linked leave too.
3. **History:** "lc-upda ochilgan guruhni o'sha guruh ochilgandan boshlab shu kungacha hamma davomati biznikiga o'tishi kerak u yerda 100% aniqlikdagi davomat bor."
4. **XP:** "XP ham lc-up'ga moslashsin". Awards and revokes follow, and negative balances are accepted.
5. **Conflicts after go-live:** "lc-up ustun, biz faqat bo'shliqni to'ldiramiz".
6. **lc-up's own attendance window:** it stays open until end of day or longer, so a push at close + up to 15 min is inside it.
7. **EXCUSED** needs one of lc-up's 3 reasons, sent as `reason_id`. ABSENT is sent without a reason. (Decision from 2026-10-12.)

## lc-up facts (verified 2026-10-14)

**`POST /api/external/v1/attendance`**
- Body: `{group_id, date: "Y-m-d", records: [{student_id, status: present|absent|late|delete, reason_id?}]}`, at most 100 records.
- `reason_id` is for `absent` only.
- A repeated request is safe: there is no second charge.
- 200 response: `data.summary {saved, deleted, unchanged, failed}` and `data.results[] {student_id, status, result: saved|deleted|unchanged|failed, error: {code: not_in_group|blocked_debt|invalid_reason|reason_only_for_absent|internal_error, message}|null}`.
- 403: the centre's window is closed (the whole request is refused).
- 409: another request is writing this group/day; send `Retry-After`.

**`GET /api/external/v1/attendance`**
- Params: `group_id`, `student_id`, `from`, `to` (window ≤ 92 days, default 30), `include_deleted`, cursor paging.
- Row fields: `id, date, group_id, student_id, present: bool, late: bool, reason: {id,title,color}|null, grade, student_status, created_at, updated_at, deleted_at`.
- **No "who marked" field.**

**`GET /api/external/v1/attendance/reasons`**
- Returns `[{id, title, color}]`. Today: 3034 "Kasal", 3035 "Uzoqga ketib qolgan", 5376 "Maktab/Universitet ruxsat bermadi".

**Status mapping, in both directions:**

| lc-up | ours |
|---|---|
| `present && !late` | PRESENT |
| `present && late` | LATE |
| `!present && reason` | EXCUSED (+ `lcup_reason_id`) |
| `!present && !reason` | ABSENT |

**Prod measurements (2026-10-14, 24 paired groups, from 2026-07-20):**
- lc-up has 6,713 rows. 4,985 of them map to our accounts; 1,727 belong to students we have no account for and are skipped.
- Compared with ours: 2,732 are the same, 2,128 are missing on our side, and 125 differ.
- Ours-only marks: 1,578 fall on days lc-up recorded (they will be deleted); 220 fall on 16 class-days lc-up never recorded (left untouched).
- 126 registers have to be created.
- 630 lc-up marks predate the student's `joined_at` in our class.
- XP impact: about +8.7k and −2.8k.
- Rosters: 29 unlinked active students in 15 classes. Every live lc-up member has an account.

## Global constraints

- **Flags, all off by default:**
  - `LCUP_ATTENDANCE_PULL_ENABLED` gates the stage and the read-only lock;
  - `LCUP_ATTENDANCE_PUSH_ENABLED` gates any POST;
  - `LCUP_ATTENDANCE_PUSH_FROM` (`YYYY-MM-DD`) is the cutover — a day before it is **never** pushed.
  
  `LcupClient.post_attendance` itself refuses unless the push flag is on (defence in depth).
- **One push per (group, day):** a unique row in `LcupAttendancePush`.
  - Transient errors (409, 429, 5xx, network) are retried on later runs, up to 5 attempts.
  - 403 is final (`refused`).
  - Per-student failures are final and listed in `/ops/lcup`.
- **No push for a group** whose live lc-up members include one with no account of ours (that student's fee would be missed).
- **Only closed registers are reconciled** (`marking_state == LOCKED`). Today's open register is the teacher's.
- **When pull is on, a closed register of a paired class is read-only for everyone**, global admins included. Corrections are made in lc-up.
- **Records are deleted one at a time** (`record.delete()`). A queryset `.delete()` skips the reward refund (memory: attendance-window-and-xp-integrity).
- **During the history import, strike-reset notifications are not sent.** The ledger rows are still written, because they are true.
- Commits are authored by Viltrumlik. Tests: `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 /Users/macbook/.pyenv/versions/3.12.2/bin/python3 manage.py test <label> --settings=config.settings_test_nomigrations`. Only a literal `OK` counts.
- **Migrations:** `lcup.0004` (two tables) and `classes` `AttendanceRecord.lcup_reason_id` (nullable, so adding it is metadata-only). Both are verified on a throwaway Postgres before the PR.

---

### Task 1: data and the one write

**Files:**
- `lcup/models.py`: add `LcupAbsenceReason` and `LcupAttendancePush`.
- `lcup/migrations/0004_*`.
- `classes/models_attendance.py`: add `lcup_reason_id`, plus a migration.
- `lcup/conf.py`: add the flag readers.
- `config/settings.py`: read the three env values.
- `lcup/client.py`: add `post_attendance` and `LcupWindowClosed`.
- `lcup/testing.py`: `FakeLcupClient.post_attendance` records its calls and answers from `data["POST /attendance"]`.
- Tests: `lcup/tests_attendance_client.py`.

**Interfaces it produces:**
- `conf.attendance_pull_enabled() -> bool`
- `conf.attendance_push_enabled() -> bool`
- `conf.attendance_push_from() -> date | None`
- `LcupClient.post_attendance(group_id: int, day: date, records: list[dict]) -> dict` returns lc-up's `data`. Behaviour:
  - raises `LcupError("attendance push is switched off")` when the flag is off;
  - raises `LcupWindowClosed` on 403 and does not retry;
  - on 401 it refreshes the token once;
  - on 409, 429 or 5xx it retries with `Retry-After` up to `MAX_RETRIES`, then raises `LcupUnavailable`.
- `LcupAttendancePush` fields:
  - `group` (FK `LcupGroupLink`, CASCADE), `date`;
  - `state` ∈ `sent | failed | refused`, `attempts`;
  - `records` (JSON: what was sent), `summary` (JSON), `failures` (JSON list of `{student_id, user_id, code, message}`), `error` (str);
  - `created_at`, `sent_at`;
  - `UniqueConstraint(group, date)`.
- `LcupAbsenceReason`: `lcup_reason_id` (unique), `title`, `color`, `last_seen_at`.
- `AttendanceRecord.lcup_reason_id`: `PositiveIntegerField(null=True, blank=True)`.

**Tests:**
- the flag off refuses before any HTTP call;
- the body sent is exactly `{group_id, date, records}`;
- 403 → `LcupWindowClosed` after exactly 1 call;
- 409 retried, then succeeds;
- 401 refreshes once.

### Task 2: rosters mirror lc-up — unlinked students leave

**Files:** `lcup/roster.py` (`plan_group`, `RosterPlan`), `lcup/sync.py` (`_rosters`). Test: `lcup/tests_roster.py`.

`RosterPlan` gains `to_remove_unlinked: set[int]`. These are active STUDENT seats whose user has no `LcupStudentLink`. They are planned only when the group has **no live lc-up member without an account**, i.e. `link.memberships.filter(left_at__isnull=True, student__user__isnull=True)` is empty.
- They are not counted against the per-class or per-run caps. Those caps guard against a partial lc-up member list, and this removal does not depend on that list.
- `apply_plan` removes them through `save()`.
- Count: `removed_unlinked`.

**Tests:**
- an unlinked student leaves;
- an unlinked student stays when the group has a live member without an account;
- unlinked removals ignore the caps;
- a linked student still obeys the caps.

### Task 3: the reconcile rule

**Files:** create `lcup/attendance.py`. Test: `lcup/tests_attendance_reconcile.py`.

**Interfaces:**
- `ours_status(row: dict) -> tuple[str, int | None]`: lc-up row → `(STATUS, reason_id)`.
- `lcup_record(record, lcup_student_id: int) -> dict`: our record → `{student_id, status, reason_id?}`.
- `DayPlan`, a dataclass:
  - `link`, `day`;
  - `recorded: bool` (lc-up has ≥1 live row);
  - `mirror: dict[user_id, (status, reason_id)]`;
  - `delete: set[user_id]`;
  - `push: dict[user_id, dict]` (lc-up record dicts).
- `plan_day(link, day, rows, *, gap_fill: bool) -> DayPlan`.
  - `rows` are lc-up rows for this group and day, including deleted ones.
  - Live rows of students with an account go to `mirror`, unless ours already equals them.
  - **History mode** (`gap_fill=False`): when `recorded` is true, ours-only marks go to `delete`; otherwise nothing changes.
  - **Gap-fill mode:** ours-only marks of linked students go to `push`, unless an earlier sent push for (link, day) already included that student. A student we pushed whose lc-up row is now deleted goes to `delete` (lc-up removed it, so lc-up wins). Ours-only marks of unlinked students are left alone; Task 2 removes those students.
- `apply_day(plan) -> Counter`:
  - Ensures the session exists. It is created when `mirror` or `push` is non-empty.
  - Makes sure every mirrored student has a seat with `joined_at` ≤ day. A missing seat is created as REMOVED; a later `joined_at` is moved back to local midnight of `day` via `.update()`. Without this, the register's roster filter and `rewards._enrolled_for` would hide or refuse the mark.
  - `update_or_create` per mirrored mark, with `marked_by=None` and `lcup_reason_id` set.
  - `delete()` per record in `delete`.
  - Sets the session to FINALIZED when `recorded` or a push is planned.
  - Counts: `att_marks_added`, `att_marks_changed`, `att_marks_deleted`, `att_registers_created`.

**Tests (fixed dates, never the clock):**
- each mapping both ways;
- mirror creates the session + record and finalizes it;
- an unchanged mark is not re-saved (`marked_at` stays);
- history deletes ours-only marks on recorded days and keeps them on unrecorded days;
- gap-fill puts ours-only marks into `push` and never into `delete`;
- gap-fill never pushes a student twice;
- an lc-up deletion after our push deletes ours;
- a missing seat is created as REMOVED with `joined_at` = day;
- a mirrored PRESENT pays 5 XP even when the seat had joined later (because of the join-date move).

### Task 4: the push

**Files:** `lcup/attendance.py` (`push_day`). Test: `lcup/tests_attendance_push.py`.

**Interface:** `push_day(client, plan, *, now) -> LcupAttendancePush | None`.
- Returns `None` when `plan.push` is empty, the flag is off, or `plan.day < attendance_push_from()`.
- Also returns `None` when the group has a live lc-up member without an account; in that case the caller adds the alert "push held for <group>: an lc-up student has no account here".
- Uses `get_or_create` on (group, date) and does nothing if the state is `sent` or `refused`, or if `attempts >= 5`.
- Sends at most 100 records per call. One lc-up group has fewer than 30 students; a longer list is chunked.
- Saves `summary`. `failures` are taken from `results` where `result == "failed"`, mapped back to user ids.
- `LcupWindowClosed` → `refused`. `LcupUnavailable` → `failed` with `attempts` + 1.

**Tests:**
- the payload maps EXCUSED to `absent` + `reason_id`, LATE to `late` and ABSENT to `absent` without a reason;
- a day before the cutover is never sent;
- the flag off sends nothing;
- an account-less live member holds the push;
- a sent push is never repeated;
- a failed push is retried and stops after 5 attempts;
- 403 → `refused` and no retry;
- per-student failures are recorded.

### Task 5: the sync stage

**Files:** `lcup/sync.py` (new stages `reasons` and `attendance` after `rosters`). Test: `lcup/tests_attendance_sync.py`.

**`_reasons`:** `GET attendance/reasons`, upserting `LcupAbsenceReason`. This is one request.

**`_attendance`:**
- Runs only when the pull flag is on.
- Makes one `fetch_all(attendance, {from: today-3, to: today, include_deleted: true})` for the whole centre, grouped by `group_id`.
- For each paired, live, CONFIRMED link and each day in that window whose register is LOCKED (`attendance_window.marking_state(classroom, day) == LOCKED`), it runs `plan_day(gap_fill=push_flag and day >= push_from)`, then `apply_day`, then `push_day`.
- Each (link, day) is wrapped in its own atomic block. The push is sent only after the apply commits.
- It adds to the run's counts and alerts, e.g. "pushed 14 marks for <group> <day>" and "<n> failed in lc-up: blocked_debt …".

**Tests:**
- the flag off → no request;
- an open register is left alone;
- a closed register mirrors lc-up;
- gap-fill pushes after the cutover and only mirrors before it;
- counts and alerts are written to the run.

### Task 6: strikes can be deferred, and the history command

**Files:**
- `rewards/strikes.py`: `deferred()` context manager plus the guard in `sync_from_attendance`;
- `lcup/management/commands/lcup_attendance_history.py`;
- tests: `lcup/tests_attendance_history.py` and `rewards/tests_strikes_deferred.py`.

**`strikes.deferred()`:**
- Inside the block, `sync_from_attendance` only collects student ids.
- On exit, each student is recomputed once, with `_notify_streak_reset` suppressed through a `ContextVar`. The ledger RESET rows are still written.

**The command:** `lcup_attendance_history [--dry-run] [--until YYYY-MM-DD]` (default `until` = yesterday).
- **Range:** from the earliest `course_start_date` of the paired live groups to `until`.
- **Fetching:** in 90-day windows with `include_deleted=true`.
- **Per (group, day):** `plan_day(gap_fill=False)` + `apply_day`, all inside `strikes.deferred()`.
- **Afterwards:** `sync_attendance_record` runs over every record in the window, so marks the old join date refused are paid now.
- **Report:**
  - counts per action;
  - XP before/after, as the sum of `PointAward.xp` where `source_type="attendance_record"`;
  - students touched.
- **`--dry-run`:** the same work inside `transaction.atomic()` + `set_rollback(True)`, so nothing is sent and nothing is kept.

**Tests:**
- the dry run writes nothing but reports counts;
- apply mirrors history and pays XP;
- no strike notification is sent during the import;
- days lc-up never recorded are untouched.

### Task 7: the register API

**Files:** `classes/views_attendance.py`, `classes/attendance_window.py`, new `lcup/attendance_guard.py`. Tests: `classes/tests_attendance_lcup.py`.

`lcup/attendance_guard.py` (imported lazily by `classes`):
- `follows_lcup(classroom) -> bool`: `is_lcup_managed(classroom) and attendance_pull_enabled()`.
- `excuse_reasons(classroom) -> list[{id, title}]`: empty unless the class is paired.

Changes:
- **`attendance_window.can_mark` / `window_payload`:** a LOCKED register of a class that `follows_lcup` gets no override, and its reason reads: "Attendance for this class comes from lc-up once the lesson is over. Correct it in lc-up — it reaches here within 15 minutes."
- **Session detail:** returns `excuse_reasons`, and each roster row gets `reason_id`.
- **`mark`:** accepts `reason_id` per entry. In a paired class, an EXCUSED entry without a known reason gets a 400: "Choose a reason for the excused absence." Any status other than EXCUSED clears the reason.
- **`mark-all-present`:** keeps EXCUSED and its reason.

**Tests:**
- a paired, locked register is refused even to a super_admin while pull is on, and is unchanged while pull is off;
- EXCUSED without a reason → 400 in a paired class, and is still allowed in a class that is not paired;
- the reason is saved and returned in the roster;
- changing to PRESENT clears the reason.

### Task 8: the register UI

**Files:** `frontend/src/features/classroom/attendanceApi.ts` and `pages/Attendance.tsx`. Test: `pages/Attendance.lcup.test.tsx`.

- `RosterRow.reason_id: number | null` and `excuse_reasons?: {id, title}[]` on the session.
- `local` state keeps `{status, reason_id}`.
- When E is selected and `excuse_reasons` is non-empty, a `<select>` of reasons appears under that student's row.
- Save is disabled until every E has a reason. `mark()` sends `reason_id`.

**Tests:** the reasons appear only when the class has them; Save stays disabled until a reason is chosen; the payload carries `reason_id`.

### Task 9: `/ops/lcup` — pushes

**Files:**
- `lcup/views.py` + `urls.py`: `GET /api/lcup/attendance/pushes/` returns the last 100 pushes, each with group name, date, state, summary, failures (with student names) and error.
- `frontend/src/features/lcup/lcupApi.ts`: `AttendancePushesPanel`.
- `LcupPanels.tsx`.
- `app/(ops)/ops/lcup/page.tsx`: renders the panel.
- Tests: the view test (admin only) and the panel render test.

### Task 10: verify, PR, deploy, roll out

1. Run the `lcup`, `classes`, `rewards` and `users` suites (in chunks), plus frontend vitest, tsc and eslint. Apply the migrations on a throwaway Postgres.
2. Open the PR. Deploy only with the owner's yes: migrate first (`lcup.0004` + `classes`), then switch the code (frontend + backend → full blue-green release).
3. **Rollout:**
   1. All flags off → run `lcup_attendance_history --dry-run` and show the report to the owner.
   2. With the owner's yes, run `--apply`.
   3. Pull on.
   4. Push on with `LCUP_ATTENDANCE_PUSH_FROM` = the next lesson day.
   5. Watch the first day's pushes.

# lc-up groups fully automatic: implementation plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD: write the test, see it fail, implement, see it pass, commit.

**Goal:** after pairing, a class keeps following its lc-up group without anyone touching it. Teachers who
come and go in lc-up are added to and removed from the class. Name, days, time, level and filial changes
reach the class. A deleted group archives its class, and a restored one reopens it. A new lc-up teacher
gets an account of their own, the way a new student already does.

**Owner's words (2026-10-13):** "guruh lc-upda ochilsa bizda ham ochiladimi? auto teacher ta'yinladimi?
guruh detaillari automatic olinadi? guruh to'xtatilsa yoki o'chirilsa bizda ham automatic o'chiriladi"
(will a group opened in lc-up open here too? are teachers assigned automatically? are group details taken
automatically? if a group is stopped or deleted, is it removed here automatically too?). Then: "ha, qiling.
shuningdek teacher uchun ham yangi account ochilaversin" (yes, do it, and let new accounts be opened for
teachers too). Teacher first sign-in: **the same as students**, phone plus its last four digits (asked and
chosen).

This reverses one 2026-10-12 decision, "Teachers: auto-link plus review, NEVER auto-created". Matching
stays as it is: a unique phone auto-links, and anything ambiguous goes to review. Only a teacher with
**no match at all** gets a new account.

**Architecture:** the `lcup` app only. A new `lcup/follow.py` holds what a paired class does when its group
changes. `sync._groups` calls it, and it also calls teacher-account creation for every live group before it
looks the group's teachers up. One nullable field, `LcupGroupLink.class_archived_at`, records which classes
the sync archived, so a restore reopens only those.

**Tech stack:** Django 6, existing `lcup` sync stages, `FakeLcupClient` tests.

## Global constraints

- **Change, not state.** Details and teacher *removals* act on what lc-up changed between the previous
  snapshot and this one, never on how the class differs from lc-up today. On prod (checked 2026-10-13)
  9 class/teacher pairs and 3 class names differ from lc-up already (e.g. user 44 teaches in 6 classes lc-up
  does not list them in). The first run after the deploy must change none of them.
- Teacher *additions* are reconciled: every linked lc-up teacher of the group is a teacher of the class.
  On prod that adds nobody today (checked).
- Support teachers (ignored links) and TA rows that are ours are never touched. A STUDENT row is never
  turned into a teacher.
- lc-up listing no teachers for a group that had some is not believed: the teachers stay, with an alert.
- Archive = `Classroom.is_active=False`, the existing soft archive (`classroomsApi` "Archive (soft)").
  Nothing is deleted. A class the admin archived before is never reopened by the sync.
- Nothing is created before the initial review (`run.review_done`), as today.
- A teacher account needs a subject (`User.subject`, "math"/"english"), taken from the lc-up group that needs
  them. A teacher with no live group gets no account until they have one. Deleted lc-up teachers never get one.

---

### Task 1: an account for a new lc-up teacher

**Files:** modify `backend/lcup/accounts.py` and `backend/lcup/sync.py`; test `backend/lcup/tests_teacher_accounts.py`.

- `accounts.create_teacher_account_for(link, *, subject, now) -> User | None`: phone checks as for students
  (no phone, or a phone already used, sends the link to review), but with **no** public-account phone move.
  It creates `role=teacher, subject=<domain>`, grants the global subject row through
  `users.serializers._sync_global_user_access` (parity with the admin's create), and opens an `AccountClaim`.
  The link becomes `CREATED`. A shared `_claimable_account` helper serves both kinds of account.
- `sync._teacher_accounts(row, run)`: for a live, non-ignored group after the review, it handles each lc-up
  teacher of the row whose link is `UNMATCHED`, has no user and is not deleted, and creates their account
  using the group's subject. Counts: `teacher_accounts_created`, alert `teacher account created for <name>`.
  It runs inside `_groups`, before `teachers_for(row)`, so a new group with a new teacher gets its class in
  the same run.

Tests:
- A new group with a new teacher, after the review, gets a teacher account (role, subject, claim, link
  CREATED) and a class owned by that teacher in one run.
- Before the review, no account is created.
- A deleted lc-up teacher gets no account.
- A support teacher gets no account.
- A phone already used goes to review.
- Phone + last four digits signs the teacher in.

### Task 2: details follow lc-up changes

**Files:** create `backend/lcup/follow.py`; modify `sync.py`; test `backend/lcup/tests_follow.py`.

- `follow.follow_details(room, previous, current) -> list[str]` (fields changed):
  - name;
  - days (when lc-up's day list changed: a new ODD/EVEN, or an alert when it is neither);
  - start time → `lesson_time`;
  - start/finish → `lesson_hours`;
  - filial → `branch` (only when it maps);
  - level (only to a level the subject has).
  
  A subject change is an alert only. An empty `previous` means no change.
- Alert: `class <name> updated from lc-up: <fields>`. Count: `classes_updated`.

Tests:
- A rename, a days change, a time change and a level change reach the class.
- A difference that existed before (unchanged in lc-up) is left alone.
- Odd days give an alert and no change.

### Task 3: teachers follow lc-up changes

**Files:** `follow.py`, `sync.py`, `tests_follow.py`.

- `follow.follow_teachers(link, previous, current, alerts) -> dict`:
  - Additions: each user in `teachers_for(current)` gets a TEACHER row. A REMOVED row is reactivated, and a
    TA row is promoted to TEACHER. A STUDENT row is skipped with an alert. Each also gets the class-scoped
    `UserAccess`.
  - Removals: the linked, non-ignored users of lc-up teacher ids that were in `previous` and are gone from
    `current` lose their ACTIVE manager row (status REMOVED through `save()`).
  - Owner: when `room.teacher` was removed (or is empty), the first remaining lc-up teacher becomes
    `room.teacher` with an ADMIN row.
  - If `current` lists no teachers while `previous` did, nothing is removed; an alert says so.
  - Counts: `teachers_added`, `teachers_removed`.

Tests:
- A swap: the new teacher is added and owns the class, and the old teacher is removed.
- A second teacher added in lc-up is added as TEACHER.
- A teacher of ours whom lc-up never listed stays.
- A TA (support teacher) stays.
- An empty teacher list removes nobody.

### Task 4: a deleted group archives its class, a restored group reopens it

**Files:** `models.py` + migration `0003_lcupgrouplink_class_archived_at`, `follow.py`, `sync.py`,
`guards.py`; tests in `tests_follow.py`, `tests_sync.py` (alert text) and `tests_guards.py`.

- On the deletion transition (`deleted_in_lcup_at` None → set) a paired, active class is archived and
  `class_archived_at` is set. Alert: `lc-up group deleted: <group>; its class <class> was archived`. A class
  that is already inactive is left as it is (no field set). Count: `classes_archived`.
- On restore (deleted → live), a class with `class_archived_at` is reopened and the field cleared. Alert:
  `lc-up group restored: <group>; its class <class> is open again`. Count: `classes_restored`.
- `guards.is_lcup_managed` is false for a deleted group's class (it no longer follows lc-up, so its roster is
  editable by hand again).

Tests:
- Archive, then restore.
- The admin's earlier archive is not reopened.
- An alert fires once only.
- The guard is false for a deleted group's class.

### Verification and deploy

- [ ] `lcup` suite, plus `classes` and `users` (local command in memory `local-backend-test-command`).
- [ ] The migration on a throwaway Postgres (metadata-only nullable column).
- [ ] PR. Deploy only with the owner's yes: migrate first (additive column, old code unaffected), then the
  code, with zero downtime.
- [ ] After the first live run: `classes_updated`, `teachers_added`, `teachers_removed` and `classes_archived`
  are all 0 (nothing changed in lc-up), and no alerts are new.

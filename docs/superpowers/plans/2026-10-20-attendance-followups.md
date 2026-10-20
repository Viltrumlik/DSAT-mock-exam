# Attendance Follow-ups (excused · trial · not on the list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a paired class's lesson ends, its teachers get one platform notification naming who is absent without a reason, which trial student has already had the free lesson, and which lc-up member is missing from the list. The register shows trial badges and a "not on your list" banner. Admins get an /ops **Trials** section with a count in the sidebar.

**Architecture:** One read-only module, `backend/lcup/followups.py`, answers all three questions from stored data: lc-up memberships (refreshed by the 15-minute sync) and our registers. Three things read from it: the register API, a 5-minute Celery task (flag-gated) and a new admin endpoint `GET /api/lcup/followups/`. The frontend adds badges and a banner to the register, plus a `/ops/trials` page with two tabs and a sidebar count. No new table. The only migration is the notification event's choices list.

**Tech Stack:** Django 6 + DRF, Celery beat, Next.js (app router) + React Query, vitest.

**Spec:** None as a document (the owner: "spec=code"). The design was approved section by section in chat on 2026-10-20. It is summarised in memory `teacher-attendance-followups.md` and restated as Global Constraints below.

## Global Constraints

- **"adminga jo'natish" = the TEACHER sends the student to the admin.** No message to any admin, and no Telegram (owner: "Faqat bo'lim"). Admins see the /ops section only.
- **Teacher channel:** the platform only, meaning the in-app bell plus web/iOS push through the existing `notifications.services.notify`.
- **Timing:** one notification per class per lesson, as the lesson ENDS (`lesson_interval` end), while the register is still open. It closes `MARKING_GRACE_MINUTES` = 120 after the end. Nothing is sent when there is nothing to say.
- **Free trial = 1 lesson.** Setting `LCUP_FREE_TRIAL_LESSONS` (default `1`).
- **"Not activated"** means the lc-up membership still has `lcup_status == "trial"`. Activation happens in lc-up only; our only lc-up write is `POST /attendance`.
- **"Not on the platform"** means a live, non-frozen lc-up member of a CONFIRMED, non-deleted group whose class has no ACTIVE STUDENT seat for them. It is detected **automatically only**; there is no teacher "walk-in" button.
- **Compute live** (approach A): no alerts table. Resolved rows vanish on their own.
- **Kill switch:** `LCUP_ATTENDANCE_CHECKS_ENABLED`. Only the literal `"true"` turns it on, and it is off by default. It gates ONLY the notification. Badges, banner and /ops Trials are read-only and need no flag (they still require `LCUP_ENABLED`).
- **UI and notification text are English**, like the rest of the platform. The exact strings are in the tasks.
- **/ops Trials:** admin + super admin (`ADMIN_OPS_SECTIONS`); the API uses `IsGlobalAdmin`.
- **Commits:** authored by `Viltrumlik <viltrumlik@gmail.com>`, with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Where to work:** worktree `/Users/macbook/Projects/dsat-wt-followups`, branch `feat/attendance-followups`, off `origin/main` `6b3810f2`. Never switch or pull the primary checkout `/Users/macbook/Projects/DSAT-mock-exam`.
- **Backend test command** (no venv; every variable is required):
  `cd /Users/macbook/Projects/dsat-wt-followups/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test <label> --settings=config.settings_test_nomigrations -v 1`
  Only a literal `OK` line counts as green.
- **Frontend test command:** `cd /Users/macbook/Projects/dsat-wt-followups/frontend && npx vitest run <path>`

---

## File map

| File | Responsibility |
|---|---|
| `backend/lcup/followups.py` (new) | Trial seats, missing seats, pending count, and the lesson-end check (compose, due, send, preview). The single source. |
| `backend/lcup/conf.py` | `attendance_checks_enabled()`, `free_trial_lessons()` |
| `backend/config/settings.py`, `backend/.env.example` | The two settings, plus the beat entry `lcup-attendance-checks` |
| `backend/lcup/attendance_guard.py` | `trial_in_lcup(classroom, day)`, `not_on_list(classroom)`: what the register asks |
| `backend/classes/views_attendance.py` | Register payload: `lcup_trial` per row, `not_on_list` per session |
| `backend/notifications/constants.py` + migration `0006` | `EVENT_ATTENDANCE_CHECK` (CLASSROOM, pushed) |
| `backend/lcup/tasks.py` | `lcup.tasks.attendance_checks` |
| `backend/lcup/management/commands/attendance_check_preview.py` (new) | Read-only preview for the owner before the flag goes on |
| `backend/lcup/views.py`, `backend/lcup/urls.py` | `FollowupsView` at `followups/` |
| `backend/lcup/testing.py` | `FollowupsFixtureMixin`, shared by the follow-up tests |
| `backend/lcup/tests_followups.py`, `tests_followups_register.py`, `tests_followups_api.py` (new) | Backend tests |
| `frontend/src/features/classroom/attendanceApi.ts`, `pages/Attendance.tsx` | Register types, badges, banner, warning |
| `frontend/src/features/lcup/lcupApi.ts`, `lcupHooks.ts`, `LcupPanels.tsx` | Followups types, hook, two panels |
| `frontend/src/app/(ops)/ops/trials/page.tsx` (new) | The Trials page |
| `frontend/src/features/ops/shell/opsNav.ts`, `OpsSidebar.tsx`, `OpsShell.tsx`, `features/ops/adminScope.ts` | Nav item and count badge |
| Frontend tests | `AttendanceTrial.test.tsx`, `TrialsPanels.test.tsx`, `OpsSidebarCount.test.tsx`; updates to `opsNav.test.ts`, `OpsShell.test.tsx` |

---

### Task 1: Trial seats (`followups.trial_seats`) + settings

**Files:**
- Create: `backend/lcup/followups.py`
- Modify: `backend/lcup/conf.py` (append two functions)
- Modify: `backend/config/settings.py` (after `LCUP_DEBT_FREEZE_DAY`, ~line 311)
- Modify: `backend/.env.example` (next to the other `LCUP_*` lines)
- Modify: `backend/lcup/testing.py` (append `FollowupsFixtureMixin`)
- Test: `backend/lcup/tests_followups.py` (new)

**Interfaces:**
- Produces:
  - `lcup.conf.free_trial_lessons() -> int`
  - `lcup.conf.attendance_checks_enabled() -> bool`
  - `lcup.followups.live_memberships() -> QuerySet[LcupMembership]`
  - `TRIAL`, `FROZEN`, `ATTENDED`, `STATE_NOT_YET`, `STATE_CAME`, `STATE_USED`, `STATE_ORDER`
  - `trial_state(lessons: int) -> str`
  - `TrialSeat`, a frozen dataclass with fields `membership_id`, `name`, `user_id`, `classroom_id`, `since`, `lesson_dates` and properties `lessons`, `state`
  - `trial_seats(*, classroom=None, before: date | None = None) -> list[TrialSeat]`
  - `lcup.testing.FollowupsFixtureMixin`

- [ ] **Step 1: Add the shared fixture to `backend/lcup/testing.py`.** Append it at the end of the file and add the imports at the top.

```python
from datetime import date, datetime

from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink, LinkStatus
from users.models import User


class FollowupsFixtureMixin:
    """A class paired with lc-up (Mon/Wed/Fri 14:00–16:00, so its register closes at 18:00), its
    teacher, and helpers for lc-up seats and marks — the common ground of the follow-up tests
    (lcup.followups). Mix it in before ``TestCase``."""

    MONDAY = date(2026, 10, 19)
    #: Seats are taken well before every lesson the tests mark, so the register's own rule (a seat
    #: taken after a lesson is not on it) never hides a student.
    SEATED_AT = datetime(2026, 9, 1, 9, 0)

    def setUp(self):
        super().setUp()
        self.teacher = User.objects.create_user(
            None, password=None, username="teach", role="teacher", subject="math", first_name="Tess", last_name="Teacher"
        )
        self.admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        self.room = Classroom.objects.create(
            name="Middle G23", subject="MATH", lesson_days="ODD", lesson_time="14:00-16:00",
            created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN)
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=501, name="Middle G23 | Math", classroom=self.room, status=GroupLinkStatus.CONFIRMED
        )
        self._lcup_ids = iter(range(9001, 9999))

    def student(self, first, last, *, seat=True):
        user = User.objects.create_user(
            None, password=None, username=f"{first}{last}".lower(), role="student", first_name=first, last_name=last
        )
        if seat:
            seat_row = ClassroomMembership.objects.create(classroom=self.room, user=user, role=ClassroomMembership.ROLE_STUDENT)
            ClassroomMembership.objects.filter(pk=seat_row.pk).update(joined_at=timezone.make_aware(self.SEATED_AT))
        return user

    def lcup_member(self, name, *, user=None, status="active", since=None, link_status=None, group=None):
        link = LcupStudentLink.objects.create(
            lcup_student_id=next(self._lcup_ids), name=name, user=user,
            status=link_status or (LinkStatus.CONFIRMED if user else LinkStatus.UNMATCHED),
        )
        return LcupMembership.objects.create(group=group or self.group, student=link, lcup_status=status, start_date=since)

    def mark(self, day, user, status):
        session, _ = AttendanceSession.objects.get_or_create(
            classroom=self.room, date=day, defaults={"created_by": self.teacher}
        )
        record, _ = AttendanceRecord.objects.update_or_create(session=session, student=user, defaults={"status": status})
        return record
```

- [ ] **Step 2: Write the failing tests** in `backend/lcup/tests_followups.py`

```python
from datetime import date, datetime

from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.followups import STATE_CAME, STATE_NOT_YET, STATE_USED, trial_seats
from lcup.models import GroupLinkStatus, LcupGroupLink
from lcup.testing import FollowupsFixtureMixin


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class TrialSeatTests(FollowupsFixtureMixin, TestCase):
    def test_lessons_are_the_ones_come_to_in_this_class_since_the_trial_began(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 9), ali, "PRESENT")   # before lc-up started the trial
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(date(2026, 10, 14), ali, "ABSENT")   # not a lesson come to
        self.mark(date(2026, 10, 16), ali, "LATE")
        [seat] = trial_seats()
        self.assertEqual(seat.lesson_dates, (date(2026, 10, 12), date(2026, 10, 16)))
        self.assertEqual(seat.lessons, 2)
        self.assertEqual(seat.state, STATE_USED)
        self.assertEqual((seat.user_id, seat.classroom_id, seat.name), (ali.pk, self.room.pk, "Ali Valiyev"))

    def test_states_follow_the_free_trial(self):
        none, once, twice = self.student("No", "Show"), self.student("Came", "Once"), self.student("Came", "Twice")
        for user in (none, once, twice):
            self.lcup_member(f"{user.first_name} {user.last_name}", user=user, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), once, "PRESENT")
        self.mark(date(2026, 10, 12), twice, "PRESENT")
        self.mark(date(2026, 10, 14), twice, "PRESENT")
        states = {seat.user_id: seat.state for seat in trial_seats()}
        self.assertEqual(states, {none.pk: STATE_NOT_YET, once.pk: STATE_CAME, twice.pk: STATE_USED})

    @override_settings(LCUP_FREE_TRIAL_LESSONS=2)
    def test_the_free_trial_length_is_a_setting(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(date(2026, 10, 14), ali, "PRESENT")
        self.assertEqual(trial_seats()[0].state, STATE_CAME)

    def test_before_counts_only_earlier_lessons(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(self.MONDAY, ali, "PRESENT")
        self.assertEqual(trial_seats(before=self.MONDAY)[0].lessons, 1)

    def test_a_missing_start_date_falls_back_to_when_lc_up_added_them(self):
        ali = self.student("Ali", "Valiyev")
        member = self.lcup_member("Ali Valiyev", user=ali, status="trial")
        member.joined_at = timezone.make_aware(datetime(2026, 10, 14, 10, 0))
        member.save(update_fields=["joined_at"])
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(date(2026, 10, 14), ali, "PRESENT")
        [seat] = trial_seats()
        self.assertEqual((seat.since, seat.lessons), (date(2026, 10, 14), 1))

    def test_only_live_trial_seats_of_paired_groups(self):
        self.lcup_member("Active One", user=self.student("Active", "One"), status="active")
        gone = self.lcup_member("Left One", user=self.student("Left", "One"), status="trial")
        gone.left_at = timezone.now()
        gone.save(update_fields=["left_at"])
        deleted = LcupGroupLink.objects.create(
            lcup_group_id=502, name="Old", status=GroupLinkStatus.CONFIRMED, deleted_in_lcup_at=timezone.now()
        )
        self.lcup_member("Old Group", status="trial", group=deleted)
        unpaired = LcupGroupLink.objects.create(lcup_group_id=503, name="Unpaired", status=GroupLinkStatus.SUGGESTED)
        self.lcup_member("Unpaired Group", status="trial", group=unpaired)
        self.assertEqual(trial_seats(), [])

    def test_a_trial_student_with_no_account_has_come_to_nothing_here(self):
        self.lcup_member("Jasur Toshmatov", status="trial", since=date(2026, 10, 12))
        [seat] = trial_seats()
        self.assertEqual((seat.user_id, seat.lessons, seat.state), (None, 0, STATE_NOT_YET))

    def test_classroom_narrows_to_one_class(self):
        self.lcup_member("Ali Valiyev", user=self.student("Ali", "Valiyev"), status="trial")
        self.assertEqual(len(trial_seats(classroom=self.room)), 1)
        other = type(self.room).objects.create(
            name="Other", subject="MATH", lesson_days="EVEN", created_by=self.teacher, teacher=self.teacher
        )
        self.assertEqual(trial_seats(classroom=other), [])

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_while_the_integration_is_off(self):
        self.lcup_member("Ali Valiyev", user=self.student("Ali", "Valiyev"), status="trial")
        self.assertEqual(trial_seats(), [])
```

- [ ] **Step 3: Run them and see them fail**

Run: `... python3 manage.py test lcup.tests_followups --settings=config.settings_test_nomigrations -v 1`
Expected: `ModuleNotFoundError: No module named 'lcup.followups'`

- [ ] **Step 4: Add the settings.** In `backend/config/settings.py`, right after `LCUP_DEBT_FREEZE_DAY = …`:

```python
# Follow-ups (docs/superpowers/plans/2026-10-20-attendance-followups.md): as a paired class's lesson ends, its
# teachers get one notification — absent without a reason, the free trial used, lc-up members missing from the
# list. Off by default; literal "true" only. The free trial is this many lessons (the owner: one).
LCUP_ATTENDANCE_CHECKS_ENABLED = os.getenv("LCUP_ATTENDANCE_CHECKS_ENABLED", "False").lower() == "true"
LCUP_FREE_TRIAL_LESSONS = int(os.getenv("LCUP_FREE_TRIAL_LESSONS", "1") or 1)
```

In `backend/.env.example`, next to the other `LCUP_*` lines:

```
# Lesson-end notification to teachers (absent without a reason, free trial used, not on the list). Off by default.
LCUP_ATTENDANCE_CHECKS_ENABLED=False
# How many lessons the free trial is.
LCUP_FREE_TRIAL_LESSONS=1
```

Append to `backend/lcup/conf.py`:

```python
def attendance_checks_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ATTENDANCE_CHECKS_ENABLED", False))


def free_trial_lessons() -> int:
    """How many lessons a trial student comes to for free (owner, 2026-10-20: one — "birinchi darsda")."""
    try:
        lessons = int(getattr(settings, "LCUP_FREE_TRIAL_LESSONS", 1))
    except (TypeError, ValueError):
        lessons = 1
    return max(lessons, 0)
```

- [ ] **Step 5: Create `backend/lcup/followups.py`**

```python
"""What follows a lesson up, for its teachers and for the front desk (owner, 2026-10-20).

Three questions, answered here and nowhere else, so the register, the lesson-end notification and
/ops/trials cannot disagree:

1. **Trial seats.** A student lc-up still holds on ``trial`` in a group, with the lessons they came
   to in its class since lc-up started the trial. The free trial is ``LCUP_FREE_TRIAL_LESSONS``
   lessons (the owner: one). A trial student who comes again after it has had it, so the teacher
   sends them to the admin, who activates them in lc-up. "adminga jo'natish" is the teacher's
   errand; nothing here messages an admin.
2. **Not on the class list.** A live, non-frozen lc-up member of a paired group with no active
   seat in its class. The register cannot show them, so the teacher cannot mark them, and the
   group's push to lc-up is held for them (``attendance.push_held_reason``).
3. **The lesson-end check.** What one class's teachers are told when its lesson ends: once, while
   the register is still open.

Everything is computed from what is stored: lc-up's memberships (refreshed by the 15-minute sync)
and our registers. A student the admin activates or links simply stops appearing. Nothing here
writes except ``send_lesson_checks``, which writes notifications.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceRecord

from .conf import free_trial_lessons, lcup_enabled
from .models import GroupLinkStatus, LcupMembership

TRIAL = "trial"
FROZEN = "frozen"
#: The marks that mean the student came to the lesson.
ATTENDED = (AttendanceRecord.STATUS_PRESENT, AttendanceRecord.STATUS_LATE)

STATE_NOT_YET = "not_yet"
STATE_CAME = "came"
STATE_USED = "used"
#: /ops/trials lists the ones that need the desk first.
STATE_ORDER = {STATE_USED: 0, STATE_CAME: 1, STATE_NOT_YET: 2}


def live_memberships():
    """lc-up's current members of the groups paired with a class of ours."""
    return LcupMembership.objects.filter(
        left_at__isnull=True,
        group__status=GroupLinkStatus.CONFIRMED,
        group__deleted_in_lcup_at__isnull=True,
        group__classroom__isnull=False,
        student__deleted_in_lcup=False,
    )


def trial_state(lessons: int) -> str:
    if lessons <= 0:
        return STATE_NOT_YET
    return STATE_CAME if lessons <= free_trial_lessons() else STATE_USED


@dataclass(frozen=True)
class TrialSeat:
    membership_id: int
    #: lc-up's name for them — a trial student may have no account here yet.
    name: str
    user_id: int | None
    classroom_id: int
    #: When lc-up started the trial (its start_date, else when it added them), or None.
    since: date | None
    #: The lessons of this class they came to since then, oldest first.
    lesson_dates: tuple[date, ...]

    @property
    def lessons(self) -> int:
        return len(self.lesson_dates)

    @property
    def state(self) -> str:
        return trial_state(self.lessons)


def _since(membership) -> date | None:
    if membership.start_date:
        return membership.start_date
    return timezone.localdate(membership.joined_at) if membership.joined_at else None


def trial_seats(*, classroom=None, before: date | None = None) -> list[TrialSeat]:
    """Every live trial seat (of ``classroom`` only, when given). ``before`` counts only the lessons
    held before that day — the register asks "had they had the free trial when this lesson began?"."""
    if not lcup_enabled():
        return []
    memberships = live_memberships().filter(lcup_status=TRIAL).select_related("student", "group")
    if classroom is not None:
        memberships = memberships.filter(group__classroom=classroom)
    seats = []
    for membership in memberships.order_by("pk"):
        since = _since(membership)
        user_id = membership.student.user_id
        dates: tuple[date, ...] = ()
        if user_id:
            records = AttendanceRecord.objects.filter(
                student_id=user_id, session__classroom_id=membership.group.classroom_id, status__in=ATTENDED
            )
            if since is not None:
                records = records.filter(session__date__gte=since)
            if before is not None:
                records = records.filter(session__date__lt=before)
            dates = tuple(sorted(records.values_list("session__date", flat=True)))
        seats.append(
            TrialSeat(membership.pk, membership.student.name.strip(), user_id, membership.group.classroom_id, since, dates)
        )
    return seats
```

(`ClassroomMembership` is imported now for Task 2. Leave it in.)

- [ ] **Step 6: Run the tests and see them pass**

Run: `... python3 manage.py test lcup.tests_followups --settings=config.settings_test_nomigrations -v 1`
Expected: `Ran 9 tests … OK`

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-followups
git add backend/lcup/followups.py backend/lcup/conf.py backend/lcup/testing.py backend/lcup/tests_followups.py backend/config/settings.py backend/.env.example
git commit -m "feat(lcup): trial seats — lessons a trial student came to since lc-up began the trial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Members missing from the class list (`followups.missing_seats`, `pending`)

**Files:**
- Modify: `backend/lcup/followups.py` (append)
- Test: `backend/lcup/tests_followups.py` (append a class)

**Interfaces:**
- Consumes: `live_memberships`, `_since`, `FROZEN`, `trial_seats`, `STATE_NOT_YET` (Task 1)
- Produces:
  - `REASON_NEEDS_REVIEW`, `REASON_IGNORED`, `REASON_NO_ACCOUNT`, `REASON_NOT_SEATED`, `REASON_TEXT: dict[str, str]`
  - `MissingSeat`, a frozen dataclass with fields `lcup_student_id`, `name`, `phone`, `user_id`, `classroom_id`, `lcup_status`, `since`, `reason`
  - `missing_seats(*, classroom=None) -> list[MissingSeat]`
  - `pending(seats: list[TrialSeat], missing: list[MissingSeat]) -> int`

- [ ] **Step 1: Write the failing tests.** Append them to `backend/lcup/tests_followups.py`. Change the followups import to `from lcup.followups import (REASON_IGNORED, REASON_NEEDS_REVIEW, REASON_NO_ACCOUNT, REASON_NOT_SEATED, STATE_CAME, STATE_NOT_YET, STATE_USED, missing_seats, pending, trial_seats)`, and add `from classes.models import ClassroomMembership` and `from lcup.models import LinkStatus`.

```python
@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class MissingSeatTests(FollowupsFixtureMixin, TestCase):
    def test_a_seated_member_is_not_missing(self):
        self.lcup_member("Ali Valiyev", user=self.student("Ali", "Valiyev"))
        self.assertEqual(missing_seats(), [])

    def test_why_each_member_is_missing(self):
        self.lcup_member("Linked NoSeat", user=self.student("Linked", "NoSeat", seat=False))
        self.lcup_member("In Review", link_status=LinkStatus.NEEDS_REVIEW)
        self.lcup_member("Was Ignored", link_status=LinkStatus.IGNORED)
        self.lcup_member("Brand New")
        reasons = {seat.name: seat.reason for seat in missing_seats()}
        self.assertEqual(reasons, {
            "Linked NoSeat": REASON_NOT_SEATED,
            "In Review": REASON_NEEDS_REVIEW,
            "Was Ignored": REASON_IGNORED,
            "Brand New": REASON_NO_ACCOUNT,
        })

    def test_a_removed_seat_is_no_seat(self):
        ali = self.student("Ali", "Valiyev")
        ClassroomMembership.objects.filter(user=ali).update(status=ClassroomMembership.STATUS_REMOVED)
        self.lcup_member("Ali Valiyev", user=ali)
        self.assertEqual([seat.reason for seat in missing_seats()], [REASON_NOT_SEATED])

    def test_a_frozen_member_is_not_expected_on_the_list(self):
        self.lcup_member("Frozen One", status="frozen")
        self.assertEqual(missing_seats(), [])

    def test_a_trial_member_missing_is_listed_with_its_status(self):
        self.lcup_member("Jasur Toshmatov", status="trial", since=date(2026, 10, 19))
        [seat] = missing_seats()
        self.assertEqual((seat.lcup_status, seat.since, seat.classroom_id), ("trial", date(2026, 10, 19), self.room.pk))

    def test_pending_counts_what_waits_on_the_desk(self):
        came = self.student("Came", "Once")
        self.lcup_member("Came Once", user=came, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), came, "PRESENT")
        self.lcup_member("Not Yet", user=self.student("Not", "Yet"), status="trial")
        self.lcup_member("Brand New")
        self.assertEqual(pending(trial_seats(), missing_seats()), 2)

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_while_the_integration_is_off(self):
        self.lcup_member("Brand New")
        self.assertEqual(missing_seats(), [])
```

- [ ] **Step 2: Run them and see them fail**

Expected: `ImportError: cannot import name 'REASON_IGNORED'`

- [ ] **Step 3: Append to `backend/lcup/followups.py`** (add `LinkStatus` to the `.models` import)

```python
REASON_NEEDS_REVIEW = "needs_review"
REASON_IGNORED = "ignored"
REASON_NO_ACCOUNT = "no_account"
REASON_NOT_SEATED = "not_seated"

#: What /ops/trials says about each — the admin fixes it where the sentence points.
REASON_TEXT = {
    REASON_NEEDS_REVIEW: "Their account match waits for review in lc-up → Students.",
    REASON_IGNORED: "Marked “ignored” in lc-up → Students.",
    REASON_NO_ACCOUNT: "No account here yet — the next lc-up sync creates one.",
    REASON_NOT_SEATED: "Has an account here, but no seat in this class.",
}


@dataclass(frozen=True)
class MissingSeat:
    lcup_student_id: int
    name: str
    phone: str
    user_id: int | None
    classroom_id: int
    lcup_status: str
    since: date | None
    reason: str


def missing_seats(*, classroom=None) -> list[MissingSeat]:
    """lc-up members of paired groups (not frozen — lc-up takes no attendance for them) with no active
    student seat in the paired class, each with why."""
    if not lcup_enabled():
        return []
    memberships = live_memberships().exclude(lcup_status=FROZEN).select_related("student", "group")
    if classroom is not None:
        memberships = memberships.filter(group__classroom=classroom)
    memberships = list(memberships.order_by("group__classroom_id", "student__name"))
    seated = set(
        ClassroomMembership.objects.filter(
            classroom_id__in={m.group.classroom_id for m in memberships},
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        ).values_list("classroom_id", "user_id")
    )
    missing = []
    for membership in memberships:
        link = membership.student
        if link.user_id and (membership.group.classroom_id, link.user_id) in seated:
            continue
        if link.user_id:
            reason = REASON_NOT_SEATED
        elif link.status == LinkStatus.NEEDS_REVIEW:
            reason = REASON_NEEDS_REVIEW
        elif link.status == LinkStatus.IGNORED:
            reason = REASON_IGNORED
        else:
            reason = REASON_NO_ACCOUNT
        missing.append(
            MissingSeat(
                link.lcup_student_id, link.name.strip(), link.phone, link.user_id,
                membership.group.classroom_id, membership.lcup_status, _since(membership), reason,
            )
        )
    return missing


def pending(seats: list[TrialSeat], missing: list[MissingSeat]) -> int:
    """What waits on the front desk: trial students who came (the free lesson or more), and every
    member missing from a class list. A trial student who has not come yet waits on nobody."""
    return sum(1 for seat in seats if seat.state != STATE_NOT_YET) + len(missing)
```

- [ ] **Step 4: Run the tests and see them pass**

Expected: `Ran 16 tests … OK`

- [ ] **Step 5: Commit**

```bash
git add backend/lcup/followups.py backend/lcup/tests_followups.py
git commit -m "feat(lcup): lc-up members missing from their class list, and why

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The register API carries trial state and the missing members

**Files:**
- Modify: `backend/lcup/attendance_guard.py` (append two functions; extend its imports)
- Modify: `backend/classes/views_attendance.py` (`AttendanceSessionDetailView.get` ~lines 158–187, plus two helpers next to `_frozen_in_lcup`)
- Test: `backend/lcup/tests_followups_register.py` (new)

**Interfaces:**
- Consumes: `trial_seats`, `missing_seats` (Tasks 1–2), `free_trial_lessons`
- Produces:
  - `lcup.attendance_guard.trial_in_lcup(classroom, day) -> dict[int, dict]`, where each value is `{"lessons_before": int, "free_used": bool}`
  - `lcup.attendance_guard.not_on_list(classroom) -> list[dict]`, where each item is `{"name": str}`
  - Register JSON: each roster row gains `"lcup_trial": {"lessons_before", "free_used"} | null`, and the session gains `"not_on_list": [{"name"}]`

- [ ] **Step 1: Write the failing tests** in `backend/lcup/tests_followups_register.py`

```python
from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models_attendance import AttendanceSession
from lcup.models import LcupGroupLink
from lcup.testing import FollowupsFixtureMixin


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class RegisterFollowupsTests(FollowupsFixtureMixin, TestCase):
    def register(self, day):
        session, _ = AttendanceSession.objects.get_or_create(classroom=self.room, date=day, defaults={"created_by": self.teacher})
        api = APIClient()
        api.force_authenticate(self.teacher)
        response = api.get(f"/api/classes/{self.room.pk}/attendance/sessions/{session.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def row(self, payload, user):
        return next(r for r in payload["roster"] if r["student_id"] == user.pk)

    def test_a_trial_student_on_their_first_lesson_then_after_the_free_one(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 14))
        first = self.register(date(2026, 10, 14))
        self.assertEqual(self.row(first, ali)["lcup_trial"], {"lessons_before": 0, "free_used": False})
        self.mark(date(2026, 10, 14), ali, "PRESENT")
        second = self.register(date(2026, 10, 16))
        self.assertEqual(self.row(second, ali)["lcup_trial"], {"lessons_before": 1, "free_used": True})

    def test_an_active_student_has_no_trial(self):
        bek = self.student("Bek", "Rahimov")
        self.lcup_member("Bek Rahimov", user=bek)
        self.assertIsNone(self.row(self.register(self.MONDAY), bek)["lcup_trial"])

    def test_the_register_names_lc_up_members_it_cannot_show(self):
        self.lcup_member("Jasur Toshmatov", status="trial")
        self.assertEqual(self.register(self.MONDAY)["not_on_list"], [{"name": "Jasur Toshmatov"}])

    def test_a_class_lc_up_does_not_run_has_neither(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial")
        self.lcup_member("Jasur Toshmatov")
        LcupGroupLink.objects.update(classroom=None)
        payload = self.register(self.MONDAY)
        self.assertIsNone(self.row(payload, ali)["lcup_trial"])
        self.assertEqual(payload["not_on_list"], [])
```

- [ ] **Step 2: Run them and see them fail**

Run: `... python3 manage.py test lcup.tests_followups_register --settings=config.settings_test_nomigrations -v 1`
Expected: `KeyError: 'lcup_trial'`

- [ ] **Step 3: Append to `backend/lcup/attendance_guard.py`.** First change its imports to `from .conf import attendance_pull_enabled, free_trial_lessons` and add `from .followups import missing_seats, trial_seats`.

```python
def trial_in_lcup(classroom, day) -> dict[int, dict]:
    """Our user ids lc-up holds on trial in this class's group, with the lessons each came to here
    before ``day``. ``free_used``: they have had the free trial, so the teacher sends them to the
    admin (owner, 2026-10-20). Empty for a class lc-up does not run."""
    if not is_lcup_managed(classroom):
        return {}
    free = free_trial_lessons()
    return {
        seat.user_id: {"lessons_before": seat.lessons, "free_used": seat.lessons >= free}
        for seat in trial_seats(classroom=classroom, before=day)
        if seat.user_id
    }


def not_on_list(classroom) -> list[dict]:
    """lc-up members of this class's group the register cannot show — the teacher sends them to the admin."""
    if not is_lcup_managed(classroom):
        return []
    return [{"name": seat.name} for seat in missing_seats(classroom=classroom)]
```

- [ ] **Step 4: Wire them into `backend/classes/views_attendance.py`.**
  1. In `AttendanceSessionDetailView.get`, after `frozen = _frozen_in_lcup(classroom)`, add `trial = _trial_in_lcup(classroom, session.date)`.
  2. After the `"frozen_in_lcup": m.user_id in frozen,` line, add:

```python
                # On trial in lc-up: lessons come to before this one, and whether the free trial is
                # behind them (owner, 2026-10-20: the teacher sends them to the admin). None otherwise.
                "lcup_trial": trial.get(m.user_id),
```

  3. After `"excuse_reasons": _excuse_reasons(classroom),`, add:

```python
            # lc-up members of this group with no seat here: the teacher sends them to the admin.
            "not_on_list": _not_on_list(classroom),
```

  4. Next to `_frozen_in_lcup`, add:

```python
def _trial_in_lcup(classroom, day) -> dict[int, dict]:
    from lcup.attendance_guard import trial_in_lcup

    return trial_in_lcup(classroom, day)


def _not_on_list(classroom) -> list[dict]:
    from lcup.attendance_guard import not_on_list

    return not_on_list(classroom)
```

- [ ] **Step 5: Run the new tests and the register's existing ones**

First list the register test modules: `ls backend/classes | grep -i "tests.*attendance"`. Then run them together with the new ones:
`... python3 manage.py test lcup.tests_followups_register lcup.tests_followups lcup.tests_attendance_sync <the classes attendance test modules> --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/lcup/attendance_guard.py backend/classes/views_attendance.py backend/lcup/tests_followups_register.py
git commit -m "feat(attendance): the register knows lc-up trial students and the members it cannot show

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The lesson-end check (`followups.lesson_check`)

**Files:**
- Modify: `backend/lcup/followups.py` (append)
- Test: `backend/lcup/tests_followups.py` (append a class)

**Interfaces:**
- Consumes: `trial_seats`, `missing_seats`, `ATTENDED`, `free_trial_lessons`, `attendance_guard.frozen_in_lcup`, `classes.attendance_window.marking_window`, `lcup.serializers.user_ref`
- Produces:
  - `LessonCheck`, a frozen dataclass with fields `classroom_id`, `classroom_name`, `day`, `closes_at`, `taken`, `unmarked`, `absent`, `trial_used`, `not_on_list` and properties `is_empty`, `title`, `body`
  - `lesson_check(classroom, day: date) -> LessonCheck`

- [ ] **Step 1: Write the failing tests.** Append them, and add `lesson_check` to the followups import.

```python
@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class LessonCheckTests(FollowupsFixtureMixin, TestCase):
    def test_everything_the_teacher_should_look_at_in_one_message(self):
        ali, bek = self.student("Ali", "Valiyev"), self.student("Bek", "Rahimov")
        self.student("Dilnoza", "Karimova")
        sardor = self.student("Sardor", "Nazarov")
        self.lcup_member("Sardor Nazarov", user=sardor, status="trial", since=date(2026, 10, 14))
        self.mark(date(2026, 10, 16), sardor, "PRESENT")   # the free lesson
        self.mark(self.MONDAY, ali, "PRESENT")
        self.mark(self.MONDAY, bek, "ABSENT")
        self.mark(self.MONDAY, sardor, "PRESENT")
        self.lcup_member("Jasur Toshmatov")
        check = lesson_check(self.room, self.MONDAY)
        self.assertEqual(check.title, "Middle G23 — check today's register")
        self.assertEqual(
            check.body,
            "Not marked: Dilnoza Karimova — mark them before 18:00. "
            "Absent: Bek Rahimov — if excused, set the reason before 18:00. "
            "Free trial used: Sardor Nazarov — send to the admin. "
            "Not on your list: Jasur Toshmatov — send to the admin.",
        )
        self.assertFalse(check.is_empty)

    def test_a_register_nobody_took(self):
        self.student("Ali", "Valiyev")
        self.assertEqual(lesson_check(self.room, self.MONDAY).body, "Register not taken yet — mark it before 18:00.")

    def test_a_clean_register_says_nothing(self):
        self.mark(self.MONDAY, self.student("Ali", "Valiyev"), "PRESENT")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_an_excused_absence_is_not_asked_about(self):
        self.mark(self.MONDAY, self.student("Ali", "Valiyev"), "EXCUSED")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_a_trial_student_on_the_free_lesson_is_not_sent_away(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=self.MONDAY)
        self.mark(self.MONDAY, ali, "PRESENT")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_a_student_frozen_in_lc_up_is_not_unmarked(self):
        ali, frozen = self.student("Ali", "Valiyev"), self.student("Frozen", "One")
        self.lcup_member("Frozen One", user=frozen, status="frozen")
        self.mark(self.MONDAY, ali, "PRESENT")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_long_lists_are_cut_after_four_names(self):
        self.mark(self.MONDAY, self.student("Keep", "Present"), "PRESENT")
        for first in ("Aa", "Bb", "Cc", "Dd", "Ee", "Ff"):
            self.mark(self.MONDAY, self.student(first, "Absent"), "ABSENT")
        self.assertIn(
            "Absent: Aa Absent, Bb Absent, Cc Absent, Dd Absent +2 more — if excused",
            lesson_check(self.room, self.MONDAY).body,
        )

    def test_an_empty_class_says_nothing(self):
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)
```

- [ ] **Step 2: Run them and see them fail**

Expected: `ImportError: cannot import name 'lesson_check'`

- [ ] **Step 3: Append to `backend/lcup/followups.py`.** Change the datetime import to `from datetime import date, datetime` and add `from .serializers import user_ref`.

```python
#: A message names this many people per line, then "+N more" — the register has the rest.
NAMES_SHOWN = 4


def _names(names) -> str:
    names = list(names)
    shown = ", ".join(names[:NAMES_SHOWN])
    extra = len(names) - NAMES_SHOWN
    return f"{shown} +{extra} more" if extra > 0 else shown


@dataclass(frozen=True)
class LessonCheck:
    classroom_id: int
    classroom_name: str
    day: date
    closes_at: datetime
    #: Whether the register holds any mark at all (or has nobody to mark).
    taken: bool
    unmarked: tuple[str, ...]
    absent: tuple[str, ...]
    trial_used: tuple[str, ...]
    not_on_list: tuple[str, ...]

    @property
    def is_empty(self) -> bool:
        return self.taken and not (self.unmarked or self.absent or self.trial_used or self.not_on_list)

    @property
    def title(self) -> str:
        return f"{self.classroom_name} — check today's register"[:160]

    @property
    def body(self) -> str:
        close = timezone.localtime(self.closes_at).strftime("%H:%M")
        parts = []
        if not self.taken:
            parts.append(f"Register not taken yet — mark it before {close}.")
        elif self.unmarked:
            parts.append(f"Not marked: {_names(self.unmarked)} — mark them before {close}.")
        if self.absent:
            parts.append(f"Absent: {_names(self.absent)} — if excused, set the reason before {close}.")
        if self.trial_used:
            parts.append(f"Free trial used: {_names(self.trial_used)} — send to the admin.")
        if self.not_on_list:
            parts.append(f"Not on your list: {_names(self.not_on_list)} — send to the admin.")
        return " ".join(parts)[:400]


def _roster(classroom, day: date):
    """The register's own roster rule (``classes.views_attendance._active_students``): active
    student seats taken on or before the lesson's local date."""
    seats = ClassroomMembership.objects.filter(
        classroom=classroom, role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE
    ).select_related("user")
    return [seat.user for seat in seats if timezone.localdate(seat.joined_at) <= day]


def lesson_check(classroom, day: date) -> LessonCheck:
    """What this class's teachers are told when the lesson of ``day`` ends."""
    from classes.attendance_window import marking_window
    from classes.models_attendance import AttendanceSession

    from .attendance_guard import frozen_in_lcup

    roster = _roster(classroom, day)
    names = {user.pk: user_ref(user)["name"] for user in roster}
    frozen = frozen_in_lcup(classroom)
    markable = [user.pk for user in roster if user.pk not in frozen]
    session = AttendanceSession.objects.filter(classroom=classroom, date=day).first()
    records = dict(session.records.values_list("student_id", "status")) if session else {}
    free = free_trial_lessons()
    trial_used = [
        names[seat.user_id]
        for seat in trial_seats(classroom=classroom, before=day)
        if seat.user_id in names and seat.lessons >= free and records.get(seat.user_id) in ATTENDED
    ]
    return LessonCheck(
        classroom_id=classroom.pk,
        classroom_name=classroom.name,
        day=day,
        closes_at=marking_window(classroom, day)[1],
        taken=bool(records) or not markable,
        unmarked=tuple(sorted(names[uid] for uid in markable if uid not in records)),
        absent=tuple(sorted(
            names[uid] for uid, status in records.items() if status == AttendanceRecord.STATUS_ABSENT and uid in names
        )),
        trial_used=tuple(sorted(trial_used)),
        not_on_list=tuple(seat.name for seat in missing_seats(classroom=classroom)),
    )
```

The import cycle is safe: `attendance_guard` imports `followups` at module level, and `followups` imports `attendance_guard` only inside `lesson_check`.

- [ ] **Step 4: Run the tests and see them pass**

Expected: `Ran 24 tests … OK`. The 18:00 in the expected body assumes `TIME_ZONE` = Asia/Tashkent and a 14:00–16:00 lesson. If the hour comes out different, print `timezone.get_current_timezone()` under the test settings before touching any code.

- [ ] **Step 5: Commit**

```bash
git add backend/lcup/followups.py backend/lcup/tests_followups.py
git commit -m "feat(lcup): the lesson-end check — absent, not marked, free trial used, not on the list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Send it as the lesson ends (event, task, beat, flag)

**Files:**
- Modify: `backend/notifications/constants.py`
- Create: `backend/notifications/migrations/0006_attendance_check_event.py` (generated)
- Modify: `backend/lcup/followups.py` (append)
- Modify: `backend/lcup/tasks.py` (append a task)
- Modify: `backend/config/settings.py` (beat entry after `"lcup-sync"`)
- Test: `backend/lcup/tests_followups.py` (append a class)

**Interfaces:**
- Consumes: `lesson_check`, `attendance_checks_enabled`, `notifications.services.notify`
- Produces:
  - `notifications.constants.EVENT_ATTENDANCE_CHECK = "ATTENDANCE_CHECK"`
  - `followups.CHECK_GRACE_MINUTES = 30`
  - `followups.due_lessons(now) -> list[tuple[Classroom, date]]`
  - `followups.teachers_of(classroom) -> list[User]`
  - `followups.check_key(classroom_id, day) -> str`
  - `followups.send_lesson_checks(*, now=None) -> dict`
  - Celery task `lcup.tasks.attendance_checks`

- [ ] **Step 1: Write the failing tests.** Append them, and add `from notifications.models import Notification`, `from users.models import User` and `send_lesson_checks` to the imports.

```python
def at(day, hour, minute):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour, minute))


@override_settings(LCUP_ENABLED=True, LCUP_ATTENDANCE_CHECKS_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class SendLessonChecksTests(FollowupsFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.bek = self.student("Bek", "Rahimov")
        self.mark(self.MONDAY, self.bek, "ABSENT")

    def sent(self):
        return Notification.objects.filter(event="ATTENDANCE_CHECK")

    def staff(self, username, role):
        user = User.objects.create_user(None, password=None, username=username, role="teacher", subject="math")
        ClassroomMembership.objects.create(classroom=self.room, user=user, role=role)
        return user

    def test_the_teacher_is_told_once_as_the_lesson_ends(self):
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"classes": 1, "notified": 1})
        [row] = self.sent()
        self.assertEqual(row.recipient, self.teacher)
        self.assertEqual(row.category, "CLASSROOM")
        self.assertEqual(row.link_url, f"/classes/{self.room.pk}?tab=attendance")
        self.assertEqual(row.dedupe_key, f"attcheck:{self.room.pk}:2026-10-19")
        self.assertIn("Absent: Bek Rahimov", row.body)
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 10)), {"already_sent": 1})
        self.assertEqual(self.sent().count(), 1)

    def test_only_inside_the_half_hour_after_the_lesson(self):
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 15, 55)), {})
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 31)), {})
        self.assertFalse(self.sent().exists())

    def test_not_on_a_day_the_class_does_not_meet(self):
        self.assertEqual(send_lesson_checks(now=at(date(2026, 10, 20), 16, 5)), {})

    def test_a_clean_register_sends_nothing(self):
        self.mark(self.MONDAY, self.bek, "PRESENT")
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"clean": 1})
        self.assertFalse(self.sent().exists())

    def test_every_teacher_of_the_class_and_no_assistant(self):
        second = self.staff("second", ClassroomMembership.ROLE_TEACHER)
        self.staff("helper", ClassroomMembership.ROLE_TA)
        send_lesson_checks(now=at(self.MONDAY, 16, 5))
        self.assertEqual(set(self.sent().values_list("recipient_id", flat=True)), {self.teacher.pk, second.pk})

    @override_settings(LCUP_ATTENDANCE_CHECKS_ENABLED=False)
    def test_nothing_while_the_switch_is_off(self):
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"skipped": "off"})
        self.assertFalse(self.sent().exists())
```

- [ ] **Step 2: Run them and see them fail**

Expected: `ImportError: cannot import name 'send_lesson_checks'`

- [ ] **Step 3: Add the event to `backend/notifications/constants.py`.**
  1. After `EVENT_STRIKE_LOST = "STRIKE_LOST"`, add:

```python
#: A paired class's lesson has ended and its register wants a look: absent without a reason, a
#: trial student who has had the free lesson, an lc-up member missing from the list (owner,
#: 2026-10-20). Teachers only; one per class per lesson (lcup.followups).
EVENT_ATTENDANCE_CHECK = "ATTENDANCE_CHECK"
```

  2. In `EVENT_CATEGORY`, after the `EVENT_COMMENT_REPLY` line, add `EVENT_ATTENDANCE_CHECK: CATEGORY_CLASSROOM,`.
  3. In `PUSH_EVENTS`, before the closing `})`, add:

```python
    # The register closes two hours after the lesson; a teacher who has left the room needs it now.
    EVENT_ATTENDANCE_CHECK,
```

- [ ] **Step 4: Generate the migration**

Run: `cd backend && SECRET_KEY=test-secret DEBUG=True python3 manage.py makemigrations notifications -n attendance_check_event`
Expected: `backend/notifications/migrations/0006_attendance_check_event.py`, holding a single `AlterField` on `notification.event` (choices). Open it and confirm there is no other operation. If the command asks for a database, prefix it with `DATABASE_URL=sqlite:////tmp/mk-followups.sqlite3`.

- [ ] **Step 5: Append to `backend/lcup/followups.py`.** Add `import logging`, `from collections import Counter`, change the datetime import to `from datetime import date, datetime, timedelta`, and add `attendance_checks_enabled` to the `.conf` import.

```python
logger = logging.getLogger("lcup.followups")

#: How long after a lesson ends its check may still go out: a beat that missed a run (a restart, a
#: slow worker) catches up, but a lesson is never announced long after the teacher has left.
CHECK_GRACE_MINUTES = 30


def due_lessons(now) -> list[tuple]:
    """``(classroom, day)`` of each paired class whose lesson ended in the last CHECK_GRACE_MINUTES
    and whose register is still open."""
    from classes.attendance_window import marking_window
    from classes.lesson_schedule import lesson_interval, lesson_weekdays
    from classes.models import Classroom

    day = timezone.localdate(now)
    rooms = Classroom.objects.filter(
        is_active=True,
        lcup_group_link__status=GroupLinkStatus.CONFIRMED,
        lcup_group_link__deleted_in_lcup_at__isnull=True,
    ).order_by("pk")
    due = []
    for room in rooms:
        if day.weekday() not in lesson_weekdays(room):
            continue
        interval = lesson_interval(room, day)
        if interval is None:  # a lesson_time nobody can read: no end to wait for
            continue
        ends_at = interval[1]
        if ends_at <= now < ends_at + timedelta(minutes=CHECK_GRACE_MINUTES) and now < marking_window(room, day)[1]:
            due.append((room, day))
    return due


def teachers_of(classroom):
    """Who runs the class — owner and teachers (lc-up's teachers on a paired class), not assistants."""
    seats = ClassroomMembership.objects.filter(
        classroom=classroom,
        role__in=ClassroomMembership.MANAGER_ROLES,
        status=ClassroomMembership.STATUS_ACTIVE,
        user__is_active=True,
        user__is_frozen=False,
    ).select_related("user").order_by("pk")
    return [seat.user for seat in seats]


def check_key(classroom_id: int, day: date) -> str:
    return f"attcheck:{classroom_id}:{day.isoformat()}"


def send_lesson_checks(*, now=None) -> dict:
    """Tell each due class's teachers what its register needs, once per lesson. A class with
    nothing to say is looked at again on the next run, so a mark turned ABSENT later in the window
    still reaches the teacher."""
    from notifications.constants import EVENT_ATTENDANCE_CHECK
    from notifications.models import Notification
    from notifications.services import notify

    if not (lcup_enabled() and attendance_checks_enabled()):
        return {"skipped": "off"}
    now = now or timezone.now()
    counts = Counter()
    for room, day in due_lessons(now):
        try:
            key = check_key(room.pk, day)
            # Checked without notify's 60-minute dedupe window: a lesson is told once, ever, and a
            # read notification is never brought back as unread.
            teachers = [t for t in teachers_of(room) if not Notification.objects.filter(recipient=t, dedupe_key=key).exists()]
            if not teachers:
                counts["already_sent"] += 1
                continue
            check = lesson_check(room, day)
            if check.is_empty:
                counts["clean"] += 1
                continue
            counts["classes"] += 1
            for teacher in teachers:
                row = notify(
                    teacher, event=EVENT_ATTENDANCE_CHECK, title=check.title, body=check.body,
                    link_url=f"/classes/{room.pk}?tab=attendance", dedupe_key=key,
                )
                if row is not None:
                    counts["notified"] += 1
        except Exception:
            logger.exception("attendance_check_failed classroom=%s", room.pk)
            counts["failed"] += 1
    return dict(counts)
```

(A class with no teacher at all is counted under `already_sent`: there is nobody to tell, and the count is only telemetry.)

- [ ] **Step 6: Add the Celery task** to the end of `backend/lcup/tasks.py`

```python
@shared_task(name="lcup.tasks.attendance_checks")
def attendance_checks() -> dict:
    """Each paired class's teachers, as its lesson ends (lcup.followups). Returns at once while
    LCUP_ATTENDANCE_CHECKS_ENABLED is off."""
    from .followups import send_lesson_checks

    return send_lesson_checks()
```

Then add the beat entry to `backend/config/settings.py`, right after the `"lcup-sync"` entry:

```python
    # The lesson-end check (lcup.followups, owner 2026-10-20): each paired class's teachers are told who is
    # absent without a reason, who has had the free trial and whom lc-up lists but the register cannot show —
    # once, as the lesson ends. Returns at once while LCUP_ATTENDANCE_CHECKS_ENABLED is off.
    "lcup-attendance-checks": {
        "task": "lcup.tasks.attendance_checks",
        "schedule": crontab(minute="*/5"),
    },
```

- [ ] **Step 7: Run the new tests and the notifications app**

Run: `... python3 manage.py test lcup.tests_followups notifications --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add backend/notifications/constants.py backend/notifications/migrations/0006_attendance_check_event.py backend/lcup/followups.py backend/lcup/tasks.py backend/config/settings.py backend/lcup/tests_followups.py
git commit -m "feat(lcup): tell a class's teachers what its register needs as the lesson ends (flag-gated)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `attendance_check_preview` — read-only, shown to the owner before the flag

**Files:**
- Modify: `backend/lcup/followups.py` (append `preview_lesson_checks`)
- Create: `backend/lcup/management/commands/attendance_check_preview.py`
- Test: `backend/lcup/tests_followups.py` (append a class)

**Interfaces:**
- Consumes: `lesson_check`, `teachers_of`, `user_ref`
- Produces:
  - `followups.preview_lesson_checks(day: date) -> list[dict]`, where each item is `{"classroom", "teachers": [str], "title", "body", "sends": bool}`
  - `manage.py attendance_check_preview [--day YYYY-MM-DD]`

- [ ] **Step 1: Write the failing tests.** Append them, and add `from io import StringIO` and `from django.core.management import call_command`.

```python
@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class PreviewCommandTests(FollowupsFixtureMixin, TestCase):
    def preview(self):
        out = StringIO()
        call_command("attendance_check_preview", "--day", "2026-10-19", stdout=out)
        return out.getvalue()

    def test_it_prints_each_class_as_if_its_lesson_had_ended_and_sends_nothing(self):
        self.mark(self.MONDAY, self.student("Bek", "Rahimov"), "ABSENT")
        text = self.preview()
        self.assertIn("Middle G23 — check today's register", text)
        self.assertIn("Absent: Bek Rahimov", text)
        self.assertIn("to: Tess Teacher", text)
        self.assertFalse(Notification.objects.exists())

    def test_a_clean_class_is_shown_as_silent(self):
        self.mark(self.MONDAY, self.student("Ali", "Valiyev"), "PRESENT")
        self.assertIn("Middle G23: nothing to say — no notification", self.preview())
```

- [ ] **Step 2: Run them and see them fail**

Expected: `CommandError: Unknown command: 'attendance_check_preview'`

- [ ] **Step 3: Append to `backend/lcup/followups.py`**

```python
def preview_lesson_checks(day: date) -> list[dict]:
    """Every paired class that meets on ``day``, with what its teachers would be told had its lesson
    just ended. Sends nothing and ignores the switch — it is how the owner sees the messages first."""
    from classes.lesson_schedule import lesson_weekdays
    from classes.models import Classroom

    rooms = Classroom.objects.filter(
        is_active=True,
        lcup_group_link__status=GroupLinkStatus.CONFIRMED,
        lcup_group_link__deleted_in_lcup_at__isnull=True,
    ).order_by("name")
    rows = []
    for room in rooms:
        if day.weekday() not in lesson_weekdays(room):
            continue
        check = lesson_check(room, day)
        rows.append({
            "classroom": room.name,
            "teachers": [user_ref(t)["name"] for t in teachers_of(room)],
            "title": check.title,
            "body": check.body,
            "sends": not check.is_empty,
        })
    return rows
```

- [ ] **Step 4: Create `backend/lcup/management/commands/attendance_check_preview.py`**

```python
"""Print the lesson-end check each paired class's teachers would get (lcup.followups). Read-only:
run it on prod and show the owner before LCUP_ATTENDANCE_CHECKS_ENABLED goes on."""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_date

from lcup.followups import preview_lesson_checks


class Command(BaseCommand):
    help = "Show what each paired class's teachers would be told as DAY's lesson ends. Sends nothing."

    def add_arguments(self, parser):
        parser.add_argument("--day", help="YYYY-MM-DD (default: today)")

    def handle(self, *args, **options):
        day = parse_date(options["day"]) if options.get("day") else timezone.localdate()
        if day is None:
            raise CommandError("--day must be YYYY-MM-DD")
        rows = preview_lesson_checks(day)
        if not rows:
            self.stdout.write(f"No paired class meets on {day}.")
        for row in rows:
            if not row["sends"]:
                self.stdout.write(f"{row['classroom']}: nothing to say — no notification")
                continue
            self.stdout.write(f"{row['title']}\n  to: {', '.join(row['teachers']) or '(no teacher)'}\n  {row['body']}\n")
```

- [ ] **Step 5: Run the tests and see them pass**

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/lcup/followups.py backend/lcup/management/commands/attendance_check_preview.py backend/lcup/tests_followups.py
git commit -m "feat(lcup): attendance_check_preview — the messages, shown before the switch goes on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `GET /api/lcup/followups/` for /ops/trials

**Files:**
- Modify: `backend/lcup/views.py` (new view at the end, after `AttendancePushListView`)
- Modify: `backend/lcup/urls.py`
- Test: `backend/lcup/tests_followups_api.py` (new)

**Interfaces:**
- Consumes: `trial_seats`, `missing_seats`, `pending`, `REASON_TEXT`, `STATE_ORDER`, `free_trial_lessons`, `user_ref`, `room_ref`
- Produces this JSON:

```json
{
  "free_trial_lessons": 1,
  "trials": [{"membership_id": 1, "name": "…", "student": {"id", "name", "username", "phone"} | null,
              "classroom": {"id", "name"}, "teachers": ["…"], "since": "YYYY-MM-DD" | null,
              "lessons": 2, "first_lesson": "YYYY-MM-DD" | null, "last_lesson": "YYYY-MM-DD" | null,
              "state": "used" | "came" | "not_yet"}],
  "not_on_list": [{"lcup_student_id": 9001, "name": "…", "phone": "…", "student": {…} | null,
                   "classroom": {"id", "name"}, "teachers": ["…"], "lcup_status": "trial",
                   "since": "YYYY-MM-DD" | null, "reason": "no_account", "reason_text": "…"}],
  "pending": 3
}
```

`trials` is ordered by state (used, came, not_yet), then by `since` (oldest first; none last), then by name.

- [ ] **Step 1: Write the failing tests** in `backend/lcup/tests_followups_api.py`

```python
from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from lcup.testing import FollowupsFixtureMixin


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class FollowupsApiTests(FollowupsFixtureMixin, TestCase):
    def get(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api.get("/api/lcup/followups/")

    def test_a_teacher_is_refused(self):
        self.assertEqual(self.get(self.teacher).status_code, 403)

    def test_the_desk_sees_trials_neediest_first_and_the_missing(self):
        used, came = self.student("Sardor", "Nazarov"), self.student("Ali", "Valiyev")
        self.lcup_member("Not Yet", user=self.student("Not", "Yet"), status="trial", since=date(2026, 10, 1))
        self.lcup_member("Ali Valiyev", user=came, status="trial", since=date(2026, 10, 16))
        self.lcup_member("Sardor Nazarov", user=used, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), used, "PRESENT")
        self.mark(date(2026, 10, 14), used, "PRESENT")
        self.mark(date(2026, 10, 16), came, "PRESENT")
        self.lcup_member("Jasur Toshmatov", status="trial", since=self.MONDAY)

        response = self.get(self.admin)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["free_trial_lessons"], 1)
        self.assertEqual(
            [(row["name"], row["state"]) for row in body["trials"]],
            [("Sardor Nazarov", "used"), ("Ali Valiyev", "came"), ("Not Yet", "not_yet"), ("Jasur Toshmatov", "not_yet")],
        )
        sardor = body["trials"][0]
        self.assertEqual(sardor["lessons"], 2)
        self.assertEqual((sardor["first_lesson"], sardor["last_lesson"]), ("2026-10-12", "2026-10-14"))
        self.assertEqual(sardor["classroom"], {"id": self.room.pk, "name": "Middle G23"})
        self.assertEqual(sardor["teachers"], ["Tess Teacher"])
        self.assertEqual(sardor["student"]["id"], used.pk)
        [missing] = body["not_on_list"]
        self.assertEqual((missing["name"], missing["reason"], missing["student"]), ("Jasur Toshmatov", "no_account", None))
        self.assertIn("next lc-up sync", missing["reason_text"])
        self.assertEqual(body["pending"], 3)
```

- [ ] **Step 2: Run them and see them fail**

Run: `... python3 manage.py test lcup.tests_followups_api --settings=config.settings_test_nomigrations -v 1`
Expected: `AssertionError: 404 != 403`

- [ ] **Step 3: Add the view** at the end of `backend/lcup/views.py`

```python
# ── follow-ups (/ops/trials) ──────────────────────────────────────────────


class FollowupsView(_AdminView):
    """lc-up's trial students, by the lessons they came to since the trial began, and the members no
    class list shows (lcup.followups). Read-only: a student is activated in lc-up, or linked in
    /ops/lcup, and leaves these lists within one sync."""

    def get(self, request):
        from datetime import date

        from .conf import free_trial_lessons
        from .followups import REASON_TEXT, STATE_ORDER, missing_seats, pending, trial_seats

        seats = trial_seats()
        missing = missing_seats()
        room_ids = {seat.classroom_id for seat in seats} | {seat.classroom_id for seat in missing}
        rooms = Classroom.objects.in_bulk(room_ids)
        teachers = defaultdict(list)
        for seat in (
            ClassroomMembership.objects.filter(
                classroom_id__in=room_ids,
                role__in=ClassroomMembership.MANAGER_ROLES,
                status=ClassroomMembership.STATUS_ACTIVE,
            ).select_related("user").order_by("pk")
        ):
            teachers[seat.classroom_id].append(user_ref(seat.user)["name"])
        users = User.objects.in_bulk({s.user_id for s in seats if s.user_id} | {s.user_id for s in missing if s.user_id})
        ordered = sorted(seats, key=lambda s: (STATE_ORDER[s.state], s.since or date.max, s.name))
        return Response({
            "free_trial_lessons": free_trial_lessons(),
            "trials": [
                {
                    "membership_id": seat.membership_id,
                    "name": seat.name,
                    "student": user_ref(users.get(seat.user_id)),
                    "classroom": room_ref(rooms.get(seat.classroom_id)),
                    "teachers": teachers[seat.classroom_id],
                    "since": seat.since,
                    "lessons": seat.lessons,
                    "first_lesson": seat.lesson_dates[0] if seat.lesson_dates else None,
                    "last_lesson": seat.lesson_dates[-1] if seat.lesson_dates else None,
                    "state": seat.state,
                }
                for seat in ordered
            ],
            "not_on_list": [
                {
                    "lcup_student_id": seat.lcup_student_id,
                    "name": seat.name,
                    "phone": seat.phone,
                    "student": user_ref(users.get(seat.user_id)),
                    "classroom": room_ref(rooms.get(seat.classroom_id)),
                    "teachers": teachers[seat.classroom_id],
                    "lcup_status": seat.lcup_status,
                    "since": seat.since,
                    "reason": seat.reason,
                    "reason_text": REASON_TEXT[seat.reason],
                }
                for seat in missing
            ],
            "pending": pending(seats, missing),
        })
```

In `backend/lcup/urls.py`, after the `attendance/pushes/` line:

```python
    path("followups/", views.FollowupsView.as_view(), name="lcup-followups"),
```

(`/api/lcup/` is already open on the admin host (`access/host_guard.py:265`), so the allowlist needs no change.)

- [ ] **Step 4: Run the tests and see them pass**

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/lcup/views.py backend/lcup/urls.py backend/lcup/tests_followups_api.py
git commit -m "feat(lcup): /api/lcup/followups/ — trial students and members missing from a class list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Register UI — trial badges, "free trial used" warning, "not on your list" banner

**Files:**
- Modify: `frontend/src/features/classroom/attendanceApi.ts` (`RosterRow`, `getSession` return type)
- Modify: `frontend/src/features/classroom/pages/Attendance.tsx` (`RosterMarker`)
- Test: `frontend/src/features/classroom/__tests__/AttendanceTrial.test.tsx` (new)

**Interfaces:**
- Consumes: the register JSON from Task 3 (`roster[].lcup_trial`, `not_on_list`)
- Produces:
  - `RosterRow.lcup_trial?: LcupTrialMark | null`
  - `LcupTrialMark { lessons_before: number; free_used: boolean }`
  - `NotOnListPerson { name: string }`

- [ ] **Step 0: Link node_modules into the worktree** (once)

Run: `ln -s /Users/macbook/Projects/DSAT-mock-exam/frontend/node_modules /Users/macbook/Projects/dsat-wt-followups/frontend/node_modules`

- [ ] **Step 1: Write the failing test** `frontend/src/features/classroom/__tests__/AttendanceTrial.test.tsx`

```tsx
/**
 * The register of a class paired with lc-up shows lc-up's trial students (owner, 2026-10-20). The
 * first lesson is marked as such. One who has had the free trial is flagged "send to the admin",
 * loudest the moment they are marked present. lc-up members the register cannot show are named in
 * a banner above it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), patch: vi.fn(), delete: vi.fn() },
}));

const { RosterMarker } = await import("../pages/Attendance");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount(extra: { roster: object[]; not_on_list?: object[] }) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/attendance/sessions/7/") {
      return {
        data: {
          id: 7, date: "2026-10-19", title: "", lesson_index: null, status: "OPEN", counts: null,
          marking: { state: "OPEN", opens_at: "", closes_at: "", can_mark: true, is_override: false, reason: null },
          excuse_reasons: [],
          ...extra,
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <RosterMarker classId={34} sessionId={7} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && !host.textContent?.includes("Ali"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!host.textContent?.includes("Ali")) throw new Error("the register never rendered");
}

const row = (lcup_trial: object | null) => ({
  student_id: 1, name: "Ali Valiyev", status: null, note: "", reason_id: null, lcup_trial,
});

describe("Attendance register — lc-up trial students", () => {
  it("marks a trial student's first lesson", async () => {
    await mount({ roster: [row({ lessons_before: 0, free_used: false })] });
    expect(host.textContent).toContain("Trial · 1st lesson");
    expect(host.textContent).not.toContain("send to the admin");
  });

  it("flags one who has had the free trial, and says it again when they are marked present", async () => {
    await mount({ roster: [row({ lessons_before: 1, free_used: true })] });
    expect(host.textContent).toContain("Free trial used — send to the admin");
    expect(host.textContent).not.toContain("has already had the free trial lesson");
    const present = host.querySelector<HTMLButtonElement>('button[title="Present"]');
    if (!present) throw new Error("no Present button");
    await act(async () => present.click());
    expect(host.textContent).toContain("Ali Valiyev has already had the free trial lesson — send them to the admin");
  });

  it("says nothing for a student who is not on trial", async () => {
    await mount({ roster: [row(null)] });
    expect(host.textContent).not.toContain("Trial");
  });

  it("names the lc-up members the register cannot show", async () => {
    await mount({ roster: [row(null)], not_on_list: [{ name: "Jasur Toshmatov" }, { name: "Bek Rahimov" }] });
    expect(host.textContent).toContain(
      "In lc-up but not on your list: Jasur Toshmatov, Bek Rahimov — send them to the admin.",
    );
  });
});
```

(The Present button's `title` is `META.PRESENT.label`. If that label is not "Present", read `META` at the top of `Attendance.tsx` and use its label.)

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx vitest run src/features/classroom/__tests__/AttendanceTrial.test.tsx`
Expected: 3 of 4 fail; "says nothing…" passes already.

- [ ] **Step 3: Extend the types** in `attendanceApi.ts`.
  1. Add to `RosterRow`, after `frozen_in_lcup`:

```ts
  /** On trial in lc-up (owner, 2026-10-20): lessons come to here before this one, and whether the
   *  free trial is behind them — then the teacher sends them to the admin. Null when not on trial. */
  lcup_trial?: LcupTrialMark | null;
```

  2. Below the `RosterRow` interface:

```ts
export interface LcupTrialMark {
  lessons_before: number;
  free_used: boolean;
}

/** An lc-up member of this class's group the register cannot show (no seat here yet). */
export interface NotOnListPerson {
  name: string;
}
```

  3. Change the `getSession` return type to `AttendanceSessionBrief & { roster: RosterRow[]; excuse_reasons?: ExcuseReason[]; not_on_list?: NotOnListPerson[] }`.

- [ ] **Step 4: Render them in `RosterMarker`** (`Attendance.tsx`)

a) After `const excuseReasons = data?.excuse_reasons ?? [];`:

```tsx
  const notOnList = data?.not_on_list ?? [];
```

b) Right after the marking-window banner block (`{markWindow && markWindow.state !== "OPEN" && (…)}`):

```tsx
      {/* lc-up lists them in this group but they have no seat here, so they cannot be marked: the
          teacher sends them to the admin, who links them (owner, 2026-10-20). */}
      {notOnList.length > 0 && (
        <div role="note" className="mt-3 rounded-xl border border-amber-400/60 bg-amber-500/[0.07] px-3.5 py-2.5 text-xs text-foreground">
          In lc-up but not on your list: {notOnList.map((person) => person.name).join(", ")} — send them to the admin.
        </div>
      )}
```

c) In the row, after the `frozen_in_lcup` badge:

```tsx
                  {r.lcup_trial ? (
                    r.lcup_trial.free_used ? (
                      <span
                        title="They have had the free trial lesson. Send them to the admin to be activated in lc-up."
                        className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                      >
                        Free trial used — send to the admin
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {r.lcup_trial.lessons_before === 0 ? "Trial · 1st lesson" : `Trial · lesson ${r.lcup_trial.lessons_before + 1}`}
                      </span>
                    )
                  ) : null}
```

d) After the excuse-reason `Select` block, still inside the row's wrapper `div`:

```tsx
              {r.lcup_trial?.free_used && (local[r.student_id] === "PRESENT" || local[r.student_id] === "LATE") && (
                <p role="status" className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  {r.name} has already had the free trial lesson — send them to the admin to be activated in lc-up.
                </p>
              )}
```

- [ ] **Step 5: Run the new test and the register's existing one**

Run: `npx vitest run src/features/classroom/__tests__/AttendanceTrial.test.tsx src/features/classroom/__tests__/AttendanceExcuseReasons.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/classroom/attendanceApi.ts frontend/src/features/classroom/pages/Attendance.tsx frontend/src/features/classroom/__tests__/AttendanceTrial.test.tsx
git commit -m "feat(attendance): trial badges, the free-trial warning and the not-on-your-list banner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: /ops/trials page + sidebar count

**Files:**
- Modify: `frontend/src/features/lcup/lcupApi.ts` (types + `followups()`)
- Modify: `frontend/src/features/lcup/lcupHooks.ts` (`lcupKeys.followups`, `useLcupFollowups`)
- Modify: `frontend/src/features/lcup/LcupPanels.tsx` (`TrialStudentsPanel`, `NotOnListPanel`)
- Create: `frontend/src/app/(ops)/ops/trials/page.tsx`
- Modify: `frontend/src/features/ops/shell/opsNav.ts`, `OpsSidebar.tsx`, `OpsShell.tsx`, `frontend/src/features/ops/adminScope.ts`
- Test (new): `frontend/src/features/lcup/__tests__/TrialsPanels.test.tsx`, `frontend/src/features/ops/shell/__tests__/OpsSidebarCount.test.tsx`
- Modify tests: `frontend/src/features/ops/shell/__tests__/opsNav.test.ts`, `frontend/src/features/ops/shell/__tests__/OpsShell.test.tsx`

**Interfaces:**
- Consumes: `GET /api/lcup/followups/` (Task 7)
- Produces:
  - `lcupApi.followups(): Promise<LcupFollowups>`
  - `useLcupFollowups(options?: { enabled?: boolean })`
  - `OpsNavCountKey = "trials"`, `OpsNavItem.countKey?`
  - `OpsSidebar` prop `counts?: Partial<Record<OpsNavCountKey, number>>`

- [ ] **Step 1: Write the failing panel test** `frontend/src/features/lcup/__tests__/TrialsPanels.test.tsx`

```tsx
/**
 * /ops/trials shows two lists. The first is lc-up's trial students, neediest first (the server
 * orders them). The second is lc-up members no class list shows, each with why. Read-only:
 * activation happens in lc-up.
 */
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { NotOnListPanel, TrialStudentsPanel } = await import("../LcupPanels");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const ROOM = { id: 12, name: "Middle G23" };
const FOLLOWUPS = {
  free_trial_lessons: 1,
  pending: 3,
  trials: [
    { membership_id: 1, name: "Sardor Nazarov", student: { id: 41, name: "Sardor Nazarov", username: "sn", phone: null },
      classroom: ROOM, teachers: ["Tess Teacher"], since: "2026-10-12", lessons: 2,
      first_lesson: "2026-10-12", last_lesson: "2026-10-14", state: "used" },
    { membership_id: 2, name: "Ali Valiyev", student: null, classroom: ROOM, teachers: [], since: "2026-10-16",
      lessons: 1, first_lesson: "2026-10-16", last_lesson: "2026-10-16", state: "came" },
    { membership_id: 3, name: "Not Yet", student: null, classroom: ROOM, teachers: [], since: null,
      lessons: 0, first_lesson: null, last_lesson: null, state: "not_yet" },
  ],
  not_on_list: [
    { lcup_student_id: 9001, name: "Jasur Toshmatov", phone: "998901234567", student: null, classroom: ROOM,
      teachers: ["Tess Teacher"], lcup_status: "trial", since: "2026-10-19", reason: "needs_review",
      reason_text: "Their account match waits for review in lc-up → Students." },
  ],
};

async function mount(node: ReactNode, data: object = FOLLOWUPS) {
  get.mockImplementation(async (url: string) => {
    if (url === "/lcup/followups/") return { data };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  for (let tick = 0; tick < 50 && (host.textContent ?? "").includes("Loading"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("/ops/trials panels", () => {
  it("lists trial students in the server's order with their state", async () => {
    await mount(<TrialStudentsPanel />);
    const rows = Array.from(host.querySelectorAll("tbody tr")).map((tr) => tr.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Sardor Nazarov");
    expect(rows[0]).toContain("Free trial used");
    expect(rows[1]).toContain("Came to trial (2026-10-16)");
    expect(rows[2]).toContain("Not come yet");
    expect(host.querySelector<HTMLAnchorElement>('a[href="/ops/students/41"]')?.textContent).toBe("Sardor Nazarov");
  });

  it("says so when nobody is on trial", async () => {
    await mount(<TrialStudentsPanel />, { ...FOLLOWUPS, trials: [] });
    expect(host.textContent).toContain("No one is on trial in lc-up right now.");
  });

  it("lists members missing from a class list with why, and points review cases at lc-up", async () => {
    await mount(<NotOnListPanel />);
    expect(host.textContent).toContain("Jasur Toshmatov");
    expect(host.textContent).toContain("Their account match waits for review in lc-up → Students.");
    expect(host.querySelector('a[href="/ops/lcup"]')).not.toBeNull();
  });

  it("says so when every member is on a list", async () => {
    await mount(<NotOnListPanel />, { ...FOLLOWUPS, not_on_list: [] });
    expect(host.textContent).toContain("Every lc-up member of a paired group is on their class list.");
  });
});
```

- [ ] **Step 2: Write the failing sidebar test** `frontend/src/features/ops/shell/__tests__/OpsSidebarCount.test.tsx`

```tsx
/** The Trials item carries the desk's waiting count; zero draws nothing. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpsSidebar } from "../OpsSidebar";
import { OPS_NAV_GROUPS, visibleNav } from "../opsNav";

const ADMIN = { role: "admin", permissions: [] };
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(counts?: { trials?: number }) {
  act(() => {
    root.render(
      <OpsSidebar
        groups={visibleNav(OPS_NAV_GROUPS, ADMIN)}
        pathname="/ops"
        collapsed={false}
        mobileOpen={false}
        onCloseMobile={() => {}}
        onToggleCollapsed={() => {}}
        counts={counts}
      />,
    );
  });
  return host.querySelector<HTMLAnchorElement>('a[href="/ops/trials"]');
}

describe("ops sidebar count", () => {
  it("shows the waiting count beside Trials", () => {
    const link = render({ trials: 3 });
    expect(link?.textContent).toBe("Trials3");
    expect(link?.querySelector('[aria-label="3 waiting"]')).not.toBeNull();
  });

  it("draws nothing for zero", () => {
    expect(render({ trials: 0 })?.textContent).toBe("Trials");
  });
});
```

- [ ] **Step 3: Run both and see them fail**

Run: `npx vitest run src/features/lcup/__tests__/TrialsPanels.test.tsx src/features/ops/shell/__tests__/OpsSidebarCount.test.tsx`
Expected: failures (no `TrialStudentsPanel` export; no `/ops/trials` link).

- [ ] **Step 4: API types and method** in `lcupApi.ts`. Add these next to the other interfaces:

```ts
export type TrialState = "not_yet" | "came" | "used";
export type MissingReason = "needs_review" | "ignored" | "no_account" | "not_seated";

export interface LcupTrialRow {
  membership_id: number;
  name: string;
  student: LcupUserRef | null;
  classroom: LcupRef;
  teachers: string[];
  since: string | null;
  lessons: number;
  first_lesson: string | null;
  last_lesson: string | null;
  state: TrialState;
}

export interface LcupMissingRow {
  lcup_student_id: number;
  name: string;
  phone: string;
  student: LcupUserRef | null;
  classroom: LcupRef;
  teachers: string[];
  lcup_status: string;
  since: string | null;
  reason: MissingReason;
  reason_text: string;
}

/** /ops/trials (backend lcup.followups): read-only; a student is activated in lc-up itself. */
export interface LcupFollowups {
  free_trial_lessons: number;
  trials: LcupTrialRow[];
  not_on_list: LcupMissingRow[];
  pending: number;
}
```

Inside `lcupApi`, after `attendancePushes()`:

```ts
  async followups(): Promise<LcupFollowups> {
    const { data } = await api.get<LcupFollowups>("/lcup/followups/");
    return data;
  },
```

- [ ] **Step 5: The hook** in `lcupHooks.ts`. Add `followups: [...ROOT, "followups"] as const,` to `lcupKeys`, then:

```ts
/** /ops/trials and the sidebar's count share this one query; a minute is fresh enough for a desk. */
export function useLcupFollowups(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: lcupKeys.followups,
    queryFn: () => lcupApi.followups(),
    refetchInterval: 60_000,
    enabled: options.enabled ?? true,
  });
}
```

- [ ] **Step 6: The panels** in `LcupPanels.tsx`. First the imports:
  - add `import Link from "next/link";`
  - add `type TrialState` to the `./lcupApi` import
  - add `useLcupFollowups` to the `./lcupHooks` import

Then append:

```tsx
const TRIAL_STATE: Record<TrialState, { label: string; tone: string }> = {
  used: { label: "Free trial used", tone: "font-semibold text-amber-700 dark:text-amber-300" },
  came: { label: "Came to trial", tone: "font-semibold text-sky-700 dark:text-sky-300" },
  not_yet: { label: "Not come yet", tone: "text-muted-foreground" },
};

const PERSON_LINK = "text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** lc-up's trial students, neediest first — activate them in lc-up and they leave within one sync. */
export function TrialStudentsPanel() {
  const q = useLcupFollowups();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.trials.length) return <p className="text-[13px] text-muted-foreground">No one is on trial in lc-up right now.</p>;
  return (
    <DenseTable
      caption="Trial students"
      head={
        <>
          <th scope="col" className={TH}>Student</th>
          <th scope="col" className={TH}>Class</th>
          <th scope="col" className={TH}>Teacher</th>
          <th scope="col" className={TH}>Trial since</th>
          <th scope="col" className={TH_R}>Lessons came</th>
          <th scope="col" className={TH}>Status</th>
        </>
      }
    >
      {q.data.trials.map((row) => (
        <tr key={row.membership_id} className={TR}>
          <td className={cn(TD, "font-medium")}>
            {row.student ? <Link href={`/ops/students/${row.student.id}`} className={PERSON_LINK}>{row.name}</Link> : row.name}
          </td>
          <td className={TD}>{row.classroom.name}</td>
          <td className={TD}>{row.teachers.join(", ") || "—"}</td>
          <td className={TD}>{row.since ?? "—"}</td>
          <td className={TD_R}>{row.lessons}</td>
          <td className={cn(TD, TRIAL_STATE[row.state].tone)}>
            {TRIAL_STATE[row.state].label}
            {row.state === "came" && row.first_lesson ? ` (${row.first_lesson})` : ""}
          </td>
        </tr>
      ))}
    </DenseTable>
  );
}

/** lc-up members of a paired group that no class list shows — their teacher cannot mark them. */
export function NotOnListPanel() {
  const q = useLcupFollowups();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.not_on_list.length) {
    return <p className="text-[13px] text-muted-foreground">Every lc-up member of a paired group is on their class list.</p>;
  }
  return (
    <DenseTable
      caption="lc-up members not on their class list"
      head={
        <>
          <th scope="col" className={TH}>Student</th>
          <th scope="col" className={TH}>Class</th>
          <th scope="col" className={TH}>lc-up status</th>
          <th scope="col" className={TH}>Member since</th>
          <th scope="col" className={TH}>Why</th>
        </>
      }
    >
      {q.data.not_on_list.map((row) => (
        <tr key={`${row.lcup_student_id}-${row.classroom.id}`} className={TR}>
          <td className={cn(TD, "font-medium")}>
            {row.student ? <Link href={`/ops/students/${row.student.id}`} className={PERSON_LINK}>{row.name}</Link> : row.name}
            {row.phone ? <span className="ml-2 text-[12px] font-normal text-muted-foreground">{row.phone}</span> : null}
          </td>
          <td className={TD}>{row.classroom.name}</td>
          <td className={TD}>{row.lcup_status}</td>
          <td className={TD}>{row.since ?? "—"}</td>
          <td className={TD_WRAP}>
            {row.reason_text}
            {row.reason === "needs_review" || row.reason === "ignored" ? (
              <>
                {" "}
                <Link href="/ops/lcup" className={PERSON_LINK}>Open lc-up</Link>
              </>
            ) : null}
          </td>
        </tr>
      ))}
    </DenseTable>
  );
}
```

- [ ] **Step 7: The page** `frontend/src/app/(ops)/ops/trials/page.tsx`

```tsx
"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";
import { NotOnListPanel, TrialStudentsPanel } from "@/features/lcup/LcupPanels";
import { useLcupFollowups } from "@/features/lcup/lcupHooks";

/**
 * Trials (owner, 2026-10-20): students lc-up holds on trial, and lc-up members no class list shows.
 * The teacher sends both kinds to the desk. The desk activates or links them in lc-up, and they
 * leave these lists within one sync. Nothing here writes.
 */
export default function OpsTrialsPage() {
  const [tab, setTab] = useState("trials");
  const q = useLcupFollowups();
  const free = q.data?.free_trial_lessons ?? 1;
  const tabs = [
    { value: "trials", label: q.data ? `Trial students (${q.data.trials.length})` : "Trial students" },
    { value: "missing", label: q.data ? `Not on class list (${q.data.not_on_list.length})` : "Not on class list" },
  ];
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Trials</h1>
        <p className="text-[13px] text-muted-foreground">
          Students on trial in lc-up, and lc-up members their class list does not show. The free trial is {free} lesson
          {free === 1 ? "" : "s"}. Activate or link a student in lc-up — they leave this page within 15 minutes.
        </p>
      </header>
      <Tabs tabs={tabs} value={tab} onValueChange={setTab} aria-label="Trials sections" />
      {tab === "trials" ? <TrialStudentsPanel /> : <NotOnListPanel />}
    </div>
  );
}
```

- [ ] **Step 8: Nav item, scope and count**

`opsNav.ts`:
  1. Add `UserCheck` to the lucide import.
  2. Add `export type OpsNavCountKey = "trials";`.
  3. In `OpsNavItem`, add:

```ts
  /** Work waiting behind this section — the shell fetches it and the sidebar draws it beside the label. */
  countKey?: OpsNavCountKey;
```

  4. In the `centre` group, right after the lc-up item:

```ts
      // Trial students and lc-up members missing from a class list (owner, 2026-10-20); the count is what
      // waits on the desk.
      { href: "/ops/trials", label: "Trials", icon: UserCheck, countKey: "trials" },
```

`adminScope.ts`, after `"/ops/lcup",`:

```ts
  // Trials (plan 2026-10-20): the desk's follow-ups — trial students and members missing from a class list.
  "/ops/trials",
```

`OpsSidebar.tsx`:
  1. Import `type OpsNavCountKey` from `./opsNav`.
  2. Add the destructured prop `counts` and its type `counts?: Partial<Record<OpsNavCountKey, number>>;`, with the doc comment `/** Work waiting behind a section, by its countKey — drawn beside the label when above zero. */`.
  3. Inside `group.items.map`, after `const Icon = item.icon;`:

```tsx
                const count = item.countKey ? counts?.[item.countKey] ?? 0 : 0;
```

  4. Right after the label `<span>`:

```tsx
                      {count > 0 ? (
                        <span
                          aria-label={`${count} waiting`}
                          className={cn(
                            "ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-300",
                            collapsed && "lg:absolute lg:right-1 lg:top-0.5 lg:px-1",
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
```

`OpsShell.tsx`:
  1. Add the imports: `useLcupFollowups` from `@/features/lcup/lcupHooks`, `isScopedOpsAdmin` from `@/features/ops/adminScope`, and `isOpsSuperAdmin` from `./opsNav`.
  2. After `const groups = useMemo(…)`:

```tsx
  // The Trials count — for an administrator only, the one role its API answers.
  const wantsTrials = useMemo(() => groups.some((g) => g.items.some((i) => i.countKey === "trials")), [groups]);
  const followups = useLcupFollowups({ enabled: wantsTrials && (isOpsSuperAdmin(me) || isScopedOpsAdmin(me)) });
  const counts = useMemo(() => ({ trials: followups.data?.pending ?? 0 }), [followups.data]);
```

  3. Pass `counts={counts}` to `<OpsSidebar …/>`.

- [ ] **Step 9: Update the existing nav tests**

`opsNav.test.ts`: in "shows a scoped admin only the school's sections", insert `"/ops/trials",` right after `"/ops/lcup",` in the expected list.

`OpsShell.test.tsx`: its `@/lib/api` mock has no `default`, and the shell now fetches the count for an admin. Extend the mock:

```ts
vi.mock("@/lib/api", () => ({
  authApi: { logout: (...args: unknown[]) => logout(...args) },
  default: { get: vi.fn(async () => ({ data: { free_trial_lessons: 1, trials: [], not_on_list: [], pending: 0 } })) },
}));
```

- [ ] **Step 10: Run the ops and lcup tests**

Run: `npx vitest run src/features/lcup src/features/ops`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/lcup frontend/src/features/ops "frontend/src/app/(ops)/ops/trials"
git commit -m "feat(ops): Trials — lc-up trial students and members missing from a class list, counted in the sidebar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verify, open the PR, and prepare the owner's rollout

**Files:** none new (plus `graphify-out/`, if `graphify update .` changes it)

- [ ] **Step 1: Run the backend suites touched by the change**, in chunks. Only a literal `OK` counts.

```bash
cd /Users/macbook/Projects/dsat-wt-followups/backend
SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test lcup --settings=config.settings_test_nomigrations -v 1
SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test notifications --settings=config.settings_test_nomigrations -v 1
SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes --settings=config.settings_test_nomigrations -v 1
```

`classes` carries known date-dependent reds on main (`tests_support_working_hours`; run app groups serially, because `--parallel` crashes). Compare its failure list with the same run on `origin/main` in a scratch worktree, and report any difference.

- [ ] **Step 2: Check the migration on Postgres.** Apply `notifications.0006` on a local Postgres (memory `local-postgres-verify-orm-sql`). `sqlmigrate notifications 0006` must print no DDL: it is a choices-only `AlterField`.

- [ ] **Step 3: Frontend.** Run the whole suite with `cd frontend && npx vitest run`. It must be green; read the counts, not just the exit code. Then run `npx tsc --noEmit -p .`; it must report 0 errors.

- [ ] **Step 4: Graph.** Run `cd /Users/macbook/Projects/dsat-wt-followups && graphify update .` and commit if tracked files changed.

- [ ] **Step 5: Push and open the PR** (the body lists what changed, the test counts and the rollout below)

```bash
git push origin HEAD:refs/heads/feat/attendance-followups
gh pr create --base main --head feat/attendance-followups --title "Attendance follow-ups: lesson-end check for teachers + /ops Trials" --body-file /tmp/followups-pr.md
```

End the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Rollout.** This runs after the owner approves the merge, with zero downtime (the owner's rule).
  1. Migrate first: only `notifications.0006`, with the live venv and `lock_timeout`, after checking it is the only pending migration.
  2. Run a full blue-green release (`bg-phaseA.<sha>.sh` then `bg-phaseB.sh`), because the frontend changed. All probes must return 200. Check the deploy lock and the live release first, because other sessions deploy too.
  3. Badges, banner and /ops Trials are live immediately. `LCUP_ATTENDANCE_CHECKS_ENABLED` stays OFF.
  4. On prod, run `cd /var/www/satapp/current/backend && sudo -u satapp ./venv/bin/python manage.py attendance_check_preview --day <a lesson day>` and send the output to the owner.
  5. Only after the owner says "yoqing":
     - append `LCUP_ATTENDANCE_CHECKS_ENABLED=True` to `shared/backend.env` (with a `.bak-` copy);
     - do a gunicorn TTIN/TTOU reload;
     - restart the celery worker and beat;
     - watch the first lesson end (`Notification.objects.filter(event="ATTENDANCE_CHECK")`).
  6. Rollback: delete the line, then repeat the reload.

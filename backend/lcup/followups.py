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

import logging
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceRecord

from .conf import attendance_checks_enabled, free_trial_lessons, lcup_enabled
from .models import GroupLinkStatus, LcupMembership, LinkStatus
from .serializers import user_ref

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


logger = logging.getLogger("lcup.followups")

#: How long after a lesson ends its check may still go out: a beat that missed a run (a restart, a
#: slow worker) catches up, but a lesson is never announced long after the teacher has left.
CHECK_GRACE_MINUTES = 30


def _meeting_classes(day: date, *, order_by: str = "pk"):
    """``(classroom, (starts_at, ends_at))`` of each active paired class that holds a lesson on ``day``:
    its weekday is one of the class's, the class has begun (``start_date`` is the school's own answer
    and wins, as in ``classes.attendance_auto``), and its ``lesson_time`` can be read — without a
    readable time there is no end to wait for and no close to name. The one place that decides it,
    so the beat and the preview cannot disagree about which classes there is a message for."""
    from classes.lesson_schedule import lesson_interval, lesson_weekdays
    from classes.models import Classroom

    rooms = Classroom.objects.filter(
        is_active=True,
        lcup_group_link__status=GroupLinkStatus.CONFIRMED,
        lcup_group_link__deleted_in_lcup_at__isnull=True,
    ).order_by(order_by)
    for room in rooms:
        if day.weekday() not in lesson_weekdays(room):
            continue
        if room.start_date and day < room.start_date:
            continue
        interval = lesson_interval(room, day)
        if interval is None:
            continue
        yield room, interval


def due_lessons(now) -> list[tuple]:
    """``(classroom, day)`` of each paired class whose lesson ended in the last CHECK_GRACE_MINUTES
    and whose register is still open."""
    from classes.attendance_window import marking_window

    day = timezone.localdate(now)
    due = []
    for room, (_starts_at, ends_at) in _meeting_classes(day):
        if ends_at <= now < ends_at + timedelta(minutes=CHECK_GRACE_MINUTES) and now < marking_window(room, day)[1]:
            due.append((room, day))
    return due


def teachers_by_room(room_ids) -> dict[int, list]:
    """Who runs each class — owner and teachers (lc-up's teachers on a paired class), not assistants —
    in one query. The one definition: the lesson-end message and /ops/trials both name these people."""
    seats = ClassroomMembership.objects.filter(
        classroom_id__in=room_ids,
        role__in=ClassroomMembership.MANAGER_ROLES,
        status=ClassroomMembership.STATUS_ACTIVE,
        user__is_active=True,
        user__is_frozen=False,
    ).select_related("user").order_by("pk")
    teachers: dict[int, list] = {}
    for seat in seats:
        teachers.setdefault(seat.classroom_id, []).append(seat.user)
    return teachers


def teachers_of(classroom):
    """Who runs the class (see ``teachers_by_room``)."""
    return teachers_by_room([classroom.pk]).get(classroom.pk, [])


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
                    link_url=f"/teacher/classrooms/{room.pk}?tab=attendance", dedupe_key=key,
                )
                if row is not None:
                    counts["notified"] += 1
        except Exception:
            logger.exception("attendance_check_failed classroom=%s", room.pk)
            counts["failed"] += 1
    return dict(counts)


def preview_lesson_checks(day: date) -> list[dict]:
    """Every paired class that holds a lesson on ``day``, with what its teachers would be told had that
    lesson just ended. Sends nothing and ignores the switch — it is how the owner sees the messages first."""
    rows = []
    for room, _interval in _meeting_classes(day, order_by="name"):
        check = lesson_check(room, day)
        rows.append({
            "classroom": room.name,
            "teachers": [user_ref(t)["name"] for t in teachers_of(room)],
            "title": check.title,
            "body": check.body,
            "sends": not check.is_empty,
        })
    return rows

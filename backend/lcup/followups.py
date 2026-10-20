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
from datetime import date, datetime

from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceRecord

from .conf import free_trial_lessons, lcup_enabled
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

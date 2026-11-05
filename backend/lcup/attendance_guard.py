"""What the classes app asks of lc-up about a register — imported lazily from ``classes``, the way
``lcup.guards`` is, so ``classes`` keeps no import-time dependency on this app."""

from __future__ import annotations

from classes.models import ClassroomMembership

from .conf import attendance_pull_enabled, attendance_push_enabled, free_trial_lessons, lcup_enabled
from .followups import missing_seats, trial_seats
from .guards import is_lcup_managed
from .models import GroupLinkStatus, LcupAbsenceReason, LcupMembership

#: What a closed register of a paired class says while lc-up is its source (owner, 2026-10-14:
#: "lc-up ustun, biz faqat bo'shliqni to'ldiramiz").
LOCKED_REASON = (
    "Attendance for this class comes from lc-up once the lesson is over. "
    "Correct it in lc-up — it reaches here within 15 minutes."
)


def follows_lcup(classroom) -> bool:
    """A closed register of this class is lc-up's, so nobody here writes it."""
    return attendance_pull_enabled() and is_lcup_managed(classroom)


def pushes_to_lcup(classroom) -> bool:
    """This class's closed registers are sent to lc-up, so they must close inside lc-up's window."""
    return attendance_push_enabled() and follows_lcup(classroom)


#: lc-up's status for a member it has paused: still in the group, but not attending and not billed.
FROZEN = "frozen"

#: Why a register offers no mark for such a student (owner, 2026-10-17: "Belgilab bo'lmaydi").
FROZEN_REASON = "Frozen in lc-up. lc-up takes no attendance for them — unfreeze them in lc-up first."


def frozen_in_lcup(classroom) -> set[int]:
    """Our user ids frozen in this class. lc-up refuses every mark for a frozen member
    (``not_in_group``: 13 of 13 refusals up to 2026-10-16, against 102 of 102 active and trial marks
    taken), so the register offers none and the push sends none. The seat itself says so; while lc-up
    runs the class its own list counts too, so a seat the sync has not filled yet loses nobody. In a class
    lc-up does not run while it is on, nothing writes the seat, so a status copied earlier says nothing."""
    managed = is_lcup_managed(classroom)
    if lcup_enabled() and not managed:
        return set()
    frozen = set(
        ClassroomMembership.objects.filter(
            classroom=classroom,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
            seat_status=ClassroomMembership.SEAT_FROZEN,
        ).values_list("user_id", flat=True)
    )
    if not managed:
        return frozen
    return frozen | set(
        LcupMembership.objects.filter(
            group__classroom=classroom,
            group__status=GroupLinkStatus.CONFIRMED,
            group__deleted_in_lcup_at__isnull=True,
            left_at__isnull=True,
            lcup_status=FROZEN,
            student__user__isnull=False,
        ).values_list("student__user_id", flat=True)
    )


def excuse_reasons(classroom) -> list[dict]:
    """lc-up's reasons an excused absence in this class must name; none for a class lc-up does not run."""
    if not is_lcup_managed(classroom):
        return []
    return [{"id": r.lcup_reason_id, "title": r.title} for r in LcupAbsenceReason.objects.order_by("lcup_reason_id")]


def trial_in_lcup(classroom, day) -> dict[int, dict]:
    """Our user ids lc-up holds on trial in this class's group, with the lessons each came to here
    before ``day``. ``free_used``: they have had the free trial, so the teacher sends them to the
    admin (owner, 2026-10-20)."""
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

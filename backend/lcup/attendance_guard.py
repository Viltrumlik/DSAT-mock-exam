"""What the classes app asks of lc-up about a register — imported lazily from ``classes``, the way
``lcup.guards`` is, so ``classes`` keeps no import-time dependency on this app."""

from __future__ import annotations

from .conf import attendance_pull_enabled, free_trial_lessons
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


#: lc-up's status for a member it has paused: still in the group, but not attending and not billed.
FROZEN = "frozen"

#: Why a register offers no mark for such a student (owner, 2026-10-17: "Belgilab bo'lmaydi").
FROZEN_REASON = "Frozen in lc-up. lc-up takes no attendance for them — unfreeze them in lc-up first."


def frozen_in_lcup(classroom) -> set[int]:
    """Our user ids lc-up holds frozen in this class's group. lc-up refuses every mark for a
    frozen member (``not_in_group``: 13 of 13 refusals up to 2026-10-16, against 102 of 102
    active and trial marks taken), so the register offers none and the push sends none."""
    if not is_lcup_managed(classroom):
        return set()
    return set(
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

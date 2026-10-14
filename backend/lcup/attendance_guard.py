"""What the classes app asks of lc-up about a register — imported lazily from ``classes``, the way
``lcup.guards`` is, so ``classes`` keeps no import-time dependency on this app."""

from __future__ import annotations

from .conf import attendance_pull_enabled
from .guards import is_lcup_managed
from .models import LcupAbsenceReason

#: What a closed register of a paired class says while lc-up is its source (owner, 2026-10-14:
#: "lc-up ustun, biz faqat bo'shliqni to'ldiramiz").
LOCKED_REASON = (
    "Attendance for this class comes from lc-up once the lesson is over. "
    "Correct it in lc-up — it reaches here within 15 minutes."
)


def follows_lcup(classroom) -> bool:
    """A closed register of this class is lc-up's, so nobody here writes it."""
    return attendance_pull_enabled() and is_lcup_managed(classroom)


def excuse_reasons(classroom) -> list[dict]:
    """lc-up's reasons an excused absence in this class must name; none for a class lc-up does not run."""
    if not is_lcup_managed(classroom):
        return []
    return [{"id": r.lcup_reason_id, "title": r.title} for r in LcupAbsenceReason.objects.order_by("lcup_reason_id")]

"""The sync's say over who is a learning-center student — by the seat rule (owner, 2026-10-14).

"Guruhi yo'q studentlar to'g'ridan to'g'ri public bo'lib qolsin": a student with no seat in an active
class becomes a public learner (frozen first when lc-up shows a debt), and a public learner who has
one — the roster just added them — is a student again (``users.audience.seat_plan``). It runs after
the rosters, so a seat lc-up added or took away this run already counts. A leaver frozen for debt is
let go once lc-up shows the balance paid.

Two brakes: a run that hit any error changes no role (a failed page must never read as "left"),
and more than MAX_DEMOTIONS_PER_RUN leavers at once are held as an alert for a human to look at.
"""

from __future__ import annotations

from django.conf import settings

from access import constants as C
from users import audience as A

from .models import LcupStudentLink

MAX_DEMOTIONS_PER_RUN = 20


def apply(run) -> None:
    if not getattr(settings, "PUBLIC_SPLIT_ENABLED", False):
        return
    if run.errors:
        run.alerts.append("role changes held: this sync had errors")
        return
    leaving, joining = A.seat_plan()
    for u in joining:
        A.make_centre(u, reason=A.REASON_JOINED, source=A.SOURCE_SYNC)
        run.counts["became_centre"] += 1
    if len(leaving) > MAX_DEMOTIONS_PER_RUN:
        run.alerts.append(f"role changes held: {len(leaving)} leavers > {MAX_DEMOTIONS_PER_RUN} in one run")
        run.counts["demotions_held"] += len(leaving)
    else:
        for u, owes in leaving:
            A.make_public(
                u, reason=A.REASON_LEFT_WITH_DEBT if owes else A.REASON_LEFT, source=A.SOURCE_SYNC,
                freeze_for_debt=owes,
            )
            run.counts["became_public"] += 1
            run.counts["frozen_for_debt"] += int(owes)
    paid = LcupStudentLink.objects.filter(
        user__role=C.ROLE_PUBLIC_STUDENT, user__is_frozen=True, user__frozen_reason=A.FROZEN_LCUP_DEBT,
        balance__gte=0,
    ).select_related("user")
    for link in paid:
        if A.clear_debt_freeze(link.user, source=A.SOURCE_SYNC):
            run.counts["debt_cleared"] += 1

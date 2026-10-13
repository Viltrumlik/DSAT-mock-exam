"""The sync's say over who is a learning-center student (plan 2026-10-13).

Only LINKED learners are touched: lc-up decides about its own people, an administrator about
everyone else. In a live group → student. Out of every live group → public_student, frozen first
when lc-up shows a negative balance; the freeze lifts once the balance is back to zero or above.

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
    if not getattr(settings, "PUBLIC_SPLIT_ENABLED", False) or not run.review_done:
        return
    if run.errors:
        run.alerts.append("role changes held: this sync had errors")
        return
    from .sync import live_student_ids

    live = live_student_ids()
    links = LcupStudentLink.objects.filter(user__isnull=False, user__role__in=C.LEARNER_ROLES).select_related("user")
    joining, leaving, paid = [], [], []
    for link in links:
        u = link.user
        if link.pk in live and not link.deleted_in_lcup:
            if u.role != C.ROLE_STUDENT or (u.is_frozen and u.frozen_reason == A.FROZEN_LCUP_DEBT):
                joining.append(u)
        elif u.role == C.ROLE_STUDENT:
            leaving.append((u, link.balance is not None and link.balance < 0))
        elif u.frozen_reason == A.FROZEN_LCUP_DEBT and link.balance is not None and link.balance >= 0:
            paid.append(u)

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
    for u in paid:
        if A.clear_debt_freeze(u, source=A.SOURCE_SYNC):
            run.counts["debt_cleared"] += 1

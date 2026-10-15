"""Practice tests: the centre's own standalone sections (owner decisions 2026-10-14/15).

ONE visibility rule serves the student list, the detail page and attempt creation, so a
student can never see a practice test they cannot start (the old packs did exactly that:
listed to everyone, 404 on Start).
"""
from __future__ import annotations

from django.db import transaction
from django.db.models import Q

from access import constants as acc_const
from core.authz import normalized_role

from .models import PracticeTest


def live_group_levels(user) -> set[str]:
    """Levels of the classes the user studies in right now (ACTIVE member of an ACTIVE class)."""
    from classes.models import ClassroomMembership  # classes imports exams

    if not getattr(user, "is_authenticated", False):
        return set()
    levels = ClassroomMembership.objects.filter(
        user=user,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
        classroom__is_active=True,
    ).values_list("classroom__level", flat=True)
    return {lvl for lvl in levels if lvl}


def visible_practice_tests_q(user) -> Q:
    """Practice tests this learner may see and start.

    Open + published + level blank or one of the learner's group levels (exact match), OR given
    to the learner through homework / an admin (``assigned_users``). A public learner gets nothing.
    """
    if not getattr(user, "is_authenticated", False) or normalized_role(user) == acc_const.ROLE_PUBLIC_STUDENT:
        return Q(pk__in=[])
    levels = live_group_levels(user)
    level_ok = Q(practice_level="") | Q(practice_level__in=levels)
    open_to_learner = Q(is_published=True, practice_access=PracticeTest.ACCESS_OPEN) & level_ok
    # A subquery, not Q(assigned_users=user): that is a LEFT JOIN under an OR, which repeats an open
    # test once per assigned user and makes .get(pk=...) raise MultipleObjectsReturned.
    given = Q(pk__in=PracticeTest.assigned_users.through.objects.filter(user_id=user.pk).values("practicetest_id"))
    return Q(is_practice_test=True, mock_exam__isnull=True) & (open_to_learner | given)


def assign_practice_number(section: PracticeTest) -> None:
    """Give a practice test its permanent number (next free in its subject). Idempotent."""
    if not section.is_practice_test or section.practice_number is not None:
        return
    with transaction.atomic():
        # Lock the subject's practice tests so two first-publishes can't take the same number;
        # the partial unique constraint is the backstop.
        rows = list(
            PracticeTest.objects.select_for_update()
            .filter(is_practice_test=True, subject=section.subject)
            .values_list("pk", "practice_number")
        )
        # Re-read under the lock: this instance may be stale (a double-click publish), and a
        # number once given is never changed or burned.
        current = next((n for pk, n in rows if pk == section.pk), None)
        if current is not None:
            section.practice_number = current
            return
        top = max((n for _, n in rows if n is not None), default=0)
        section.practice_number = top + 1
        section.save(update_fields=["practice_number", "updated_at"])


def practice_display_title(section) -> str:
    """'Practice Test N' for a numbered practice test, else the section's own title."""
    if getattr(section, "is_practice_test", False) and getattr(section, "practice_number", None):
        return f"Practice Test {section.practice_number}"
    return (getattr(section, "title", "") or "").strip()

"""The one place a learner's role or debt freeze changes (public vs learning center, plan 2026-10-13).

A learning-center student is role ``student``: a learner with a seat in a class (``seat_plan``,
owner 2026-10-14). A public learner is role ``public_student``: everyone else. The lc-up sync
(``lcup.audience``) and ``split_public_students`` call these; nothing else should move an existing
account between the two. Each call is one
transaction and writes one ``RoleChange``, which is what the /ops numbers and ``--revert`` read.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction

from access import constants as C

from .models import RoleChange, User

FROZEN_LCUP_DEBT = "lcup_debt"

SOURCE_SYNC = "lcup_sync"
SOURCE_SPLIT = "split"

REASON_INITIAL_SPLIT = "initial_split"
REASON_JOINED = "lcup_joined"
REASON_LEFT = "lcup_left"
REASON_LEFT_WITH_DEBT = "lcup_left_with_debt"
REASON_DEBT_PAID = "lcup_debt_paid"


def seated_user_ids() -> set[int]:
    """Accounts with an ACTIVE student seat in an active class — a learning-center student's mark."""
    from classes.models import ClassroomMembership

    return set(
        ClassroomMembership.objects.filter(
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
            classroom__is_active=True,
        ).values_list("user_id", flat=True)
    )


def seat_plan() -> tuple[list[tuple[User, bool]], list[User]]:
    """Who moves under the seat rule (owner, 2026-10-14: "guruhi yo'q studentlar to'g'ridan to'g'ri
    public bo'lib qolsin"): an active ``student`` with no seat becomes public — ``owes`` when lc-up
    shows a debt, so they are frozen on the way out — and a public learner with a seat becomes a
    student again. It replaced "linked AND in a live lc-up group" (2026-10-13); the rosters mirror
    lc-up, so for lc-up students the two agree."""
    from lcup.models import LcupStudentLink

    seated = seated_user_ids()
    owing = set(
        LcupStudentLink.objects.filter(user__isnull=False, balance__lt=0).values_list("user_id", flat=True)
    )
    to_public = [
        (u, u.pk in owing)
        for u in User.objects.filter(role=C.ROLE_STUDENT, is_active=True).exclude(pk__in=seated).order_by("pk")
    ]
    to_centre = list(User.objects.filter(role=C.ROLE_PUBLIC_STUDENT, is_active=True, pk__in=seated).order_by("pk"))
    return to_public, to_centre


def self_signup_role() -> str:
    """The role an account made on the site itself gets (register, Google, Telegram)."""
    return C.ROLE_PUBLIC_STUDENT if getattr(settings, "PUBLIC_SPLIT_ENABLED", False) else C.ROLE_STUDENT


#: The iOS and Windows apps are the learning center's: classes, homework and midterms, all closed
#: to a public learner. A clear "no" at sign-in beats an app full of error states.
NATIVE_APP_REFUSAL = "This app is for learning center students. Please use mastersat.uz in your browser."
#: ``windows/`` and ``macos/`` are the native desktop app; a bare ``desktop`` is its 0.1.x predecessor.
_CENTRE_APP_CLIENTS = ("ios/", "windows/", "macos/", "desktop")


def is_public_learner(user) -> bool:
    return str(getattr(user, "role", "") or "").strip().lower() == C.ROLE_PUBLIC_STUDENT


def refused_on_native_app(request, user) -> bool:
    """True when ``user`` is a public learner and ``request`` comes from the iOS or Windows app."""
    from .auth_cookies import NATIVE_CLIENT_HEADER

    if not is_public_learner(user):
        return False
    headers = getattr(request, "headers", None) or {}
    client = str(headers.get(NATIVE_CLIENT_HEADER, "") or "").strip().lower()
    return client.startswith(_CENTRE_APP_CLIENTS)


def kind_of(user) -> str:
    """How /ops groups an account: centre, public, frozen_debt, frozen_admin, or staff."""
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role not in C.LEARNER_ROLES:
        return "staff"
    if getattr(user, "is_frozen", False):
        return "frozen_debt" if getattr(user, "frozen_reason", "") == FROZEN_LCUP_DEBT else "frozen_admin"
    return "centre" if role == C.ROLE_STUDENT else "public"


def _locked(user) -> User:
    fresh = User.objects.select_for_update().get(pk=user.pk)
    if fresh.role not in C.LEARNER_ROLES:
        raise ValueError(f"user {fresh.pk} is staff ({fresh.role}); only learners move between centre and public")
    return fresh


def _sync_caller_copy(user, fresh) -> None:
    user.role, user.is_frozen, user.frozen_reason = fresh.role, fresh.is_frozen, fresh.frozen_reason


def _remove_student_seats(user) -> list[list]:
    """Remove every student seat; returns ``[[membership_id, status_before], ...]`` so a revert can
    put back an INVITED seat as INVITED, not ACTIVE."""
    from classes.models import ClassroomMembership

    removed = []
    seats = ClassroomMembership.objects.filter(user=user, role=ClassroomMembership.ROLE_STUDENT).exclude(
        status=ClassroomMembership.STATUS_REMOVED
    )
    for seat in seats:  # .save(), never .update(): the audit, Telegram and library signals must fire
        removed.append([seat.pk, seat.status])
        seat.status = ClassroomMembership.STATUS_REMOVED
        seat.save()
    return removed


@transaction.atomic
def make_public(user, *, reason, source, freeze_for_debt=False, run_id=None) -> RoleChange:
    """Public learner from now on: every student seat goes. ``freeze_for_debt`` freezes the account
    with the debt reason, unless an administrator froze it already (theirs keeps its "" reason)."""
    u = _locked(user)
    from_role = u.role
    froze = False
    fields = ["role"]
    u.role = C.ROLE_PUBLIC_STUDENT
    if freeze_for_debt and not u.is_frozen:
        u.is_frozen, u.frozen_reason, froze = True, FROZEN_LCUP_DEBT, True
        fields += ["is_frozen", "frozen_reason"]
    u.save(update_fields=fields)
    removed = _remove_student_seats(u)
    _sync_caller_copy(user, u)
    return RoleChange.objects.create(
        user=u, from_role=from_role, to_role=u.role, froze=froze, reason=reason, source=source,
        lcup_run_id=run_id, removed_membership_ids=removed,
    )


@transaction.atomic
def make_centre(user, *, reason, source, run_id=None) -> RoleChange:
    """A learning-center student from now on. A debt freeze is lifted: they are back at the center."""
    u = _locked(user)
    from_role = u.role
    unfroze = False
    fields = ["role"]
    u.role = C.ROLE_STUDENT
    if u.is_frozen and u.frozen_reason == FROZEN_LCUP_DEBT:
        u.is_frozen, u.frozen_reason, unfroze = False, "", True
        fields += ["is_frozen", "frozen_reason"]
    u.save(update_fields=fields)
    _sync_caller_copy(user, u)
    return RoleChange.objects.create(
        user=u, from_role=from_role, to_role=u.role, unfroze=unfroze, reason=reason, source=source,
        lcup_run_id=run_id,
    )


@transaction.atomic
def freeze_for_debt(user, *, reason, source, run_id=None) -> RoleChange | None:
    """Freeze a learner who owes the centre (lc-up's balance below zero after the month's due day).
    An account already frozen — for debt, or by an administrator — is left as it is."""
    u = _locked(user)
    if u.is_frozen:
        return None
    u.is_frozen, u.frozen_reason = True, FROZEN_LCUP_DEBT
    u.save(update_fields=["is_frozen", "frozen_reason"])
    _sync_caller_copy(user, u)
    return RoleChange.objects.create(
        user=u, from_role=u.role, to_role=u.role, froze=True, reason=reason, source=source, lcup_run_id=run_id,
    )


@transaction.atomic
def clear_debt_freeze(user, *, source, run_id=None) -> RoleChange | None:
    """Lift a debt freeze (the balance is paid). Any other freeze is an administrator's: untouched."""
    u = _locked(user)
    if not (u.is_frozen and u.frozen_reason == FROZEN_LCUP_DEBT):
        return None
    u.is_frozen, u.frozen_reason = False, ""
    u.save(update_fields=["is_frozen", "frozen_reason"])
    _sync_caller_copy(user, u)
    return RoleChange.objects.create(
        user=u, from_role=u.role, to_role=u.role, unfroze=True, reason=REASON_DEBT_PAID, source=source,
        lcup_run_id=run_id,
    )

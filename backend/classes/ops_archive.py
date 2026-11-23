"""The /ops Archive (lc-up structure canvas, Archive board, owner 22 Nov 2026): the students who left a group, and
the groups that were archived. Read-only — bringing a student back is the group's own Add (``classes.seat_actions``).

What is kept, and so what is shown:

* **A leaver** is a STUDENT seat whose status is REMOVED. The day they left is ``seat_left_on`` (the seat actions and
  lc-up's ``left_at`` fill it); for an older removal with no such day, the day the membership history
  (``ClassroomMembershipEvent``, since 2026-08-29) recorded it. Who removed them is that history's ``actor_name`` —
  empty when nobody clicked (lc-up's sync, a command).
* **No reason** for leaving is kept anywhere: not by the seat actions, not by the membership history, and lc-up's
  External API sends none. So there is no reason column and no "why students left" summary.
* **The balance** is the student's lc-up balance NOW — the balance on the day they left is not kept. It goes only to
  ``view_money`` holders, and so does the "owes money now" filter.
* **An archived group** is a class with ``is_active`` off. When lc-up deleted it, the sync wrote the day
  (``LcupGroupLink.class_archived_at``); a class an admin archived by hand has no such day.
"""

from __future__ import annotations

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from users.changelist import apply_search, facets, paginate, to_int
from users.people_detail import display_name, iso, section_of

from .models import Classroom, ClassroomMembership as M
from .models_membership_audit import ClassroomMembershipEvent as Event

STUDENT_SEARCH = [
    "user__first_name", "user__last_name", "user__username", "user__phone_number", "user__lcup_student_link__phone",
]
GROUP_SEARCH = ["name", "room_number", "teacher__first_name", "teacher__last_name", "teacher__username"]


def _last_removal(field: str) -> Subquery:
    """The newest REMOVED event of this very seat (its class and its student): when, or by whom."""
    events = Event.objects.filter(
        classroom_id=OuterRef("classroom_id"), student_id=OuterRef("user_id"), action=Event.ACTION_REMOVED
    ).order_by("-created_at", "-pk")
    return Subquery(events.values(field)[:1])


def left_seats():
    """Every student seat that ended, each with the day it ended (``left_day``) and who ended it (``removed_by``)."""
    return (
        M.objects.filter(role=M.ROLE_STUDENT, status=M.STATUS_REMOVED)
        .annotate(removed_at=_last_removal("created_at"), removed_by=_last_removal("actor_name"))
        .annotate(left_day=Coalesce("seat_left_on", TruncDate("removed_at")))
    )


def _group_choices(qs):
    rows = qs.order_by().values("classroom_id", "classroom__name").annotate(n=Count("pk", distinct=True))
    return sorted(((str(r["classroom_id"]), r["classroom__name"], r["n"]) for r in rows), key=lambda c: c[1].casefold())


def _teacher_choices(qs):
    rows = (
        qs.exclude(classroom__teacher__isnull=True).order_by()
        .values("classroom__teacher_id", "classroom__teacher__first_name", "classroom__teacher__last_name",
                "classroom__teacher__username")
        .annotate(n=Count("pk", distinct=True))
    )
    out = [
        (
            str(r["classroom__teacher_id"]),
            f"{r['classroom__teacher__first_name'] or ''} {r['classroom__teacher__last_name'] or ''}".strip()
            or r["classroom__teacher__username"],
            r["n"],
        )
        for r in rows
    ]
    return sorted(out, key=lambda c: c[1].casefold())


OWES_NOW = Q(user__lcup_student_link__balance__lt=0)


def _owes_now():
    """``OWES_NOW``, by the ledger once it is the master (leaving lc-up, 1 Dec 2026)."""
    from billing.conf import ledger_is_ours

    if ledger_is_ours():
        from billing.reads import owing_user_ids

        return Q(user__pk__in=owing_user_ids())
    return OWES_NOW


def student_filters(*, money: bool) -> dict:
    defs = {
        "classroom": ("Group", _group_choices, lambda v: Q(classroom_id=to_int(v)) if to_int(v) else None),
        "teacher": ("Teacher", _teacher_choices, lambda v: Q(classroom__teacher_id=to_int(v)) if to_int(v) else None),
    }
    if money:
        # Only with the money: a filter on a balance says the balance, even with the column hidden.
        defs["owing"] = (
            "Owes money now",
            lambda qs: [("1", "Owes money now", qs.filter(_owes_now()).count())],
            lambda v: _owes_now() if v == "1" else None,
        )
    return defs


def _one_to_one(obj, name: str):
    """A reverse one-to-one (``user.lcup_student_link``, ``room.lcup_group_link``), or None when there is none."""
    try:
        return getattr(obj, name)
    except ObjectDoesNotExist:
        return None


def student_row(seat, *, money: bool) -> dict:
    user, room = seat.user, seat.classroom
    link = _one_to_one(user, "lcup_student_link")
    started = seat.seat_start_date or (timezone.localdate(seat.joined_at) if seat.joined_at else None)
    row = {
        "id": seat.pk,
        "student": {
            "id": user.pk, "name": display_name(user), "section": section_of(user),
            "phone": user.phone_number or (link.phone if link else "") or "",
        },
        "group": {
            "id": room.pk, "name": room.name, "level": room.level or "", "subject": room.subject or "",
            "is_active": room.is_active, "teacher": display_name(room.teacher) if room.teacher_id else "",
        },
        "started_on": iso(started),
        "left_on": iso(seat.left_day),
        "removed_by": seat.removed_by or "",
    }
    if money:
        from billing.conf import ledger_is_ours

        if ledger_is_ours():
            from billing.reads import balances_by_user

            row["balance"] = balances_by_user([user.pk]).get(user.pk)
        else:
            row["balance"] = int(link.balance) if link is not None and link.balance is not None else None
    return row


def students_page(params, *, money: bool) -> dict:
    """``{count, page, page_size, pages, results, filters, total}``: newest leavers first, a day unknown last."""
    qs = apply_search(left_seats(), params.get("q") or "", STUDENT_SEARCH)
    qs, filters = facets(qs, student_filters(money=money), params)
    qs = qs.select_related("user", "user__lcup_student_link", "classroom", "classroom__teacher")
    window, meta = paginate(qs.order_by(F("left_day").desc(nulls_last=True), "-pk"), params)
    return {**meta, "results": [student_row(s, money=money) for s in window], "filters": filters}


def group_row(room) -> dict:
    link = _one_to_one(room, "lcup_group_link")
    return {
        "id": room.pk, "name": room.name, "level": room.level or "", "subject": room.subject or "",
        "teacher": display_name(room.teacher) if room.teacher_id else "",
        "start_date": iso(room.start_date),
        "created_at": iso(timezone.localdate(room.created_at)) if room.created_at else None,
        # Only lc-up's deletion leaves the day; a class an admin archived by hand has none.
        "archived_on": iso(timezone.localdate(link.class_archived_at)) if link and link.class_archived_at else None,
        "left": getattr(room, "left", 0) or 0,
    }


def groups_page(params) -> dict:
    """``{count, page, page_size, pages, results}``: archived classes, the most recently archived by lc-up first."""
    qs = apply_search(Classroom.objects.filter(is_active=False), params.get("q") or "", GROUP_SEARCH)
    qs = qs.select_related("teacher", "lcup_group_link")
    ordered = qs.order_by(F("lcup_group_link__class_archived_at").desc(nulls_last=True), "-created_at", "-pk")
    window, meta = paginate(ordered, params)
    rooms = list(window)
    left = dict(
        M.objects.filter(classroom_id__in=[r.pk for r in rooms], role=M.ROLE_STUDENT, status=M.STATUS_REMOVED)
        .order_by().values_list("classroom_id").annotate(n=Count("pk"))
    )
    for room in rooms:
        room.left = left.get(room.pk, 0)
    return {**meta, "results": [group_row(r) for r in rooms]}


def totals() -> dict:
    """The tab counts: every leaver and every archived class, whatever the filters."""
    return {
        "students": M.objects.filter(role=M.ROLE_STUDENT, status=M.STATUS_REMOVED).count(),
        "groups": Classroom.objects.filter(is_active=False).count(),
    }

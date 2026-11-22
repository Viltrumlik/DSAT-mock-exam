"""``GET /api/users/admin/people/`` — the /ops Students, Public users and Staff lists (plan 2026-10-14).

The owner: "admin panelda public userlar bilan studentlarni ajrating … to'liq ajratilsin boshqa boshqa
joylarga", and the console should read like Django admin. So each section is its own list, and the
server does what a changelist needs: search, filters with a count beside every choice (counted with the
search and every OTHER filter applied, as a facet is), ordering and pages.

``/users/admin/list/`` stays as it is: two other callers read it as one bare list.
"""

from __future__ import annotations

import re
from datetime import timedelta

from django.db.models import Count, F, OuterRef, Prefetch, Q, Subquery
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import Requires
from access.services import authorize
from classes.models import Classroom, ClassroomMembership

from . import audience as A
from .activity import with_activity_counts
from .changelist import DEFAULT_PAGE_SIZE, PAGE_SIZES  # noqa: F401 — still importable from here
from .changelist import apply_search, facets, page_slice, paginate, to_int
from .models import RefreshSession
from .views import manageable_users_queryset

SECTIONS = {
    "students": Q(role=C.ROLE_STUDENT),
    "public": Q(role=C.ROLE_PUBLIC_STUDENT),
    "staff": ~Q(role__in=C.LEARNER_ROLES),
}
PEOPLE_SEARCH = ["username", "first_name", "last_name", "email", "phone_number"]

_STATUS = {
    "active": Q(is_frozen=False),
    "frozen_debt": Q(is_frozen=True, frozen_reason=A.FROZEN_LCUP_DEBT),
    "frozen_admin": Q(is_frozen=True) & ~Q(frozen_reason=A.FROZEN_LCUP_DEBT),
}
_STATUS_LABELS = (("active", "Active"), ("frozen_debt", "Frozen — unpaid"), ("frozen_admin", "Frozen — by admin"))
_STAFF_STATUS = {"active": Q(is_frozen=False), "frozen": Q(is_frozen=True)}
_ROLE_LABELS = dict(C.ROLE_CHOICES)
_SUBJECT_LABELS = {"math": "Math", "english": "English", "both": "Both"}


def _seat_q():
    return Q(
        role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE, classroom__is_active=True
    )


def _seated_in(**classroom):
    seats = ClassroomMembership.objects.filter(_seat_q(), **{f"classroom__{k}": v for k, v in classroom.items()})
    return Q(pk__in=seats.values("user_id"))


_int = to_int  # FILTERS below read it by this name


# ── filters ───────────────────────────────────────────────────────────────
# Each: key → (label, choices(qs) -> [(value, label, count)], q(value) -> Q | None).


def _fixed(qs, table, labels):
    return [(value, label, qs.filter(table[value]).count()) for value, label in labels]


def _joined_q(value):
    now = timezone.now()
    return {
        "7d": Q(date_joined__gte=now - timedelta(days=7)),
        "30d": Q(date_joined__gte=now - timedelta(days=30)),
        "older": Q(date_joined__lt=now - timedelta(days=30)),
    }.get(value)


def _group_choices(qs):
    rows = (
        ClassroomMembership.objects.filter(_seat_q(), user_id__in=qs.values("pk"))
        .values("classroom_id", "classroom__name")
        .annotate(n=Count("user_id", distinct=True))
        .order_by("classroom__name")
    )
    return [(str(r["classroom_id"]), r["classroom__name"], r["n"]) for r in rows]


def _teacher_choices(qs):
    rows = (
        ClassroomMembership.objects.filter(_seat_q(), user_id__in=qs.values("pk"), classroom__teacher__isnull=False)
        .values("classroom__teacher_id", "classroom__teacher__first_name", "classroom__teacher__last_name",
                "classroom__teacher__username")
        .annotate(n=Count("user_id", distinct=True))
    )
    out = []
    for r in rows:
        name = f"{r['classroom__teacher__first_name']} {r['classroom__teacher__last_name']}".strip()
        out.append((str(r["classroom__teacher_id"]), name or r["classroom__teacher__username"], r["n"]))
    return sorted(out, key=lambda c: c[1].casefold())


def _same_name_ids() -> list[int]:
    """Active learners whose first and last name (any case) another active learner also has — the
    duplicate accounts the owner keeps having to untangle."""
    from django.db.models.functions import Lower

    from .models import User

    rows = (
        User.objects.filter(role__in=C.LEARNER_ROLES, is_active=True)
        .exclude(first_name="").exclude(last_name="")
        .annotate(f=Lower("first_name"), l=Lower("last_name"))
        .values_list("pk", "f", "l")
    )
    by_name: dict[tuple[str, str], list[int]] = {}
    for pk, f, l in rows:
        by_name.setdefault((f.strip(), l.strip()), []).append(pk)
    return [pk for ids in by_name.values() if len(ids) > 1 for pk in ids]


def _seated_with(**seat):
    """Holds an active seat, in an active class, whose seat fields match ``seat`` (any seat when none given)."""
    return Q(pk__in=ClassroomMembership.objects.filter(_seat_q(), **seat).values("user_id"))


def _show_q(value):
    """The Students list's chips (lc-up's statuses): who owes, who is on a trial or frozen seat, who sits nowhere."""
    seat = ClassroomMembership
    if value == "owes":
        return Q(lcup_student_link__balance__lt=0)
    if value == "trial":
        return _seated_with(seat_status=seat.SEAT_TRIAL)
    if value == "frozen":
        return _seated_with(seat_status=seat.SEAT_FROZEN)
    if value == "nogroup":
        return ~_seated_with()
    return None


_SHOW_LABELS = (("owes", "Owe money"), ("trial", "Trial"), ("frozen", "Frozen"), ("nogroup", "No group"))

_SHOW = (
    "Show",
    # "all" counts the list with every OTHER filter applied — the chip bar's "All". Asking for it filters nothing.
    lambda qs: [("all", "All", qs.count())] + [(v, label, qs.filter(_show_q(v)).count()) for v, label in _SHOW_LABELS],
    _show_q,
)

_LEVEL_ORDER = {level: i for i, (level, _) in enumerate(Classroom.LEVEL_CHOICES)}
_LEVEL_WORDS = dict(Classroom.LEVEL_CHOICES)
_CLASS_SUBJECTS = dict(Classroom.SUBJECT_CHOICES)


def _course_label(level: str, subject: str) -> str:
    """"Junior Math" — a course the way lc-up names it."""
    return f"{_LEVEL_WORDS.get(level, level.title())} {_CLASS_SUBJECTS.get(subject, subject.title())}".strip()


def _course_choices(qs):
    rows = (
        ClassroomMembership.objects.filter(_seat_q(), user_id__in=qs.values("pk"))
        .exclude(classroom__level="").exclude(classroom__level__isnull=True)
        .values("classroom__level", "classroom__subject")
        .annotate(n=Count("user_id", distinct=True))
    )
    merged: dict[tuple[str, str], int] = {}
    for r in rows:
        key = (str(r["classroom__level"]).lower(), str(r["classroom__subject"] or ""))
        merged[key] = merged.get(key, 0) + r["n"]
    order = sorted(merged, key=lambda k: (_LEVEL_ORDER.get(k[0], 99), k[1]))
    return [(f"{level}:{subject}", _course_label(level, subject), merged[(level, subject)]) for level, subject in order]


def _course_q(value):
    level, _, subject = (value or "").partition(":")
    if not level or not subject:
        return None
    return _seated_in(level__iexact=level, subject=subject)


_DIGITS = re.compile(r"\D+")
#: Typed phone filters (no choices to count): the digits typed, anywhere in the number. The parent's phone is
#: searched, never sent back: the list does not give it out (users/tests/test_person_parent.py).
_PHONE_PARAMS = (("phone", "phone_number"), ("parent_phone", "parent_phone"))


def _phone_filters(qs, params):
    for param, field in _PHONE_PARAMS:
        digits = _DIGITS.sub("", params.get(param) or "")[:15]
        if digits:
            qs = qs.filter(**{f"{field}__contains": digits})
    return qs


_SAME_NAME = (
    "Duplicates",
    lambda qs: [("yes", "Same name", qs.filter(pk__in=_same_name_ids()).count())],
    lambda v: Q(pk__in=_same_name_ids()) if v == "yes" else None,
)


def _signin_q(value):
    ever = Q(pk__in=RefreshSession.objects.values("user_id"))
    return {"never": ~ever, "yes": ever}.get(value)


# "Never" is no session at all: JWT sign-in never writes last_login, and sessions are never pruned.
_SIGNED_IN = (
    "Signed in",
    lambda qs: [
        ("never", "Never", qs.filter(_signin_q("never")).count()),
        ("yes", "Has signed in", qs.filter(_signin_q("yes")).count()),
    ],
    _signin_q,
)


def _present_choices(qs, field, labels):
    rows = qs.order_by().values(field).annotate(n=Count("pk"))
    return sorted(
        ((str(r[field]), labels.get(r[field], str(r[field])), r["n"]) for r in rows if r[field]),
        key=lambda c: c[1],
    )


FILTERS = {
    "students": {
        "status": ("Status", lambda qs: _fixed(qs, _STATUS, _STATUS_LABELS), _STATUS.get),
        "group": ("Group", _group_choices, lambda v: _seated_in(pk=_int(v)) if _int(v) else None),
        "teacher": ("Teacher", _teacher_choices, lambda v: _seated_in(teacher_id=_int(v)) if _int(v) else None),
        "course": ("Course", _course_choices, _course_q),
        "show": _SHOW,
        "lcup": (
            "lc-up",
            lambda qs: [
                ("linked", "Linked", qs.filter(lcup_student_link__isnull=False).count()),
                ("unlinked", "Not linked", qs.filter(lcup_student_link__isnull=True).count()),
            ],
            lambda v: {"linked": Q(lcup_student_link__isnull=False), "unlinked": Q(lcup_student_link__isnull=True)}.get(v),
        ),
        "debt": (
            "Debt",
            lambda qs: [
                ("owes", "Owes", qs.filter(lcup_student_link__balance__lt=0).count()),
                ("clear", "Paid up", qs.exclude(lcup_student_link__balance__lt=0).count()),
            ],
            lambda v: {"owes": Q(lcup_student_link__balance__lt=0), "clear": ~Q(lcup_student_link__balance__lt=0)}.get(v),
        ),
        "dupes": _SAME_NAME,
        "signin": _SIGNED_IN,
    },
    "public": {
        "status": ("Status", lambda qs: _fixed(qs, _STATUS, _STATUS_LABELS), _STATUS.get),
        "joined": (
            "Joined",
            lambda qs: [(v, label, qs.filter(_joined_q(v)).count())
                        for v, label in (("7d", "Last 7 days"), ("30d", "Last 30 days"), ("older", "Earlier"))],
            _joined_q,
        ),
        "verified": (
            "Email",
            lambda qs: [
                ("yes", "Verified", qs.filter(email_verified=True).count()),
                ("no", "Not verified", qs.filter(email_verified=False).count()),
            ],
            lambda v: {"yes": Q(email_verified=True), "no": Q(email_verified=False)}.get(v),
        ),
        "dupes": _SAME_NAME,
        "signin": _SIGNED_IN,
    },
    "staff": {
        "role": ("Role", lambda qs: _present_choices(qs, "role", _ROLE_LABELS), lambda v: Q(role=v) if v else None),
        "subject": (
            "Subject", lambda qs: _present_choices(qs, "subject", _SUBJECT_LABELS), lambda v: Q(subject=v) if v else None
        ),
        "status": (
            "Status",
            lambda qs: _fixed(qs, _STAFF_STATUS, (("active", "Active"), ("frozen", "Frozen"))),
            _STAFF_STATUS.get,
        ),
    },
}

_ORDERING = {
    "name": (F("first_name").asc(), F("last_name").asc(), F("username").asc()),
    "-name": (F("first_name").desc(), F("last_name").desc(), F("username").desc()),
    "joined": (F("date_joined").asc(),),
    "-joined": (F("date_joined").desc(),),
    "last_seen": (F("last_seen").asc(nulls_first=True),),
    "-last_seen": (F("last_seen").desc(nulls_last=True),),
    # Students only: who owes most first (lc-up's balance is negative for a debt).
    "debt": (F("lcup_student_link__balance").asc(nulls_last=True),),
}


# ── rows ──────────────────────────────────────────────────────────────────


def _group_cell(seat) -> dict:
    """One seat as the Students list draws it: the group as a course tag, its room, its teacher, the seat's
    status (lc-up's active / trial / frozen) and the day it began."""
    room = seat.classroom
    teacher = room.teacher if room.teacher_id else None
    began = seat.seat_start_date or (timezone.localdate(seat.joined_at) if seat.joined_at else None)
    return {
        "id": seat.classroom_id,
        "name": room.name,
        "level": (room.level or "").lower(),
        "subject": room.subject or "",
        "room": room.room_number or "",
        "teacher": (
            {
                "id": teacher.pk,
                "name": f"{teacher.first_name or ''} {teacher.last_name or ''}".strip() or teacher.username,
                "first_name": teacher.first_name or "",
                "last_name": teacher.last_name or "",
            }
            if teacher
            else None
        ),
        "seat_status": seat.seat_status,
        "joined": began.isoformat() if began else None,
    }


def _row(u, section, request=None):
    from .photos import profile_image_url

    row = {
        "id": u.pk,
        # The photo beside the name, as on the person's page (owner: "rasmi ham ko'rinib turishi kerak").
        "avatar_url": profile_image_url(u, request),
        "username": u.username,
        "name": f"{u.first_name} {u.last_name}".strip(),
        "first_name": u.first_name or "",
        "last_name": u.last_name or "",
        # Graded or submitted work across the platform — what a delete would take with it.
        "attempt_count": getattr(u, "attempt_count", 0) or 0,
        "email": u.email or "",
        "phone": u.phone_number or "",
        "role": u.role,
        "status": A.kind_of(u) if section != "staff" else ("frozen" if u.is_frozen else "active"),
        "is_frozen": u.is_frozen,
        "date_joined": u.date_joined.isoformat() if u.date_joined else None,
        "last_seen": u.last_seen.isoformat() if getattr(u, "last_seen", None) else None,
    }
    if section == "students":
        link = getattr(u, "lcup_student_link", None)
        row["groups"] = [_group_cell(s) for s in getattr(u, "active_seats", [])]
        # The balance is money: ``view_money``'s alone (teachers saw it here once; the badge, never the amount).
        money = request is not None and authorize(request.user, C.PERM_VIEW_MONEY)
        row["lcup"] = (
            {"linked": True, "balance": None if link.balance is None or not money else int(link.balance)}
            if link else {"linked": False, "balance": None}
        )
        # Whom to call, on the row's second line as in lc-up (owner, 22 Nov 2026: "Ha, chiqsin"). The same rule as the
        # person page's parent (``people_detail._parent``): ``view_people``'s alone. The phone only — the name stays
        # on the person page.
        row["parent_phone"] = (
            (u.parent_phone or "") if request is not None and authorize(request.user, C.PERM_VIEW_PEOPLE) else None
        )
    elif section == "public":
        row["email_verified"] = bool(u.email_verified)
    else:
        row["subject"] = u.subject or ""
    return row


class PeopleListView(APIView):
    permission_classes = [Requires(C.PERM_VIEW_PEOPLE)]

    def get(self, request):
        params = request.query_params
        section = (params.get("section") or "").strip()
        if section not in SECTIONS:
            return Response({"detail": "section must be students, public or staff."}, status=400)
        qs = manageable_users_queryset(request.user).filter(SECTIONS[section])
        qs = apply_search(qs, params.get("q") or "", PEOPLE_SEARCH)
        qs = _phone_filters(qs, params)
        qs, filters = facets(qs, FILTERS[section], params)

        qs = qs.annotate(
            last_seen=Subquery(
                RefreshSession.objects.filter(user=OuterRef("pk")).order_by("-last_seen_at").values("last_seen_at")[:1]
            )
        )
        ordering = params.get("o") or "-joined"
        if ordering not in _ORDERING or (ordering == "debt" and section != "students"):
            ordering = "-joined"
        qs = qs.order_by(*_ORDERING[ordering], "-pk")

        _, meta = paginate(qs, params)
        if section == "students":
            qs = qs.select_related("lcup_student_link").prefetch_related(
                Prefetch(
                    "class_memberships",
                    queryset=ClassroomMembership.objects.filter(_seat_q())
                    .select_related("classroom", "classroom__teacher")
                    .order_by("classroom__name"),
                    to_attr="active_seats",
                )
            )
        # Counted for the page only: the subqueries cost per row, and the total above did not need them.
        window = with_activity_counts(qs)[page_slice(meta)]
        return Response({
            "section": section,
            **meta,
            "ordering": ordering,
            "results": [_row(u, section, request) for u in window],
            "filters": filters,
        })

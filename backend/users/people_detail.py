"""One account for /ops — what its change form opens with (plan 2026-10-15-ops-detail-pages).

The slower parts (attendance, results, sessions, history) are ``users.people_parts``, each its own
request, so a slow or failing part never blanks the page.
"""

from __future__ import annotations

from django.db.models import Count, Max, Q
from django.db.models.functions import Lower

from access import constants as C
from classes.models import Classroom, ClassroomMembership, Submission
from classes.models_membership_audit import ClassroomMembershipEvent

from . import audience as A
from .activity import with_activity_counts
from .models import RefreshSession, User

STUDENT, ACTIVE = ClassroomMembership.ROLE_STUDENT, ClassroomMembership.STATUS_ACTIVE


def section_of(user) -> str:
    role = str(user.role or "").strip().lower()  # the same reading as ``audience.kind_of``
    if role == C.ROLE_STUDENT:
        return "students"
    if role == C.ROLE_PUBLIC_STUDENT:
        return "public"
    return "staff"


def iso(value):
    return value.isoformat() if value else None


def display_name(u) -> str:
    if u is None:
        return ""
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username or f"User {u.pk}"


def last_seen_map(user_ids) -> dict:
    rows = RefreshSession.objects.filter(user_id__in=list(user_ids)).values("user_id").annotate(t=Max("last_seen_at"))
    return {r["user_id"]: r["t"] for r in rows}


def status_of(user, section: str) -> str:
    return A.kind_of(user) if section != "staff" else ("frozen" if user.is_frozen else "active")


def _freeze_reason(user):
    if not user.is_frozen:
        return None
    return "debt" if user.frozen_reason == A.FROZEN_LCUP_DEBT else "admin"


def _live_seats(user_ids):
    return ClassroomMembership.objects.filter(
        user_id__in=list(user_ids), role=STUDENT, status=ACTIVE, classroom__is_active=True
    ).select_related("classroom__teacher")


def _groups(user) -> list[dict]:
    from lcup.guards import lcup_managed_ids

    seats = list(_live_seats([user.pk]).order_by("classroom__name"))
    managed = lcup_managed_ids(s.classroom_id for s in seats)
    return [
        {
            "id": s.classroom_id,
            "name": s.classroom.name,
            "subject": s.classroom.subject,
            "teacher": display_name(s.classroom.teacher),
            "joined_at": iso(s.joined_at),
            "lcup_managed": s.classroom_id in managed,
        }
        for s in seats
    ]


def _past_groups(user) -> list[dict]:
    seats = (
        ClassroomMembership.objects.filter(user=user, role=STUDENT)
        .exclude(status=ACTIVE, classroom__is_active=True)
        .select_related("classroom")
        .order_by("classroom__name")
    )
    left = dict(
        ClassroomMembershipEvent.objects.filter(student=user, action=ClassroomMembershipEvent.ACTION_REMOVED)
        .values("classroom_id").annotate(t=Max("created_at")).values_list("classroom_id", "t")
    )
    return [{"id": s.classroom_id, "name": s.classroom.name, "left_at": iso(left.get(s.classroom_id))} for s in seats]


def _open_classes(user) -> list[dict]:
    """Active classes NOT paired with lc-up that this learner is not in — the "Add to class" choices."""
    from lcup.guards import lcup_managed_ids

    mine = ClassroomMembership.objects.filter(user=user, status=ACTIVE).values("classroom_id")
    rooms = list(Classroom.objects.filter(is_active=True).exclude(pk__in=mine).order_by("name").values_list("pk", "name"))
    managed = lcup_managed_ids(pk for pk, _ in rooms)
    return [{"id": pk, "name": name} for pk, name in rooms if pk not in managed]


def _lcup(user):
    from lcup.conf import debt_freeze_enabled
    from lcup.finance import student_finance
    from lcup.models import LcupPhonePrompt, LcupStudentLink

    link = LcupStudentLink.objects.filter(user=user).first()
    if link is None:
        return None
    prompt = LcupPhonePrompt.objects.filter(user=user).values_list("state", flat=True).first()
    return {
        **student_finance(user),
        "status": link.status,
        "lcup_student_id": link.lcup_student_id,
        "exempt": link.debt_freeze_exempt_at is not None,
        # Whether the debt freeze runs at all: switched off, "freezes after day 6" would be untrue.
        "freeze_on": debt_freeze_enabled(),
        "phone_prompt": prompt,
    }


def same_name_accounts(user) -> list[dict]:
    first, last = (user.first_name or "").strip().lower(), (user.last_name or "").strip().lower()
    if not first or not last:
        return []
    twins = list(
        User.objects.filter(role__in=C.LEARNER_ROLES, is_active=True)
        .exclude(pk=user.pk)
        .annotate(f=Lower("first_name"), l=Lower("last_name"))
        .filter(f=first, l=last)
        .order_by("pk")
    )
    seen = last_seen_map(t.pk for t in twins)
    groups: dict[int, list[str]] = {}
    for s in _live_seats(t.pk for t in twins).order_by("classroom__name"):
        groups.setdefault(s.user_id, []).append(s.classroom.name)
    out = []
    for t in twins:
        section = section_of(t)
        out.append({
            "id": t.pk, "name": display_name(t), "username": t.username, "section": section,
            "status": status_of(t, section), "last_seen": iso(seen.get(t.pk)), "groups": groups.get(t.pk, []),
        })
    return out


def _staff(user) -> dict:
    from lcup.guards import lcup_managed_ids
    from lcup.models import LcupTeacherLink

    seats = Count("memberships", filter=Q(memberships__role=STUDENT, memberships__status=ACTIVE), distinct=True)
    taught = list(Classroom.objects.filter(teacher=user, is_active=True).annotate(n=seats).order_by("name"))
    ta_ids = ClassroomMembership.objects.filter(
        user=user, role=ClassroomMembership.ROLE_TA, status=ACTIVE
    ).values("classroom_id")
    ta = list(
        Classroom.objects.filter(is_active=True, pk__in=ta_ids).exclude(teacher=user).annotate(n=seats).order_by("name")
    )
    rooms = [(c, "teacher") for c in taught] + [(c, "ta") for c in ta]
    managed = lcup_managed_ids(c.pk for c, _ in rooms)
    ids = [c.pk for c, _ in rooms]
    students = (
        ClassroomMembership.objects.filter(classroom_id__in=ids, role=STUDENT, status=ACTIVE)
        .values("user_id").distinct().count()
    )
    to_review = Submission.objects.filter(assignment__classroom_id__in=ids, status=Submission.STATUS_SUBMITTED).count()
    link = LcupTeacherLink.objects.filter(user=user).first()
    return {
        "lcup_teacher": {"status": link.status, "name": link.name} if link else None,
        "classes": [
            {"id": c.pk, "name": c.name, "subject": c.subject, "as": role, "students": c.n,
             "lcup_managed": c.pk in managed}
            for c, role in rooms
        ],
        "workload": {"classes": len(rooms), "students": students, "to_review": to_review},
    }


def _glance(user, section: str) -> dict:
    """The page header's at-a-glance figures — what the tabs below hold, said once at the top.

    A student: attendance and homework across their live classes. A public user: their mock exams.
    """
    from classes.attendance import compute_attendance_score
    from classes.models_attendance import AttendanceRecord
    from classes.progress import _homework_for
    from mocks.models import MockAttempt

    out = {"attendance_rate": None, "homework": None, "mocks_taken": 0, "last_mock_total": None}
    if section == "students":
        rooms = [s.classroom for s in _live_seats([user.pk])]
        statuses = list(
            AttendanceRecord.objects.filter(student=user, session__classroom__in=rooms).values_list("status", flat=True)
        )
        out["attendance_rate"] = compute_attendance_score(statuses) if statuses else None
        done = total = 0
        for room in rooms:
            stats = _homework_for(room, user)
            if stats:
                done, total = done + stats["completed"], total + stats["total"]
        out["homework"] = {"completed": done, "total": total} if total else None
    mocks = MockAttempt.objects.filter(student=user, is_completed=True)
    out["mocks_taken"] = mocks.count()
    out["last_mock_total"] = mocks.order_by("-completed_at").values_list("total_score", flat=True).first()
    return out


def _one_time_password(user):
    """An open one-time sign-in (phone + last four digits), or None. Shown so an admin can say so."""
    from lcup.models import AccountClaim

    if user.has_usable_password():
        return None
    claim = AccountClaim.objects.filter(user=user, password_set_at__isnull=True).first()
    if claim is None:
        return None
    return {
        "expires_at": iso(claim.expires_at),
        "used": claim.first_login_at is not None,
        "locked": claim.locked_at is not None,
    }


def person_core(user, request=None) -> dict:
    from lcup.models import LcupStudentLink, LinkStatus

    from .photos import profile_image_url

    section = section_of(user)
    counted = with_activity_counts(User.objects.filter(pk=user.pk)).values_list("attempt_count", flat=True).first()
    learner = section != "staff"
    return {
        "id": user.pk,
        "section": section,
        "avatar_url": profile_image_url(user, request),
        "glance": _glance(user, section) if learner else None,
        "one_time_password": _one_time_password(user),
        "username": user.username or "",
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "name": display_name(user),
        "email": user.email or "",
        "email_verified": bool(user.email_verified),
        "phone": user.phone_number or "",
        "role": user.role,
        "subject": user.subject or "",
        "status": status_of(user, section),
        "is_frozen": user.is_frozen,
        "frozen_reason": _freeze_reason(user),
        "date_joined": iso(user.date_joined),
        "last_seen": iso(last_seen_map([user.pk]).get(user.pk)),
        "attempt_count": counted or 0,
        "telegram_linked": bool(user.telegram_id),
        "lcup_created": LcupStudentLink.objects.filter(user=user, status=LinkStatus.CREATED).exists(),
        "sat": {
            "exam_date": iso(user.sat_exam_date),
            "target_score": user.target_score,
            "target_english": user.target_english,
            "target_math": user.target_math,
        },
        "groups": _groups(user) if learner else [],
        "past_groups": _past_groups(user) if learner else [],
        "open_classes": _open_classes(user) if learner else [],
        "lcup": _lcup(user) if learner else None,
        "duplicates": same_name_accounts(user) if learner else [],
        "staff": None if learner else _staff(user),
    }

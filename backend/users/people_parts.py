"""The person page's slower parts, one request each (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord
from classes.models_membership_audit import ClassroomMembershipEvent

from .admin_audit import ADMIN_EVENT_TYPES
from .models import RefreshSession, RoleChange, SecurityAuditEvent
from .people_detail import iso

RESULTS_LIMIT = 20
HISTORY_LIMIT = 200
NOISE = {"ping", "hello", "refresh_reuse_grace"}


def _student_rooms(user, *, live_only=False):
    seats = ClassroomMembership.objects.filter(user=user, role=ClassroomMembership.ROLE_STUDENT)
    if live_only:
        seats = seats.filter(status=ClassroomMembership.STATUS_ACTIVE, classroom__is_active=True)
    return list(Classroom.objects.filter(pk__in=seats.values("classroom_id")).order_by("name"))


def attendance_part(user) -> dict:
    from classes.progress import _attendance_for  # ungated on FINALIZED: prod never finalizes a session
    from lcup.models import LcupAbsenceReason, LcupAttendancePush

    live_ids = set(
        ClassroomMembership.objects.filter(
            user=user, role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
            classroom__is_active=True,
        ).values_list("classroom_id", flat=True)
    )
    classes = []
    for room in _student_rooms(user):
        stats = _attendance_for(room, user)
        if stats:
            classes.append({"id": room.pk, "name": room.name, "active": room.pk in live_ids, **stats})

    since = timezone.localdate() - timedelta(days=30)
    rows = list(
        AttendanceRecord.objects.filter(student=user, session__date__gte=since)
        .select_related("session__classroom").order_by("-session__date", "-pk")[:60]
    )
    reasons = dict(LcupAbsenceReason.objects.values_list("lcup_reason_id", "title"))
    pushes = {
        (p["group__classroom_id"], p["date"]): p["state"]
        for p in LcupAttendancePush.objects.filter(
            group__classroom_id__in={r.session.classroom_id for r in rows}, date__gte=since
        ).values("group__classroom_id", "date", "state")
    }
    recent = [
        {
            "date": r.session.date.isoformat(),
            "class_id": r.session.classroom_id,
            "class_name": r.session.classroom.name,
            "status": r.status,
            "note": r.note or "",
            "reason": reasons.get(r.lcup_reason_id, "") if r.lcup_reason_id else "",
            "lcup_push": pushes.get((r.session.classroom_id, r.session.date)),
        }
        for r in rows
    ]
    return {"classes": classes, "recent": recent}


def _homework(user):
    from classes.analytics import _academic_assignments, _completion_map
    from classes.progress import _homework_for

    per_class, overdue = [], []
    now = timezone.now()
    for room in _student_rooms(user, live_only=True):
        stats = _homework_for(room, user)
        if stats:
            per_class.append({"class_id": room.pk, "class_name": room.name, **stats})
        work = [a for a in _academic_assignments(room) if a.category != Assignment.CATEGORY_CLASSWORK]
        done = _completion_map(room, [user.pk], work).get(user.pk, set())
        overdue += [
            {"id": a.pk, "title": a.title, "class_name": room.name, "due_at": iso(a.due_at)}
            for a in work
            if a.status == Assignment.STATUS_PUBLISHED and a.due_at and a.due_at < now and a.pk not in done
        ]
    overdue.sort(key=lambda o: o["due_at"], reverse=True)
    return per_class, overdue[:RESULTS_LIMIT]


def results_part(user) -> dict:
    from assessments.models import AssessmentAttempt
    from events.models import EventRegistration
    from exams.models import TestAttempt
    from midterms.models import MidtermAttempt, MidtermOutcome
    from mocks.models import MockAttempt
    from rewards.models import StudentWallet
    from rewards.services import xp_balance

    homework, overdue = _homework(user)
    assessments = (
        AssessmentAttempt.objects.filter(
            student=user, status__in=[AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED]
        ).select_related("result", "homework__assessment_set").order_by("-submitted_at")[:RESULTS_LIMIT]
    )
    outcomes = dict(MidtermOutcome.objects.filter(student=user).values_list("midterm_id", "passed"))

    def _result_percent(a):
        result = getattr(a, "result", None)  # the reverse one-to-one raises when missing; getattr's default catches it
        return float(result.percent) if result is not None else None

    return {
        "homework": homework,
        "overdue": overdue,
        "assessments": [
            {
                "title": getattr(getattr(a.homework, "assessment_set", None), "title", "") or "Assessment",
                "percent": _result_percent(a),
                "at": iso(a.submitted_at),
            }
            for a in assessments
        ],
        "mocks": [
            {"title": m.mock.title if m.mock_id else "Mock", "english": m.english_score, "math": m.math_score,
             "total": m.total_score, "at": iso(m.completed_at)}
            for m in MockAttempt.objects.filter(student=user, is_completed=True)
            .select_related("mock").order_by("-completed_at")[:RESULTS_LIMIT]
        ],
        "practice": [
            {"title": str(t.practice_test) if t.practice_test_id else "Test", "score": t.score, "at": iso(t.completed_at)}
            for t in TestAttempt.objects.filter(student=user, is_completed=True)
            # PracticeTest.__str__ reads mock_exam: without it, one query per row.
            .select_related("practice_test__mock_exam").order_by("-completed_at")[:RESULTS_LIMIT]
        ],
        "midterms": [
            # A sitting pins its scale when it starts; blank means it follows the midterm's.
            {"title": m.midterm.title, "score": m.score, "scale": str(m.paper_scale or m.midterm.scoring_scale),
             "passed": outcomes.get(m.midterm_id), "at": iso(m.completed_at)}
            for m in MidtermAttempt.objects.filter(student=user, is_completed=True)
            .select_related("midterm").order_by("-completed_at")[:RESULTS_LIMIT]
        ],
        "events": [
            {"title": r.event.title, "starts_at": iso(r.event.starts_at), "status": r.status,
             "attendance": r.attendance}
            for r in EventRegistration.objects.filter(student=user).select_related("event")
            .order_by("-registered_at")[:RESULTS_LIMIT]
        ],
        "rewards": {
            "xp": xp_balance(user),
            # Read, never get_or_create: a page view must not write a wallet.
            "coins": StudentWallet.objects.filter(student=user).values_list("coins_balance", flat=True).first() or 0,
        },
    }


def security_part(user) -> dict:
    # The same "signed in right now" as the account's own device list (users.views.SessionListView):
    # unrevoked, and young enough that its refresh token can still renew.
    lifetime = settings.SIMPLE_JWT.get("REFRESH_TOKEN_LIFETIME") or timedelta(weeks=1)
    sessions = RefreshSession.objects.filter(
        user=user, revoked_at__isnull=True, created_at__gte=timezone.now() - lifetime
    ).order_by("-last_seen_at", "-id")[:20]
    return {
        "sessions": [
            {"id": s.pk, "created_at": iso(s.created_at), "last_seen_at": iso(s.last_seen_at), "ip": s.ip or "",
             # Whole (the column holds ≤ 512): the page names it, and a browser's tell can come last.
             "device": (s.user_agent or "").strip()}
            for s in sessions
        ],
        "telegram_linked": bool(user.telegram_id),
        "email_verified": bool(user.email_verified),
        "last_password_change": iso(user.last_password_change),
    }


ROLE_REASONS = {
    "initial_split": "no class seat",
    "lcup_joined": "joined a group in lc-up",
    "lcup_left": "left every group in lc-up",
    "lcup_left_with_debt": "left lc-up with a debt",
    "lcup_debt_paid": "debt paid",
}
EVENT_TITLES = {
    "admin_freeze": "Frozen by an admin",
    "admin_unfreeze": "Unfrozen by an admin",
    "admin_revoke_sessions": "Signed out of every device by an admin",
    "password_change": "Changed their password",
    "session_revoke_all": "Signed out everywhere",
    "session_revoke_others": "Signed out of other devices",
    "lcup_phone_confirmed": "Confirmed their phone number",
    "lcup_phone_moved": "Phone number moved to a new lc-up account",
    "lcup_claim_login": "First sign-in with an lc-up code",
    "email_verify_confirmed": "Verified their email",
    "auto_revoke_all_sessions": "Signed out everywhere by the risk check",
}
MEMBERSHIP_ACTIONS = {
    "ADDED": "Added to", "REMOVED": "Removed from", "REINSTATED": "Back in",
    "ROLE_CHANGED": "Role changed in", "STATUS_CHANGED": "Status changed in", "DELETED": "Seat deleted in",
}
FIELD_LABELS = {"first_name": "first name", "last_name": "last name", "phone_number": "phone", "is_frozen": "frozen"}
#: A role as History says it: "student → public user", not "student → public_student".
ROLE_NAMES = {**{code: label.lower() for code, label in C.ROLE_CHOICES}, C.ROLE_PUBLIC_STUDENT: "public user"}


def _role_name(code: str) -> str:
    return ROLE_NAMES.get(code, code)


def _event_title(ev) -> str:
    detail = ev.detail or {}
    if ev.event_type == "admin_user_update":
        fields = [FIELD_LABELS.get(f, f.replace("_", " ")) for f in detail.get("changes", {})]
        if detail.get("password_changed"):
            fields.append("password")
        return "Edited by an admin: " + (", ".join(fields) or "no fields")
    return EVENT_TITLES.get(ev.event_type) or ev.event_type.replace("_", " ").capitalize()


def _day(d):
    return timezone.make_aware(datetime.combine(d, time.min)) if d else None


def history_part(user) -> dict:
    from lcup.models import LcupPayment, LcupStudentLink

    # (when, item): sorted on the datetime, not its text — a payment day is local midnight and the
    # rest come back from the database in UTC, and "+05:00" strings do not sort against "+00:00" ones.
    rows = []
    for rc in RoleChange.objects.filter(user=user).order_by("-created_at")[:HISTORY_LIMIT]:
        extra = " and frozen" if rc.froze else (" and unfrozen" if rc.unfroze else "")
        why = ROLE_REASONS.get(rc.reason, rc.reason.replace("_", " "))
        roles = f"{_role_name(rc.from_role)} → {_role_name(rc.to_role)}"
        rows.append((rc.created_at, {"kind": "role", "title": f"Role {roles}{extra} ({why})",
                                     "by": "lc-up sync" if rc.source == "lcup_sync" else rc.source}))
    for ev in ClassroomMembershipEvent.objects.filter(student=user).order_by("-created_at")[:HISTORY_LIMIT]:
        rows.append((ev.created_at, {"kind": "group",
                                     "title": f"{MEMBERSHIP_ACTIONS.get(ev.action, ev.action)} {ev.classroom_name}",
                                     "by": ev.actor_name or ""}))
    for ev in SecurityAuditEvent.objects.filter(user=user).exclude(event_type__in=NOISE)[:HISTORY_LIMIT]:
        admin = ev.event_type in ADMIN_EVENT_TYPES
        rows.append((ev.created_at, {"kind": "admin" if admin else "security", "title": _event_title(ev),
                                     "by": (ev.detail or {}).get("actor", "") if admin else ""}))
    link = LcupStudentLink.objects.filter(user=user).first()
    if link:
        for p in LcupPayment.objects.filter(lcup_student_id=link.lcup_student_id).order_by("-paid_on")[:HISTORY_LIMIT]:
            # "650,000 UZS", as the lc-up box writes it; a payment has a day, not a time.
            rows.append((_day(p.paid_on), {"kind": "payment",
                                           "title": f"{p.kind.capitalize()} {abs(int(p.amount)):,} UZS"
                                           + (f" for {p.month}" if p.month else ""),
                                           "by": "lc-up", "all_day": True}))
    rows = [(t, item) for t, item in rows if t]
    rows.sort(key=lambda r: r[0], reverse=True)
    items = [{"at": iso(timezone.localtime(t)), **item} for t, item in rows[:HISTORY_LIMIT]]
    return {"items": items, "truncated": len(rows) > HISTORY_LIMIT}


PARTS = {
    "attendance": attendance_part,
    "results": results_part,
    "security": security_part,
    "history": history_part,
}

"""``/api/lcup/`` — the admin console for the lc-up link (``/ops/lcup``), and the two endpoints a
student uses: choosing the first password of an account the sync created, and typing their phone
on one of several same-name accounts (``phone_confirm``).

Everything an admin does here goes through the same services the sync uses (``accounts``,
``classrooms``), so a link made by hand and a link made by the sync are the same thing.
"""

from __future__ import annotations

from collections import defaultdict

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as acc_const
from classes.capabilities import is_global_admin
from classes.models import Classroom, ClassroomMembership
from users.models import User

from . import finance, tasks
from .accounts import create_account_for, reissue_claim
from .auth_backend import _audit
from .classrooms import branch_for, create_classroom_for, teachers_for
from .claims import set_initial_password
from .conf import lcup_enabled
from .matching import SUPPORTER_REASON
from .models import (
    AccountClaim,
    GroupLinkStatus,
    LcupGroupLink,
    LcupMembership,
    LcupState,
    LcupStudentLink,
    LcupSyncRun,
    LcupTeacherLink,
    LinkStatus,
)
from .phone_confirm import NOTHING_TO_CONFIRM, PhoneRefused, confirm_phone, dismiss_prompt, supersede_prompts
from .serializers import claim_row, group_row, person_row, room_ref, run_row, user_ref
from .sync import live_student_ids

_TRUTHY = {"1", "true", "yes", "on"}
_NEEDS_ATTENTION = (LinkStatus.NEEDS_REVIEW, LinkStatus.UNMATCHED)


class IsGlobalAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and is_global_admin(user))


class _AdminView(APIView):
    permission_classes = [IsGlobalAdmin]


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"detail": detail}, status=code)


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ── status and sync ───────────────────────────────────────────────────────


class StatusView(_AdminView):
    def get(self, request):
        state = LcupState.get()
        runs = list(LcupSyncRun.objects.all()[:5])
        live = live_student_ids()
        counts = {
            "needs_review_students": LcupStudentLink.objects.filter(pk__in=live, status=LinkStatus.NEEDS_REVIEW).count(),
            "unmatched_students": LcupStudentLink.objects.filter(pk__in=live, status=LinkStatus.UNMATCHED).count(),
            "needs_review_teachers": LcupTeacherLink.objects.filter(deleted_in_lcup=False, status__in=_NEEDS_ATTENTION).count(),
            "groups_pending": LcupGroupLink.objects.filter(
                deleted_in_lcup_at__isnull=True, status__in=[GroupLinkStatus.SUGGESTED, GroupLinkStatus.NEEDS_TEACHER]
            ).count(),
            "unclaimed_accounts": AccountClaim.objects.filter(password_set_at__isnull=True).count(),
        }
        return Response(
            {
                "enabled": lcup_enabled(),
                "initial_review_done_at": state.initial_review_done_at,
                "last_run": run_row(runs[0]) if runs else None,
                "recent_runs": [run_row(run) for run in runs],
                "counts": counts,
            }
        )


class SyncView(_AdminView):
    def post(self, request):
        # Both run in the worker: a sync is ~30 lc-up requests paced to the limit, far longer than
        # a web request should be held open. The run list shows the result.
        if str(request.query_params.get("dry_run", "")).strip().lower() in _TRUTHY:
            tasks.dry_run.delay()
            return Response({"queued": True, "dry_run": True}, status=status.HTTP_202_ACCEPTED)
        if not lcup_enabled():
            return _bad("The lc-up integration is off (LCUP_ENABLED). A dry run previews it.", status.HTTP_409_CONFLICT)
        tasks.sync.delay()
        return Response({"queued": True, "dry_run": False}, status=status.HTTP_202_ACCEPTED)


class ReviewDoneView(_AdminView):
    def post(self, request):
        pending = LcupStudentLink.objects.filter(pk__in=live_student_ids(), status=LinkStatus.NEEDS_REVIEW).count()
        if pending:
            return _bad(f"{pending} lc-up students still need review.")
        state = LcupState.get()
        state.initial_review_done_at = timezone.now()
        state.initial_review_done_by = request.user
        state.save(update_fields=["initial_review_done_at", "initial_review_done_by"])
        return Response({"initial_review_done_at": state.initial_review_done_at})


# ── groups ────────────────────────────────────────────────────────────────


class GroupListView(_AdminView):
    def get(self, request):
        links = (
            LcupGroupLink.objects.select_related("classroom", "suggestion")
            .annotate(member_count=Count("memberships", filter=Q(memberships__left_at__isnull=True)))
            .order_by("name")
        )
        return Response([group_row(link) for link in links])


class GroupConfirmView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupGroupLink, pk=pk)
        classroom_id = _int(request.data.get("classroom_id")) or link.suggestion_id
        room = Classroom.objects.filter(pk=classroom_id, is_active=True).first() if classroom_id else None
        if room is None:
            return _bad("Choose an active class to pair this lc-up group with.")
        if LcupGroupLink.objects.filter(classroom=room).exclude(pk=link.pk).exists():
            return _bad("That class is already paired with another lc-up group.")
        link.classroom = room
        link.status = GroupLinkStatus.CONFIRMED
        link.save(update_fields=["classroom", "status"])
        return Response(group_row(link))


class GroupCreateClassView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupGroupLink, pk=pk)
        if link.classroom_id:
            return _bad("This lc-up group already has a class.")
        snapshot = link.snapshot or {}
        teachers = teachers_for(snapshot)
        if not teachers:
            return _bad("Link this group's lc-up teacher to one of our teachers first.")
        try:
            create_classroom_for(link, teacher_users=teachers, branch=branch_for(snapshot))
        except ValueError as exc:
            return _bad(str(exc))
        return Response(group_row(link), status=status.HTTP_201_CREATED)


class GroupIgnoreView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupGroupLink, pk=pk)
        # Ignoring a paired group unpairs it: its class goes back to being run by hand.
        link.status = GroupLinkStatus.IGNORED
        link.classroom = None
        link.save(update_fields=["status", "classroom"])
        return Response(group_row(link))


# ── students and teachers ─────────────────────────────────────────────────


def _group_names(student_ids) -> dict[int, list[str]]:
    names: dict[int, list[str]] = defaultdict(list)
    rows = LcupMembership.objects.filter(
        student_id__in=list(student_ids), left_at__isnull=True, group__deleted_in_lcup_at__isnull=True
    ).values_list("student_id", "group__name")
    for student_id, name in rows:
        names[student_id].append(name)
    return names


class StudentListView(_AdminView):
    def get(self, request):
        wanted = (request.query_params.get("status") or LinkStatus.NEEDS_REVIEW).strip()
        links = LcupStudentLink.objects.filter(pk__in=live_student_ids()).select_related("user").order_by("name")
        if wanted in _NEEDS_ATTENTION:
            links = links.filter(status=wanted)
        links = list(links)
        groups = _group_names(link.pk for link in links)
        return Response(
            [person_row(link, lcup_id=link.lcup_student_id, groups=sorted(groups[link.pk])) for link in links]
        )


class StudentLinkView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupStudentLink, pk=pk)
        # A public account too: a returning student's old account is linked, then the sync's
        # audience stage makes it a learning-center one again.
        user = User.objects.filter(pk=_int(request.data.get("user_id")), role__in=acc_const.LEARNER_ROLES).first()
        if user is None:
            return _bad("Choose a student account.")
        if LcupStudentLink.objects.filter(user=user).exclude(pk=link.pk).exists():
            return _bad("That account is already linked to another lc-up student.")
        moved = link.user_id != user.pk
        with transaction.atomic():
            link.user = user
            link.status = LinkStatus.CONFIRMED
            link.match_reason = "linked by an admin"
            link.save(update_fields=["user", "status", "match_reason"])
            # The admin has decided: the student's same-name accounts are not asked for a phone any
            # more, and the groups and attendance follow the new account now.
            supersede_prompts(link, now=timezone.now())
            if moved:
                transaction.on_commit(lambda: tasks.follow_student.delay(link.pk))
        return Response(person_row(link, lcup_id=link.lcup_student_id))


class StudentCreateAccountView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupStudentLink, pk=pk)
        if link.user_id:
            return _bad("This lc-up student already has an account.")
        phone = (request.data.get("phone") or "").strip() or None
        if create_account_for(link, now=timezone.now(), phone_override=phone) is None:
            return _bad(link.match_reason or "The account could not be created.")
        return Response(person_row(link, lcup_id=link.lcup_student_id), status=status.HTTP_201_CREATED)


class StudentIgnoreView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupStudentLink, pk=pk)
        link.status = LinkStatus.IGNORED
        link.save(update_fields=["status"])
        return Response(person_row(link, lcup_id=link.lcup_student_id))


class TeacherListView(_AdminView):
    def get(self, request):
        links = LcupTeacherLink.objects.select_related("user").order_by("name")
        if (request.query_params.get("status") or "attention") != "all":
            links = links.filter(status__in=_NEEDS_ATTENTION, deleted_in_lcup=False)
        return Response([person_row(link, lcup_id=link.lcup_teacher_id) for link in links])


class TeacherLinkView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupTeacherLink, pk=pk)
        user = User.objects.filter(
            pk=_int(request.data.get("user_id")), role__in=acc_const.TEACHER_PORTAL_ROLES
        ).first()
        if user is None:
            return _bad("Choose a teacher account.")
        if LcupTeacherLink.objects.filter(user=user).exclude(pk=link.pk).exists():
            return _bad("That account is already linked to another lc-up teacher.")
        link.user = user
        # A support teacher stays one: the admin names their account, the sync still never
        # makes them a group teacher.
        if link.match_reason != SUPPORTER_REASON:
            link.status = LinkStatus.CONFIRMED
            link.match_reason = "linked by an admin"
        link.save(update_fields=["user", "status", "match_reason"])
        return Response(person_row(link, lcup_id=link.lcup_teacher_id))


class TeacherIgnoreView(_AdminView):
    def post(self, request, pk):
        link = get_object_or_404(LcupTeacherLink, pk=pk)
        link.status = LinkStatus.IGNORED
        link.save(update_fields=["status"])
        return Response(person_row(link, lcup_id=link.lcup_teacher_id))


class UnlinkedMembersView(_AdminView):
    """Students of paired classes who match no lc-up student — the sync leaves them alone."""

    def get(self, request):
        rooms = LcupGroupLink.objects.filter(status=GroupLinkStatus.CONFIRMED, classroom__isnull=False).values_list(
            "classroom_id", flat=True
        )
        rows = (
            ClassroomMembership.objects.filter(
                classroom_id__in=list(rooms),
                role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
                user__lcup_student_link__isnull=True,
            )
            .select_related("classroom", "user")
            .order_by("classroom__name", "user__last_name", "user__first_name")
        )
        return Response([{"classroom": room_ref(row.classroom), "user": user_ref(row.user)} for row in rows])


# ── accounts the sync created ─────────────────────────────────────────────


class AccountListView(_AdminView):
    def get(self, request):
        now = timezone.now()
        rows = [claim_row(claim, now) for claim in AccountClaim.objects.select_related("user").order_by("-created_at")]
        wanted = request.query_params.get("state")
        return Response([row for row in rows if row["state"] == wanted] if wanted else rows)


class AccountReissueView(_AdminView):
    def post(self, request, user_id):
        claim = get_object_or_404(AccountClaim.objects.select_related("user"), user_id=user_id)
        if claim.password_set_at:
            return _bad("This account has been claimed already.")
        now = timezone.now()
        reissue_claim(claim, now=now)
        return Response(claim_row(claim, now))


class ClaimPasswordView(APIView):
    """The student's own first password, asked for by the profile completion gate."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        password = request.data.get("password")
        if not isinstance(password, str) or not password:
            return Response({"password": ["Choose a password."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            set_initial_password(request.user, password, now=timezone.now())
        except PermissionError:
            return _bad("There is no first password to choose for this account.", status.HTTP_403_FORBIDDEN)
        except ValidationError as exc:
            return Response({"password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClaimPhoneView(APIView):
    """A same-name account's phone, asked for by the completion gate (``phone_confirm``): typed on
    the account the student uses, it makes that account the one lc-up is linked to.
    ``{"not_me": true}`` is a namesake's answer."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        now = timezone.now()
        if request.data.get("not_me") is True:
            if not dismiss_prompt(request.user, now=now):
                return _bad(NOTHING_TO_CONFIRM, status.HTTP_403_FORBIDDEN)
            _audit(request.user, "lcup_phone_not_me", request)
            return Response(status=status.HTTP_204_NO_CONTENT)
        phone = request.data.get("phone")
        try:
            moved = confirm_phone(request.user, phone if isinstance(phone, str) else "", now=now)
        except PhoneRefused as refused:
            if refused.status in (status.HTTP_403_FORBIDDEN, status.HTTP_409_CONFLICT, status.HTTP_429_TOO_MANY_REQUESTS):
                return _bad(refused.detail, refused.status)
            body = {"phone": [refused.detail]}
            if refused.hint:
                body["hint"] = refused.hint
            return Response(body, status=refused.status)
        _audit(request.user, "lcup_phone_confirmed", request, moved=moved)
        return Response({"moved": moved})


# ── finance (lc-up Part 3) ────────────────────────────────────────────────


class StudentFinanceView(APIView):
    """A learner's own balance, monthly cost and payments. ``IsAuthenticated`` alone, on purpose: a
    student frozen for debt must still be able to see what they owe (the frozen screen reads this)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(finance.student_finance(request.user))


class FinanceSummaryView(_AdminView):
    def get(self, request):
        return Response(finance.summary(finance.parse_month(request.query_params.get("month"), now=timezone.now())))


class FinanceDebtorsView(_AdminView):
    def get(self, request):
        return Response(finance.debtors())


class FinancePaymentsView(_AdminView):
    def get(self, request):
        return Response(finance.payments_in(finance.parse_month(request.query_params.get("month"), now=timezone.now())))


class FinanceExemptView(_AdminView):
    """Never freeze this student for debt (a grant, an agreement) — or freeze as usual again."""

    def post(self, request, pk):
        link = get_object_or_404(LcupStudentLink.objects.select_related("user"), pk=pk)
        exempt = request.data.get("exempt")
        if not isinstance(exempt, bool):
            return _bad("Send exempt: true or false.")
        finance.set_exempt(link, exempt, by=request.user, now=timezone.now())
        return Response({"link_id": link.pk, "exempt": exempt})


# ── attendance pushes (lc-up Part 2) ──────────────────────────────────────


class AttendancePushListView(_AdminView):
    """The last 100 registers sent to lc-up: what lc-up said, and the students it did not take."""

    def get(self, request):
        from users.models import User

        from .models import LcupAttendancePush

        pushes = list(LcupAttendancePush.objects.select_related("group").order_by("-date", "-id")[:100])
        user_ids = {f.get("user_id") for p in pushes for f in (p.failures or []) if f.get("user_id")}
        people = {u.pk: user_ref(u) for u in User.objects.filter(pk__in=user_ids)}
        return Response([
            {
                "id": p.pk,
                "group": p.group.name,
                "date": p.date.isoformat(),
                "state": p.state,
                "attempts": p.attempts,
                "marks": len(p.records or []),
                "summary": p.summary or {},
                "failures": [
                    {"student": people.get(f.get("user_id")), "code": f.get("code") or "", "message": f.get("message") or ""}
                    for f in (p.failures or [])
                ],
                "error": p.error,
                "sent_at": p.sent_at,
            }
            for p in pushes
        ])


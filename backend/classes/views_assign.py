"""Teacher assignment + admin governance endpoints for a classroom.

Teacher (teaching team):
  POST /api/classes/<pk>/assign-midterm/   { mock_exam_id }   assign an existing
        interactive midterm (MockExam kind=MIDTERM) to all enrolled students.

Admin (global admin) — governance only:
  POST /api/classes/<pk>/assign-teacher/      { user_id }   set the classroom teacher
  POST /api/classes/<pk>/transfer-ownership/  { user_id }   move the OWNER role

Assignment goes through the access engine's ClassroomService, whose enforcement
write-through grants real, usable access (legacy assigned_users) in the same
transaction — independent of the ACCESS_ENGINE read flags. No separate admin step.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from access import constants as acc_const
from access.services import covers_domain_subject, normalized_role
from access.engine.classroom_service import ClassroomAccessService
from access.resources import RT_MIDTERM
from exams.models import MockExam

from .capabilities import classroom_capabilities
from .mail_midterm import notify_class_midterm_scheduled
from .models import Classroom, ClassroomMembership
from .models_schedule import MidtermSchedule
from .views_rankings import _ClassroomScopedView, _display_name


def _parse_schedule_dt(value):
    """Parse an ISO/datetime-local string to an aware datetime. '' / None → None; bad → 'INVALID'."""
    if value in (None, ""):
        return None
    dt = parse_datetime(value)
    if dt is None:
        return "INVALID"
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def missing_starts_at_response():
    """400 for a teacher-facing path that would leave a schedule with no start time.

    A ``MidtermSchedule`` with a NULL ``starts_at`` is not a half-filled form — it is an
    exam the whole class can open right now (see the model docstring), so every dialog that
    creates one has to carry a start. Reported as a field error, not just a detail, so the
    form can mark the input that is missing.
    """
    return Response(
        {
            "detail": "Set the date and time this midterm starts.",
            "starts_at": ["A start date and time is required."],
        },
        status=http.HTTP_400_BAD_REQUEST,
    )

User = get_user_model()


def _assign_legacy_midterm_grant(classroom, exam, actor, *, expires_at=None):
    """Grant a legacy midterm to a classroom, narrowing a RETAKE to its parent's failers.

    The v2 assign path (``views_midterm_v2._grant_to_classroom``) already does this; the
    legacy MockExam-based path did not, so a retake assigned here was handed to the whole
    room. The start gate blocks a passer, but the stray grant misrepresents who is owed the
    retake and — worse — the scheduling email summons students who cannot sit it. Resolving
    the mirror lets the same failers-only rule apply. Any failure to resolve the mirror
    degrades to the unchanged whole-class assignment.
    """
    try:
        from midterms.access import retake_eligible_students
        from midterms.models import Midterm

        mirror = (
            Midterm.objects.filter(legacy_mock_exam_id=exam.id)
            .only("id", "midterm_type", "retake_of_id")
            .first()
        )
        if mirror is not None and mirror.midterm_type == Midterm.TYPE_RETAKE and mirror.retake_of_id:
            from access.engine.assignment_service import AssignmentService
            from access.models import ResourceAccessGrant

            from .views_midterm_v2 import _classroom_student_ids

            roster = set(_classroom_student_ids(classroom))
            eligible = roster & set(retake_eligible_students(mirror).values_list("pk", flat=True))
            result = AssignmentService.bulk_assign_resource(
                list(User.objects.filter(pk__in=eligible)),
                RT_MIDTERM,
                exam.id,
                actor=actor,
                source=ResourceAccessGrant.SOURCE_CLASSROOM,
                classroom=classroom,
                expires_at=expires_at,
                note="teacher retake assignment (legacy, failers only)",
            )
            result.update({"granted": len(eligible), "skipped_not_eligible": len(roster) - len(eligible)})
            return result
    except Exception:  # pragma: no cover - defensive; whole-class assign is the safe fallback
        pass
    return ClassroomAccessService.assign_resource_to_classroom(
        classroom, RT_MIDTERM, exam.id, actor=actor, note="teacher midterm assignment", expires_at=expires_at,
    )

# Classroom subject (ENGLISH/MATH) → midterm subject (READING_WRITING/MATH).
_CLASSROOM_TO_MIDTERM_SUBJECT = {
    Classroom.SUBJECT_MATH: "MATH",
    Classroom.SUBJECT_ENGLISH: "READING_WRITING",
}


class AssignMidtermView(_ClassroomScopedView):
    """Assign an existing interactive midterm to every enrolled student."""

    def post(self, request, classroom_pk):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response(
                {"detail": "Only the teaching team can assign midterms."},
                status=http.HTTP_403_FORBIDDEN,
            )

        raw = request.data.get("mock_exam_id") or request.data.get("midterm_id")
        try:
            exam_id = int(raw)
        except (TypeError, ValueError):
            return Response({"detail": "mock_exam_id is required."}, status=http.HTTP_400_BAD_REQUEST)

        exam = MockExam.objects.filter(pk=exam_id).first()
        if exam is None or exam.kind != MockExam.KIND_MIDTERM:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        expected = _CLASSROOM_TO_MIDTERM_SUBJECT.get(classroom.subject)
        if expected and exam.midterm_subject != expected:
            return Response(
                {"detail": f"This midterm's subject does not match the classroom subject ({classroom.get_subject_display()})."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        starts_at = _parse_schedule_dt(request.data.get("starts_at"))
        deadline = _parse_schedule_dt(request.data.get("deadline"))
        if "INVALID" in (starts_at, deadline):
            return Response({"detail": "Invalid schedule datetime."}, status=http.HTTP_400_BAD_REQUEST)
        if starts_at is not None and deadline is not None and deadline <= starts_at:
            return Response(
                {"detail": "Deadline must be after the start time."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        # The window is mandatory, but only where one does not exist yet: re-assigning to
        # pick up a late student legitimately sends no schedule fields, and that must keep
        # the window the teacher already chose rather than being rejected.
        existing = MidtermSchedule.objects.filter(classroom=classroom, mock_exam=exam).first()
        if starts_at is None and (existing is None or existing.starts_at is None):
            return missing_starts_at_response()

        result = _assign_legacy_midterm_grant(classroom, exam, request.user, expires_at=deadline)

        # Upsert the per-classroom schedule (start countdown + deadline). Assigning never
        # releases results — that happens when certificates are issued. On RE-assign, only
        # overwrite window fields that were explicitly provided: a blank starts_at/deadline
        # must NOT null out a previously-set window (which would open it immediately and
        # never close it), and a stale ignore_start must not silently survive as "open now".
        schedule, created = MidtermSchedule.objects.get_or_create(
            classroom=classroom, mock_exam=exam,
            defaults={"starts_at": starts_at, "deadline": deadline, "created_by": request.user},
        )
        if not created:
            update_fields = []
            if starts_at is not None:
                schedule.starts_at = starts_at
                update_fields.append("starts_at")
            if deadline is not None:
                schedule.deadline = deadline
                update_fields.append("deadline")
            if update_fields:
                schedule.save(update_fields=[*update_fields, "updated_at"])
        notify_class_midterm_scheduled(schedule)
        return Response({"detail": "Midterm assigned to classroom.", **result}, status=http.HTTP_200_OK)


class _AdminClassroomGovernanceView(APIView):
    """Base for admin-only governance actions on a classroom."""

    permission_classes = [IsAuthenticated]

    def _guard(self, request) -> bool:
        # Governance (assign-teacher / transfer-ownership) is ADMIN-only by spec.
        # NOTE: do NOT use ``is_global_admin`` here — it treats any LMS-staff user
        # (including ordinary teachers, whose ``is_admin`` is permission-based) as a
        # global admin, which would let teachers reassign/transfer each other's
        # classrooms. Restrict strictly to super_admin / admin / Django superuser.
        u = request.user
        if not u or not getattr(u, "is_authenticated", False):
            return False
        if getattr(u, "is_superuser", False):
            return True
        return str(getattr(u, "role", "") or "").strip().lower() in ("super_admin", "admin")

    def _teacher_user(self, user_id):
        user = get_object_or_404(User, pk=user_id)
        role = str(getattr(user, "role", "") or "").strip().lower()
        return user, role


class AssignTeacherView(_AdminClassroomGovernanceView):
    """Admin sets the classroom's teacher (and ensures an active TEACHER membership)."""

    @transaction.atomic
    def post(self, request, classroom_pk):
        if not self._guard(request):
            return Response({"detail": "Admin only."}, status=http.HTTP_403_FORBIDDEN)
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        user, role = self._teacher_user(request.data.get("user_id"))
        if role not in ("teacher", "super_admin"):
            return Response({"detail": "User is not a teacher."}, status=http.HTTP_400_BAD_REQUEST)

        classroom.teacher = user
        classroom.save(update_fields=["teacher", "updated_at"])
        ClassroomMembership.objects.update_or_create(
            classroom=classroom,
            user=user,
            defaults={"role": ClassroomMembership.ROLE_TEACHER, "status": ClassroomMembership.STATUS_ACTIVE},
        )
        return Response({"detail": "Teacher assigned.", "classroom_id": classroom.pk, "teacher_id": user.pk})


class TransferOwnershipView(_AdminClassroomGovernanceView):
    """Admin transfers classroom ownership: demote current owner(s), promote the new owner."""

    @transaction.atomic
    def post(self, request, classroom_pk):
        if not self._guard(request):
            return Response({"detail": "Admin only."}, status=http.HTTP_403_FORBIDDEN)
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        user, role = self._teacher_user(request.data.get("user_id"))
        if role not in ("teacher", "super_admin"):
            return Response({"detail": "New owner must be a teacher."}, status=http.HTTP_400_BAD_REQUEST)

        ClassroomMembership.objects.filter(
            classroom=classroom,
            role__in=[ClassroomMembership.ROLE_OWNER, ClassroomMembership.ROLE_ADMIN],
        ).update(role=ClassroomMembership.ROLE_TEACHER)
        ClassroomMembership.objects.update_or_create(
            classroom=classroom,
            user=user,
            defaults={"role": ClassroomMembership.ROLE_OWNER, "status": ClassroomMembership.STATUS_ACTIVE},
        )
        classroom.teacher = user
        classroom.save(update_fields=["teacher", "updated_at"])
        return Response({"detail": "Ownership transferred.", "classroom_id": classroom.pk, "owner_id": user.pk})


class ClassroomGovernanceDeleteView(_AdminClassroomGovernanceView):
    """Admin governance: delete ANY classroom (admin / super_admin only).

    The operational ``ClassroomViewSet.destroy`` is owner-only and membership-scoped, so
    admins (non-members) get 403 there. This is the explicit governance delete path.
    """

    @transaction.atomic
    def delete(self, request, classroom_pk):
        if not self._guard(request):
            return Response({"detail": "Admin only."}, status=http.HTTP_403_FORBIDDEN)
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        classroom.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


class SupportTeacherAssignView(_AdminClassroomGovernanceView):
    """Assign / unassign a support teacher on a classroom.

    Deliberately NOT ``AssignTeacherView``. That endpoint overwrites the single
    ``Classroom.teacher`` FK, so routing a support teacher through it would silently evict the
    real teacher — the class would end up with a support teacher listed as its teacher and
    nobody would notice until someone looked.

    A support teacher is a MEMBERSHIP, not a classroom attribute: it holds
    ``ClassroomMembership.ROLE_TA``, whose capability matrix is already written and tested
    (grade, take attendance, create assignments; no settings, no roster, no ranking config).
    Several support teachers can serve one classroom, which a single FK could never express.

    Subject alignment is enforced here rather than left to the booking flow: a Maths support
    teacher assigned to an English class would become bookable by English students for help
    they cannot give, and the error would surface as a wasted appointment rather than a 400.
    """

    def _support_membership_qs(self, classroom):
        return ClassroomMembership.objects.filter(
            classroom=classroom,
            role=ClassroomMembership.ROLE_TA,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ).select_related("user")

    def get(self, request, classroom_pk):
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        caps = classroom_capabilities(request.user, classroom)
        # Readable by the teaching team as well as admins: a teacher needs to know who is
        # supporting their class, and a support teacher needs to see their own colleagues.
        if not (self._guard(request) or caps.is_staff):
            return Response({"detail": "Forbidden."}, status=http.HTTP_403_FORBIDDEN)
        return Response({
            "support_teachers": [
                {
                    "user_id": m.user_id,
                    "name": _display_name(m.user),
                    "email": m.user.email,
                    "subject": getattr(m.user, "subject", None),
                    # Whether STUDENTS can actually book this person, which is not the same
                    # question as whether they hold the membership.
                    #
                    # There are two doors onto ROLE_TA and only one of them checks the account
                    # role: this endpoint requires ROLE_SUPPORT_TEACHER, while the roster's
                    # "Make TA" button lets an owner promote any member. `support.py` requires
                    # the membership AND the account to agree (see SUPPORT_ACCOUNT_ROLE), so a
                    # plain teacher holding a TA membership shows up here as support staff and
                    # is invisible on every student's booking calendar.
                    #
                    # Zero accounts are in that state on production today. It is reported
                    # rather than filtered precisely because of that: hiding the row would
                    # make an admin who used the wrong button see their assignment silently
                    # vanish, which is a worse thing to debug than a row that says why.
                    "is_bookable": (
                        normalized_role(m.user) == acc_const.ROLE_SUPPORT_TEACHER
                        and m.status == ClassroomMembership.STATUS_ACTIVE
                    ),
                }
                for m in self._support_membership_qs(classroom)
            ]
        })

    @transaction.atomic
    def post(self, request, classroom_pk):
        if not self._guard(request):
            return Response({"detail": "Admin only."}, status=http.HTTP_403_FORBIDDEN)
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        user, role = self._teacher_user(request.data.get("user_id"))

        if role != acc_const.ROLE_SUPPORT_TEACHER:
            return Response(
                {"detail": "User is not a support teacher."}, status=http.HTTP_400_BAD_REQUEST
            )
        # `covers_domain_subject`, not a `!=` on the raw field: a support teacher whose
        # subject is "both" covers this classroom and a direct comparison would refuse them
        # for every class in the school.
        if not covers_domain_subject(user, classroom.domain_subject):
            return Response(
                {
                    "detail": (
                        f"Subject mismatch: this support teacher covers "
                        f"{getattr(user, 'subject', None) or 'no subject'}, the classroom is "
                        f"{classroom.domain_subject}."
                    )
                },
                status=http.HTTP_400_BAD_REQUEST,
            )

        membership, created = ClassroomMembership.objects.update_or_create(
            classroom=classroom,
            user=user,
            defaults={
                "role": ClassroomMembership.ROLE_TA,
                "status": ClassroomMembership.STATUS_ACTIVE,
            },
        )
        # Classroom.teacher is deliberately untouched.
        return Response(
            {
                "detail": "Support teacher assigned.",
                "classroom_id": classroom.pk,
                "user_id": user.pk,
                "created": created,
            },
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )

    @transaction.atomic
    def delete(self, request, classroom_pk, user_id):
        if not self._guard(request):
            return Response({"detail": "Admin only."}, status=http.HTTP_403_FORBIDDEN)
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        membership = ClassroomMembership.objects.filter(
            classroom=classroom, user_id=user_id, role=ClassroomMembership.ROLE_TA
        ).first()
        if membership is None:
            return Response(
                {"detail": "Not a support teacher on this classroom."},
                status=http.HTTP_404_NOT_FOUND,
            )
        # Soft removal, matching every other membership exit: the row and its history survive
        # so past grading and attendance keep their author.
        membership.status = ClassroomMembership.STATUS_REMOVED
        membership.save(update_fields=["status"])
        return Response({"detail": "Support teacher removed.", "user_id": int(user_id)})

"""Assigning a support teacher to a classroom.

The regression these exist for: a support teacher is a MEMBERSHIP, never the
``Classroom.teacher`` FK. Routing one through ``assign-teacher/`` would overwrite that FK and
silently evict the real teacher — the class would list its support teacher as the teacher and
nobody would notice until someone looked.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership

User = get_user_model()


class SupportTeacherAssignTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("st_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user(
            "st_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.support = User.objects.create_user(
            "st_sup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.support2 = User.objects.create_user(
            "st_sup2@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.english_support = User.objects.create_user(
            "st_sup_en@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_ENGLISH
        )
        self.student = User.objects.create_user("st_student@t.com", "secret123")

        self.classroom = Classroom.objects.create(
            name="Maths A", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher,
            role=ClassroomMembership.ROLE_OWNER,
        )

    def _url(self, user_id=None):
        base = f"/api/classes/{self.classroom.id}/support-teachers/"
        return base if user_id is None else f"{base}{user_id}/"

    def _assign(self, user, *, as_user=None):
        self.client.force_authenticate(as_user or self.admin)
        return self.client.post(self._url(), {"user_id": user.id}, format="json")

    # ── the regression ────────────────────────────────────────────────────────

    def test_assigning_a_support_teacher_does_not_replace_the_real_teacher(self):
        response = self._assign(self.support)
        self.assertEqual(response.status_code, 201)

        self.classroom.refresh_from_db()
        self.assertEqual(self.classroom.teacher_id, self.teacher.id)

    def test_the_support_teacher_lands_as_a_TA_membership(self):
        self._assign(self.support)
        membership = ClassroomMembership.objects.get(
            classroom=self.classroom, user=self.support
        )
        self.assertEqual(membership.role, ClassroomMembership.ROLE_TA)
        self.assertEqual(membership.status, ClassroomMembership.STATUS_ACTIVE)

    def test_one_classroom_can_hold_several_support_teachers(self):
        """A single FK could never express this, which is the other half of why the
        membership route exists."""
        self._assign(self.support)
        self._assign(self.support2)

        self.assertEqual(
            ClassroomMembership.objects.filter(
                classroom=self.classroom, role=ClassroomMembership.ROLE_TA,
                status=ClassroomMembership.STATUS_ACTIVE,
            ).count(),
            2,
        )

    # ── validation ────────────────────────────────────────────────────────────

    def test_a_plain_teacher_cannot_be_assigned_as_support(self):
        response = self._assign(self.teacher)
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a support teacher", response.json()["detail"])

    def test_a_student_cannot_be_assigned_as_support(self):
        self.assertEqual(self._assign(self.student).status_code, 400)

    def test_a_support_teacher_of_the_wrong_subject_is_refused(self):
        """Otherwise an English support teacher becomes bookable by Maths students for help
        they cannot give — and the error surfaces as a wasted appointment, not a 400."""
        response = self._assign(self.english_support)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Subject mismatch", response.json()["detail"])

    # ── authorization ─────────────────────────────────────────────────────────

    def test_a_teacher_cannot_assign_support_staff(self):
        """Governance is admin-only by the same reasoning as assign-teacher: otherwise
        teachers could restaff each other's classrooms."""
        self.assertEqual(self._assign(self.support, as_user=self.teacher).status_code, 403)

    def test_a_student_cannot_assign_support_staff(self):
        self.assertEqual(self._assign(self.support, as_user=self.student).status_code, 403)

    # ── idempotency and removal ───────────────────────────────────────────────

    def test_assigning_twice_updates_rather_than_duplicating(self):
        first = self._assign(self.support)
        again = self._assign(self.support)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)      # 200, nothing created
        self.assertEqual(
            ClassroomMembership.objects.filter(
                classroom=self.classroom, user=self.support
            ).count(),
            1,
        )

    def test_removal_is_soft_so_past_work_keeps_its_author(self):
        self._assign(self.support)
        self.client.force_authenticate(self.admin)
        response = self.client.delete(self._url(self.support.id))

        self.assertEqual(response.status_code, 200)
        membership = ClassroomMembership.objects.get(
            classroom=self.classroom, user=self.support
        )
        self.assertEqual(membership.status, ClassroomMembership.STATUS_REMOVED)

    def test_a_removed_support_teacher_can_be_brought_back(self):
        self._assign(self.support)
        self.client.force_authenticate(self.admin)
        self.client.delete(self._url(self.support.id))
        self._assign(self.support)

        membership = ClassroomMembership.objects.get(
            classroom=self.classroom, user=self.support
        )
        self.assertEqual(membership.status, ClassroomMembership.STATUS_ACTIVE)

    def test_removing_someone_who_was_never_assigned_is_a_404(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(self._url(self.support2.id)).status_code, 404)

    # ── listing ───────────────────────────────────────────────────────────────

    def test_the_teaching_team_can_see_who_supports_the_class(self):
        self._assign(self.support)
        self.client.force_authenticate(self.teacher)
        body = self.client.get(self._url()).json()

        self.assertEqual(len(body["support_teachers"]), 1)
        self.assertEqual(body["support_teachers"][0]["user_id"], self.support.id)
        self.assertEqual(body["support_teachers"][0]["subject"], C.DOMAIN_MATH)

    def test_a_removed_support_teacher_drops_off_the_list(self):
        self._assign(self.support)
        self.client.force_authenticate(self.admin)
        self.client.delete(self._url(self.support.id))

        body = self.client.get(self._url()).json()
        self.assertEqual(body["support_teachers"], [])

    def test_a_stranger_cannot_read_the_list(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self._url()).status_code, 403)

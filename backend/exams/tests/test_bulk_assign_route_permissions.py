"""The gate on `POST /api/exams/bulk_assign/`.

The action declares its own guard::

    @action(detail=False, methods=["post"],
            permission_classes=[IsAuthenticated, BulkAssignAccess])
    def bulk_assign(self, request): ...

but the route is hand-written in ``exams/urls.py`` as
``PracticeTestViewSet.as_view({"post": "bulk_assign"})``. Those decorator kwargs reach the
view **through the router** — DRF's own source says so — so a hand-written path passed none
and the viewset's ``AllowAny`` applied instead. ``AllowAny`` is right for the public practice
catalogue this viewset mostly serves; it is not right for an assignment endpoint.

A student POSTing it therefore got 200 and a ``BulkAssignmentDispatch`` row. No access was
granted, because the view re-checks each subject internally and denied — but that inner check
was the only thing there, and the outer gate was silently absent for every caller including
anonymous ones.

Exercised through the URL, not the viewset: calling the view directly would have passed
throughout, which is exactly why this went unnoticed.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import Permission, UserAccess
from exams.models import BulkAssignmentDispatch, PracticeTest

User = get_user_model()

URL = "/api/exams/bulk_assign/"


class BulkAssignRouteGateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        Permission.objects.get_or_create(
            codename=acc_const.PERM_ASSIGN_ACCESS, defaults={"name": "Assign access"}
        )
        self.student = User.objects.create_user(
            email="ba_student@example.com", password="x", role=acc_const.ROLE_STUDENT
        )
        self.teacher = User.objects.create_user(
            email="ba_teacher@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH,
            classroom=None, granted_by=self.teacher,
        )
        self.practice_test = PracticeTest.objects.create(
            subject=acc_const.SUBJECT_MATH_PLATFORM, title="M", skip_default_modules=True
        )

    def _payload(self):
        return {
            "user_ids": [self.student.pk],
            "practice_test_ids": [self.practice_test.pk],
            "exam_ids": [],
            "assignment_type": "FULL",
        }

    def test_a_student_is_refused(self):
        self.client.force_authenticate(self.student)
        r = self.client.post(URL, self._payload(), format="json")
        self.assertEqual(r.status_code, 403, r.content)

    def test_a_refused_caller_leaves_no_dispatch_row(self):
        # The 200 was not harmless: it recorded a dispatch the caller was never entitled to
        # ask for, so the assignment history showed work a student had commissioned.
        self.client.force_authenticate(self.student)
        self.client.post(URL, self._payload(), format="json")
        self.assertFalse(BulkAssignmentDispatch.objects.exists())

    def test_an_anonymous_caller_is_refused(self):
        r = self.client.post(URL, self._payload(), format="json")
        self.assertIn(r.status_code, (401, 403), r.content)

    def test_a_subject_scoped_teacher_still_gets_through(self):
        # The point is to restore the declared gate, not to close the endpoint.
        self.client.force_authenticate(self.teacher)
        r = self.client.post(URL, self._payload(), format="json")
        self.assertNotEqual(r.status_code, 403, r.content)

    def test_the_catalogue_the_viewset_mostly_serves_stays_open(self):
        # `list`/`retrieve` are hand-routed too and declare no permissions of their own, so
        # they must keep the viewset's AllowAny — the practice catalogue loads without cookies.
        self.assertEqual(self.client.get("/api/exams/").status_code, 200)

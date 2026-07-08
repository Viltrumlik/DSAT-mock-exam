"""Standalone teacher-flow tests: grant -> student takes -> teacher sees results; admin exclusion.

    python manage.py test midterms.tests_teacher --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import resources
from access.models import ResourceAccessGrant
from midterms.models import Midterm
from midterms.tests_api import make_published_midterm

User = get_user_model()


class StandaloneTeacherTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="t1", email="t1@x.io", is_staff=True)
        self.student = User.objects.create(username="s1", email="s1@x.io")
        self.tc = APIClient()
        self.tc.force_authenticate(self.teacher)
        self.sc = APIClient()
        self.sc.force_authenticate(self.student)
        self.mt = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")

    def test_grant_then_student_can_take_and_teacher_sees_results(self):
        # Before a grant the student is locked out.
        r = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(r.status_code, 403, r.content)

        # Teacher grants standalone access.
        r = self.tc.post(
            f"/api/midterms/teacher/midterms/{self.mt.id}/grant/",
            {"user_ids": [self.student.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["granted"], [self.student.id])
        grant = ResourceAccessGrant.objects.get(
            user=self.student, resource_type=resources.RT_MIDTERM_V2, resource_id=self.mt.id
        )
        self.assertIsNone(grant.classroom_id)  # standalone
        self.assertEqual(grant.granted_by_id, self.teacher.id)  # instructor = grantor

        # Student can now take it.
        qids = [str(q.id) for q in self.mt.questions()]
        r = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        aid = r.json()["id"]
        self.sc.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        r = self.sc.post(
            f"/api/midterms/attempts/{aid}/submit_module/",
            {"answers": {qids[0]: "a", qids[1]: "a", qids[2]: "b", qids[3]: "b"}},  # 2/4 = 50
            format="json",
        )
        self.assertEqual(r.json()["current_state"], "COMPLETED")

        # Teacher results surface shows the frozen score, instructor, no ranking.
        r = self.tc.get(f"/api/midterms/teacher/midterms/{self.mt.id}/results/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(len(body["students"]), 1)
        row = body["students"][0]
        self.assertEqual(row["student_id"], self.student.id)
        self.assertEqual(row["state"], "COMPLETED")
        self.assertTrue(row["submitted"])
        self.assertEqual(row["score"], 50)
        self.assertEqual(row["instructor_id"], self.teacher.id)
        self.assertNotIn("rank", row)

    def test_revoke_blocks_new_attempt(self):
        self.tc.post(
            f"/api/midterms/teacher/midterms/{self.mt.id}/grant/",
            {"user_ids": [self.student.id]}, format="json",
        )
        self.tc.post(
            f"/api/midterms/teacher/midterms/{self.mt.id}/revoke/",
            {"user_ids": [self.student.id]}, format="json",
        )
        r = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(r.status_code, 403, r.content)

    def test_student_cannot_use_teacher_endpoints(self):
        r = self.sc.get(f"/api/midterms/teacher/midterms/{self.mt.id}/results/")
        self.assertEqual(r.status_code, 403, r.content)

    def test_midterm_hidden_from_admin_resource_types(self):
        self.assertFalse(resources.is_admin_grantable("midterm"))
        self.assertFalse(resources.is_admin_grantable("midterm_v2"))
        self.assertTrue(resources.is_admin_grantable("mock_exam"))
        self.assertTrue(resources.is_admin_grantable("practice_test"))

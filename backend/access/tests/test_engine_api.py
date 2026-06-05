"""API tests for the access-engine admin endpoints (Phase 2 frontend contract)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from access import constants as C
from access import resources
from access.models import ResourceAccessGrant
from classes.models import Classroom, ClassroomMembership
from exams.models import PracticeTest

User = get_user_model()


class EngineApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="api_admin@example.com", password="x", role=C.ROLE_ADMIN)
        self.student = User.objects.create_user(email="api_stud@example.com", password="x", role=C.ROLE_STUDENT)
        self.student2 = User.objects.create_user(email="api_stud2@example.com", password="x", role=C.ROLE_STUDENT)
        self.pt = PracticeTest.objects.create(subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True)

    def test_student_forbidden(self):
        self.client.force_authenticate(self.student)
        r = self.client.get("/api/access/grants/")
        self.assertEqual(r.status_code, 403)

    def test_subject_grant_individual_and_bulk(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post("/api/access/grants/subject/", {
            "user_ids": [self.student.pk, self.student2.pk], "subject": "math",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created"], 2)
        # Idempotent re-grant.
        r2 = self.client.post("/api/access/grants/subject/", {
            "user_ids": [self.student.pk], "subject": "math",
        }, format="json")
        self.assertEqual(r2.json()["created"], 0)
        self.assertEqual(r2.json()["skipped"], 1)

    def test_subject_grant_validation(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post("/api/access/grants/subject/", {
            "user_ids": [self.student.pk], "subject": "physics",
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_resource_grant_and_list_filter(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post("/api/access/grants/resource/", {
            "user_ids": [self.student.pk], "resource_type": resources.RT_PRACTICE_TEST,
            "resource_id": self.pt.pk,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        lst = self.client.get(f"/api/access/grants/?user={self.student.pk}&scope=RESOURCE")
        self.assertEqual(lst.status_code, 200)
        results = lst.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["resource_type"], resources.RT_PRACTICE_TEST)
        self.assertTrue(results[0]["is_effective"])

    def test_classroom_grant(self):
        teacher = User.objects.create_user(email="api_t@example.com", password="x", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        classroom = Classroom.objects.create(
            name="API C", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=teacher,
        )
        ClassroomMembership.objects.create(classroom=classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        ClassroomMembership.objects.create(classroom=classroom, user=self.student2, role=ClassroomMembership.ROLE_STUDENT)
        self.client.force_authenticate(self.admin)
        r = self.client.post("/api/access/grants/classroom/", {
            "classroom_id": classroom.pk, "resource_type": resources.RT_PRACTICE_TEST,
            "resource_id": self.pt.pk,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["created"], 2)

    def test_revoke_and_events(self):
        self.client.force_authenticate(self.admin)
        self.client.post("/api/access/grants/resource/", {
            "user_ids": [self.student.pk], "resource_type": resources.RT_PRACTICE_TEST,
            "resource_id": self.pt.pk,
        }, format="json")
        grant = ResourceAccessGrant.objects.get(user=self.student, resource_id=self.pt.pk)
        rev = self.client.post(f"/api/access/grants/{grant.pk}/revoke/", {}, format="json")
        self.assertEqual(rev.status_code, 200)
        self.assertEqual(rev.json()["status"], "REVOKED")
        ev = self.client.get(f"/api/access/grants/{grant.pk}/events/")
        actions = {e["action"] for e in ev.json()["results"]} if isinstance(ev.json(), dict) else {e["action"] for e in ev.json()}
        self.assertIn("REVOKED", actions)

    def test_resource_search_and_types(self):
        self.client.force_authenticate(self.admin)
        types = self.client.get("/api/access/resource-types/")
        self.assertIn(resources.RT_PRACTICE_TEST, types.json()["results"])
        search = self.client.get(f"/api/access/resources/?type={resources.RT_PRACTICE_TEST}")
        self.assertEqual(search.status_code, 200)
        ids = [it["resource_id"] for it in search.json()["results"]]
        self.assertIn(self.pt.pk, ids)

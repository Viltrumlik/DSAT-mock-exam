"""Subject-scope isolation for the access-engine admin API (Fix 4).

A subject-scoped teacher must not read, mutate, or create grants outside their
subject; global staff stay unrestricted.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from access import constants as C
from access import resources
from access.models import ResourceAccessGrant, UserAccess
from exams.models import PracticeTest

User = get_user_model()


class EngineGrantSubjectScopeTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="scope_admin@example.com", password="x", role=C.ROLE_ADMIN
        )
        self.math_teacher = User.objects.create_user(
            email="scope_mteacher@example.com", password="x", role=C.ROLE_TEACHER,
            subject=C.DOMAIN_MATH,
        )
        # Global math subject grant so authorize(assign_access, MATH) passes.
        UserAccess.objects.create(
            user=self.math_teacher, subject=C.DOMAIN_MATH, granted_by=self.math_teacher
        )
        self.student = User.objects.create_user(
            email="scope_student@example.com", password="x", role=C.ROLE_STUDENT
        )
        self.math_pt = PracticeTest.objects.create(
            subject=C.SUBJECT_MATH_PLATFORM, form_type="INTERNATIONAL", skip_default_modules=True
        )
        self.eng_pt = PracticeTest.objects.create(
            subject=C.SUBJECT_ENGLISH_PLATFORM, form_type="INTERNATIONAL", skip_default_modules=True
        )

    def _grant_resource(self, pt):
        self.client.force_authenticate(self.admin)
        r = self.client.post("/api/access/grants/resource/", {
            "user_ids": [self.student.pk], "resource_type": resources.RT_PRACTICE_TEST,
            "resource_id": pt.pk,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return ResourceAccessGrant.objects.get(user=self.student, resource_id=pt.pk)

    # ── Listing / reading ────────────────────────────────────────────────────
    def test_teacher_list_excludes_other_subject_grants(self):
        math_grant = self._grant_resource(self.math_pt)
        eng_grant = self._grant_resource(self.eng_pt)
        self.client.force_authenticate(self.math_teacher)
        r = self.client.get(f"/api/access/grants/?user={self.student.pk}")
        self.assertEqual(r.status_code, 200)
        ids = {g["id"] for g in r.json()["results"]}
        self.assertIn(math_grant.pk, ids)
        self.assertNotIn(eng_grant.pk, ids)

    def test_teacher_events_hidden_for_other_subject(self):
        eng_grant = self._grant_resource(self.eng_pt)
        self.client.force_authenticate(self.math_teacher)
        r = self.client.get(f"/api/access/grants/{eng_grant.pk}/events/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        results = body["results"] if isinstance(body, dict) else body
        self.assertEqual(results, [])

    # ── Mutation ─────────────────────────────────────────────────────────────
    def test_teacher_cannot_revoke_other_subject_grant(self):
        eng_grant = self._grant_resource(self.eng_pt)
        self.client.force_authenticate(self.math_teacher)
        r = self.client.post(f"/api/access/grants/{eng_grant.pk}/revoke/", {}, format="json")
        self.assertEqual(r.status_code, 404, r.content)
        eng_grant.refresh_from_db()
        self.assertEqual(eng_grant.status, ResourceAccessGrant.STATUS_ACTIVE)

    def test_teacher_can_revoke_own_subject_grant(self):
        math_grant = self._grant_resource(self.math_pt)
        self.client.force_authenticate(self.math_teacher)
        r = self.client.post(f"/api/access/grants/{math_grant.pk}/revoke/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "REVOKED")

    # ── Creation ─────────────────────────────────────────────────────────────
    def test_teacher_cannot_grant_other_subject(self):
        self.client.force_authenticate(self.math_teacher)
        r = self.client.post("/api/access/grants/subject/", {
            "user_ids": [self.student.pk], "subject": "english",
        }, format="json")
        self.assertEqual(r.status_code, 403, r.content)

    def test_teacher_can_grant_own_subject(self):
        self.client.force_authenticate(self.math_teacher)
        r = self.client.post("/api/access/grants/subject/", {
            "user_ids": [self.student.pk], "subject": "math",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_teacher_cannot_grant_other_subject_resource(self):
        self.client.force_authenticate(self.math_teacher)
        r = self.client.post("/api/access/grants/resource/", {
            "user_ids": [self.student.pk], "resource_type": resources.RT_PRACTICE_TEST,
            "resource_id": self.eng_pt.pk,
        }, format="json")
        self.assertEqual(r.status_code, 403, r.content)

    def test_teacher_can_grant_own_subject_resource(self):
        self.client.force_authenticate(self.math_teacher)
        r = self.client.post("/api/access/grants/resource/", {
            "user_ids": [self.student.pk], "resource_type": resources.RT_PRACTICE_TEST,
            "resource_id": self.math_pt.pk,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    # ── Global staff unaffected ──────────────────────────────────────────────
    def test_global_admin_unrestricted(self):
        math_grant = self._grant_resource(self.math_pt)
        eng_grant = self._grant_resource(self.eng_pt)
        self.client.force_authenticate(self.admin)
        r = self.client.get(f"/api/access/grants/?user={self.student.pk}")
        ids = {g["id"] for g in r.json()["results"]}
        self.assertEqual({math_grant.pk, eng_grant.pk}, ids)
        rev = self.client.post(f"/api/access/grants/{eng_grant.pk}/revoke/", {}, format="json")
        self.assertEqual(rev.status_code, 200, rev.content)

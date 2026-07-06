"""Classroom `level` field: subject-dependent create/update validation, and the
assignment-options picker filtering assessment sets by the classroom's level."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet
from classes.models import Classroom, ClassroomMembership

User = get_user_model()


class ClassroomLevelValidationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="lvl_admin@example.com", password="x", role=acc_const.ROLE_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _create(self, **overrides):
        payload = {
            "name": "Level class",
            "subject": Classroom.SUBJECT_ENGLISH,
            "lesson_days": Classroom.DAYS_ODD,
            **overrides,
        }
        return self.client.post("/api/classes/", payload, format="json")

    def test_english_accepts_middle(self):
        resp = self._create(level="middle")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["level"], "middle")

    def test_english_rejects_foundation(self):
        resp = self._create(level="foundation")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("level", resp.json())

    def test_math_accepts_foundation(self):
        resp = self._create(subject=Classroom.SUBJECT_MATH, level="foundation")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["level"], "foundation")

    def test_blank_level_allowed(self):
        resp = self._create()  # no level
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["level"], "")

    def test_settings_update_changes_level(self):
        cid = self._create(level="junior").json()["id"]
        resp = self.client.patch(f"/api/classes/{cid}/", {"level": "senior"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Classroom.objects.get(pk=cid).level, "senior")

    def test_settings_update_rejects_invalid_level_for_subject(self):
        cid = self._create(subject=Classroom.SUBJECT_ENGLISH, level="junior").json()["id"]
        resp = self.client.patch(f"/api/classes/{cid}/", {"level": "foundation"}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)


class AssignmentOptionsLevelFilterTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "lvlopt_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        self.middle_set = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="Middle Eng",
            source=AssessmentSet.SOURCE_SATOPLAM, level="middle", created_by=self.admin,
        )
        self.junior_set = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="Junior Eng",
            source=AssessmentSet.SOURCE_SATOPLAM, level="junior", created_by=self.admin,
        )
        self.untagged_set = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="Untagged Eng",
            source=AssessmentSet.SOURCE_SATOPLAM, level="", created_by=self.admin,
        )

    def _mk_class(self, level: str) -> Classroom:
        c = Classroom.objects.create(
            name=f"Eng {level or 'untagged'}",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            level=level,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=c, user=self.admin, role=ClassroomMembership.ROLE_ADMIN
        )
        return c

    def _options(self, c: Classroom):
        resp = self.client.get(f"/api/classes/{c.id}/assignment-options/")
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_middle_class_sees_only_middle_sets(self):
        data = self._options(self._mk_class("middle"))
        titles = {a["title"] for a in data["assessment_sets"]}
        self.assertEqual(titles, {"Middle Eng"})
        self.assertEqual(data["classroom_level"], "middle")

    def test_untagged_class_sees_all_levels(self):
        data = self._options(self._mk_class(""))
        titles = {a["title"] for a in data["assessment_sets"]}
        self.assertEqual(titles, {"Middle Eng", "Junior Eng", "Untagged Eng"})
        self.assertEqual(data["classroom_level"], "")

    def test_level_present_on_each_set(self):
        data = self._options(self._mk_class("junior"))
        for a in data["assessment_sets"]:
            self.assertIn("level", a)
            self.assertEqual(a["level"], "junior")

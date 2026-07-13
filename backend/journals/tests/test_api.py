"""Journal + lesson REST API: provisioning, content-options level scoping, lesson save,
publish gating, bulk, and permissions."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet
from journals import services
from journals.models import Journal, JournalLesson

User = get_user_model()


def _admin(email="j_admin@test.com"):
    return User.objects.create_user(email=email, password="x", role=acc_const.ROLE_SUPER_ADMIN)


class JournalProvisioningTests(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_create_provisions_lessons(self):
        resp = self.client.post(
            "/api/journals/", {"subject": "MATH", "level": "foundation"}, format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["total_lessons"], 12)
        self.assertEqual(len(body["lessons"]), 12)
        self.assertEqual(body["lessons"][-1]["lesson_type"], "MIDTERM")
        self.assertEqual(body["progress"]["homework_total"], 11)
        self.assertEqual(body["progress"]["midterm_total"], 1)

    def test_create_is_idempotent(self):
        journal, created = services.create_journal(
            subject="MATH", level="junior", actor=self.admin
        )
        self.assertTrue(created)
        again, created2 = services.create_journal(
            subject="MATH", level="junior", actor=self.admin
        )
        self.assertFalse(created2)
        self.assertEqual(journal.id, again.id)
        self.assertEqual(JournalLesson.objects.filter(journal=journal).count(), 36)

    def test_create_english_foundation_rejected(self):
        resp = self.client.post(
            "/api/journals/", {"subject": "ENGLISH", "level": "foundation"}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_list_journals(self):
        services.create_journal(subject="MATH", level="foundation", actor=self.admin)
        services.create_journal(subject="ENGLISH", level="junior", actor=self.admin)
        resp = self.client.get("/api/journals/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["count"], 2)


class ContentOptionsTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_copt@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.found = AssessmentSet.objects.create(
            subject="math", title="Math Found", source=AssessmentSet.SOURCE_SQB,
            level="foundation", created_by=self.admin,
        )
        self.junior = AssessmentSet.objects.create(
            subject="math", title="Math Junior", source=AssessmentSet.SOURCE_SQB,
            level="junior", created_by=self.admin,
        )
        self.english = AssessmentSet.objects.create(
            subject="english", title="Eng Middle", source=AssessmentSet.SOURCE_SQB,
            level="middle", created_by=self.admin,
        )

    def test_level_scoped_assessment_sets(self):
        resp = self.client.get("/api/journals/content-options/?subject=MATH&level=foundation")
        self.assertEqual(resp.status_code, 200, resp.content)
        titles = {a["title"] for a in resp.json()["assessment_sets"]}
        self.assertEqual(titles, {"Math Found"})

    def test_invalid_course_rejected(self):
        resp = self.client.get("/api/journals/content-options/?subject=ENGLISH&level=foundation")
        self.assertEqual(resp.status_code, 400)


class LessonEditTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_ledit@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.set = AssessmentSet.objects.create(
            subject="math", title="F set", source=AssessmentSet.SOURCE_SQB,
            level="foundation", created_by=self.admin,
        )
        self.wrong_level = AssessmentSet.objects.create(
            subject="math", title="J set", source=AssessmentSet.SOURCE_SQB,
            level="junior", created_by=self.admin,
        )
        self.hw = self.journal.lessons.filter(lesson_type="HOMEWORK").first()
        self.midterm = self.journal.lessons.filter(lesson_type="MIDTERM").first()

    def _url(self, lesson):
        return f"/api/journals/{self.journal.id}/lessons/{lesson.id}/"

    def test_attach_assessment_makes_ready(self):
        resp = self.client.patch(
            self._url(self.hw),
            {"instructions": "Do it", "assessment_set_ids": [self.set.id]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertTrue(body["is_ready"])
        self.assertEqual(len(body["assessments"]), 1)

    def test_wrong_level_assessment_filtered_out(self):
        resp = self.client.patch(
            self._url(self.hw),
            {"instructions": "x", "assessment_set_ids": [self.wrong_level.id]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.json()["assessments"]), 0)

    def test_allow_file_upload_alone_is_ready(self):
        resp = self.client.patch(
            self._url(self.hw),
            {"instructions": "Upload your work", "allow_file_upload": True},
            format="json",
        )
        self.assertTrue(resp.json()["is_ready"])

    def test_missing_instructions_not_ready(self):
        resp = self.client.patch(
            self._url(self.hw), {"allow_file_upload": True}, format="json"
        )
        body = resp.json()
        self.assertFalse(body["is_ready"])
        self.assertIn("Instructions are empty", body["validation"])

    def test_midterm_rejects_homework_fields(self):
        resp = self.client.patch(
            self._url(self.midterm), {"instructions": "nope"}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_lesson_publish_requires_ready(self):
        # Not ready yet → 409
        resp = self.client.post(self._url(self.hw) + "publish/")
        self.assertEqual(resp.status_code, 409, resp.content)
        # Make ready, then publish.
        self.client.patch(
            self._url(self.hw),
            {"instructions": "Do it", "allow_file_upload": True},
            format="json",
        )
        resp2 = self.client.post(self._url(self.hw) + "publish/")
        self.assertEqual(resp2.status_code, 200, resp2.content)
        self.assertEqual(resp2.json()["status"], "PUBLISHED")


class JournalPublishTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_pub@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )

    def test_publish_blocked_when_incomplete(self):
        resp = self.client.post(f"/api/journals/{self.journal.id}/publish/")
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertTrue(resp.json()["blocking_lessons"])

    def test_publish_succeeds_when_all_homework_ready(self):
        for l in self.journal.lessons.filter(lesson_type="HOMEWORK"):
            l.instructions = "ok"
            l.allow_file_upload = True
            l.save()
        resp = self.client.post(f"/api/journals/{self.journal.id}/publish/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], "PUBLISHED")


class BulkTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_bulk@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.hw = list(self.journal.lessons.filter(lesson_type="HOMEWORK")[:3])
        for l in self.hw:
            l.instructions = "ok"
            l.allow_file_upload = True
            l.save()

    def test_bulk_publish(self):
        resp = self.client.post(
            f"/api/journals/{self.journal.id}/lessons/bulk/",
            {"action": "publish", "ids": [l.id for l in self.hw]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["affected"], 3)
        for l in self.hw:
            l.refresh_from_db()
            self.assertEqual(l.status, "PUBLISHED")

    def test_bulk_skips_midterm(self):
        midterm = self.journal.lessons.get(lesson_type="MIDTERM")
        resp = self.client.post(
            f"/api/journals/{self.journal.id}/lessons/bulk/",
            {"action": "publish", "ids": [midterm.id]},
            format="json",
        )
        self.assertEqual(resp.json()["skipped"], 1)


class PermissionTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_perm_admin@test.com")
        self.teacher = User.objects.create_user(
            email="j_perm_teacher@test.com", password="x",
            role=acc_const.ROLE_TEACHER, subject="math",
        )
        self.student = User.objects.create_user(
            email="j_perm_student@test.com", password="x", role=acc_const.ROLE_STUDENT
        )
        services.create_journal(subject="MATH", level="foundation", actor=self.admin)

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_admin_can_list(self):
        self.assertEqual(self._client(self.admin).get("/api/journals/").status_code, 200)

    def test_teacher_forbidden(self):
        self.assertEqual(self._client(self.teacher).get("/api/journals/").status_code, 403)

    def test_student_forbidden(self):
        self.assertEqual(self._client(self.student).get("/api/journals/").status_code, 403)

    def test_teacher_cannot_create(self):
        resp = self._client(self.teacher).post(
            "/api/journals/", {"subject": "MATH", "level": "junior"}, format="json"
        )
        self.assertEqual(resp.status_code, 403)

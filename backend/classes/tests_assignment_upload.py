"""Regression: creating/updating an assignment with a temp-file-backed upload must not 500.

Large uploads (> FILE_UPLOAD_MAX_MEMORY_SIZE) arrive as a disk-backed TemporaryUploadedFile
(a non-picklable BufferedRandom). The view used to ``request.data.copy()`` (a deep copy) with
the file still present, raising "cannot pickle 'BufferedRandom'". We force temp-file backing for
every upload via FILE_UPLOAD_MAX_MEMORY_SIZE=0 so even a tiny file reproduces the original crash.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


@override_settings(FILE_UPLOAD_MAX_MEMORY_SIZE=0)
class AssignmentFileUploadTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("up_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="UP", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.owner
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _url(self):
        return f"/api/classes/{self.classroom.id}/assignments/"

    def _pdf(self, name="hw.pdf"):
        return SimpleUploadedFile(name, b"%PDF-1.4 test file body", content_type="application/pdf")

    def test_create_with_temp_file_upload_succeeds(self):
        resp = self.client.post(
            self._url(),
            {"title": "With file", "instructions": "do it", "attachment_file": self._pdf()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        a = Assignment.objects.get(pk=resp.json()["id"])
        self.assertTrue(a.attachment_file)  # primary file stored

    def test_create_with_disallowed_file_type_returns_400_not_500(self):
        # A .jar (or any non-allowlisted type) must fail gracefully with a 400 +
        # readable detail — never bubble the Django ValidationError up as a 500.
        bad = SimpleUploadedFile("payload.jar", b"PK\x03\x04 fake", content_type="application/java-archive")
        resp = self.client.post(
            self._url(),
            {"title": "Bad file", "instructions": "do it", "attachment_file": bad},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("detail", resp.json())
        self.assertIn("File type not allowed", resp.json()["detail"])

    def test_update_with_temp_file_upload_succeeds(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Edit me",
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=Assignment.STATUS_DRAFT,
        )
        resp = self.client.patch(
            f"{self._url()}{a.id}/",
            {"title": "Edited", "attachment_file": self._pdf("edit.pdf")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.title, "Edited")
        self.assertTrue(a.attachment_file)

    def _attached_names(self, a) -> set[str]:
        """Every teacher file still reachable from the assignment, primary and extras."""
        names = {ex.file.name for ex in a.extra_attachments.all()}
        if a.attachment_file:
            names.add(a.attachment_file.name)
        return names

    def test_a_second_edit_adds_a_file_instead_of_evicting_the_first(self):
        # Two files added in two separate edits — the teacher's first file must still be
        # there. It used to be reassigned away from `attachment_file` with a 200 OK and no
        # warning, leaving an unreachable blob in storage and a homework short one handout.
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Two files",
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=Assignment.STATUS_DRAFT,
        )
        first = self.client.patch(
            f"{self._url()}{a.id}/", {"attachment_file": self._pdf("first.pdf")}, format="multipart"
        )
        self.assertEqual(first.status_code, 200, first.content)
        a.refresh_from_db()
        first_name = a.attachment_file.name

        second = self.client.patch(
            f"{self._url()}{a.id}/", {"attachment_file": self._pdf("second.pdf")}, format="multipart"
        )
        self.assertEqual(second.status_code, 200, second.content)
        a.refresh_from_db()

        names = self._attached_names(a)
        self.assertIn(first_name, names, "the first file was dropped from the assignment")
        self.assertEqual(len(names), 2, f"expected both files to survive, got {names}")
        # The newest upload is what the homework leads with; the older one steps down.
        self.assertNotEqual(a.attachment_file.name, first_name)
        self.assertIn(first_name, {ex.file.name for ex in a.extra_attachments.all()})

    def test_replace_attachments_is_the_one_way_to_drop_the_earlier_files(self):
        # The explicit swap: ?replace_attachments means the teacher asked for the old files
        # to go, so demotion must NOT keep them alive.
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Swap",
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=Assignment.STATUS_DRAFT,
        )
        self.client.patch(
            f"{self._url()}{a.id}/", {"attachment_file": self._pdf("old.pdf")}, format="multipart"
        )
        a.refresh_from_db()
        old_name = a.attachment_file.name

        resp = self.client.patch(
            f"{self._url()}{a.id}/?replace_attachments=1",
            {"attachment_file": self._pdf("new.pdf")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()

        names = self._attached_names(a)
        self.assertEqual(len(names), 1, f"replace should leave exactly one file, got {names}")
        self.assertNotIn(old_name, names)

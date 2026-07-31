"""Lesson video on a classroom homework: upload key, link/upload precedence, presign auth.

resolve_video_key works offline for a well-formed key (the R2 size check is skipped when
R2 is unconfigured), so the save paths need no mocking; the presign endpoint is mocked.
"""
from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class AssignmentVideoTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("av_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Vid", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _detail(self, aid):
        return f"/api/classes/{self.classroom.id}/assignments/{aid}/"

    def _mk(self, **kw):
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="HW", **kw
        )

    def test_upload_key_sets_video_file_and_serves_url(self):
        a = self._mk()
        resp = self.client.patch(
            self._detail(a.id), {"video_key": "homework_videos/abc123.mp4"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.video_file.name, "homework_videos/abc123.mp4")
        self.assertTrue(resp.json()["video_file_url"])

    def test_link_replaces_uploaded_file(self):
        a = self._mk(video_file="homework_videos/old.mp4")
        resp = self.client.patch(
            self._detail(a.id), {"video_url": "youtube.com/watch?v=x"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.video_url, "https://youtube.com/watch?v=x")
        self.assertFalse(a.video_file)

    def test_upload_clears_existing_link(self):
        a = self._mk(video_url="https://youtube.com/watch?v=x")
        self.client.patch(self._detail(a.id), {"video_key": "homework_videos/new.mp4"}, format="json")
        a.refresh_from_db()
        self.assertEqual(a.video_file.name, "homework_videos/new.mp4")
        self.assertEqual(a.video_url, "")

    def test_remove_video_clears_both(self):
        a = self._mk(video_file="homework_videos/x.mp4")
        self.client.patch(self._detail(a.id), {"remove_video": True}, format="json")
        a.refresh_from_db()
        self.assertFalse(a.video_file)
        self.assertEqual(a.video_url, "")

    def test_malformed_key_is_ignored_not_500(self):
        a = self._mk()
        resp = self.client.patch(
            self._detail(a.id), {"video_key": "evil/../x.mp4"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertFalse(a.video_file)

    def test_presign_forbidden_for_student(self):
        student = User.objects.create_user("av_stud@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=student, role=ClassroomMembership.ROLE_STUDENT
        )
        c = APIClient()
        c.force_authenticate(student)
        resp = c.post(
            f"/api/classes/{self.classroom.id}/assignments/video-upload-url/",
            {"filename": "x.mp4"}, format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.content)

    @patch("classes.views_media.presign_video_put")
    def test_presign_returns_ticket_for_staff(self, mock_presign):
        mock_presign.return_value = {
            "upload_url": "https://r2/put", "key": "homework_videos/x.mp4",
            "content_type": "video/mp4", "max_bytes": 123,
        }
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/assignments/video-upload-url/",
            {"filename": "x.mp4"}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["key"], "homework_videos/x.mp4")

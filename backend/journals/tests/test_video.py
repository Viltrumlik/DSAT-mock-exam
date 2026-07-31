"""Lesson video on journal sessions: upload/link/remove precedence + release aliasing."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from journals import services

User = get_user_model()


def _admin(email="jv@test.com"):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_SUPER_ADMIN
    )


class JournalLessonVideoTests(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.lesson = services.add_session(self.journal, actor=self.admin)

    def _url(self):
        return f"/api/journals/{self.journal.id}/lessons/{self.lesson.id}/"

    def test_upload_key_sets_file_and_clears_link(self):
        self.lesson.video_url = "https://youtu.be/x"
        self.lesson.save()
        r = self.client.patch(self._url(), {"video_key": "homework_videos/a.mp4"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.video_file.name, "homework_videos/a.mp4")
        self.assertEqual(self.lesson.video_url, "")
        self.assertTrue(r.json()["video_file_url"])

    def test_link_clears_uploaded_file(self):
        self.lesson.video_file = "homework_videos/old.mp4"
        self.lesson.save()
        r = self.client.patch(self._url(), {"video_url": "vimeo.com/123"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.lesson.refresh_from_db()
        self.assertFalse(self.lesson.video_file)
        self.assertEqual(self.lesson.video_url, "https://vimeo.com/123")

    def test_remove_clears_file(self):
        self.lesson.video_file = "homework_videos/x.mp4"
        self.lesson.save()
        self.client.patch(self._url(), {"remove_video": True}, format="json")
        self.lesson.refresh_from_db()
        self.assertFalse(self.lesson.video_file)


class DeliveryVideoAliasTests(TestCase):
    def setUp(self):
        from datetime import date
        from classes.models import Classroom
        from journals.models import Journal

        self.admin = _admin("jvd@test.com")
        self.classroom = Classroom.objects.create(
            name="M", subject=Classroom.SUBJECT_MATH, level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD, lesson_time="18:00",
            start_date=date(2026, 8, 3), created_by=self.admin,
        )
        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])
        self.lesson = services.add_session(self.journal, actor=self.admin)
        self.lesson.instructions = "do it"
        self.lesson.video_file = "homework_videos/lesson.mp4"
        self.lesson.save()

    def test_release_aliases_the_same_object_key(self):
        from journals import delivery

        row, created, _ = delivery.release_homework(
            self.classroom, self.lesson, actor=self.admin
        )
        self.assertTrue(created)
        self.assertEqual(row.assignment.video_file.name, "homework_videos/lesson.mp4")

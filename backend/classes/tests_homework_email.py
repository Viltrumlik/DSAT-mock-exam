"""The "new homework" class email: sent on assign/publish, once, to active students only.

    python manage.py test classes.tests_homework_email
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from classes.mail_homework import build_context, notify_homework_assigned
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()

SENDING_ON = dict(
    EMAIL_SENDING_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CELERY_TASK_ALWAYS_EAGER=True,  # run the fan-out inline so mail.outbox fills in the test
)


@override_settings(**SENDING_ON)
class HomeworkEmailTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("hw_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Senior G12 · English · Abdulahad N.",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        self.s1 = self._enrol("hw_s1@t.com")
        self.s2 = self._enrol("hw_s2@t.com")

    def _enrol(self, email, *, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(email, "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=status,
        )
        return user

    def _homework(self, **kw):
        kw.setdefault("title", "Unit 4 practice set")
        kw.setdefault("status", Assignment.STATUS_PUBLISHED)
        kw.setdefault("due_at", timezone.now())
        return Assignment.objects.create(classroom=self.classroom, created_by=self.teacher, **kw)

    # ── who gets it ──────────────────────────────────────────────────────────
    def test_published_homework_mails_every_active_student(self):
        notify_homework_assigned(self._homework())
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual({r for m in mail.outbox for r in m.to}, {"hw_s1@t.com", "hw_s2@t.com"})

    def test_teacher_is_never_mailed(self):
        notify_homework_assigned(self._homework())
        self.assertNotIn("hw_teacher@t.com", {r for m in mail.outbox for r in m.to})

    def test_removed_and_invited_students_are_skipped(self):
        self._enrol("hw_removed@t.com", status=ClassroomMembership.STATUS_REMOVED)
        self._enrol("hw_invited@t.com", status=ClassroomMembership.STATUS_INVITED)
        notify_homework_assigned(self._homework())
        recipients = {r for m in mail.outbox for r in m.to}
        self.assertNotIn("hw_removed@t.com", recipients)
        self.assertNotIn("hw_invited@t.com", recipients)

    def test_a_draft_is_never_announced(self):
        notify_homework_assigned(self._homework(status=Assignment.STATUS_DRAFT))
        self.assertEqual(len(mail.outbox), 0)

    # ── idempotency ──────────────────────────────────────────────────────────
    def test_a_second_call_does_not_re_mail(self):
        hw = self._homework()
        self.assertTrue(notify_homework_assigned(hw))
        self.assertFalse(notify_homework_assigned(hw))  # notified_at already claimed
        self.assertEqual(len(mail.outbox), 2)

    def test_claiming_sets_notified_at(self):
        hw = self._homework()
        notify_homework_assigned(hw)
        hw.refresh_from_db()
        self.assertIsNotNone(hw.notified_at)

    # ── content ──────────────────────────────────────────────────────────────
    def test_email_carries_deadline_and_a_link_to_the_detail_page(self):
        hw = self._homework(instructions="Read the passage twice.")
        notify_homework_assigned(hw)
        html = mail.outbox[0].alternatives[0][0]
        self.assertIn("Read the passage twice.", html)
        self.assertIn(f"/classes/{self.classroom.id}/assignments/{hw.id}", html)
        self.assertIn("DUE BY", html)

    def test_deadline_free_homework_says_so_instead_of_a_blank_date(self):
        ctx = build_context(self._homework(due_at=None))
        self.assertFalse(ctx["has_due"])
        # The text body must not promise a due time it does not have.
        from classes.mail_homework import _text_body

        self.assertIn("No fixed deadline", _text_body(ctx))

    def test_the_view_create_path_sends_one_email_per_student(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(self.teacher)
        resp = client.post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {"title": "Homework via API", "instructions": "Do the set."},
            format="json",
        )
        self.assertIn(resp.status_code, (200, 201), resp.content)
        self.assertEqual(len(mail.outbox), 2)

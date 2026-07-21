"""Mandatory midterm schedule + the class-wide "your midterm is scheduled" email.

Two things are under test and they are the same rule seen from both ends: a classroom
midterm may not exist without a start time (a schedule with a NULL ``starts_at`` is open to
everyone, see ``MidtermSchedule``), and the moment one is set the class is told once.

    python manage.py test classes.tests_midterm_email
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from exams.models import MockExam, PracticeTest
from midterms.models import Midterm, MidtermOutcome

from classes.mail_midterm import (
    build_context,
    notify_class_midterm_scheduled,
    send_midterm_scheduled_emails,
)
from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule

User = get_user_model()

SENDING_ON = dict(
    EMAIL_SENDING_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)


class MidtermEmailFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("mte_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="ENG-Senior", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        self.s1 = self._enrol("mte_s1@t.com")
        self.s2 = self._enrol("mte_s2@t.com")
        self.midterm = Midterm.objects.create(
            title="R&W Midterm 3", subject=Midterm.READING_WRITING,
            scoring_scale=Midterm.SCALE_800, duration_minutes=45, is_published=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _enrol(self, email, *, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(email, "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=status,
        )
        return user

    def _schedule(self, **kw):
        kw.setdefault("starts_at", timezone.now() + timedelta(days=1))
        return MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, **kw
        )

    def _assign_url(self):
        return f"/api/classes/{self.classroom.id}/midterms-v2/assign/"

    def _panel_url(self):
        return f"/api/classes/{self.classroom.id}/midterms-v2/{self.midterm.id}/panel/"

    def _start_code_url(self):
        return f"/api/classes/{self.classroom.id}/midterms-v2/{self.midterm.id}/start-code/"


class MandatoryScheduleTests(MidtermEmailFixture):
    """Every teacher-facing path that can create a schedule must carry a start time."""

    def test_assign_without_start_is_rejected(self):
        resp = self.client.post(self._assign_url(), {"midterm_id": self.midterm.id}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("starts_at", resp.data)
        self.assertFalse(
            MidtermSchedule.objects.filter(classroom=self.classroom, midterm=self.midterm).exists()
        )

    def test_assign_with_start_creates_the_window(self):
        starts = timezone.now() + timedelta(days=1)
        resp = self.client.post(
            self._assign_url(),
            {"midterm_id": self.midterm.id, "starts_at": starts.isoformat()},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        sched = MidtermSchedule.objects.get(classroom=self.classroom, midterm=self.midterm)
        self.assertIsNotNone(sched.starts_at)

    def test_reassign_without_fields_keeps_the_existing_window(self):
        """Re-assigning to pick up a late student sends no schedule fields; the window the
        teacher already chose satisfies the rule."""
        sched = self._schedule()
        resp = self.client.post(self._assign_url(), {"midterm_id": self.midterm.id}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        sched.refresh_from_db()
        self.assertIsNotNone(sched.starts_at)

    def test_panel_patch_cannot_null_the_start_back_out(self):
        sched = self._schedule()
        resp = self.client.patch(self._panel_url(), {"starts_at": None}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("starts_at", resp.data)
        sched.refresh_from_db()
        self.assertIsNotNone(sched.starts_at)

    def test_panel_patch_on_an_unscheduled_midterm_needs_a_start(self):
        """The rejected PATCH must not leave the empty schedule behind that it used to
        create before validating."""
        resp = self.client.patch(self._panel_url(), {"ignore_start": True}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertFalse(
            MidtermSchedule.objects.filter(classroom=self.classroom, midterm=self.midterm).exists()
        )

    def test_start_code_needs_a_scheduled_start(self):
        resp = self.client.post(self._start_code_url(), {}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("starts_at", resp.data)
        self.assertFalse(
            MidtermSchedule.objects.filter(classroom=self.classroom, midterm=self.midterm).exists()
        )

    def test_start_code_accepts_the_start_in_the_same_request(self):
        starts = timezone.now() + timedelta(hours=3)
        resp = self.client.post(
            self._start_code_url(), {"starts_at": starts.isoformat()}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data["access_code"]), 6)
        sched = MidtermSchedule.objects.get(classroom=self.classroom, midterm=self.midterm)
        self.assertIsNotNone(sched.starts_at)

    def test_legacy_assign_without_start_is_rejected(self):
        exam = MockExam.objects.create(
            title="Legacy Midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="READING_WRITING", midterm_scoring_scale=MockExam.SCALE_100,
        )
        PracticeTest.objects.create(
            subject="ENGLISH", label="M", title="sec", collection_name="MID", mock_exam=exam
        )
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/assign-midterm/",
            {"mock_exam_id": exam.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("starts_at", resp.data)
        self.assertFalse(MidtermSchedule.objects.filter(mock_exam=exam).exists())


class NotifyOnceTests(MidtermEmailFixture):
    """``notified_at`` is claimed before anything is queued, so a class is mailed once."""

    def test_claim_is_single_use(self):
        sched = self._schedule()
        with patch("classes.mail_midterm.enqueue_midterm_scheduled_emails") as enqueue:
            self.assertTrue(notify_class_midterm_scheduled(sched))
            self.assertFalse(notify_class_midterm_scheduled(sched))
            self.assertEqual(enqueue.call_count, 1)
        sched.refresh_from_db()
        self.assertIsNotNone(sched.notified_at)

    def test_force_re_notifies(self):
        sched = self._schedule(notified_at=timezone.now())
        with patch("classes.mail_midterm.enqueue_midterm_scheduled_emails") as enqueue:
            self.assertTrue(notify_class_midterm_scheduled(sched, force=True))
            enqueue.assert_called_once_with(sched.pk)

    def test_a_schedule_with_no_start_is_never_announced(self):
        sched = MidtermSchedule.objects.create(classroom=self.classroom, midterm=self.midterm)
        with patch("classes.mail_midterm.enqueue_midterm_scheduled_emails") as enqueue:
            self.assertFalse(notify_class_midterm_scheduled(sched))
            enqueue.assert_not_called()

    def test_assign_claims_and_resave_does_not(self):
        starts = timezone.now() + timedelta(days=1)
        with patch("classes.mail_midterm.enqueue_midterm_scheduled_emails") as enqueue:
            self.client.post(
                self._assign_url(),
                {"midterm_id": self.midterm.id, "starts_at": starts.isoformat()},
                format="json",
            )
            self.client.patch(
                self._panel_url(),
                {"starts_at": (starts + timedelta(hours=1)).isoformat()},
                format="json",
            )
        self.assertEqual(enqueue.call_count, 1)


class EnqueueDispatchTests(MidtermEmailFixture):
    """A 25-student fan-out at EMAIL_TIMEOUT=10 must never run inside the request."""

    def test_no_broker_defers_to_on_commit(self):
        from classes import mail_midterm

        sched = self._schedule()
        with patch.object(mail_midterm, "send_midterm_scheduled_emails") as task:
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                mail_midterm.enqueue_midterm_scheduled_emails(sched.pk)
            task.assert_not_called()
            task.delay.assert_not_called()
            self.assertEqual(len(callbacks), 1)

    @override_settings(CELERY_BROKER_URL="redis://example:6379/0")
    def test_broker_uses_delay(self):
        from classes import mail_midterm

        sched = self._schedule()
        with patch.object(mail_midterm, "send_midterm_scheduled_emails") as task:
            mail_midterm.enqueue_midterm_scheduled_emails(sched.pk)
            task.delay.assert_called_once_with(sched.pk)


@override_settings(**SENDING_ON)
class FanOutTests(MidtermEmailFixture):
    def test_every_active_student_gets_one(self):
        sched = self._schedule()
        result = send_midterm_scheduled_emails(sched.pk)
        self.assertEqual(result["sent"], 2)
        self.assertEqual(
            sorted(m.to[0] for m in mail.outbox), [self.s1.email, self.s2.email]
        )

    def test_removed_students_and_teachers_are_not_mailed(self):
        self._enrol("mte_gone@t.com", status=ClassroomMembership.STATUS_REMOVED)
        sched = self._schedule()
        send_midterm_scheduled_emails(sched.pk)
        recipients = {m.to[0] for m in mail.outbox}
        self.assertNotIn("mte_gone@t.com", recipients)
        self.assertNotIn(self.teacher.email, recipients)

    def test_an_undeliverable_address_is_skipped(self):
        """A Telegram signup has no address at all; it must not become a send attempt."""
        User.objects.filter(pk=self.s2.pk).update(email=None)
        sched = self._schedule()
        result = send_midterm_scheduled_emails(sched.pk)
        self.assertEqual(result["sent"], 1)
        self.assertEqual([m.to[0] for m in mail.outbox], [self.s1.email])

    def test_one_failure_does_not_abort_the_class(self):
        sched = self._schedule()
        with patch("classes.mail_midterm._send_one", side_effect=[OSError("smtp down"), True]):
            result = send_midterm_scheduled_emails(sched.pk)
        self.assertEqual((result["sent"], result["failed"]), (1, 1))

    def test_nothing_is_sent_while_sending_is_disabled(self):
        sched = self._schedule()
        with override_settings(EMAIL_SENDING_ENABLED=False):
            result = send_midterm_scheduled_emails(sched.pk)
        self.assertEqual(result["reason"], "sending_disabled")
        self.assertEqual(mail.outbox, [])

    def test_the_message_carries_the_window_and_the_rules(self):
        sched = self._schedule()
        send_midterm_scheduled_emails(sched.pk)
        msg = mail.outbox[0]
        html = msg.alternatives[0][0]
        self.assertIn("R&W Midterm 3", msg.subject)
        # Times are rendered in the classroom's timezone, and "be seated by" is 15 minutes
        # before the start — a student reading UTC would turn up five hours late.
        local = timezone.localtime(sched.starts_at)
        self.assertIn(local.strftime("%H:%M"), html)
        self.assertIn((local - timedelta(minutes=15)).strftime("%H:%M"), html)
        # The rules mirror the runner's start screen — the grouped headings and the
        # off-screen rule (worded as on the screen) must both be present.
        self.assertIn("NOT ALLOWED", html)
        self.assertIn("Leaving full screen or switching windows", html)
        self.assertIn(self.classroom.name, html)
        # Both parts are present: some clients render only the plain text.
        self.assertIn("NOT ALLOWED", msg.body)
        self.assertIn("Leaving full screen or switching windows", msg.body)

    def test_a_scripted_title_cannot_reach_the_inbox_as_markup(self):
        Midterm.objects.filter(pk=self.midterm.pk).update(title="<script>alert(1)</script>")
        sched = self._schedule()
        send_midterm_scheduled_emails(sched.pk)
        html = mail.outbox[0].alternatives[0][0]
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)

    def _retake_schedule(self):
        parent = Midterm.objects.create(title="R&W Midterm 3", subject=Midterm.READING_WRITING)
        retake = Midterm.objects.create(
            title="R&W Midterm 3 — Retake", subject=Midterm.READING_WRITING,
            midterm_type=Midterm.TYPE_RETAKE, retake_of=parent,
        )
        return parent, MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=retake, starts_at=timezone.now() + timedelta(days=1)
        )

    def test_a_retake_says_so(self):
        parent, sched = self._retake_schedule()
        # A retake is mailed only to the students it is granted to — the ones who failed.
        MidtermOutcome.objects.create(
            midterm=parent, student=self.s1, score=300, pass_mark=500, passed=False
        )
        send_midterm_scheduled_emails(sched.pk)
        self.assertIn("Your retake is scheduled", mail.outbox[0].subject)

    def test_a_retake_is_not_mailed_to_students_who_passed(self):
        # Summoning a student who already cleared the midterm to a retake they cannot even
        # open is the same mistake as granting it to them.
        parent, sched = self._retake_schedule()
        MidtermOutcome.objects.create(
            midterm=parent, student=self.s1, score=300, pass_mark=500, passed=False
        )
        MidtermOutcome.objects.create(
            midterm=parent, student=self.s2, score=700, pass_mark=500, passed=True
        )
        send_midterm_scheduled_emails(sched.pk)
        self.assertEqual([m.to[0] for m in mail.outbox], [self.s1.email])


class ContextTests(MidtermEmailFixture):
    def test_pre_midterm_is_not_described_as_pass_fail(self):
        self.midterm.midterm_type = Midterm.TYPE_PRE_MIDTERM
        self.midterm.save(update_fields=["midterm_type"])
        context = build_context(self._schedule())
        self.assertIn("not pass/fail", context["scoring_label"])

    def test_graded_midterm_shows_the_pass_mark_on_its_own_scale(self):
        """SCALE_800 floors at 200, so the default pass mark is 500 — never 400."""
        context = build_context(self._schedule())
        self.assertEqual(context["scoring_label"], "Out of 800 · pass at 500")

    def test_a_legacy_mock_exam_schedule_is_still_describable(self):
        """Legacy midterms keep their length on their modules, so the facts come from a
        different query than the new model's — and a schedule can still carry either."""
        exam = MockExam.objects.create(
            title="Legacy Midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="READING_WRITING", midterm_scoring_scale=MockExam.SCALE_100,
        )
        sched = MidtermSchedule.objects.create(
            classroom=self.classroom, mock_exam=exam, starts_at=timezone.now() + timedelta(days=1)
        )
        context = build_context(sched)
        self.assertEqual(context["midterm_title"], "Legacy Midterm")
        self.assertEqual(context["scoring_label"], "Out of 100 · pass at 50")

    def test_a_schedule_with_no_exam_is_undescribable(self):
        sched = MidtermSchedule.objects.create(
            classroom=self.classroom, starts_at=timezone.now() + timedelta(days=1)
        )
        self.assertIsNone(build_context(sched))

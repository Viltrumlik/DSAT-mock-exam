"""The three exam notifications actually get produced: scheduled, result, certificate.

Every event in ``notifications.constants`` was declared long before anything fired it, so
these tests pin the *producers* rather than the delivery machinery (that is covered by
``notifications.tests_notifications``). Four properties, each of which has a way of going
wrong that is worse than sending nothing at all:

1. **Scheduling reaches the whole roster, mailbox or not.** The bell is not email and is not
   gated on ``EMAIL_SENDING_ENABLED``; a Telegram signup with no address still has to be told
   when to turn up.
2. **Re-running the hook is silent.** A class that gets the same notice three times learns to
   ignore all three.
3. **A result notification goes only to a student whose result is genuinely visible.** This
   school has already been burned once by a publish that flipped one identity's row while the
   student area read another (``midterms.access.midterm_results_state``); a notification
   announcing a score that its own link still withholds turns that bug into a message.
4. **The score and the certificate are separate news.** A student can have the first without
   the second, and must then hear about exactly one.

    python manage.py test midterms.tests_notifications_midterm
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from classes.mail_midterm import send_midterm_scheduled_emails
from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule
from midterms.certificate_service import issue_classroom_certificates
from midterms.models import Midterm, MidtermAttempt, MidtermResit
from midterms.tests_api import make_published_midterm
from notifications import constants as note_const
from notifications.models import Notification

User = get_user_model()


def make_classroom(teacher, name="ENG-101"):
    room = Classroom.objects.create(
        name=name,
        subject=Classroom.SUBJECT_ENGLISH,
        level="junior",
        lesson_days=Classroom.DAYS_ODD,
        teacher=teacher,
        created_by=teacher,
    )
    ClassroomMembership.objects.create(
        classroom=room, user=teacher, role=ClassroomMembership.ROLE_TEACHER,
        status=ClassroomMembership.STATUS_ACTIVE,
    )
    return room


def enrol(room, student, status=ClassroomMembership.STATUS_ACTIVE):
    return ClassroomMembership.objects.create(
        classroom=room, user=student, role=ClassroomMembership.ROLE_STUDENT, status=status,
    )


def grant(student, midterm, classroom, teacher):
    return ResourceAccessGrant.objects.create(
        user=student,
        scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM_V2,
        resource_id=midterm.id,
        status=ResourceAccessGrant.STATUS_ACTIVE,
        classroom=classroom,
        granted_by=teacher,
    )


def finish(midterm, student, score):
    """A completed sitting, written straight to the table.

    These tests are about who gets told, not about how the paper was taken, and driving the
    runner API for each student would make the fixture the slowest part of the suite.
    """
    return MidtermAttempt.objects.create(
        midterm=midterm, student=student, score=score,
        is_completed=True, current_state=MidtermAttempt.STATE_COMPLETED,
    )


def notes(student, event):
    return Notification.objects.filter(recipient=student, event=event)


@contextmanager
def no_push_broker():
    """Silence the Celery publish ``notify`` queues for push-eligible events.

    There is no broker in a test run, and ``notifications.services.queue_push`` defers its
    ``.delay()`` into a ``transaction.on_commit`` of its own — so the kombu connection error
    is raised by whoever DRAINS the callback queue, not inside ``queue_push``'s ``try``. In
    production that drainer is ``notify`` itself (the callback runs inline, because by then we
    are outside any transaction) and the error is swallowed there. Under ``TestCase`` the
    drainer is ``captureOnCommitCallbacks``, which has no such guard, so the publish failure
    surfaces as an error in a test that is not about push at all.

    Only the publish tests need this: they are the ones that have to drain callbacks.
    """
    from notifications import tasks

    with patch.object(tasks.send_push_for_notification, "delay"):
        yield


# ── MIDTERM_SCHEDULED ─────────────────────────────────────────────────────────
@override_settings(EMAIL_SENDING_ENABLED=False)
class MidtermScheduledNotificationTests(TestCase):
    """Sending is deliberately OFF for the whole class: the bell must not depend on it."""

    def setUp(self):
        self.teacher = User.objects.create(username="msn_t", email="msn_t@x.io", is_staff=True)
        self.room = make_classroom(self.teacher)
        self.mt = make_published_midterm(scale=Midterm.SCALE_100, n=4)

        self.s1 = User.objects.create(username="msn_1", email="msn_1@x.io")
        self.s2 = User.objects.create(username="msn_2", email="msn_2@x.io")
        self.gone = User.objects.create(username="msn_gone", email="msn_gone@x.io")
        for student in (self.s1, self.s2):
            enrol(self.room, student)
        enrol(self.room, self.gone, status=ClassroomMembership.STATUS_REMOVED)

        self.sched = MidtermSchedule.objects.create(
            classroom=self.room, midterm=self.mt,
            starts_at=timezone.now() + timedelta(days=2), created_by=self.teacher,
        )

    def test_scheduling_notifies_every_active_student_exactly_once(self):
        result = send_midterm_scheduled_emails(self.sched.pk)

        # No mail went out (sending is off) — and the class was still told.
        self.assertEqual(result["reason"], "sending_disabled")
        self.assertEqual(result["notified"], 2)

        scheduled = Notification.objects.filter(event=note_const.EVENT_MIDTERM_SCHEDULED)
        self.assertEqual(scheduled.count(), 2)
        self.assertEqual(
            set(scheduled.values_list("recipient_id", flat=True)), {self.s1.pk, self.s2.pk}
        )

    def test_a_student_with_no_mailbox_is_still_told(self):
        """A Telegram signup has no address. The email skips them; the bell may not."""
        User.objects.filter(pk=self.s2.pk).update(email=None)

        send_midterm_scheduled_emails(self.sched.pk)

        self.assertEqual(notes(self.s2, note_const.EVENT_MIDTERM_SCHEDULED).count(), 1)

    def test_the_teacher_and_removed_students_are_not_summoned(self):
        send_midterm_scheduled_emails(self.sched.pk)

        self.assertFalse(notes(self.teacher, note_const.EVENT_MIDTERM_SCHEDULED).exists())
        self.assertFalse(notes(self.gone, note_const.EVENT_MIDTERM_SCHEDULED).exists())

    def test_the_notice_points_at_the_students_own_midterm_list(self):
        send_midterm_scheduled_emails(self.sched.pk)

        row = notes(self.s1, note_const.EVENT_MIDTERM_SCHEDULED).get()
        self.assertEqual(row.link_url, "/midterm")
        self.assertEqual(row.category, note_const.CATEGORY_EXAMS)
        # The window is in the message itself, not only behind the link.
        self.assertIn(self.mt.title, row.body)

    def test_re_running_the_hook_tells_nobody_a_second_time(self):
        send_midterm_scheduled_emails(self.sched.pk)
        send_midterm_scheduled_emails(self.sched.pk)

        self.assertEqual(
            Notification.objects.filter(event=note_const.EVENT_MIDTERM_SCHEDULED).count(), 2
        )


# ── MIDTERM_RESULT + CERTIFICATE_READY ────────────────────────────────────────
class MidtermPublishNotificationTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="mpn_t", email="mpn_t@x.io", is_staff=True)
        self.room = make_classroom(self.teacher, name="ENG-Publish")
        self.mt = make_published_midterm(scale=Midterm.SCALE_100, n=4)

    def _publish(self, **kwargs):
        """Publish, running the on_commit callbacks the producer schedules.

        ``issue_classroom_certificates`` is atomic and the notifications are queued for after
        it commits — which never happens inside a ``TestCase``'s wrapping transaction, so the
        callbacks have to be drained by hand.
        """
        with no_push_broker(), self.captureOnCommitCallbacks(execute=True):
            return issue_classroom_certificates(self.mt, self.room, self.teacher, **kwargs)

    def test_publishing_tells_the_class_their_result_and_their_certificate(self):
        student = User.objects.create(username="mpn_a", email="mpn_a@x.io")
        enrol(self.room, student)
        grant(student, self.mt, self.room, self.teacher)
        attempt = finish(self.mt, student, 80)
        MidtermSchedule.objects.create(
            classroom=self.room, midterm=self.mt, created_by=self.teacher,
        )

        result = self._publish()
        self.assertTrue(result["ok"], result)

        row = notes(student, note_const.EVENT_MIDTERM_RESULT).get()
        self.assertEqual(row.link_url, f"/midterm/result/{attempt.pk}")
        self.assertEqual(row.category, note_const.CATEGORY_GRADES)

        cert = result["certificates"][0]
        cert_row = notes(student, note_const.EVENT_CERTIFICATE_READY).get()
        self.assertEqual(cert_row.link_url, f"/certificate/{cert.code}")
        # Two messages, not one: the breakdown and the printable sheet are different pages.
        self.assertNotEqual(row.pk, cert_row.pk)

    def test_only_students_whose_result_is_genuinely_visible_are_told(self):
        """THE TRAP: a certificate was issued to them, and their score is still gated.

        A student enrolled in two classrooms that both run this midterm is resolved by
        ``winning_grant`` to the LATER classroom, so it is that classroom's publish — not
        this one — that reveals their score. Publishing here writes them a certificate all
        the same (they are in this room's cohort), and both the result page and the
        certificate download still refuse them. Telling them their result is ready would
        hand them a link to "awaiting result".
        """
        other_room = make_classroom(self.teacher, name="ENG-Other")

        plain = User.objects.create(username="mpn_p", email="mpn_p@x.io")
        enrol(self.room, plain)
        grant(plain, self.mt, self.room, self.teacher)
        finish(self.mt, plain, 90)

        both = User.objects.create(username="mpn_b", email="mpn_b@x.io")
        enrol(self.room, both)
        enrol(other_room, both)
        grant(both, self.mt, self.room, self.teacher)
        grant(both, self.mt, other_room, self.teacher)  # later grant → the governing one
        finish(self.mt, both, 70)

        MidtermSchedule.objects.create(
            classroom=self.room, midterm=self.mt, created_by=self.teacher,
        )
        MidtermSchedule.objects.create(  # the other room has NOT published
            classroom=other_room, midterm=self.mt, created_by=self.teacher,
        )

        result = self._publish()
        self.assertEqual(result["issued"], 2, "both students are in this room's cohort")

        from midterms.access import midterm_results_state

        gated_attempt = MidtermAttempt.objects.get(midterm=self.mt, student=both)
        self.assertFalse(
            midterm_results_state(gated_attempt)["results_visible"],
            "fixture check: this student's score must still be gated",
        )

        self.assertTrue(notes(plain, note_const.EVENT_MIDTERM_RESULT).exists())
        self.assertFalse(notes(both, note_const.EVENT_MIDTERM_RESULT).exists())
        # ...and no certificate notification either: that download 403s while results are
        # gated (classes/views_certificates._cert_or_403).
        self.assertFalse(notes(both, note_const.EVENT_CERTIFICATE_READY).exists())

    def test_a_student_with_no_certificate_still_hears_their_result_is_out(self):
        """A force-published student who is owed a re-sit keeps their score and loses the paper.

        ``issue_classroom_certificates`` deliberately withholds a certificate from anyone
        holding an unspent ``MidtermResit`` — it would freeze the sitting they are about to
        replace — but the release flip reveals the score they already have. One notification,
        not two, and not zero.
        """
        certified = User.objects.create(username="mpn_c", email="mpn_c@x.io")
        resitting = User.objects.create(username="mpn_r", email="mpn_r@x.io")
        for student in (certified, resitting):
            enrol(self.room, student)
            grant(student, self.mt, self.room, self.teacher)
            finish(self.mt, student, 60)
        MidtermResit.objects.create(
            midterm=self.mt, student=resitting, granted_by=self.teacher,
            reason="repeated the month",
        )
        MidtermSchedule.objects.create(
            classroom=self.room, midterm=self.mt, created_by=self.teacher,
        )

        result = self._publish(force=True)
        self.assertEqual(result["issued"], 1, "the re-sitter must not be certified yet")

        self.assertTrue(notes(certified, note_const.EVENT_MIDTERM_RESULT).exists())
        self.assertTrue(notes(certified, note_const.EVENT_CERTIFICATE_READY).exists())

        self.assertTrue(notes(resitting, note_const.EVENT_MIDTERM_RESULT).exists())
        self.assertFalse(notes(resitting, note_const.EVENT_CERTIFICATE_READY).exists())

    def test_re_publishing_tells_nobody_a_second_time(self):
        student = User.objects.create(username="mpn_x", email="mpn_x@x.io")
        enrol(self.room, student)
        grant(student, self.mt, self.room, self.teacher)
        finish(self.mt, student, 75)
        MidtermSchedule.objects.create(
            classroom=self.room, midterm=self.mt, created_by=self.teacher,
        )

        self._publish()
        self._publish()  # "Re-calculate" is a button a teacher presses more than once

        self.assertEqual(notes(student, note_const.EVENT_MIDTERM_RESULT).count(), 1)
        self.assertEqual(notes(student, note_const.EVENT_CERTIFICATE_READY).count(), 1)

"""The notification *platform*: when a push is published, the fan-out's shape, the deadline
sweep, and the one endpoint that writes into somebody else's inbox.

``tests_notifications.py`` covers what a notification is. This file covers what happens around
it, and every property here was a live defect first:

* **A push was published before the row existed.** ``queue_push`` called ``.delay()`` while the
  caller's transaction was still open, so a Celery worker — a different process on a different
  connection — could read the id and find nothing. It then returned ``{"skipped": "gone"}`` for
  a notification that was about to be perfectly real, and the phone simply never buzzed.
* **A fan-out was a loop.** ``notify_many`` ran a ``get_or_create``, a dedupe ``SELECT``, an
  ``INSERT``, a realtime write and a Celery publish *per student*, inside a request thread.
* **``HOMEWORK_DUE_SOON`` had no producer.** Declared, categorised, listed in ``PUSH_EVENTS``,
  and raised by nothing anywhere.
* **``EVENT_SYSTEM`` could not be sent by anybody at all.**
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from notifications import constants
from notifications.models import Notification, NotificationPreference
from notifications.services import notify, notify_many
from notifications.tasks import notify_homework_due_soon

User = get_user_model()


def _u(email, **kwargs):
    return User.objects.create_user(email, "secret123", **kwargs)


class PushIsPublishedAfterCommitTests(TestCase):
    """The race that made push silently useless even on a configured deployment.

    ``.delay()`` hands the notification id to a broker immediately. Every hook that calls
    ``notify`` — grading, submitting, the shop — holds a ``transaction.atomic()`` the view has
    not finished, so at that instant the row is invisible to every other connection, and on a
    rollback it never exists. The worker that wins that race logs nothing that looks like a
    failure; it just skips.
    """

    def setUp(self):
        self.student = _u("pc_student@t.com")

    def test_no_push_is_published_while_the_callers_transaction_is_open(self):
        with patch("notifications.tasks.send_push_for_notification.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                notify(
                    self.student,
                    event=constants.EVENT_HOMEWORK_GRADED,
                    title="Your work has been marked",
                )
                self.assertEqual(
                    delay.call_count,
                    0,
                    "the push was published before COMMIT — the worker can lose the race",
                )

            self.assertEqual(delay.call_count, 1)

    def test_a_rolled_back_notification_never_publishes_a_push(self):
        """The other half of the same guarantee: no row, no buzz."""
        with patch("notifications.tasks.send_push_for_notification.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                try:
                    with transaction.atomic():
                        notify(
                            self.student,
                            event=constants.EVENT_HOMEWORK_GRADED,
                            title="Marked",
                        )
                        raise RuntimeError("the view failed after notifying")
                except RuntimeError:
                    pass

        self.assertEqual(delay.call_count, 0)
        self.assertEqual(Notification.objects.count(), 0)

    def test_a_collapsed_repeat_does_not_buzz_a_second_time(self):
        """Deliberate, and the entire point of ``dedupe_key``.

        The bell is a list a student scans, so refreshing a row there is cheap and the newest
        wording is worth having. A push is an interruption. Buzzing three times for one piece
        of news is what teaches a 15-year-old to switch push off — after which the one that
        mattered never arrives either.
        """
        with patch("notifications.tasks.send_push_for_notification.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                notify(
                    self.student, event=constants.EVENT_HOMEWORK_GRADED,
                    title="Marked", dedupe_key="g:1",
                )
                notify(
                    self.student, event=constants.EVENT_HOMEWORK_GRADED,
                    title="Marked again", dedupe_key="g:1",
                )

        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(delay.call_count, 1, "a collapsed repeat buzzed the phone again")

    def test_a_student_who_turned_push_off_still_gets_the_bell(self):
        NotificationPreference.objects.create(user=self.student, push_enabled=False)

        with patch("notifications.tasks.send_push_for_notification.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                notify(
                    self.student,
                    event=constants.EVENT_HOMEWORK_GRADED,
                    title="Marked",
                )

        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(delay.call_count, 0)


class FanOutShapeTests(TestCase):
    """``notify_many`` must not cost a query per recipient.

    The realtime hint is patched out throughout: it is best-effort by construction, it belongs
    to another app, and leaving it in would measure ``realtime``'s query shape rather than this
    one's.
    """

    def setUp(self):
        self.students = [_u(f"fan_{i}@t.com") for i in range(12)]

    def _queries_for(self, users, **kwargs):
        with patch("realtime.services.emit_to_users"):
            with CaptureQueriesContext(connection) as captured:
                notify_many(users, **kwargs)
        return len(captured)

    def test_the_query_count_does_not_grow_with_the_class_size(self):
        """The property, stated as a property. A 200-student announcement used to be ~600
        queries in a request thread; three students and twelve must now cost the same."""
        small = self._queries_for(
            self.students[:3], event=constants.EVENT_CLASS_ANNOUNCEMENT, title="Small",
        )
        Notification.objects.all().delete()
        large = self._queries_for(
            self.students, event=constants.EVENT_CLASS_ANNOUNCEMENT, title="Large",
        )

        self.assertEqual(
            small, large, f"the fan-out is still linear in recipients ({small} → {large})"
        )

    def test_it_writes_one_row_per_student(self):
        written = notify_many(
            self.students, event=constants.EVENT_CLASS_ANNOUNCEMENT, title="Notice",
        )

        self.assertEqual(written, 12)
        self.assertEqual(Notification.objects.count(), 12)

    def test_no_preference_row_is_manufactured_for_a_default(self):
        """Absence means "everything on". Writing two thousand rows saying so on a broadcast
        would be pure cost, and it would freeze today's default for people who never chose."""
        notify_many(self.students, event=constants.EVENT_CLASS_ANNOUNCEMENT, title="Notice")

        self.assertEqual(NotificationPreference.objects.count(), 0)

    def test_a_muted_student_is_left_out_of_the_group(self):
        NotificationPreference.objects.create(
            user=self.students[0], muted_categories=[constants.CATEGORY_CLASSROOM]
        )

        written = notify_many(
            self.students, event=constants.EVENT_CLASS_ANNOUNCEMENT, title="Notice",
        )

        self.assertEqual(written, 11)
        self.assertFalse(Notification.objects.filter(recipient=self.students[0]).exists())

    def test_the_same_student_twice_is_one_person(self):
        """A caller assembling recipients from several querysets has no cheap way to know
        that a student in two of the targeted classrooms is not two students."""
        written = notify_many(
            [self.students[0], self.students[1], self.students[0]],
            event=constants.EVENT_CLASS_ANNOUNCEMENT,
            title="Notice",
        )

        self.assertEqual(written, 2)
        self.assertEqual(Notification.objects.count(), 2)

    def test_a_repeated_fanout_refreshes_rather_than_duplicating(self):
        kwargs = {
            "event": constants.EVENT_CLASS_ANNOUNCEMENT,
            "title": "Notice",
            "dedupe_key": "announce:7",
        }
        notify_many(self.students[:4], **kwargs)
        notify_many(self.students[:4], **{**kwargs, "title": "Notice (updated)"})

        self.assertEqual(Notification.objects.count(), 4)
        self.assertEqual(
            set(Notification.objects.values_list("title", flat=True)), {"Notice (updated)"}
        )

    def test_a_callable_dedupe_key_gives_each_student_their_own(self):
        """What lets a per-student key ride the bulk path instead of forcing a loop."""
        notify_many(
            self.students[:3],
            event=constants.EVENT_HOMEWORK_DUE_SOON,
            title="Due soon",
            dedupe_key=lambda user: f"due:5:{user.pk}",
        )

        self.assertEqual(
            set(Notification.objects.values_list("dedupe_key", flat=True)),
            {f"due:5:{s.pk}" for s in self.students[:3]},
        )

    def test_the_whole_group_shares_one_push_task(self):
        """One Celery message for the announcement, not one per student."""
        with patch("notifications.tasks.send_push_for_notifications.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                notify_many(
                    self.students, event=constants.EVENT_HOMEWORK_ASSIGNED, title="New homework",
                )

        self.assertEqual(delay.call_count, 1)
        (queued_ids,), _ = delay.call_args
        self.assertEqual(len(queued_ids), 12)

    def test_a_student_who_turned_push_off_is_dropped_from_the_batch(self):
        NotificationPreference.objects.create(user=self.students[0], push_enabled=False)

        with patch("notifications.tasks.send_push_for_notifications.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                notify_many(
                    self.students, event=constants.EVENT_HOMEWORK_ASSIGNED, title="New homework",
                )

        (queued_ids,), _ = delay.call_args
        self.assertEqual(len(queued_ids), 11)
        self.assertTrue(Notification.objects.filter(recipient=self.students[0]).exists())

    def test_it_never_raises_into_its_caller(self):
        """Same contract as ``notify``. A fan-out sits inside somebody's request."""
        with patch(
            "notifications.models.Notification.objects.bulk_create",
            side_effect=RuntimeError("boom"),
        ):
            self.assertEqual(
                notify_many(self.students, event=constants.EVENT_SYSTEM, title="Notice"), 0
            )


class HomeworkDueSoonSweepTests(TestCase):
    """The producer ``HOMEWORK_DUE_SOON`` never had.

    A deadline becomes newsworthy because time passed, not because anybody acted, so it can
    only ever be a sweep — and a sweep that runs every half hour against a 24-hour horizon must
    tell each student once, not forty-eight times.
    """

    def setUp(self):
        self.teacher = _u("due_t@t.com")
        self.classroom = Classroom.objects.create(
            name="Math Middle A", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = _u("due_s@t.com")
        self.other = _u("due_s2@t.com")
        for user in (self.student, self.other):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=user,
                role=ClassroomMembership.ROLE_STUDENT,
            )
        self.assignment = self._assignment(hours=6)

    def _assignment(self, *, hours, status=Assignment.STATUS_PUBLISHED, title="Week 1"):
        return Assignment.objects.create(
            classroom=self.classroom, title=title, created_by=self.teacher,
            status=status, due_at=timezone.now() + timedelta(hours=hours),
        )

    def test_it_tells_a_student_whose_homework_is_nearly_due(self):
        stats = notify_homework_due_soon()

        self.assertEqual(stats["notified"], 2)
        note = Notification.objects.get(recipient=self.student)
        self.assertEqual(note.event, constants.EVENT_HOMEWORK_DUE_SOON)
        self.assertEqual(note.category, constants.CATEGORY_HOMEWORK)
        self.assertEqual(note.link_url, f"/classes/{self.classroom.pk}")

    def test_the_wording_is_a_nudge_and_not_a_reprimand(self):
        """House rule: this school's student UI never uses punishing labels. The event code is
        machine-readable; the sentence a 15-year-old reads is not the same thing."""
        notify_homework_due_soon()

        note = Notification.objects.get(recipient=self.student)
        text = f"{note.title} {note.body}".lower()
        self.assertIn("still time", text)
        for punishing in ("overdue", "late", "missing", "failed", "warning"):
            self.assertNotIn(punishing, text)

    def test_running_it_again_tells_nobody_twice(self):
        """The load-bearing one. ``notify``'s dedupe window is sixty minutes, which is the
        wrong guard for a half-hourly sweep against a day-long horizon: every student would
        collect a fresh reminder each time the window re-armed. The sweep carries its own
        all-time guard instead."""
        notify_homework_due_soon()
        Notification.objects.update(created_at=timezone.now() - timedelta(hours=9))

        again = notify_homework_due_soon()

        self.assertEqual(again["notified"], 0)
        self.assertEqual(Notification.objects.count(), 2)

    def test_a_student_who_has_handed_it_in_is_left_alone(self):
        """Reminding somebody about work they have already submitted is the fastest way to
        teach them the bell is noise."""
        Submission.objects.create(
            assignment=self.assignment, student=self.student,
            status=Submission.STATUS_SUBMITTED, submitted_at=timezone.now(),
        )

        notify_homework_due_soon()

        self.assertFalse(Notification.objects.filter(recipient=self.student).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.other).exists())

    def test_a_draft_submission_is_exactly_who_this_is_for(self):
        Submission.objects.create(
            assignment=self.assignment, student=self.student, status=Submission.STATUS_DRAFT
        )

        notify_homework_due_soon()

        self.assertTrue(Notification.objects.filter(recipient=self.student).exists())

    def test_a_returned_submission_still_gets_the_reminder(self):
        """Returned work is work the student still has to redo before the deadline."""
        Submission.objects.create(
            assignment=self.assignment, student=self.student,
            status=Submission.STATUS_RETURNED, returned_at=timezone.now(),
        )

        notify_homework_due_soon()

        self.assertTrue(Notification.objects.filter(recipient=self.student).exists())

    def test_a_draft_assignment_reminds_nobody(self):
        """A DRAFT is invisible to students — a reminder would point at work they cannot see."""
        Assignment.objects.filter(pk=self.assignment.pk).update(
            status=Assignment.STATUS_DRAFT
        )

        self.assertEqual(notify_homework_due_soon()["notified"], 0)

    def test_homework_due_next_week_is_not_yet_news(self):
        Assignment.objects.filter(pk=self.assignment.pk).update(
            due_at=timezone.now() + timedelta(days=7)
        )

        self.assertEqual(notify_homework_due_soon()["notified"], 0)

    def test_a_deadline_that_has_already_passed_is_not_a_reminder(self):
        Assignment.objects.filter(pk=self.assignment.pk).update(
            due_at=timezone.now() - timedelta(hours=1)
        )

        self.assertEqual(notify_homework_due_soon()["notified"], 0)

    def test_a_removed_student_is_no_longer_in_the_class(self):
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_REMOVED)

        notify_homework_due_soon()

        self.assertFalse(Notification.objects.filter(recipient=self.student).exists())

    def test_the_teacher_is_not_reminded_about_their_own_homework(self):
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher,
            role=ClassroomMembership.ROLE_TEACHER,
        )

        notify_homework_due_soon()

        self.assertFalse(Notification.objects.filter(recipient=self.teacher).exists())

    def test_two_assignments_are_two_separate_reminders(self):
        """The dedupe prefix carries a trailing colon so assignment 1 cannot swallow 11."""
        self._assignment(hours=5, title="Week 2")

        notify_homework_due_soon()

        self.assertEqual(Notification.objects.filter(recipient=self.student).count(), 2)


class BroadcastTests(TestCase):
    """``EVENT_SYSTEM`` had no way in at all: no hook raises it, and the admin's add button is
    disabled on purpose because a row typed there would skip the realtime hint and the push."""

    def setUp(self):
        self.client = APIClient()
        self.super_admin = _u("bc_super@t.com", role=acc_const.ROLE_SUPER_ADMIN)
        self.admin = _u("bc_admin@t.com", role=acc_const.ROLE_ADMIN)
        self.teacher = _u(
            "bc_teacher@t.com", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH
        )
        self.student = _u("bc_student@t.com", role=acc_const.ROLE_STUDENT)

    def _post(self, payload, *, as_user=None):
        self.client.force_authenticate(as_user or self.super_admin)
        return self.client.post("/api/notifications/broadcast/", payload, format="json")

    def test_a_student_cannot_broadcast(self):
        response = self._post({"title": "School is shut"}, as_user=self.student)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Notification.objects.count(), 0)

    def test_a_teacher_cannot_broadcast(self):
        self.assertEqual(
            self._post({"title": "School is shut"}, as_user=self.teacher).status_code, 403
        )

    def test_an_admin_cannot_broadcast(self):
        """Narrower than "global staff" on purpose. Writing into every inbox in the school has
        no undo — a broadcast cannot be recalled once phones have buzzed."""
        self.assertEqual(
            self._post({"title": "School is shut"}, as_user=self.admin).status_code, 403
        )

    def test_it_requires_a_login(self):
        response = self.client.post(
            "/api/notifications/broadcast/", {"title": "Hello"}, format="json"
        )

        self.assertEqual(response.status_code, 401)

    def test_a_super_admin_reaches_the_whole_school(self):
        response = self._post({"title": "Centre closed Thursday", "body": "Back Friday."})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["notified"], 4)
        note = Notification.objects.filter(recipient=self.student).get()
        self.assertEqual(note.event, constants.EVENT_SYSTEM)
        self.assertEqual(note.category, constants.CATEGORY_SYSTEM)
        self.assertEqual(note.title, "Centre closed Thursday")

    def test_an_audience_of_students_leaves_the_staff_out(self):
        self._post({"title": "Mock exam Saturday", "audience": "students"})

        self.assertEqual(Notification.objects.count(), 1)
        self.assertTrue(Notification.objects.filter(recipient=self.student).exists())

    def test_an_audience_of_teachers_includes_support_teachers(self):
        support = _u(
            "bc_support@t.com", role=acc_const.ROLE_SUPPORT_TEACHER,
            subject=acc_const.DOMAIN_ENGLISH,
        )

        self._post({"title": "Staff meeting", "audience": "teachers"})

        self.assertTrue(Notification.objects.filter(recipient=support).exists())
        self.assertFalse(Notification.objects.filter(recipient=self.student).exists())

    def test_a_double_submit_is_one_notification(self):
        """An impatient second click, or a console retrying a request whose response was
        lost. Identical text inside the dedupe window collapses."""
        payload = {"title": "Centre closed Thursday", "body": "Back Friday."}
        self._post(payload)
        self._post(payload)

        self.assertEqual(Notification.objects.filter(recipient=self.student).count(), 1)

    def test_a_muted_student_is_counted_honestly(self):
        """`recipients` is who was targeted, `notified` who it reached. An operator staring at
        the smaller number should not have to guess whether the send half-failed."""
        NotificationPreference.objects.create(
            user=self.student, muted_categories=[constants.CATEGORY_SYSTEM]
        )

        body = self._post({"title": "Notice"}).json()

        self.assertEqual(body["recipients"], 4)
        self.assertEqual(body["notified"], 3)

    def test_a_frozen_account_is_not_sent_a_row_it_can_never_open(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)

        self.assertEqual(self._post({"title": "Notice"}).json()["recipients"], 3)

    def test_an_empty_title_is_refused(self):
        self.assertEqual(self._post({"title": "   "}).status_code, 400)
        self.assertEqual(Notification.objects.count(), 0)

    def test_an_absolute_link_is_refused(self):
        """The platform is served from several subdomains; an absolute URL in a broadcast
        would send half its recipients to the wrong console."""
        response = self._post({"title": "Notice", "link_url": "https://elsewhere.test/x"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("link_url", response.json())

    def test_a_protocol_relative_link_is_refused(self):
        """`//host/path` starts with a slash and is absolute in every browser."""
        self.assertEqual(
            self._post({"title": "Notice", "link_url": "//evil.test/x"}).status_code, 400
        )

    def test_a_broadcast_stays_off_the_phones_unless_it_is_asked_for(self):
        """``EVENT_SYSTEM`` is not in ``PUSH_EVENTS`` and the pushing set is kept short on
        purpose. Opting in is an act; the default is quiet."""
        with patch("notifications.tasks.send_push_for_notifications.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                self._post({"title": "Notice"})

        self.assertEqual(delay.call_count, 0)

    def test_an_urgent_broadcast_can_buzz_phones_when_asked(self):
        """"The centre is closed tomorrow" is exactly the announcement that should reach a
        phone, and the choice belongs to whoever is writing it."""
        with patch("notifications.tasks.send_push_for_notifications.delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                self._post({"title": "Centre closed tomorrow", "push": True})

        self.assertEqual(delay.call_count, 1)

    def test_an_unknown_audience_is_refused(self):
        self.assertEqual(
            self._post({"title": "Notice", "audience": "everyone-ish"}).status_code, 400
        )


class PreferencesScreenTests(TestCase):
    """The preferences endpoint had no client at all — a muted category was a thing the server
    honoured and nothing on the site could set."""

    def setUp(self):
        self.client = APIClient()
        self.student = _u("pref_s@t.com")
        self.client.force_authenticate(self.student)

    def test_the_screen_is_told_which_sections_exist(self):
        """Served rather than hardcoded, like the inbox's. A section missing from a private
        client-side copy is a switch the student can never reach."""
        body = self.client.get("/api/notifications/preferences/").json()

        values = [c["value"] for c in body["categories"]]
        self.assertEqual(values, list(constants.ALL_CATEGORIES))
        self.assertTrue(all(c["label"] for c in body["categories"]))

    def test_patching_answers_in_the_same_shape_as_reading(self):
        """So a client can write the response straight into its cache instead of refetching
        to learn what it was just told."""
        body = self.client.patch(
            "/api/notifications/preferences/",
            {"muted_categories": [constants.CATEGORY_REWARDS]},
            format="json",
        ).json()

        self.assertEqual(body["muted_categories"], [constants.CATEGORY_REWARDS])
        self.assertIn("categories", body)
        self.assertIn("push_enabled", body)


def _has_cryptography() -> bool:
    try:
        import cryptography  # noqa: F401
    except ImportError:
        return False
    return True


class VapidKeyCommandTests(TestCase):
    """``generate_vapid_keys`` prints a secret and stores nothing.

    That is the whole design. Push has been dead in production because the three VAPID settings
    default to empty, and the tempting fix — generate a pair and commit it — would be far worse
    than the outage: a private key in git is usable by anyone with repository access for the
    life of the history, and rotating it invalidates every subscription every student has
    granted.
    """

    def test_it_refuses_a_subject_that_is_not_a_contact(self):
        """A push service may reject a subscription signed with anything else, and the
        failure surfaces as "push just doesn't work" days later."""
        with self.assertRaises(CommandError):
            call_command("generate_vapid_keys", subject="admin@example.com")

    def test_it_prints_a_keypair_and_writes_it_nowhere(self):
        if not _has_cryptography():
            self.skipTest("cryptography is not installed in this environment")

        from io import StringIO

        out, err = StringIO(), StringIO()
        call_command("generate_vapid_keys", stdout=out, stderr=err)
        printed = out.getvalue()

        self.assertIn("VAPID_PUBLIC_KEY=", printed)
        self.assertIn("VAPID_PRIVATE_KEY=", printed)
        self.assertIn("VAPID_SUBJECT=", printed)
        # Base64url, unpadded — the encoding `PushManager.subscribe()` and `py_vapid` both
        # require. A padded or PEM-shaped key is rejected by the browser.
        public = [ln for ln in printed.splitlines() if ln.startswith("VAPID_PUBLIC_KEY=")][0]
        self.assertNotIn("=", public.split("=", 1)[1])
        self.assertIn("NEVER COMMIT THE PRIVATE KEY", err.getvalue())

    def test_two_runs_never_print_the_same_key(self):
        if not _has_cryptography():
            self.skipTest("cryptography is not installed in this environment")

        from notifications.management.commands.generate_vapid_keys import generate_keypair

        self.assertNotEqual(generate_keypair(), generate_keypair())

    def test_it_says_what_to_install_when_it_cannot_generate(self):
        if _has_cryptography():
            self.skipTest("cryptography is installed; the guard cannot be reached")

        with self.assertRaises(CommandError) as caught:
            call_command("generate_vapid_keys")

        self.assertIn("cryptography", str(caught.exception))

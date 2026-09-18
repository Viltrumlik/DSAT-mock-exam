"""The day-before reminder sweep.

Every case here is about WHICH events the sweep picks up, because the sending itself is the
same code the other three messages use. The claim is a conditional UPDATE on
`reminder_sent_at`, so two overlapping beats cannot both remind.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from access import constants as C
from events import services
from events.models import Event
from notifications import constants as note_const
from notifications.models import Notification

User = get_user_model()

SENDING_ON = dict(
    EMAIL_SENDING_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CELERY_TASK_ALWAYS_EAGER=True,
)


@override_settings(**SENDING_ON)
class ReminderFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_ops6@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user("ev_anna6@t.com", "secret123", role=C.ROLE_STUDENT)
        self.now = timezone.now()

    def _event(self, *, starts_in, published_ago=timedelta(days=5), seats=10, ends_at=None):
        event = Event.objects.create(
            title="Study skills workshop",
            starts_at=self.now + starts_in,
            # `ends_at` is overridable: `ends_at > starts_at` (services.update_event, and the
            # DB check constraint) must survive a later move of `starts_at` — see the same
            # note in tests_lifecycle.py.
            ends_at=ends_at or (self.now + starts_in + timedelta(hours=2)),
            seats=seats,
            status=Event.STATUS_PUBLISHED,
            published_at=self.now - published_ago,
            created_by=self.staff,
        )
        return event

    def _reminded(self):
        return set(
            Notification.objects.filter(
                event=note_const.EVENT_EVENT_REMINDER
            ).values_list("recipient_id", flat=True)
        )


class SweepTests(ReminderFixture):
    def test_nothing_goes_out_before_the_twenty_four_hour_mark(self):
        event = self._event(starts_in=timedelta(hours=25))
        services.sign_up(event, self.anna, now=self.now)

        stats = services.send_due_reminders(now=self.now)

        self.assertEqual(stats["events"], 0)
        self.assertEqual(mail.outbox, [])

    def test_inside_the_window_the_seat_holders_are_reminded_once(self):
        event = self._event(starts_in=timedelta(hours=23))
        services.sign_up(event, self.anna, now=self.now)

        first = services.send_due_reminders(now=self.now)
        second = services.send_due_reminders(now=self.now + timedelta(minutes=10))

        event.refresh_from_db()
        self.assertEqual((first["events"], first["students"], second["events"]), (1, 1, 0))
        self.assertEqual(self._reminded(), {self.anna.id})
        self.assertEqual(len(mail.outbox), 1)
        self.assertIsNotNone(event.reminder_sent_at)

    def test_a_student_who_signs_up_after_the_sweep_is_not_reminded(self):
        event = self._event(starts_in=timedelta(hours=23))
        services.send_due_reminders(now=self.now)
        mail.outbox.clear()

        services.sign_up(event, self.anna, now=self.now)
        services.send_due_reminders(now=self.now + timedelta(minutes=10))

        # They have just signed up; the page told them everything the reminder would.
        self.assertEqual(mail.outbox, [])

    def test_an_event_published_less_than_a_day_ahead_gets_no_reminder(self):
        event = self._event(starts_in=timedelta(hours=20), published_ago=timedelta(minutes=5))
        services.sign_up(event, self.anna, now=self.now)

        stats = services.send_due_reminders(now=self.now)

        self.assertEqual(stats["events"], 0)

    def test_a_draft_and_a_cancelled_event_are_skipped(self):
        draft = self._event(starts_in=timedelta(hours=23))
        Event.objects.filter(pk=draft.pk).update(status=Event.STATUS_DRAFT)
        cancelled = self._event(starts_in=timedelta(hours=23))
        services.sign_up(cancelled, self.anna, now=self.now)
        Event.objects.filter(pk=cancelled.pk).update(status=Event.STATUS_CANCELLED)

        self.assertEqual(services.send_due_reminders(now=self.now)["events"], 0)

    def test_an_event_that_has_already_started_is_not_reminded_about(self):
        event = self._event(starts_in=timedelta(hours=-1))
        services.sign_up(event, self.anna, now=self.now - timedelta(days=2))

        self.assertEqual(services.send_due_reminders(now=self.now)["events"], 0)

    def test_a_start_moved_further_away_is_reminded_about_again(self):
        event = self._event(starts_in=timedelta(hours=23), ends_at=self.now + timedelta(days=10))
        services.sign_up(event, self.anna, now=self.now)
        services.send_due_reminders(now=self.now)
        mail.outbox.clear()

        services.update_and_announce(
            event, {"starts_at": self.now + timedelta(days=4)}, now=self.now
        )
        mail.outbox.clear()
        later = self.now + timedelta(days=3, hours=1)

        self.assertEqual(services.send_due_reminders(now=later)["events"], 1)
        self.assertEqual(len(mail.outbox), 1)

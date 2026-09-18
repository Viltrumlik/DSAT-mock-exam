"""The event emails: who gets one, who does not, and what it says.

Email is the leg that matters here. On prod 370 of 392 active students have an address and
41 have push set up, so an announcement that went out by bell alone would wait for each
student to open the site.
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
from notifications.models import Notification, NotificationPreference
from rewards import constants as RC
from rewards.models import RewardRule

User = get_user_model()

SENDING_ON = dict(
    EMAIL_SENDING_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CELERY_TASK_ALWAYS_EAGER=True,  # run the fan-out inline so mail.outbox fills in the test
)


@override_settings(**SENDING_ON)
class EventEmailFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_ops5@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user("ev_anna5@t.com", "secret123", role=C.ROLE_STUDENT)
        self.boris = User.objects.create_user("ev_boris5@t.com", "secret123", role=C.ROLE_STUDENT)
        # Telegram signups have no address at all — a large share of this learning center.
        self.mailless = User.objects.create_user("ev_nomail5@t.com", "secret123", role=C.ROLE_STUDENT)
        User.objects.filter(pk=self.mailless.pk).update(email=None)
        self.now = timezone.now()
        RewardRule.objects.get_or_create(
            event=RC.EVENT_ATTENDED, defaults={"points": 10, "grants_xp": True}
        )
        self.event = Event.objects.create(
            title="Robotics open day",
            description="Bring a laptop.",
            starts_at=self.now + timedelta(days=3),
            # A wide gap, not the usual +2h: `SeatHolderEmailTests` moves `starts_at` out by a
            # day, and `ends_at > starts_at` (services.update_event, and the DB check
            # constraint) must survive that move — see the same note in tests_lifecycle.py.
            ends_at=self.now + timedelta(days=10),
            location="Fergana city branch, room 3",
            seats=30,
            created_by=self.staff,
        )

    def _recipients(self):
        return {address for message in mail.outbox for address in message.to}


class AnnouncementTests(EventEmailFixture):
    def test_publishing_mails_every_student_with_an_address(self):
        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(self._recipients(), {"ev_anna5@t.com", "ev_boris5@t.com"})

    def test_one_message_per_address_never_a_shared_to(self):
        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual([len(m.to) for m in mail.outbox], [1, 1])

    def test_a_student_with_no_address_still_gets_the_bell(self):
        services.publish_and_announce(self.event, now=self.now)

        self.assertNotIn(None, self._recipients())
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.mailless, event=note_const.EVENT_EVENT_PUBLISHED
            ).exists()
        )

    def test_a_student_who_muted_events_gets_no_announcement(self):
        NotificationPreference.objects.create(
            user=self.boris, muted_categories=[note_const.CATEGORY_EVENTS]
        )

        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(self._recipients(), {"ev_anna5@t.com"})

    def test_a_second_publish_mails_nobody(self):
        services.publish_and_announce(self.event, now=self.now)
        mail.outbox.clear()

        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(mail.outbox, [])

    def test_the_announcement_carries_the_time_the_place_and_what_it_pays(self):
        RewardRule.objects.filter(event=RC.EVENT_ATTENDED).update(points=7)

        services.publish_and_announce(self.event, now=self.now)

        html = mail.outbox[0].alternatives[0][0]
        self.assertIn("Robotics open day", html)
        self.assertIn("Fergana city branch, room 3", html)
        # Read from the rule at send time, never written into the copy.
        self.assertIn("7", html)
        self.assertIn("/events", html)

    def test_nothing_is_mailed_when_sending_is_off(self):
        with override_settings(EMAIL_SENDING_ENABLED=False):
            services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(mail.outbox, [])
        # The bell is not gated on the mailbox.
        self.assertEqual(
            Notification.objects.filter(event=note_const.EVENT_EVENT_PUBLISHED).count(), 3
        )


class SeatHolderEmailTests(EventEmailFixture):
    def setUp(self):
        super().setUp()
        services.publish_and_announce(self.event, now=self.now)
        self.event.refresh_from_db()
        services.sign_up(self.event, self.anna, now=self.now)
        mail.outbox.clear()

    def test_moving_it_mails_only_the_students_holding_a_seat(self):
        services.update_and_announce(
            self.event, {"starts_at": self.now + timedelta(days=4)}, now=self.now
        )

        self.assertEqual(self._recipients(), {"ev_anna5@t.com"})

    def test_a_muted_student_is_still_told_about_their_own_seat(self):
        NotificationPreference.objects.create(
            user=self.anna, muted_categories=[note_const.CATEGORY_EVENTS]
        )

        services.cancel_and_announce(self.event, actor=self.staff, now=self.now)

        self.assertEqual(self._recipients(), {"ev_anna5@t.com"})

    def test_the_cancellation_says_the_seat_is_closed(self):
        services.cancel_and_announce(self.event, actor=self.staff, now=self.now)

        self.assertIn("cancelled", mail.outbox[0].subject.lower())

    def test_an_announcement_for_an_event_cancelled_since_sends_nothing(self):
        from events import mail as event_mail

        services.cancel_event(self.event, actor=self.staff, now=self.now)
        mail.outbox.clear()

        event_mail.send_event_announcement_emails(self.event.pk)

        self.assertEqual(mail.outbox, [])

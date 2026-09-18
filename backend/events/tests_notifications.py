"""Who hears about an event in the bell, and who does not."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from events import services
from events.models import Event
from notifications import constants as note_const
from notifications.models import Notification, NotificationPreference

User = get_user_model()


class BellFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_ops4@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user("ev_anna4@t.com", "secret123", role=C.ROLE_STUDENT)
        self.boris = User.objects.create_user("ev_boris4@t.com", "secret123", role=C.ROLE_STUDENT)
        self.frozen = User.objects.create_user(
            "ev_frozen4@t.com", "secret123", role=C.ROLE_STUDENT, is_frozen=True
        )
        self.teacher = User.objects.create_user(
            "ev_teach4@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.now = timezone.now()
        self.event = Event.objects.create(
            title="Robotics open day",
            starts_at=self.now + timedelta(days=3),
            # A wide gap, not the usual +2h: `ChangeAndCancelBellTests` moves `starts_at` out
            # by a day, and `ends_at > starts_at` (services.update_event, and the DB check
            # constraint) must survive that move — see the same note in tests_lifecycle.py.
            ends_at=self.now + timedelta(days=10),
            location="Fergana city branch, room 3",
            seats=30,
            created_by=self.staff,
        )

    def _told(self, event_code):
        return set(
            Notification.objects.filter(event=event_code).values_list("recipient_id", flat=True)
        )


class PublishBellTests(BellFixture):
    def test_publishing_tells_every_active_student_and_nobody_else(self):
        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(
            self._told(note_const.EVENT_EVENT_PUBLISHED), {self.anna.id, self.boris.id}
        )

    def test_a_second_publish_tells_nobody_again(self):
        services.publish_and_announce(self.event, now=self.now)
        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(
            Notification.objects.filter(event=note_const.EVENT_EVENT_PUBLISHED).count(), 2
        )

    def test_a_student_who_muted_events_is_not_told(self):
        NotificationPreference.objects.create(
            user=self.boris, muted_categories=[note_const.CATEGORY_EVENTS]
        )

        services.publish_and_announce(self.event, now=self.now)

        self.assertEqual(self._told(note_const.EVENT_EVENT_PUBLISHED), {self.anna.id})

    def test_the_bell_links_to_the_events_page(self):
        services.publish_and_announce(self.event, now=self.now)

        row = Notification.objects.filter(event=note_const.EVENT_EVENT_PUBLISHED).first()
        self.assertEqual((row.link_url, row.category), ("/events", note_const.CATEGORY_EVENTS))


class ChangeAndCancelBellTests(BellFixture):
    def setUp(self):
        super().setUp()
        services.publish_and_announce(self.event, now=self.now)
        self.event.refresh_from_db()
        services.sign_up(self.event, self.anna, now=self.now)

    def test_moving_it_tells_only_the_students_holding_a_seat(self):
        services.update_and_announce(
            self.event, {"starts_at": self.now + timedelta(days=4)}, now=self.now
        )

        self.assertEqual(self._told(note_const.EVENT_EVENT_CHANGED), {self.anna.id})

    def test_editing_the_description_tells_nobody(self):
        services.update_and_announce(self.event, {"description": "Bring a pen."}, now=self.now)

        self.assertEqual(self._told(note_const.EVENT_EVENT_CHANGED), set())

    def test_calling_it_off_tells_the_students_who_had_a_seat(self):
        # Read before the seats are closed, or the message would reach nobody at all.
        services.cancel_and_announce(self.event, actor=self.staff, now=self.now)

        self.assertEqual(self._told(note_const.EVENT_EVENT_CANCELLED), {self.anna.id})


class PushRoutingTests(TestCase):
    def test_all_four_event_codes_reach_a_phone_and_sit_under_Events(self):
        for code in (
            note_const.EVENT_EVENT_PUBLISHED,
            note_const.EVENT_EVENT_REMINDER,
            note_const.EVENT_EVENT_CHANGED,
            note_const.EVENT_EVENT_CANCELLED,
        ):
            with self.subTest(code):
                self.assertIn(code, note_const.PUSH_EVENTS)
                self.assertEqual(note_const.category_for(code), note_const.CATEGORY_EVENTS)

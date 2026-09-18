"""Publishing an event, moving it, and calling it off.

The claim is the interesting part: publish is a conditional UPDATE, so pressing the button
twice — or two admins pressing it at once — announces once. Everything downstream (the bell,
the push, roughly 370 emails) hangs off the return value of that UPDATE.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from events import services
from events.models import Event, EventRegistration

User = get_user_model()


class LifecycleFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_ops@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user("ev_anna2@t.com", "secret123", role=C.ROLE_STUDENT)
        self.now = timezone.now()

    def _event(self, **kw):
        kw.setdefault("title", "Study skills workshop")
        kw.setdefault("starts_at", self.now + timedelta(days=3))
        kw.setdefault("ends_at", self.now + timedelta(days=3, hours=2))
        kw.setdefault("seats", 10)
        kw.setdefault("created_by", self.staff)
        return Event.objects.create(**kw)

    def _published(self, **kw):
        event = self._event(**kw)
        services.publish(event, now=self.now)
        event.refresh_from_db()
        return event

    def _refusal(self, fn, *args, **kwargs) -> str:
        with self.assertRaises(services.EventRefused) as caught:
            fn(*args, **kwargs)
        return caught.exception.code


class PublishTests(LifecycleFixture):
    def test_publishing_stamps_the_time_and_claims_the_announcement(self):
        event = self._event()

        claimed = services.publish(event, now=self.now)

        event.refresh_from_db()
        self.assertTrue(claimed)
        self.assertEqual((event.status, event.published_at), (Event.STATUS_PUBLISHED, self.now))

    def test_publishing_twice_claims_once(self):
        event = self._event()
        services.publish(event, now=self.now)

        # The second press changes no row, so nothing downstream runs a second time.
        self.assertFalse(services.publish(event, now=self.now))

    def test_an_event_whose_start_has_passed_cannot_be_published(self):
        late = self._event(
            starts_at=self.now - timedelta(hours=1), ends_at=self.now + timedelta(hours=1)
        )

        self.assertEqual(self._refusal(services.publish, late, now=self.now), "started")


class UpdateTests(LifecycleFixture):
    def test_moving_the_time_reports_that_it_moved(self):
        # A wide default gap: the spec holds `ends_at > starts_at` with no exception for a
        # starts_at-only move, so a fixture event whose end sits just after the ORIGINAL
        # start cannot have its start pushed a day out — the gap must survive the move.
        event = self._published(ends_at=self.now + timedelta(days=10))

        event, moved = services.update_event(
            event, {"starts_at": self.now + timedelta(days=4)}, now=self.now
        )

        self.assertTrue(moved)
        self.assertEqual(event.starts_at, self.now + timedelta(days=4))

    def test_editing_the_description_is_not_a_move(self):
        event = self._published()

        _, moved = services.update_event(event, {"description": "Bring a notebook."}, now=self.now)

        self.assertFalse(moved)

    def test_seats_cannot_drop_below_the_students_already_holding_one(self):
        event = self._published(seats=2)
        services.sign_up(event, self.anna, now=self.now)

        self.assertEqual(
            self._refusal(services.update_event, event, {"seats": 0}, now=self.now),
            "seats_below_registered",
        )

    def test_an_event_cannot_be_made_to_end_before_it_starts(self):
        event = self._published()

        self.assertEqual(
            self._refusal(
                services.update_event, event, {"ends_at": self.now + timedelta(days=2)}, now=self.now
            ),
            "ends_before_start",
        )

    def test_a_cancelled_event_is_not_edited(self):
        event = self._published()
        services.cancel_event(event, actor=self.staff, now=self.now)

        self.assertEqual(
            self._refusal(services.update_event, event, {"seats": 40}, now=self.now), "cancelled"
        )

    def test_a_start_moved_further_away_re_arms_the_reminder(self):
        # Same wide gap as above, and for the same reason: the move must not invert the
        # interval the spec requires (`ends_at > starts_at`, unconditionally).
        event = self._published(ends_at=self.now + timedelta(days=10))
        Event.objects.filter(pk=event.pk).update(reminder_sent_at=self.now)
        event.refresh_from_db()

        event, _ = services.update_event(
            event, {"starts_at": self.now + timedelta(days=5)}, now=self.now
        )

        self.assertIsNone(event.reminder_sent_at)

    def test_a_start_moved_inside_a_day_counts_the_change_message_as_the_reminder(self):
        event = self._published()

        event, _ = services.update_event(
            event, {"starts_at": self.now + timedelta(hours=5)}, now=self.now
        )

        # Not None: the sweep must not follow the change message with a reminder minutes later.
        self.assertEqual(event.reminder_sent_at, self.now)


class CancelTests(LifecycleFixture):
    def test_cancelling_closes_every_seat(self):
        event = self._published()
        row = services.sign_up(event, self.anna, now=self.now)

        services.cancel_event(event, actor=self.staff, now=self.now)

        event.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(
            (event.status, event.cancelled_at, row.status, row.cancel_reason),
            (
                Event.STATUS_CANCELLED,
                self.now,
                EventRegistration.STATUS_CANCELLED,
                EventRegistration.REASON_EVENT_CANCELLED,
            ),
        )

    def test_a_started_event_cannot_be_cancelled(self):
        event = self._published()
        started = event.starts_at + timedelta(minutes=1)

        # Attendance may already have paid, and cancelling would leave awards behind it.
        self.assertEqual(
            self._refusal(services.cancel_event, event, actor=self.staff, now=started), "started"
        )

    def test_a_draft_is_deleted_rather_than_cancelled(self):
        draft = self._event()

        services.delete_draft(draft)

        self.assertFalse(Event.objects.filter(pk=draft.pk).exists())

    def test_a_published_event_is_never_deleted(self):
        event = self._published()

        self.assertEqual(self._refusal(services.delete_draft, event), "not_a_draft")

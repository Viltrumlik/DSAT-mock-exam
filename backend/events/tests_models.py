"""The two rows an event is made of, and the counts every surface reads off them."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from events.models import Event, EventRegistration

User = get_user_model()


class EventFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.student = User.objects.create_user("ev_student@t.com", "secret123", role=C.ROLE_STUDENT)
        self.now = timezone.now()

    def _event(self, **kw):
        kw.setdefault("title", "Robotics open day")
        kw.setdefault("starts_at", self.now + timedelta(days=2))
        kw.setdefault("ends_at", self.now + timedelta(days=2, hours=2))
        kw.setdefault("location", "Fergana city branch, room 3")
        kw.setdefault("seats", 30)
        kw.setdefault("created_by", self.staff)
        return Event.objects.create(**kw)


class EventModelTests(EventFixture):
    def test_a_new_event_is_a_draft_with_every_seat_free(self):
        event = self._event()

        self.assertEqual(
            (event.status, event.registered_count, event.seats_left, event.published_at),
            (Event.STATUS_DRAFT, 0, 30, None),
        )

    def test_a_cancelled_registration_gives_its_seat_back(self):
        event = self._event(seats=1)
        row = EventRegistration.objects.create(event=event, student=self.student)
        self.assertEqual(event.seats_left, 0)

        row.status = EventRegistration.STATUS_CANCELLED
        row.save(update_fields=["status"])

        self.assertEqual(event.seats_left, 1)

    def test_an_event_cannot_end_before_it_starts(self):
        # A database constraint, not a serializer check: the Django admin writes this table too.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._event(ends_at=self.now + timedelta(days=1))

    def test_an_event_cannot_be_created_with_no_seats(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._event(seats=0)

    def test_a_student_holds_one_registration_per_event(self):
        event = self._event()
        EventRegistration.objects.create(event=event, student=self.student)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EventRegistration.objects.create(event=event, student=self.student)

    def test_started_and_past_are_read_off_the_clock(self):
        running = self._event(
            starts_at=self.now - timedelta(hours=1), ends_at=self.now + timedelta(hours=1)
        )
        finished = self._event(
            starts_at=self.now - timedelta(days=1), ends_at=self.now - timedelta(hours=23)
        )

        self.assertEqual(
            (running.has_started, running.is_past, finished.has_started, finished.is_past),
            (True, False, True, True),
        )

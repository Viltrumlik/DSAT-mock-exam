"""Signing up for an event, and giving the seat back.

Every rule is checked against a clock passed in, never `timezone.now()` read twice: a test
that builds an event "two hours from now" and a service that reads the clock again is a test
that fails at some point in every working day.
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


class SignUpFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_staff@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = self._student("ev_anna@t.com")
        self.boris = self._student("ev_boris@t.com")
        self.now = timezone.now()
        self.event = self._event()

    def _student(self, email, **kw):
        return User.objects.create_user(email, "secret123", role=C.ROLE_STUDENT, **kw)

    def _event(self, **kw):
        kw.setdefault("title", "Robotics open day")
        kw.setdefault("starts_at", self.now + timedelta(days=2))
        kw.setdefault("ends_at", self.now + timedelta(days=2, hours=2))
        kw.setdefault("seats", 2)
        kw.setdefault("status", Event.STATUS_PUBLISHED)
        kw.setdefault("published_at", self.now - timedelta(days=1))
        kw.setdefault("created_by", self.staff)
        return Event.objects.create(**kw)

    def _refusal(self, fn, *args, **kwargs) -> str:
        with self.assertRaises(services.EventRefused) as caught:
            fn(*args, **kwargs)
        return caught.exception.code


class SignUpTests(SignUpFixture):
    def test_a_student_takes_a_seat(self):
        row = services.sign_up(self.event, self.anna, now=self.now)

        self.assertEqual(
            (row.status, row.event_id, row.student_id, self.event.seats_left),
            (EventRegistration.STATUS_REGISTERED, self.event.id, self.anna.id, 1),
        )

    def test_signing_up_twice_is_one_seat(self):
        first = services.sign_up(self.event, self.anna, now=self.now)
        again = services.sign_up(self.event, self.anna, now=self.now)

        self.assertEqual(first.pk, again.pk)
        self.assertEqual(EventRegistration.objects.count(), 1)

    def test_the_last_seat_goes_to_one_of_them(self):
        one_seat = self._event(seats=1)
        services.sign_up(one_seat, self.anna, now=self.now)

        self.assertEqual(
            self._refusal(services.sign_up, one_seat, self.boris, now=self.now), "full"
        )

    def test_a_draft_takes_no_sign_ups(self):
        draft = self._event(status=Event.STATUS_DRAFT, published_at=None)

        self.assertEqual(self._refusal(services.sign_up, draft, self.anna, now=self.now), "not_open")

    def test_a_cancelled_event_takes_no_sign_ups(self):
        cancelled = self._event(status=Event.STATUS_CANCELLED)

        self.assertEqual(
            self._refusal(services.sign_up, cancelled, self.anna, now=self.now), "not_open"
        )

    def test_sign_up_closes_when_the_event_starts(self):
        started = self.now + timedelta(days=2, seconds=1)

        self.assertEqual(
            self._refusal(services.sign_up, self.event, self.anna, now=started), "started"
        )

    def test_a_frozen_student_cannot_sign_up(self):
        frozen = self._student("ev_frozen@t.com", is_frozen=True)

        self.assertEqual(
            self._refusal(services.sign_up, self.event, frozen, now=self.now), "not_open"
        )

    def test_a_teacher_cannot_sign_up(self):
        teacher = User.objects.create_user(
            "ev_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )

        self.assertEqual(
            self._refusal(services.sign_up, self.event, teacher, now=self.now), "not_open"
        )


class CancelRegistrationTests(SignUpFixture):
    def test_cancelling_reopens_the_seat_and_keeps_the_row(self):
        row = services.sign_up(self.event, self.anna, now=self.now)

        services.cancel_registration(row, now=self.now)

        row.refresh_from_db()
        self.assertEqual(
            (row.status, row.cancel_reason, self.event.seats_left, EventRegistration.objects.count()),
            (EventRegistration.STATUS_CANCELLED, EventRegistration.REASON_STUDENT, 2, 1),
        )

    def test_signing_up_again_reuses_the_same_row(self):
        row = services.sign_up(self.event, self.anna, now=self.now)
        services.cancel_registration(row, now=self.now)

        again = services.sign_up(self.event, self.anna, now=self.now)

        self.assertEqual(again.pk, row.pk)
        self.assertEqual(
            (again.status, again.cancel_reason, again.cancelled_at),
            (EventRegistration.STATUS_REGISTERED, "", None),
        )

    def test_the_cancel_window_closes_two_hours_before_the_start(self):
        row = services.sign_up(self.event, self.anna, now=self.now)
        cutoff = self.event.starts_at - services.CANCEL_CUTOFF

        self.assertEqual(
            self._refusal(services.cancel_registration, row, now=cutoff), "cancel_window_closed"
        )

    def test_a_minute_before_the_cutoff_is_still_in_time(self):
        row = services.sign_up(self.event, self.anna, now=self.now)
        cutoff = self.event.starts_at - services.CANCEL_CUTOFF

        services.cancel_registration(row, now=cutoff - timedelta(minutes=1))

        row.refresh_from_db()
        self.assertEqual(row.status, EventRegistration.STATUS_CANCELLED)

    def test_cancelling_a_seat_you_do_not_hold(self):
        row = services.sign_up(self.event, self.anna, now=self.now)
        services.cancel_registration(row, now=self.now)

        self.assertEqual(
            self._refusal(services.cancel_registration, row, now=self.now), "not_registered"
        )

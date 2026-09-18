"""What a student can see and do over the API."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from events import services
from events.models import Event, EventRegistration

User = get_user_model()


class StudentApiFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_ops7@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user("ev_anna7@t.com", "secret123", role=C.ROLE_STUDENT)
        self.boris = User.objects.create_user("ev_boris7@t.com", "secret123", role=C.ROLE_STUDENT)
        self.now = timezone.now()
        self.client = APIClient()
        self.event = self._event()

    def _event(self, **kw):
        kw.setdefault("title", "Robotics open day")
        kw.setdefault("starts_at", self.now + timedelta(days=2))
        kw.setdefault("ends_at", self.now + timedelta(days=2, hours=2))
        kw.setdefault("seats", 1)
        kw.setdefault("status", Event.STATUS_PUBLISHED)
        kw.setdefault("published_at", self.now - timedelta(days=1))
        kw.setdefault("created_by", self.staff)
        return Event.objects.create(**kw)

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client


class EventListTests(StudentApiFixture):
    def test_a_student_sees_published_events_that_have_not_ended(self):
        self._event(status=Event.STATUS_DRAFT, published_at=None)
        self._event(
            starts_at=self.now - timedelta(days=2), ends_at=self.now - timedelta(days=1, hours=22)
        )

        rows = self._as(self.anna).get("/api/events/").json()["events"]

        self.assertEqual([row["id"] for row in rows], [self.event.id])

    def test_the_card_carries_the_seats_left_and_what_the_student_may_do(self):
        row = self._as(self.anna).get("/api/events/").json()["events"][0]

        self.assertEqual(
            (row["seats"], row["seats_left"], row["can_sign_up"], row["can_cancel"], row["my_registration"]),
            (1, 1, True, False, None),
        )

    def test_a_full_event_says_so(self):
        services.sign_up(self.event, self.boris, now=self.now)

        row = self._as(self.anna).get("/api/events/").json()["events"][0]

        self.assertEqual((row["seats_left"], row["can_sign_up"]), (0, False))

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get("/api/events/").status_code, 401)


class SignUpEndpointTests(StudentApiFixture):
    def test_signing_up_takes_the_seat(self):
        response = self._as(self.anna).post(f"/api/events/{self.event.id}/sign-up/")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], EventRegistration.STATUS_REGISTERED)

    def test_a_full_event_answers_409_with_a_code(self):
        services.sign_up(self.event, self.boris, now=self.now)

        response = self._as(self.anna).post(f"/api/events/{self.event.id}/sign-up/")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "full")
        self.assertTrue(response.json()["detail"])

    def test_a_draft_answers_400_not_open(self):
        draft = self._event(status=Event.STATUS_DRAFT, published_at=None)

        response = self._as(self.anna).post(f"/api/events/{draft.id}/sign-up/")

        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_open"))

    def test_cancelling_gives_the_seat_back(self):
        self._as(self.anna).post(f"/api/events/{self.event.id}/sign-up/")

        response = self._as(self.anna).post(f"/api/events/{self.event.id}/cancel/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.event.seats_left, 1)

    def test_cancelling_inside_the_window_answers_400_with_its_code(self):
        soon = self._event(
            starts_at=self.now + timedelta(hours=1), ends_at=self.now + timedelta(hours=3), seats=5
        )
        services.sign_up(soon, self.anna, now=self.now - timedelta(days=1))

        response = self._as(self.anna).post(f"/api/events/{soon.id}/cancel/")

        self.assertEqual(
            (response.status_code, response.json()["code"]), (400, "cancel_window_closed")
        )


class MyEventsTests(StudentApiFixture):
    def test_mine_lists_past_events_with_what_they_paid(self):
        past = self._event(
            starts_at=self.now - timedelta(days=2),
            ends_at=self.now - timedelta(days=1, hours=22),
            seats=5,
        )
        row = services.sign_up(past, self.anna, now=self.now - timedelta(days=5))
        services.mark_attendance(
            row,
            EventRegistration.ATTENDANCE_ATTENDED,
            actor=self.staff,
            now=self.now - timedelta(days=2),
        )

        rows = self._as(self.anna).get("/api/events/mine/").json()["events"]

        mine = [r for r in rows if r["id"] == past.id][0]
        self.assertEqual(mine["my_registration"]["attendance"], EventRegistration.ATTENDANCE_ATTENDED)
        self.assertGreater(mine["my_registration"]["points_awarded"], 0)

    def test_mine_shows_nobody_else_s_seats(self):
        services.sign_up(self.event, self.boris, now=self.now)

        rows = self._as(self.anna).get("/api/events/mine/").json()["events"]

        self.assertEqual(rows, [])


class CoverTests(StudentApiFixture):
    def test_a_draft_cover_is_404_even_for_a_signed_in_student(self):
        draft = self._event(status=Event.STATUS_DRAFT, published_at=None)

        self.assertEqual(self._as(self.anna).get(f"/api/events/{draft.id}/cover/").status_code, 404)

    def test_an_event_without_a_picture_is_404(self):
        # No session at all: an email client fetches images without one.
        self.assertEqual(APIClient().get(f"/api/events/{self.event.id}/cover/").status_code, 404)

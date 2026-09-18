"""The ops console's half of the API: who may touch it, and what it does."""

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


class OpsApiFixture(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("ev_admin8@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user(
            "ev_teach8@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.anna = User.objects.create_user("ev_anna8@t.com", "secret123", role=C.ROLE_STUDENT)
        self.now = timezone.now()
        self.client = APIClient()

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def _payload(self, **over):
        body = {
            "title": "Robotics open day",
            "description": "Bring a laptop.",
            "starts_at": (self.now + timedelta(days=3)).isoformat(),
            "ends_at": (self.now + timedelta(days=3, hours=2)).isoformat(),
            "location": "Fergana city branch, room 3",
            "seats": 30,
        }
        body.update(over)
        return body

    def _event(self, **kw):
        kw.setdefault("title", "Career talk")
        kw.setdefault("starts_at", self.now + timedelta(days=2))
        kw.setdefault("ends_at", self.now + timedelta(days=2, hours=2))
        kw.setdefault("seats", 10)
        kw.setdefault("created_by", self.admin)
        return Event.objects.create(**kw)


class OpsAccessTests(OpsApiFixture):
    def test_a_student_cannot_reach_the_console(self):
        self.assertEqual(self._as(self.anna).get("/api/events/admin/").status_code, 403)

    def test_a_teacher_cannot_either(self):
        # An event is learning-center-wide; publishing one is not a teacher's job.
        self.assertEqual(self._as(self.teacher).get("/api/events/admin/").status_code, 403)

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get("/api/events/admin/").status_code, 401)

    def test_an_admin_is_let_in(self):
        self.assertEqual(self._as(self.admin).get("/api/events/admin/").status_code, 200)


class OpsCrudTests(OpsApiFixture):
    def test_creating_leaves_it_a_draft_that_no_student_can_see(self):
        response = self._as(self.admin).post("/api/events/admin/", self._payload(), format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], Event.STATUS_DRAFT)
        self.assertEqual(self._as(self.anna).get("/api/events/").json()["events"], [])

    def test_publishing_puts_it_in_front_of_students(self):
        event = self._event()

        response = self._as(self.admin).post(f"/api/events/admin/{event.id}/publish/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row["id"] for row in self._as(self.anna).get("/api/events/").json()["events"]],
            [event.id],
        )

    def test_publishing_twice_is_not_an_error(self):
        event = self._event()
        self._as(self.admin).post(f"/api/events/admin/{event.id}/publish/")

        again = self._as(self.admin).post(f"/api/events/admin/{event.id}/publish/")

        self.assertEqual((again.status_code, again.json()["announced"]), (200, False))

    def test_seats_below_the_students_already_signed_up_are_refused(self):
        # Two seat-holders, not one: `EventWriteSerializer.validate_seats` already refuses
        # `seats=0` outright ("an event needs at least one seat"), before the request ever
        # reaches the service's own "seats_below_registered" rule — so `seats=1` is the value
        # that is still >= 1 yet still below what is already registered.
        boris = User.objects.create_user("ev_boris8@t.com", "secret123", role=C.ROLE_STUDENT)
        event = self._event(seats=2)
        services.publish(event, now=self.now)
        services.sign_up(event, self.anna, now=self.now)
        services.sign_up(event, boris, now=self.now)

        response = self._as(self.admin).patch(
            f"/api/events/admin/{event.id}/", {"seats": 1}, format="json"
        )

        self.assertEqual(
            (response.status_code, response.json()["code"]), (400, "seats_below_registered")
        )

    def test_a_draft_is_deleted_and_a_published_event_is_not(self):
        draft = self._event()
        published = self._event()
        services.publish(published, now=self.now)

        deleted = self._as(self.admin).delete(f"/api/events/admin/{draft.id}/")
        refused = self._as(self.admin).delete(f"/api/events/admin/{published.id}/")

        self.assertEqual(deleted.status_code, 204)
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "not_a_draft"))

    def test_cancelling_closes_the_seats(self):
        event = self._event()
        services.publish(event, now=self.now)
        services.sign_up(event, self.anna, now=self.now)

        response = self._as(self.admin).post(f"/api/events/admin/{event.id}/cancel/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(event.registrations.get(student=self.anna).status, EventRegistration.STATUS_CANCELLED)


class OpsAttendanceTests(OpsApiFixture):
    def setUp(self):
        super().setUp()
        self.event = self._event(starts_at=self.now + timedelta(hours=1), ends_at=self.now + timedelta(hours=3))
        services.publish(self.event, now=self.now - timedelta(days=1))
        self.event.refresh_from_db()
        self.row = services.sign_up(self.event, self.anna, now=self.now - timedelta(days=1))

    def test_the_list_carries_the_name_and_the_state_of_each_seat(self):
        rows = self._as(self.admin).get(
            f"/api/events/admin/{self.event.id}/registrations/"
        ).json()["registrations"]

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["student"], self.anna.id)
        self.assertIsNone(rows[0]["attendance"])

    def test_marking_attended_pays_and_shows_in_the_counters(self):
        response = self._as(self.admin).post(
            f"/api/events/admin/registrations/{self.row.id}/attendance/",
            {"attendance": EventRegistration.ATTENDANCE_ATTENDED},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        counts = self._as(self.admin).get(
            f"/api/events/admin/{self.event.id}/registrations/"
        ).json()["counts"]
        self.assertEqual(
            (counts["registered"], counts["attended"], counts["missed"], counts["not_marked"]),
            (1, 1, 0, 0),
        )

    def test_a_student_cannot_mark_anybody(self):
        response = self._as(self.anna).post(
            f"/api/events/admin/registrations/{self.row.id}/attendance/",
            {"attendance": EventRegistration.ATTENDANCE_ATTENDED},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

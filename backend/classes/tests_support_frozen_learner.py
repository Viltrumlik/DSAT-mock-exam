"""A frozen learner signs in, but cannot book, cancel, invite to or rate support hours.

``SupportBookingsView`` (and ``SupportBookingDetailView``, which inherits its list),
``SupportBookingInviteView`` and ``SupportBookingRateView`` name their own
``permission_classes``, which REPLACES the project default (``IsAuthenticatedAndNotFrozen``).
They once listed a bare ``IsAuthenticated``, and nothing in ``classes.support`` looks at
``is_frozen`` — so a debt-frozen student could still take a teacher's hour.

The freeze gate only stops learners. The detail view is shared with staff, and the teacher
must still be able to withdraw a frozen student's booking.
"""

from __future__ import annotations

from classes.models import ClassroomMembership
from classes.models_support import SupportBooking
from classes.tests_support_v2 import SupportV2Fixture
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

BOOKINGS = "/api/classes/support/bookings/"


class FrozenLearnerSupportTests(SupportV2Fixture):
    def setUp(self):
        super().setUp()
        self.classmate = type(self.student).objects.create_user("v2_mate@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.classmate, role=ClassroomMembership.ROLE_STUDENT
        )
        self.client.force_authenticate(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        type(self.student).objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.client.force_authenticate(self.student)

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        # The freeze gate refused — not the view's own "Not your booking." further down.
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_list_or_book(self):
        slot = self.make_slot()
        self._set_frozen(True)

        with self.subTest(route="GET bookings"):
            self.assertFrozenRefusal(self.client.get(BOOKINGS))
        with self.subTest(route="POST bookings"):
            self.assertFrozenRefusal(
                self.client.post(BOOKINGS, {"availability_id": slot.id}, format="json")
            )

        self.assertFalse(SupportBooking.objects.filter(student=self.student).exists())

    def test_a_frozen_student_cannot_cancel_a_booking_made_before_the_freeze(self):
        booking = self.book()
        self._set_frozen(True)

        r = self.client.delete(f"{BOOKINGS}{booking.id}/", {"reason": "Busy"}, format="json")

        self.assertFrozenRefusal(r)
        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)

    def test_a_frozen_student_cannot_invite_a_classmate(self):
        booking = self.book()
        self._set_frozen(True)

        with self.subTest(route="GET invite"):
            self.assertFrozenRefusal(self.client.get(f"{BOOKINGS}{booking.id}/invite/"))
        with self.subTest(route="POST invite"):
            self.assertFrozenRefusal(
                self.client.post(
                    f"{BOOKINGS}{booking.id}/invite/", {"student_id": self.classmate.id},
                    format="json",
                )
            )

        self.assertFalse(SupportBooking.objects.filter(student=self.classmate).exists())

    def test_a_frozen_student_cannot_rate_a_held_session(self):
        booking = self.held()
        self._set_frozen(True)

        r = self.client.post(f"{BOOKINGS}{booking.id}/rate/", {"rating": 5}, format="json")

        self.assertFrozenRefusal(r)
        booking.refresh_from_db()
        self.assertIsNone(booking.rating)

    def test_the_teacher_can_still_withdraw_a_frozen_students_booking(self):
        booking = self.book()
        self._set_frozen(True)
        self.client.force_authenticate(self.support)

        r = self.client.delete(f"{BOOKINGS}{booking.id}/", {}, format="json")

        self.assertEqual(r.status_code, 200, r.content)
        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_CANCELLED)

    def test_an_unfrozen_student_is_unaffected(self):
        r = self.client.post(BOOKINGS, {"availability_id": self.make_slot().id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        r = self.client.delete(f"{BOOKINGS}{r.data['id']}/", {"reason": "Clash"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

        held = self.held()
        r = self.client.post(f"{BOOKINGS}{held.id}/rate/", {"rating": 4}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

        r = self.client.get(BOOKINGS)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.data["bookings"]), 2)

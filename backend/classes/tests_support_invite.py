"""Adding a classmate to a support hour you booked.

The rules the school asked for, and the seams where each could go wrong:

- the invitee gets their OWN booking, not a passenger seat on somebody else's, because the
  teacher settles each student separately and the 10 points are per student;
- an invitation WIDENS a one-to-one hour by one, since capacity is 1 by default and only
  staff may change it — the alternative is a button that never works;
- the invitee is told, in the bell and by email, because they did not ask for this;
- the entitlement rule does not bend: an invitation must not put a student in front of a
  support teacher who does not teach them.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import support as support_service
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability, SupportBooking
from notifications.models import Notification

User = get_user_model()


class SupportInviteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("inv_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.support = User.objects.create_user(
            "inv_sup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        self.host = User.objects.create_user("inv_host@t.com", "secret123")
        self.guest = User.objects.create_user("inv_guest@t.com", "secret123")
        self.outsider = User.objects.create_user("inv_out@t.com", "secret123")

        self.classroom = Classroom.objects.create(
            name="Maths Invite", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        for user in (self.host, self.guest):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
            )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.support, role=ClassroomMembership.ROLE_TA
        )
        # The outsider is a student of a class this support teacher does not cover.
        other = Classroom.objects.create(
            name="Other", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=other, user=self.outsider, role=ClassroomMembership.ROLE_STUDENT
        )

        start = support_service._hour_start(
            timezone.localdate() + timedelta(days=support_service.CALENDAR_DAYS + 3), 10
        )
        self.slot = SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=start,
            ends_at=start + timedelta(hours=1), capacity=1,
        )
        self.booking = support_service.book(self.host, self.slot, topic="Quadratics")

    # ── the seat ────────────────────────────────────────────────────────────

    def test_the_guest_gets_their_own_booking(self):
        """Not a passenger. The teacher settles each student separately and the points are
        per student, so a shared row would have nowhere to record that one turned up and one
        did not."""
        guest_booking = support_service.invite_member(
            self.booking, self.guest, actor=self.host
        )

        self.assertNotEqual(guest_booking.pk, self.booking.pk)
        self.assertEqual(guest_booking.student_id, self.guest.id)
        self.assertEqual(guest_booking.status, SupportBooking.STATUS_BOOKED)
        self.assertEqual(guest_booking.invited_by_id, self.host.id)
        # The topic carries over — they are coming to the same hour about the same thing.
        self.assertEqual(guest_booking.topic, "Quadratics")

    def test_an_invitation_widens_a_one_to_one_hour_by_one(self):
        """Capacity is 1 by default and only staff may change it, so an invite either makes
        room or the feature does nothing on the calendar every teacher actually has."""
        self.assertEqual(self.slot.capacity, 1)

        support_service.invite_member(self.booking, self.guest, actor=self.host)

        self.slot.refresh_from_db()
        self.assertEqual(self.slot.capacity, 2)

    def test_a_group_hour_with_room_is_not_widened(self):
        """Only widen when it is actually full — otherwise every invite inflates the hour."""
        self.slot.capacity = 4
        self.slot.save(update_fields=["capacity"])

        support_service.invite_member(self.booking, self.guest, actor=self.host)

        self.slot.refresh_from_db()
        self.assertEqual(self.slot.capacity, 4)

    def test_a_cancelled_seat_is_reused_rather_than_duplicated(self):
        """The reward key is tied to the booking row, so a second row would let the same
        student be paid twice for one hour."""
        first = support_service.invite_member(self.booking, self.guest, actor=self.host)
        support_service.cancel(first, actor=self.guest, reason="clash")

        again = support_service.invite_member(self.booking, self.guest, actor=self.host)

        self.assertEqual(again.pk, first.pk)
        self.assertEqual(again.status, SupportBooking.STATUS_BOOKED)
        self.assertEqual(again.cancel_reason, "")
        self.assertEqual(
            SupportBooking.objects.filter(availability=self.slot, student=self.guest).count(), 1
        )

    # ── who may be added ────────────────────────────────────────────────────

    def test_a_student_who_does_not_share_a_class_cannot_be_added(self):
        """An invitation must not become a way past the entitlement rule."""
        with self.assertRaises(ValidationError):
            support_service.invite_member(self.booking, self.outsider, actor=self.host)

        self.assertFalse(SupportBooking.objects.filter(student=self.outsider).exists())

    def test_you_cannot_add_yourself(self):
        with self.assertRaises(ValidationError):
            support_service.invite_member(self.booking, self.host, actor=self.host)

    def test_you_cannot_add_somebody_who_is_already_in_it(self):
        support_service.invite_member(self.booking, self.guest, actor=self.host)
        with self.assertRaises(ValidationError):
            support_service.invite_member(self.booking, self.guest, actor=self.host)

    def test_a_cancelled_booking_cannot_invite(self):
        support_service.cancel(self.booking, actor=self.host, reason="can't make it")
        with self.assertRaises(ValidationError):
            support_service.invite_member(self.booking, self.guest, actor=self.host)

    def test_the_weekly_cap_still_applies_to_the_guest(self):
        """A classmate who has already had their week's sessions is not free to attend a
        fourth just because somebody else clicked."""
        for i in range(support_service.MAX_BOOKINGS_PER_WEEK):
            start = support_service._hour_start(
                timezone.localdate() + timedelta(days=support_service.CALENDAR_DAYS + 4), 9 + i
            )
            slot = SupportAvailability.objects.create(
                support_teacher=self.support, starts_at=start,
                ends_at=start + timedelta(hours=1), capacity=5,
            )
            SupportBooking.objects.create(
                availability=slot, student=self.guest, status=SupportBooking.STATUS_BOOKED
            )

        with self.assertRaises(ValidationError) as ctx:
            support_service.invite_member(self.booking, self.guest, actor=self.host)
        # The message is read by the INVITER, so it has to name the person it is about.
        self.assertIn("support sessions", " ".join(ctx.exception.messages))

    # ── being told ──────────────────────────────────────────────────────────

    def test_the_guest_is_notified(self):
        """They did not ask for this seat, so the bell is the whole point of the feature.

        `captureOnCommitCallbacks` is load-bearing, not boilerplate. The announcement is
        deliberately deferred to `transaction.on_commit` — telling somebody they have a seat
        that then rolls back is something they cannot un-read — and a `TestCase` wraps every
        test in a transaction it never commits, so without this the callback silently never
        runs and the assertion would be testing nothing.
        """
        with self.captureOnCommitCallbacks(execute=True):
            support_service.invite_member(self.booking, self.guest, actor=self.host)

        note = Notification.objects.filter(recipient=self.guest).first()
        self.assertIsNotNone(note)
        self.assertIn("added you", note.title)
        self.assertEqual(note.link_url, "/support")

    def test_the_inviter_is_not_notified_about_their_own_click(self):
        with self.captureOnCommitCallbacks(execute=True):
            support_service.invite_member(self.booking, self.guest, actor=self.host)
        self.assertFalse(Notification.objects.filter(recipient=self.host).exists())

    # ── the picker ──────────────────────────────────────────────────────────

    def test_the_picker_offers_classmates_and_nobody_else(self):
        names = {u.id for u in support_service.invitable_classmates(self.booking)}

        self.assertIn(self.guest.id, names)
        self.assertNotIn(self.outsider.id, names)   # not this teacher's student
        self.assertNotIn(self.host.id, names)       # already in it
        self.assertNotIn(self.support.id, names)    # a TA is not a classmate

    def test_the_picker_drops_somebody_already_in_the_session(self):
        support_service.invite_member(self.booking, self.guest, actor=self.host)

        ids = {u.id for u in support_service.invitable_classmates(self.booking)}
        self.assertNotIn(self.guest.id, ids)

    # ── the endpoint ────────────────────────────────────────────────────────

    def test_only_the_student_who_booked_it_may_add_someone(self):
        self.client.force_authenticate(self.guest)
        response = self.client.post(
            f"/api/classes/support/bookings/{self.booking.id}/invite/",
            {"student_id": self.outsider.id}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_the_endpoint_adds_and_reports(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            f"/api/classes/support/bookings/{self.booking.id}/invite/",
            {"student_id": self.guest.id}, format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["booking"]["student_id"], self.guest.id)
        self.assertEqual(response.json()["booking"]["invited_by_id"], self.host.id)

    def test_an_unknown_student_id_says_the_same_thing_as_a_wrong_one(self):
        """So the endpoint cannot be used to probe which user ids exist."""
        self.client.force_authenticate(self.host)
        missing = self.client.post(
            f"/api/classes/support/bookings/{self.booking.id}/invite/",
            {"student_id": 99999}, format="json",
        )
        wrong = self.client.post(
            f"/api/classes/support/bookings/{self.booking.id}/invite/",
            {"student_id": self.outsider.id}, format="json",
        )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(missing.json()["detail"], wrong.json()["detail"])

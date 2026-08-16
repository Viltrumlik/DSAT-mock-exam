"""Administrator oversight of the support desk, and the earning being made visible.

Three things are pinned here, and each one was a gap rather than a bug:

1. **An administrator can read a support teacher's desk.** The write paths already accepted
   ``support_teacher`` (``AdminSetsHoursTests``), but the reads did not — so an admin could
   edit a grid they had no way to look at first, and asking to see one returned their own
   empty week with a 200.
2. **Ratings are readable with their comments.** ``rating_summary`` has always returned an
   average; nothing returned what the students actually wrote.
3. **The award is carried back on the booking.** It has been written on HELD since the desk
   shipped and never surfaced anywhere, so the student's page promised points and then
   showed a tick.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from access import constants as C
from classes import support as support_service
from classes.models import ClassroomMembership
from classes.models_support import SupportBooking
from classes.tests_support_booking import SupportFixture
from notifications import constants as note_const
from notifications.models import Notification
from rewards.models import PointAward


class DeskOverviewTests(SupportFixture):
    """The cross-teacher table: the question "is the desk being run?" made answerable."""

    def rows(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/classes/support/desks/")
        self.assertEqual(r.status_code, 200)
        return {row["id"]: row for row in r.json()["teachers"]}

    def test_it_lists_every_support_teacher_including_one_covering_nothing(self):
        """A desk assigned to no classroom is exactly the row an administrator needs.

        They are on the payroll and no student can book them. A list derived from classroom
        memberships is the one list that can never show it, which is why the overview reads
        the accounts.
        """
        rows = self.rows()
        self.assertIn(self.support.id, rows)
        self.assertIn(self.other_support.id, rows)
        # Nobody teaches the outsider or the student, and neither is a support account.
        self.assertNotIn(self.student.id, rows)

    def test_a_desk_covering_no_class_reads_as_zero_not_as_absent(self):
        lonely = get_user_model().objects.create_user(
            "sa_lonely@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH
        )
        row = self.rows()[lonely.id]
        self.assertEqual(row["classrooms"], [])
        self.assertEqual(row["students"], 0)
        self.assertEqual(row["held"], 0)

    def test_the_numbers_follow_the_sessions(self):
        held = support_service.book(self.student, self.slot)
        support_service.settle(held, SupportBooking.STATUS_HELD, actor=self.support)
        missed = support_service.book(self.student, self.make_slot(self.support))
        support_service.settle(missed, SupportBooking.STATUS_NO_SHOW, actor=self.support)

        row = self.rows()[self.support.id]
        self.assertEqual(row["held"], 1)
        self.assertEqual(row["missed"], 1)
        self.assertEqual(row["students"], 1)
        self.assertEqual([c["name"] for c in row["classrooms"]], [self.classroom.name])

    def test_a_removed_student_stops_counting_towards_reach(self):
        """The count beside a list has to be computed the way the list is.

        A removed member cannot book, so counting them would advertise a reach the desk
        does not have.
        """
        self.assertEqual(self.rows()[self.support.id]["students"], 1)
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(self.rows()[self.support.id]["students"], 0)

    def test_a_student_in_two_of_the_same_desks_classes_is_one_student(self):
        ClassroomMembership.objects.create(
            classroom=self.other_classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT,
        )
        ClassroomMembership.objects.create(
            classroom=self.other_classroom, user=self.support, role=ClassroomMembership.ROLE_TA
        )
        self.assertEqual(self.rows()[self.support.id]["students"], 1)

    def test_a_settled_session_leaves_the_to_do_count(self):
        past = self.make_slot(self.support)
        past.starts_at = timezone.now() - timedelta(hours=2)
        past.ends_at = timezone.now() - timedelta(hours=1)
        past.save(update_fields=["starts_at", "ends_at"])
        booking = SupportBooking.objects.create(
            availability=past, student=self.student, classroom=self.classroom,
            status=SupportBooking.STATUS_BOOKED,
        )
        self.assertEqual(self.rows()[self.support.id]["awaiting_settle"], 1)

        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        self.assertEqual(self.rows()[self.support.id]["awaiting_settle"], 0)

    def test_free_hours_agree_with_the_grid(self):
        """The overview counts hours with the same code the grid renders them with.

        Withdrawing an hour must move both numbers or neither — a second implementation is
        how a headline ends up disagreeing with the list under it.
        """
        before = self.rows()[self.support.id]["free_hours"]
        hour = support_service._hour_start(
            timezone.localdate() + timedelta(days=1), support_service.CALENDAR_OPEN_HOUR
        )
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            "/api/classes/support/hours/close/",
            {"starts_at": hour.isoformat(), "support_teacher": self.support.id},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        after = self.rows()[self.support.id]
        self.assertEqual(after["free_hours"], before - 1)
        self.assertEqual(after["closed_hours"], 1)


class OversightIsAdminOnlyTests(SupportFixture):
    """Not permission-gated, role-gated.

    ``AuthGuard adminOnly`` on the console admits anyone holding ``manage_tests``, so a
    ``test_auditor`` reaches every ops page. Another teacher's ratings are not theirs.
    """

    def test_a_support_teacher_cannot_read_the_overview(self):
        self.client.force_authenticate(self.support)
        self.assertEqual(self.client.get("/api/classes/support/desks/").status_code, 403)

    def test_a_student_cannot_read_the_overview(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get("/api/classes/support/desks/").status_code, 403)

    def test_a_support_teacher_cannot_read_anothers_ratings(self):
        self.client.force_authenticate(self.support)
        r = self.client.get(
            f"/api/classes/support/ratings/?support_teacher={self.other_support.id}"
        )
        self.assertEqual(r.status_code, 403)

    def test_an_admin_can(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(
            f"/api/classes/support/ratings/?support_teacher={self.support.id}"
        )
        self.assertEqual(r.status_code, 200)


class RatingCommentTests(SupportFixture):
    def rate(self, value, comment):
        booking = support_service.book(self.student, self.make_slot(self.support))
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        support_service.rate(booking, value, comment=comment)
        return booking

    def test_the_comments_come_back_with_the_average(self):
        self.rate(5, "Explained the whole unit again")
        self.rate(3, "")
        self.client.force_authenticate(self.admin)
        body = self.client.get(
            f"/api/classes/support/ratings/?support_teacher={self.support.id}"
        ).json()

        self.assertEqual(body["summary"]["count"], 2)
        self.assertEqual(body["summary"]["average"], 4.0)
        self.assertEqual(
            [row["comment"] for row in body["ratings"]],
            ["", "Explained the whole unit again"],
        )

    def test_a_comment_names_the_student_who_wrote_it(self):
        """A management surface, and stated as a choice rather than left implied: a rating
        nobody can follow up is a number, not feedback. The student is never told a rating
        is anonymous, so no promise is broken — but somebody should have decided it."""
        self.rate(2, "We ran out of time")
        self.client.force_authenticate(self.admin)
        row = self.client.get(
            f"/api/classes/support/ratings/?support_teacher={self.support.id}"
        ).json()["ratings"][0]
        self.assertEqual(row["student_id"], self.student.id)
        self.assertEqual(row["classroom_name"], self.classroom.name)

    def test_naming_somebody_who_is_not_a_support_teacher_is_a_400(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(
            f"/api/classes/support/ratings/?support_teacher={self.student.id}"
        )
        self.assertEqual(r.status_code, 400)

    def test_naming_nobody_is_a_400_rather_than_your_own_empty_feed(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/classes/support/ratings/").status_code, 400)


class ReadingAnothersDeskTests(SupportFixture):
    """``?support_teacher=`` on the two reads that were hard-wired to ``request.user``."""

    def test_an_admin_reads_a_teachers_week(self):
        support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.admin)
        body = self.client.get(
            f"/api/classes/support/my-calendar/?support_teacher={self.support.id}"
        ).json()
        self.assertEqual(body["support_teacher_id"], self.support.id)

    def test_an_admin_reads_a_teachers_diary(self):
        support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.admin)
        body = self.client.get(
            f"/api/classes/support/diary/?support_teacher={self.support.id}"
        ).json()
        self.assertEqual([b["student_id"] for b in body["bookings"]], [self.student.id])

    def test_a_support_teacher_cannot_read_somebody_elses(self):
        self.client.force_authenticate(self.support)
        r = self.client.get(
            f"/api/classes/support/diary/?support_teacher={self.other_support.id}"
        )
        self.assertEqual(r.status_code, 403)

    def test_omitting_the_target_still_reads_your_own(self):
        """The whole of the backwards compatibility: nothing a support teacher does changes."""
        support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.support)
        body = self.client.get("/api/classes/support/diary/").json()
        self.assertEqual([b["student_id"] for b in body["bookings"]], [self.student.id])

    def test_naming_somebody_who_is_not_a_support_teacher_is_a_400(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(
            f"/api/classes/support/diary/?support_teacher={self.student.id}"
        )
        self.assertEqual(r.status_code, 400)


class CancelledRowsReachTheDiaryTests(SupportFixture):
    """The reason a student gives for calling an hour off is collected for exactly one
    person, and until now that person was the only one who could not see it: the row was
    filtered out one layer below their page."""

    def test_a_cancelled_booking_appears_with_its_reason(self):
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking, actor=self.student, reason="Sorted it myself")
        self.client.force_authenticate(self.support)
        body = self.client.get("/api/classes/support/diary/").json()
        row = next(b for b in body["bookings"] if b["id"] == booking.id)
        self.assertEqual(row["status"], SupportBooking.STATUS_CANCELLED)
        self.assertEqual(row["cancel_reason"], "Sorted it myself")

    def test_a_cancelled_booking_still_does_not_occupy_a_seat(self):
        """Including the row in the diary must not change any count that filters on status."""
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking, actor=self.student, reason="Unwell")
        self.client.force_authenticate(self.support)
        body = self.client.get("/api/classes/support/my-calendar/").json()
        self.assertEqual(body["booked_sessions"], 0)
        self.assertEqual(body["awaiting_settle"], 0)


class AwardOnTheBookingTests(SupportFixture):
    """What the session paid, carried back on the row that earned it."""

    def settle_held(self):
        booking = support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.support)
        r = self.client.post(
            f"/api/classes/support/bookings/{booking.id}/settle/",
            {"status": "HELD"}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        return booking, r.json()

    def test_the_settle_response_names_the_earning(self):
        _, body = self.settle_held()
        self.assertEqual(body["award"], {"points": 10, "xp": 10})

    def test_a_booking_that_has_not_happened_has_no_award(self):
        support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.student)
        row = self.client.get("/api/classes/support/bookings/").json()["bookings"][0]
        self.assertIsNone(row["award"])

    def test_the_student_sees_it_on_their_own_list(self):
        booking, _ = self.settle_held()
        self.client.force_authenticate(self.student)
        row = next(
            b for b in self.client.get("/api/classes/support/bookings/").json()["bookings"]
            if b["id"] == booking.id
        )
        self.assertEqual(row["award"], {"points": 10, "xp": 10})

    def test_a_corrected_session_stops_showing_an_earning(self):
        """A row labelled "Missed" must not also say "+10 XP".

        The gate is the booking's status, not the ledger row: revoking zeroes the points
        but deliberately leaves the XP standing — "XP is never taken away" — so the ledger
        keeps a live XP figure here for as long as the student keeps the XP. That is right
        for the rewards board and wrong for this row.
        """
        booking, _ = self.settle_held()
        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)
        # The ledger row survives a revocation by design — it is zeroed, not deleted, and
        # on this branch `revoke` zeroes only the points column.
        award = PointAward.objects.get(source_id=booking.id, source_type="support_booking")
        self.assertEqual(award.points, 0)

        self.client.force_authenticate(self.student)
        row = next(
            b for b in self.client.get("/api/classes/support/bookings/").json()["bookings"]
            if b["id"] == booking.id
        )
        self.assertIsNone(row["award"])

    def test_a_list_of_bookings_costs_one_query_for_all_their_awards(self):
        """A per-row lookup here would be an N+1 on the page a teacher opens most."""
        # Created directly rather than through `book`: four sessions in a week is over the
        # student's own allowance, and the allowance is not what this test is about.
        for _ in range(4):
            b = SupportBooking.objects.create(
                availability=self.make_slot(self.support), student=self.student,
                classroom=self.classroom, status=SupportBooking.STATUS_BOOKED,
            )
            support_service.settle(b, SupportBooking.STATUS_HELD, actor=self.support)
        bookings = list(support_service.bookings_for_teacher(self.support))
        with self.assertNumQueries(1):
            awards = support_service.awards_for(bookings)
        self.assertEqual(len(awards), 4)

    def test_asking_about_nothing_asks_the_database_nothing(self):
        with self.assertNumQueries(0):
            self.assertEqual(support_service.awards_for([]), {})


class TellingPeopleTests(SupportFixture):
    """Three notification events had existed since the notifications app shipped with no
    caller anywhere. A teacher learned they had an appointment by opening their page; a
    student learned a session had paid by opening a different one."""

    def notes(self, user, event):
        return Notification.objects.filter(recipient=user, event=event)

    def test_booking_tells_the_support_teacher(self):
        support_service.book(self.student, self.slot, topic="Quadratics")
        note = self.notes(self.support, note_const.EVENT_SUPPORT_BOOKED).get()
        self.assertIn("Quadratics", note.body)

    def test_a_student_cancelling_tells_the_teacher_why(self):
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking, actor=self.student, reason="Doctor's appointment")
        note = self.notes(self.support, note_const.EVENT_SUPPORT_CANCELLED).get()
        self.assertIn("Doctor's appointment", note.body)

    def test_a_teacher_withdrawing_an_hour_does_not_notify_themselves(self):
        """Telling somebody what they just did is noise that teaches them to stop reading."""
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking, actor=self.support, reason="I withdrew this hour.")
        self.assertFalse(self.notes(self.support, note_const.EVENT_SUPPORT_CANCELLED).exists())

    def test_a_teacher_withdrawing_an_hour_tells_the_student(self):
        """Otherwise the first the student knows about it is an empty room."""
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking, actor=self.support, reason="I'm away that day.")
        note = self.notes(self.student, note_const.EVENT_SUPPORT_CANCELLED).get()
        self.assertIn("I'm away that day.", note.body)

    def test_withdrawing_an_hour_through_the_api_tells_everyone_booked_on_it(self):
        support_service.book(self.student, self.slot)
        self.client.force_authenticate(self.support)
        r = self.client.delete(f"/api/classes/support/availability/{self.slot.id}/")
        self.assertEqual(r.status_code, 200)
        note = self.notes(self.student, note_const.EVENT_SUPPORT_CANCELLED).get()
        self.assertIn("withdrew", note.body)

    def test_a_student_cancelling_is_not_told_about_their_own_cancellation(self):
        booking = support_service.book(self.student, self.slot)
        support_service.cancel(booking, actor=self.student, reason="Unwell")
        self.assertFalse(self.notes(self.student, note_const.EVENT_SUPPORT_CANCELLED).exists())

    def test_holding_a_session_tells_the_student_what_they_earned(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        note = self.notes(self.student, note_const.EVENT_REWARD_EARNED).get()
        self.assertIn("10 XP", note.title)
        self.assertEqual(note.link_url, "/support")

    def test_a_no_show_tells_the_student_nothing(self):
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)
        self.assertFalse(self.notes(self.student, note_const.EVENT_REWARD_EARNED).exists())

    def test_re_settling_to_fix_a_note_does_not_announce_a_second_payment(self):
        """The award is idempotent and the announcement has to be too, or the ledger and
        the bell stop agreeing about how many times an hour paid."""
        booking = support_service.book(self.student, self.slot)
        for _ in range(3):
            support_service.settle(
                booking, SupportBooking.STATUS_HELD, actor=self.support,
                teacher_note="Inference questions",
            )
        self.assertEqual(self.notes(self.student, note_const.EVENT_REWARD_EARNED).count(), 1)

    def test_a_correction_back_to_held_announces_again(self):
        """A mis-click corrected to NO_SHOW takes the points back, so restoring the fact
        restores the earning — and that IS news the second time."""
        booking = support_service.book(self.student, self.slot)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        support_service.settle(booking, SupportBooking.STATUS_NO_SHOW, actor=self.support)
        support_service.settle(booking, SupportBooking.STATUS_HELD, actor=self.support)
        # Deduped into one row inside the window rather than stacked — the student is told
        # once about one hour, however many times the teacher changed their mind.
        note = self.notes(self.student, note_const.EVENT_REWARD_EARNED).get()
        self.assertIn("10 XP", note.title)

    def test_a_muted_student_still_gets_their_points(self):
        """`notify` returning None is an ordinary outcome, and must never reach the award."""
        from notifications.models import NotificationPreference

        prefs, _ = NotificationPreference.objects.get_or_create(user=self.student)
        prefs.muted_categories = [note_const.CATEGORY_REWARDS]
        prefs.save(update_fields=["muted_categories"])

        booking = support_service.book(self.student, self.slot)
        # `settle` re-reads the row under a lock and returns THAT object; the one passed in
        # keeps its old status. `awards_for` gates on status, so hand it the settled row.
        settled = support_service.settle(
            booking, SupportBooking.STATUS_HELD, actor=self.support
        )
        self.assertFalse(self.notes(self.student, note_const.EVENT_REWARD_EARNED).exists())
        self.assertEqual(support_service.award_for(settled), {"points": 10, "xp": 10})

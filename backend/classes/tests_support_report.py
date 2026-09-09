"""The ops report on the support desk.

What is pinned here, and why each one is worth a test:

- **The backlog is the report.** 32 bookings sat in BOOKED on production with their hour long
  over, the oldest from 13 August, and an unsettled booking pays nobody. So: it is counted,
  it is dated, it does NOT vanish when the reader pages to a month it did not happen in, and
  a future appointment is never mistaken for one.
- **A rate over an empty denominator is ``None``.** Never 0. A teacher who has run nothing
  has no attendance rate, and 0% accuses them of a failure that did not happen.
- **The permission is an admin one.** A support teacher must not read another support
  teacher's roster of students through this report — which the guard used by every other
  endpoint in ``views_support`` would have allowed.
- **The row explains itself**: the human label beside the status, the topic, who settled it,
  and ``invited_by`` when the seat came from an invitation.
"""

from __future__ import annotations

from datetime import date, datetime, time as dt_time, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import support_report
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability, SupportBooking

User = get_user_model()

SESSIONS_URL = "/api/classes/support/report/sessions/"
MONTHLY_URL = "/api/classes/support/report/monthly/"


def at(day: date, hour: int):
    """Local o'clock, because every window in the report is a local one."""
    return timezone.make_aware(
        datetime.combine(day, dt_time(hour=hour)), timezone.get_current_timezone()
    )


class SupportReportFixture(TestCase):
    """One desk, two support teachers, four students, and a month with something in it.

    Bookings are written straight to the model rather than through ``support.book``: the
    booking service enforces a one-session-a-day cap and refuses anything in the past, and
    this report is about sessions that already happened. Settling likewise sets the fields
    the report reads directly — what is under test here is the arithmetic over those rows,
    not the booking rules, which have their own suites.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("rep_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.alice = User.objects.create_user(
            "rep_alice@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH,
            first_name="Alice", last_name="Desk",
        )
        self.bob = User.objects.create_user(
            "rep_bob@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH,
            first_name="Bob", last_name="Desk",
        )
        self.teacher = User.objects.create_user(
            "rep_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.classroom = Classroom.objects.create(
            name="Maths Report", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        self.students = []
        for i in range(4):
            student = User.objects.create_user(
                f"rep_s{i}@t.com", "secret123", first_name=f"Stu{i}", last_name="Dent"
            )
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=student,
                role=ClassroomMembership.ROLE_STUDENT,
            )
            self.students.append(student)
        for support in (self.alice, self.bob):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=support, role=ClassroomMembership.ROLE_TA
            )

        # "Now" is fixed to the middle of a month so that "last month", "this month" and
        # "next week" are all unambiguous, whatever day the suite is actually run on.
        self.today = date(2026, 9, 15)
        self.now = at(self.today, 12)
        self.month = "2026-09"
        self.hour = 8

    def slot(self, teacher, day, *, cancelled=False, capacity=3):
        """A published hour. Each call takes the next o'clock, so no two collide on the
        (teacher, starts_at) uniqueness constraint."""
        self.hour = 8 if self.hour >= 20 else self.hour + 1
        starts = at(day, self.hour)
        return SupportAvailability.objects.create(
            support_teacher=teacher, starts_at=starts,
            ends_at=starts + timedelta(hours=1), capacity=capacity,
            is_cancelled=cancelled,
        )

    def booking(self, slot, student, *, status=SupportBooking.STATUS_BOOKED, topic="",
                settled_by=None, invited_by=None):
        return SupportBooking.objects.create(
            availability=slot, student=student, classroom=self.classroom,
            topic=topic, status=status, invited_by=invited_by,
            settled_at=self.now if status in (
                SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW
            ) else None,
            settled_by=settled_by,
        )

    def as_admin(self):
        self.client.force_authenticate(self.admin)
        return self.client


class MonthlySummaryTests(SupportReportFixture):
    def test_the_month_counts_every_outcome_and_they_add_up(self):
        held_slot = self.slot(self.alice, date(2026, 9, 2))
        self.booking(held_slot, self.students[0], status=SupportBooking.STATUS_HELD,
                     settled_by=self.alice)
        self.booking(held_slot, self.students[1], status=SupportBooking.STATUS_HELD,
                     settled_by=self.alice)
        self.booking(held_slot, self.students[2], status=SupportBooking.STATUS_NO_SHOW,
                     settled_by=self.alice)
        self.booking(self.slot(self.alice, date(2026, 9, 3)), self.students[0],
                     status=SupportBooking.STATUS_CANCELLED)
        # Over, never settled: the backlog.
        self.booking(self.slot(self.alice, date(2026, 9, 4)), self.students[3])
        # Next week: booked, but there is nothing to settle yet.
        self.booking(self.slot(self.alice, date(2026, 9, 22)), self.students[3])

        data = support_report.monthly_summary(month=self.month, now=self.now)
        row = next(r for r in data["teachers"] if r["support_teacher_id"] == self.alice.id)

        self.assertEqual(row["held"], 2)
        self.assertEqual(row["no_show"], 1)
        self.assertEqual(row["cancelled"], 1)
        self.assertEqual(row["unsettled"], 1)
        self.assertEqual(row["upcoming"], 1)
        self.assertEqual(row["bookings"], 6)
        # The five outcomes partition the total, so a reader can check the row adds up.
        self.assertEqual(
            row["held"] + row["no_show"] + row["cancelled"] + row["unsettled"] + row["upcoming"],
            row["bookings"],
        )
        self.assertEqual(row["slots_published"], 4)

    def test_students_helped_counts_heads_not_bookings(self):
        first = self.slot(self.alice, date(2026, 9, 2))
        second = self.slot(self.alice, date(2026, 9, 9))
        for slot in (first, second):
            self.booking(slot, self.students[0], status=SupportBooking.STATUS_HELD,
                         settled_by=self.alice)
        self.booking(second, self.students[1], status=SupportBooking.STATUS_HELD,
                     settled_by=self.alice)

        row = next(
            r for r in support_report.monthly_summary(month=self.month, now=self.now)["teachers"]
            if r["support_teacher_id"] == self.alice.id
        )
        self.assertEqual(row["held"], 3)
        self.assertEqual(row["students_helped"], 2)

    def test_a_student_seen_by_two_teachers_is_one_head_in_the_total(self):
        """The pooled figure, not a sum of the per-teacher ones — the mean-of-means trap."""
        self.booking(self.slot(self.alice, date(2026, 9, 2)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.alice)
        self.booking(self.slot(self.bob, date(2026, 9, 3)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.bob)

        data = support_report.monthly_summary(month=self.month, now=self.now)
        per_teacher = sum(r["students_helped"] for r in data["teachers"])
        self.assertEqual(per_teacher, 2)
        self.assertEqual(data["total"]["students_helped"], 1)
        self.assertEqual(data["total"]["held"], 2)

    def test_attendance_rate_is_none_when_nobody_was_expected(self):
        """Never 0%. A desk that ran no sessions has no rate, and 0% would read as a failure."""
        data = support_report.monthly_summary(month=self.month, now=self.now)
        row = next(r for r in data["teachers"] if r["support_teacher_id"] == self.alice.id)
        self.assertEqual(row["held"], 0)
        self.assertEqual(row["no_show"], 0)
        self.assertIsNone(row["attendance_rate"])
        self.assertIsNone(data["total"]["attendance_rate"])

    def test_an_unsettled_booking_does_not_enter_the_attendance_rate(self):
        """Held over held-plus-missed. An unsettled hour is not a missed one — counting it as
        either would let a teacher who never settles their day look good or look bad, when
        the truth is that nobody knows."""
        slot = self.slot(self.alice, date(2026, 9, 2))
        self.booking(slot, self.students[0], status=SupportBooking.STATUS_HELD,
                     settled_by=self.alice)
        self.booking(slot, self.students[1], status=SupportBooking.STATUS_NO_SHOW,
                     settled_by=self.alice)
        self.booking(self.slot(self.alice, date(2026, 9, 4)), self.students[2])

        row = next(
            r for r in support_report.monthly_summary(month=self.month, now=self.now)["teachers"]
            if r["support_teacher_id"] == self.alice.id
        )
        self.assertEqual(row["unsettled"], 1)
        self.assertEqual(row["attendance_rate"], 0.5)

    def test_a_teacher_with_no_month_still_gets_a_row(self):
        """A row of zeros is information. Dropping the teacher who did nothing is how a desk
        that stopped running looks like a desk that was never there."""
        ids = {r["support_teacher_id"] for r in
               support_report.monthly_summary(month=self.month, now=self.now)["teachers"]}
        self.assertIn(self.alice.id, ids)
        self.assertIn(self.bob.id, ids)
        # A classroom teacher is not a support teacher and has no desk to report on.
        self.assertNotIn(self.teacher.id, ids)

    def test_a_withdrawn_hour_is_not_a_published_slot(self):
        self.slot(self.alice, date(2026, 9, 2))
        self.slot(self.alice, date(2026, 9, 3), cancelled=True)
        row = next(
            r for r in support_report.monthly_summary(month=self.month, now=self.now)["teachers"]
            if r["support_teacher_id"] == self.alice.id
        )
        self.assertEqual(row["slots_published"], 1)

    def test_the_month_window_is_local_and_excludes_the_neighbours(self):
        self.booking(self.slot(self.alice, date(2026, 8, 31)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.alice)
        self.booking(self.slot(self.alice, date(2026, 9, 1)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.alice)
        self.booking(self.slot(self.alice, date(2026, 9, 30)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.alice)
        self.booking(self.slot(self.alice, date(2026, 10, 1)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.alice)

        september = support_report.monthly_summary(month="2026-09", now=self.now)
        self.assertEqual(september["total"]["held"], 2)
        august = support_report.monthly_summary(month="2026-08", now=self.now)
        self.assertEqual(august["total"]["held"], 1)

    def test_the_picker_never_offers_a_future_month_and_the_default_is_now(self):
        self.slot(self.alice, date(2026, 8, 10))
        self.slot(self.alice, date(2026, 12, 10))  # published ahead
        months = support_report.available_months(now=self.now)
        self.assertIn("2026-09", months)
        self.assertIn("2026-08", months)
        self.assertNotIn("2026-12", months)
        # Newest first, so the picker opens on the month the report defaults to.
        self.assertEqual(months[0], "2026-09")
        self.assertEqual(support_report.default_month(now=self.now), "2026-09")

    def test_a_month_that_is_not_a_month_is_refused(self):
        with self.assertRaises(ValueError):
            support_report.monthly_summary(month="September", now=self.now)


class BacklogTests(SupportReportFixture):
    """The number the report exists for."""

    def test_the_backlog_is_counted_dated_and_school_wide(self):
        for day in (date(2026, 8, 13), date(2026, 8, 20), date(2026, 9, 4)):
            self.booking(self.slot(self.alice, day), self.students[0])
        self.booking(self.slot(self.bob, date(2026, 9, 5)), self.students[1])

        data = support_report.monthly_summary(month=self.month, now=self.now)
        self.assertEqual(data["backlog"]["unsettled"], 4)
        self.assertEqual(timezone.localdate(data["backlog"]["oldest"]), date(2026, 8, 13))
        worst = data["backlog"]["teachers"][0]
        self.assertEqual(worst["support_teacher_id"], self.alice.id)
        self.assertEqual(worst["unsettled"], 3)

    def test_the_backlog_survives_paging_to_a_month_it_did_not_happen_in(self):
        """The whole point. A September page must still say the desk has bookings unsettled
        since 13 August; a month-bounded banner would report zero and the backlog would be
        invisible from every month but the one it started in."""
        self.booking(self.slot(self.alice, date(2026, 8, 13)), self.students[0])

        september = support_report.monthly_summary(month="2026-09", now=self.now)
        self.assertEqual(september["teachers"][0]["unsettled"], 0)  # none in September
        self.assertEqual(september["backlog"]["unsettled"], 1)
        self.assertEqual(
            timezone.localdate(september["backlog"]["oldest"]), date(2026, 8, 13)
        )
        row = next(r for r in september["teachers"] if r["support_teacher_id"] == self.alice.id)
        self.assertEqual(row["backlog_unsettled"], 1)
        self.assertEqual(timezone.localdate(row["backlog_oldest"]), date(2026, 8, 13))

    def test_a_future_appointment_is_never_backlog(self):
        self.booking(self.slot(self.alice, date(2026, 9, 22)), self.students[0])
        data = support_report.monthly_summary(month=self.month, now=self.now)
        self.assertEqual(data["backlog"]["unsettled"], 0)
        self.assertIsNone(data["backlog"]["oldest"])
        row = next(r for r in data["teachers"] if r["support_teacher_id"] == self.alice.id)
        self.assertEqual(row["upcoming"], 1)
        self.assertEqual(row["unsettled"], 0)

    def test_settling_clears_the_backlog(self):
        booking = self.booking(self.slot(self.alice, date(2026, 8, 13)), self.students[0])
        self.assertEqual(
            support_report.monthly_summary(month=self.month, now=self.now)["backlog"]["unsettled"],
            1,
        )
        booking.status = SupportBooking.STATUS_HELD
        booking.settled_at = self.now
        booking.settled_by = self.alice
        booking.save()
        self.assertEqual(
            support_report.monthly_summary(month=self.month, now=self.now)["backlog"]["unsettled"],
            0,
        )

    def test_a_cancelled_booking_is_not_backlog(self):
        self.booking(self.slot(self.alice, date(2026, 8, 13)), self.students[0],
                     status=SupportBooking.STATUS_CANCELLED)
        data = support_report.monthly_summary(month=self.month, now=self.now)
        self.assertEqual(data["backlog"]["unsettled"], 0)

    def test_filtering_by_teacher_narrows_the_banner_too(self):
        """A filtered page whose banner still showed the school's backlog would read as that
        one teacher's."""
        self.booking(self.slot(self.alice, date(2026, 8, 13)), self.students[0])
        self.booking(self.slot(self.bob, date(2026, 8, 14)), self.students[1])

        data = support_report.monthly_summary(
            month=self.month, teacher_id=self.bob.id, now=self.now
        )
        self.assertEqual([r["support_teacher_id"] for r in data["teachers"]], [self.bob.id])
        self.assertEqual(data["backlog"]["unsettled"], 1)
        self.assertEqual(timezone.localdate(data["backlog"]["oldest"]), date(2026, 8, 14))


class SessionHistoryTests(SupportReportFixture):
    def test_a_row_carries_everything_a_reader_needs(self):
        slot = self.slot(self.alice, date(2026, 9, 2))
        self.booking(
            slot, self.students[1], status=SupportBooking.STATUS_HELD,
            topic="Quadratics", settled_by=self.alice, invited_by=self.students[0],
        )
        row = support_report.session_history(now=self.now)["results"][0]

        self.assertEqual(row["support_teacher"], "Alice Desk")
        self.assertEqual(row["student"], "Stu1 Dent")
        self.assertEqual(row["classroom_name"], "Maths Report")
        self.assertEqual(row["topic"], "Quadratics")
        self.assertEqual(row["status"], "HELD")
        self.assertEqual(row["status_label"], "Held")
        self.assertEqual(row["settled_by"], "Alice Desk")
        self.assertIsNotNone(row["settled_at"])
        # The seat came from an invitation, and the row says so rather than leaving an hour
        # published as a one-to-one with two unexplained names on it.
        self.assertEqual(row["invited_by"], "Stu0 Dent")
        self.assertEqual(row["invited_by_id"], self.students[0].id)
        self.assertFalse(row["is_unsettled"])

    def test_a_missed_session_never_shows_its_raw_enum(self):
        self.booking(self.slot(self.alice, date(2026, 9, 2)), self.students[0],
                     status=SupportBooking.STATUS_NO_SHOW, settled_by=self.alice)
        row = support_report.session_history(now=self.now)["results"][0]
        self.assertEqual(row["status"], "NO_SHOW")
        self.assertEqual(row["status_label"], "Did not attend")

    def test_newest_first(self):
        self.booking(self.slot(self.alice, date(2026, 9, 1)), self.students[0])
        self.booking(self.slot(self.alice, date(2026, 9, 8)), self.students[1])
        rows = support_report.session_history(now=self.now)["results"]
        self.assertEqual(
            [timezone.localdate(r["starts_at"]) for r in rows],
            [date(2026, 9, 8), date(2026, 9, 1)],
        )

    def test_the_date_filter_includes_its_last_day(self):
        """An exclusive end silently drops the last day of every range anybody types."""
        self.booking(self.slot(self.alice, date(2026, 9, 10)), self.students[0])
        self.booking(self.slot(self.alice, date(2026, 9, 11)), self.students[1])
        page = support_report.session_history(
            date_from=date(2026, 9, 10), date_to=date(2026, 9, 11), now=self.now
        )
        self.assertEqual(page["count"], 2)
        page = support_report.session_history(
            date_from=date(2026, 9, 10), date_to=date(2026, 9, 10), now=self.now
        )
        self.assertEqual(page["count"], 1)

    def test_filters_by_teacher_student_and_status(self):
        self.booking(self.slot(self.alice, date(2026, 9, 2)), self.students[0],
                     status=SupportBooking.STATUS_HELD, settled_by=self.alice)
        self.booking(self.slot(self.bob, date(2026, 9, 3)), self.students[1],
                     status=SupportBooking.STATUS_NO_SHOW, settled_by=self.bob)

        self.assertEqual(
            support_report.session_history(teacher_id=self.alice.id, now=self.now)["count"], 1
        )
        self.assertEqual(
            support_report.session_history(student_id=self.students[1].id, now=self.now)["count"],
            1,
        )
        self.assertEqual(
            support_report.session_history(status="NO_SHOW", now=self.now)["count"], 1
        )

    def test_the_unsettled_filter_leaves_out_future_appointments(self):
        """The click-through from the banner. Filtering on BOOKED would mix next week's
        appointments in with August's unfinished ones."""
        self.booking(self.slot(self.alice, date(2026, 8, 13)), self.students[0])
        self.booking(self.slot(self.alice, date(2026, 9, 22)), self.students[1])

        self.assertEqual(support_report.session_history(status="BOOKED", now=self.now)["count"], 2)
        page = support_report.session_history(status="UNSETTLED", now=self.now)
        self.assertEqual(page["count"], 1)
        self.assertTrue(page["results"][0]["is_unsettled"])
        self.assertEqual(timezone.localdate(page["results"][0]["starts_at"]), date(2026, 8, 13))

    def test_an_unknown_status_is_refused_not_ignored(self):
        with self.assertRaises(ValueError):
            support_report.session_history(status="MAYBE", now=self.now)

    def test_it_paginates(self):
        for i in range(5):
            self.booking(self.slot(self.alice, date(2026, 9, 1) + timedelta(days=i)),
                         self.students[0])
        first = support_report.session_history(limit=2, now=self.now)
        self.assertEqual(first["count"], 5)
        self.assertEqual(len(first["results"]), 2)
        self.assertTrue(first["has_more"])
        last = support_report.session_history(limit=2, offset=4, now=self.now)
        self.assertEqual(len(last["results"]), 1)
        self.assertFalse(last["has_more"])


class SupportReportPermissionTests(SupportReportFixture):
    """An ops report, not a desk view.

    ``?teacher=`` names anybody, so the guard the rest of ``views_support`` uses — support
    teacher OR admin — would hand one support teacher another's roster of students, their
    topics and their ratings. ``IsGlobalScopeStaff`` is the gate, and these pin that.
    """

    def test_an_admin_may_read_both_surfaces(self):
        self.as_admin()
        self.assertEqual(self.client.get(SESSIONS_URL).status_code, 200)
        self.assertEqual(self.client.get(MONTHLY_URL).status_code, 200)

    def test_a_support_teacher_may_not_read_the_report(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get(SESSIONS_URL).status_code, 403)
        self.assertEqual(
            self.client.get(MONTHLY_URL, {"teacher": self.bob.id}).status_code, 403
        )

    def test_a_classroom_teacher_may_not_read_the_report(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.get(SESSIONS_URL).status_code, 403)
        self.assertEqual(self.client.get(MONTHLY_URL).status_code, 403)

    def test_a_student_may_not_read_the_report(self):
        self.client.force_authenticate(self.students[0])
        self.assertEqual(self.client.get(SESSIONS_URL).status_code, 403)
        self.assertEqual(self.client.get(MONTHLY_URL).status_code, 403)

    def test_signed_out_is_refused(self):
        self.assertIn(self.client.get(SESSIONS_URL).status_code, (401, 403))
        self.assertIn(self.client.get(MONTHLY_URL).status_code, (401, 403))


class SupportReportEndpointTests(SupportReportFixture):
    def test_sessions_returns_a_page_and_its_vocabulary(self):
        self.booking(self.slot(self.alice, date(2026, 9, 2)), self.students[0],
                     status=SupportBooking.STATUS_HELD, topic="Reading", settled_by=self.alice)
        body = self.as_admin().get(SESSIONS_URL).json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["topic"], "Reading")
        self.assertEqual(body["results"][0]["status_label"], "Held")
        labels = {s["value"]: s["label"] for s in body["statuses"]}
        self.assertEqual(labels["NO_SHOW"], "Did not attend")
        self.assertIn("UNSETTLED", labels)

    def test_sessions_refuses_a_date_it_cannot_read(self):
        """Never ignored. Dropping an unreadable ``from=`` would answer a request for one
        week with the whole history and look like a correct answer."""
        response = self.as_admin().get(SESSIONS_URL, {"from": "last tuesday"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("2026-09-01", response.json()["detail"])

    def test_sessions_refuses_a_backwards_range(self):
        response = self.as_admin().get(
            SESSIONS_URL, {"from": "2026-09-10", "to": "2026-09-01"}
        )
        self.assertEqual(response.status_code, 400)

    def test_sessions_refuses_an_unknown_status(self):
        self.assertEqual(
            self.as_admin().get(SESSIONS_URL, {"status": "MAYBE"}).status_code, 400
        )

    def test_monthly_defaults_to_the_current_month_and_lists_the_picker(self):
        body = self.as_admin().get(MONTHLY_URL).json()
        self.assertEqual(body["month"], support_report.current_month())
        self.assertIn(body["month"], body["months"])
        self.assertLessEqual(max(body["months"]), support_report.current_month())

    def test_monthly_refuses_a_month_that_is_not_a_month(self):
        response = self.as_admin().get(MONTHLY_URL, {"month": "2026-13"})
        self.assertEqual(response.status_code, 400)

    def test_monthly_carries_the_backlog_and_the_labels(self):
        self.booking(self.slot(self.alice, date(2026, 8, 13)), self.students[0])
        body = self.as_admin().get(MONTHLY_URL, {"month": "2026-09"}).json()
        self.assertEqual(body["backlog"]["unsettled"], 1)
        self.assertIsNotNone(body["backlog"]["oldest"])
        self.assertEqual(body["status_labels"]["NO_SHOW"], "Did not attend")

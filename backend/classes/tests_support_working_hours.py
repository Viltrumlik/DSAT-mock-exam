"""The standing weekly schedule: does it govern the calendar, and does it govern the POST.

The bug this feature answers was not that the old grid was ugly. It was that the only way to
express "I work 10–4 on Wednesdays" was to click hours on a rolling four-day window, forever —
so nobody did, and the desk ran on an 08:00–18:00 default nobody had agreed to.

Two properties matter more than the CRUD and are tested hardest:

  * **A teacher nobody has configured must not disappear.** No rows means the old behaviour,
    not an empty calendar. Getting this wrong empties every support calendar in the school on
    deploy day and the symptom is "support is broken", with nothing in the logs.
  * **The schedule is enforced on the write path, not just painted on the read path.** The
    booking endpoint takes a teacher id and a timestamp from the client; a rendered "off" that
    a POST ignores is decoration.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes import support as support_service
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability, SupportBooking, SupportWorkingHours

User = get_user_model()


def _next_weekday(weekday: int, *, after=None):
    """The next local date falling on ``weekday``, never today.

    Never today on purpose: "today" may already be past the hour under test, and a slot in the
    past is refused for a reason that has nothing to do with the schedule — which would make
    this suite pass for the wrong reason on some days of the week and some times of day.
    """
    day = timezone.localdate(after or timezone.now()) + timedelta(days=1)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


class SupportWorkingHoursBase(TestCase):
    def setUp(self):
        # `APIClient`, not the default Django test client: DRF does not pick the session up
        # from the plain client here and answers every request 401, which would make the
        # endpoint tests below fail for a reason that has nothing to do with the endpoint.
        # Matches how the other support suites in this app are set up.
        self.client = APIClient()
        self.support = User.objects.create_user(
            username="sup", email="sup@example.com", password="x",
            role=acc_const.ROLE_SUPPORT_TEACHER, subject="both",
        )
        self.student = User.objects.create_user(
            username="stu", email="stu@example.com", password="x",
            role=acc_const.ROLE_STUDENT,
        )
        self.admin = User.objects.create_user(
            username="adm", email="adm@example.com", password="x",
            role=acc_const.ROLE_SUPER_ADMIN, is_superuser=True,
        )
        self.classroom = Classroom.objects.create(
            name="Math A", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.support,
            role=ClassroomMembership.ROLE_TA, status=ClassroomMembership.STATUS_ACTIVE,
        )

    def set_schedule(self, **per_weekday):
        """`set_schedule(mon=(9, 12), tue=None)` — a tuple opens the day, None closes it.

        Days not named are written as NOT working, because a real save always writes all seven
        and the partial state is not one the UI can produce.
        """
        names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        days = []
        for i, name in enumerate(names):
            window = per_weekday.get(name)
            days.append({
                "weekday": i,
                "is_working": window is not None,
                "start_hour": window[0] if window else 8,
                "end_hour": window[1] if window else 18,
            })
        return support_service.write_weekly_schedule(self.support, days)

    def hour_state(self, day, hour: int) -> str:
        """What the STUDENT's calendar says about one hour of one day."""
        for entry in support_service.open_calendar_for(self.student):
            if entry["teacher"].id != self.support.id:
                continue
            for d in entry["days"]:
                if d["date"] != day:
                    continue
                for h in d["hours"]:
                    if timezone.localtime(h["starts_at"]).hour == hour:
                        return h["state"]
        return "absent"


class UnconfiguredTeacherKeepsWorking(SupportWorkingHoursBase):
    """No rows must mean "as before", never "closed"."""

    def test_no_rows_leaves_every_hour_open(self):
        self.assertEqual(SupportWorkingHours.objects.count(), 0)
        day = _next_weekday(2)  # a Wednesday, arbitrarily
        self.assertEqual(self.hour_state(day, 9), "open")
        self.assertEqual(self.hour_state(day, 17), "open")

    def test_no_rows_still_allows_booking(self):
        day = _next_weekday(2)
        starts_at = support_service._hour_start(day, 10)
        booking = support_service.book_at(self.student, self.support, starts_at)
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)

    def test_read_reports_defaults_and_says_they_are_defaults(self):
        days, configured = support_service.read_weekly_schedule(self.support)
        self.assertFalse(configured)
        self.assertEqual(len(days), 7)
        self.assertTrue(all(d["is_working"] for d in days))
        self.assertTrue(all(d["start_hour"] == 8 and d["end_hour"] == 18 for d in days))


class ScheduleGovernsTheStudentCalendar(SupportWorkingHoursBase):
    def test_hours_outside_the_window_read_off_not_closed(self):
        self.set_schedule(wed=(10, 14))
        day = _next_weekday(2)
        self.assertEqual(self.hour_state(day, 9), "off")
        self.assertEqual(self.hour_state(day, 10), "open")
        self.assertEqual(self.hour_state(day, 13), "open")
        # end_hour is EXCLUSIVE — 14:00 is when the last session ENDS.
        self.assertEqual(self.hour_state(day, 14), "off")

    def test_a_non_working_weekday_is_off_all_day(self):
        self.set_schedule(wed=(10, 14))
        thursday = _next_weekday(3)
        self.assertTrue(all(
            self.hour_state(thursday, h) == "off" for h in range(8, 18)
        ))

    def test_off_is_distinct_from_a_withdrawn_hour(self):
        """A teacher who withdrew an hour and one who never worked it are different facts,
        and the student is owed the difference: one reads "he cancelled", the other "he's
        not in"."""
        self.set_schedule(wed=(8, 18))
        day = _next_weekday(2)
        SupportAvailability.objects.create(
            support_teacher=self.support,
            starts_at=support_service._hour_start(day, 11),
            ends_at=support_service._hour_start(day, 12),
            capacity=1, is_cancelled=True,
        )
        self.assertEqual(self.hour_state(day, 11), "closed")

    def test_a_configured_teacher_with_a_missing_weekday_fails_closed(self):
        """A half-written schedule must not open a day nobody chose. Written by hand — the
        UI always saves seven — because failing OPEN here puts a student in front of an
        empty desk."""
        SupportWorkingHours.objects.create(
            support_teacher=self.support, weekday=2, is_working=True,
            start_hour=9, end_hour=15,
        )
        self.assertEqual(self.hour_state(_next_weekday(2), 10), "open")
        self.assertEqual(self.hour_state(_next_weekday(3), 10), "off")


class ScheduleIsEnforcedOnTheWritePath(SupportWorkingHoursBase):
    """The read path painting "off" is worth nothing if the POST still accepts the hour."""

    def test_booking_outside_working_hours_is_refused(self):
        self.set_schedule(wed=(10, 14))
        day = _next_weekday(2)
        with self.assertRaises(ValidationError):
            support_service.book_at(
                self.student, self.support, support_service._hour_start(day, 9)
            )

    def test_booking_on_a_non_working_day_is_refused(self):
        self.set_schedule(wed=(10, 14))
        with self.assertRaises(ValidationError):
            support_service.book_at(
                self.student, self.support,
                support_service._hour_start(_next_weekday(3), 11),
            )

    def test_booking_inside_working_hours_still_works(self):
        self.set_schedule(wed=(10, 14))
        booking = support_service.book_at(
            self.student, self.support,
            support_service._hour_start(_next_weekday(2), 11),
        )
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)

    def test_a_refused_booking_leaves_no_availability_row_behind(self):
        """`book_at` is one transaction precisely so a refusal does not litter the teacher's
        calendar with rows they never published and cannot see."""
        self.set_schedule(wed=(10, 14))
        before = SupportAvailability.objects.count()
        with self.assertRaises(ValidationError):
            support_service.book_at(
                self.student, self.support,
                support_service._hour_start(_next_weekday(2), 16),
            )
        self.assertEqual(SupportAvailability.objects.count(), before)


class ExistingBookingsSurviveAScheduleChange(SupportWorkingHoursBase):
    def test_narrowing_the_week_does_not_cancel_or_hide_a_booking(self):
        day = _next_weekday(2)
        booking = support_service.book_at(
            self.student, self.support, support_service._hour_start(day, 9)
        )
        self.set_schedule(wed=(10, 14))   # 09:00 is now outside the schedule

        booking.refresh_from_db()
        self.assertEqual(booking.status, SupportBooking.STATUS_BOOKED)
        # The student still sees their own appointment; "mine" outranks "off".
        self.assertEqual(self.hour_state(day, 9), "mine")

    def test_the_clash_is_reported_so_a_human_can_act_on_it(self):
        day = _next_weekday(2)
        support_service.book_at(
            self.student, self.support, support_service._hour_start(day, 9)
        )
        self.set_schedule(wed=(10, 14))
        clashes = support_service.bookings_outside_schedule(self.support)
        self.assertEqual(len(clashes), 1)
        self.assertEqual(clashes[0].student_id, self.student.id)

    def test_a_booking_inside_the_new_schedule_is_not_reported(self):
        day = _next_weekday(2)
        support_service.book_at(
            self.student, self.support, support_service._hour_start(day, 11)
        )
        self.set_schedule(wed=(10, 14))
        self.assertEqual(support_service.bookings_outside_schedule(self.support), [])


class WriteValidation(SupportWorkingHoursBase):
    def test_end_before_start_is_refused(self):
        with self.assertRaises(ValidationError):
            support_service.write_weekly_schedule(
                self.support,
                [{"weekday": 0, "is_working": True, "start_hour": 15, "end_hour": 9}],
            )

    def test_equal_start_and_end_is_refused(self):
        """A zero-length day would store as valid and silently never be bookable."""
        with self.assertRaises(ValidationError):
            support_service.write_weekly_schedule(
                self.support,
                [{"weekday": 0, "is_working": True, "start_hour": 9, "end_hour": 9}],
            )

    def test_a_second_save_replaces_rather_than_accumulates(self):
        self.set_schedule(mon=(9, 12), tue=(9, 12))
        self.set_schedule(mon=(10, 11))
        rows = SupportWorkingHours.objects.filter(support_teacher=self.support)
        self.assertEqual(rows.count(), 7)
        monday = rows.get(weekday=0)
        self.assertEqual((monday.start_hour, monday.end_hour), (10, 11))
        self.assertFalse(rows.get(weekday=1).is_working)

    def test_days_omitted_entirely_are_deleted(self):
        self.set_schedule(mon=(9, 12))
        support_service.write_weekly_schedule(
            self.support,
            [{"weekday": 0, "is_working": True, "start_hour": 9, "end_hour": 12}],
        )
        self.assertEqual(
            list(
                SupportWorkingHours.objects
                .filter(support_teacher=self.support)
                .values_list("weekday", flat=True)
            ),
            [0],
        )

    def test_an_empty_schedule_is_refused(self):
        with self.assertRaises(ValidationError):
            support_service.write_weekly_schedule(self.support, [])

    def test_switching_a_day_off_keeps_the_hours_it_had(self):
        """So that switching it back on restores what the teacher chose rather than the
        platform default."""
        self.set_schedule(mon=(10, 15))
        self.set_schedule()  # every day off
        monday = SupportWorkingHours.objects.get(support_teacher=self.support, weekday=0)
        self.assertFalse(monday.is_working)
        self.assertEqual((monday.start_hour, monday.end_hour), (8, 18))


class WorkingHoursEndpoint(SupportWorkingHoursBase):
    """`force_authenticate`, matching AdminSetsHoursTests next door.

    Not `force_login`: DRF answers a session-logged client 401 here, so every test in this
    class failed for a reason that had nothing to do with the endpoint. The sibling suite
    reaches for `force_login` only where the thing under test is Django MIDDLEWARE, which has
    already run by the time DRF attaches a user — that is not what these check.
    """

    url = "/api/classes/support/working-hours/"

    def test_teacher_reads_their_own(self):
        self.client.force_authenticate(self.support)
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()["days"]), 7)
        self.assertFalse(res.json()["configured"])

    def test_admin_reads_somebody_elses(self):
        self.client.force_authenticate(self.admin)
        res = self.client.get(self.url, {"support_teacher": self.support.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["support_teacher"]["id"], self.support.id)

    def test_admin_saves_somebody_elses(self):
        self.client.force_authenticate(self.admin)
        res = self.client.put(
            self.url,
            data={
                "support_teacher": self.support.id,
                "days": [
                    {"weekday": i, "is_working": i == 2, "start_hour": 10, "end_hour": 14}
                    for i in range(7)
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["configured"])
        row = SupportWorkingHours.objects.get(support_teacher=self.support, weekday=2)
        self.assertTrue(row.is_working)
        self.assertEqual((row.start_hour, row.end_hour), (10, 14))

    def test_a_student_is_refused(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_a_teacher_cannot_edit_another_teachers_hours(self):
        other = User.objects.create_user(
            username="sup2", email="sup2@example.com", password="x",
            role=acc_const.ROLE_SUPPORT_TEACHER, subject="both",
        )
        self.client.force_authenticate(self.support)
        res = self.client.put(
            self.url,
            data={
                "support_teacher": other.id,
                "days": [{"weekday": 0, "is_working": True, "start_hour": 9, "end_hour": 12}],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(
            SupportWorkingHours.objects.filter(support_teacher=other).count(), 0
        )

    def test_a_bad_window_is_a_400_with_the_day_named(self):
        self.client.force_authenticate(self.support)
        res = self.client.put(
            self.url,
            data={"days": [
                {"weekday": 0, "is_working": True, "start_hour": 15, "end_hour": 9}
            ]},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Monday", res.json()["detail"])

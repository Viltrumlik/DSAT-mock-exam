"""Registers open themselves on lesson days; teachers do not create them.

Every date here is fixed and passed in as ``now`` rather than read from the clock — a test
that computes "last Wednesday" from ``timezone.now()`` passes on Tuesday and fails on
Thursday, and a scheduling feature is exactly where that bites.

2026-06-01 is a Monday, so an ODD class (Mon/Wed/Fri) meets on the 1st, 3rd and 5th, and an
EVEN class (Tue/Thu/Sat) on the 2nd, 4th and 6th.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import attendance_auto
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceSession

User = get_user_model()

MONDAY = date(2026, 6, 1)


def at(day: date, hour: int, minute: int = 0):
    """An aware datetime in the school's timezone."""
    return timezone.make_aware(
        datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute),
        timezone.get_current_timezone(),
    )


class AutoSessionFixture(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("auto_owner@t.com", "secret123", role=C.ROLE_ADMIN)
        self.classroom = self.make_class()

    def make_class(self, *, lesson_days=Classroom.DAYS_ODD, lesson_time="09:00", start_date=MONDAY):
        # start_date is set by default and matters: the backfill is floored at the day the
        # class began, so without it these fixtures would reach back before the term.
        classroom = Classroom.objects.create(
            name="Auto", subject=Classroom.SUBJECT_MATH, lesson_days=lesson_days,
            lesson_time=lesson_time, start_date=start_date, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        return classroom

    def dates(self, classroom=None, **kw):
        return attendance_auto.due_lesson_dates(classroom or self.classroom, **kw)


class DueLessonDatesTests(AutoSessionFixture):
    def test_a_lesson_that_has_started_is_due(self):
        # Monday 09:30 — the 09:00 lesson began half an hour ago.
        self.assertEqual(self.dates(now=at(MONDAY, 9, 30)), [MONDAY])

    def test_a_lesson_that_has_not_started_yet_is_not(self):
        """A register for a room that is still empty invites a teacher to guess."""
        self.assertEqual(self.dates(now=at(MONDAY, 8, 59)), [])

    def test_the_boundary_belongs_to_the_lesson(self):
        self.assertEqual(self.dates(now=at(MONDAY, 9, 0)), [MONDAY])

    def test_a_day_the_class_does_not_meet_is_never_due(self):
        # Tuesday: an ODD class does not meet. Monday is still due from the backfill.
        self.assertEqual(self.dates(now=at(MONDAY + timedelta(days=1), 12)), [MONDAY])

    def test_missed_lesson_days_are_backfilled(self):
        # Friday lunchtime, nobody has opened the page all week.
        self.assertEqual(
            self.dates(now=at(MONDAY + timedelta(days=4), 12)),
            [MONDAY, MONDAY + timedelta(days=2), MONDAY + timedelta(days=4)],
        )

    def test_the_backfill_window_is_bounded(self):
        """Turning this on must not mint a term of empty drafts for an old class."""
        far = at(MONDAY + timedelta(days=200), 12)
        due = self.dates(now=far)
        self.assertTrue(due)
        self.assertGreaterEqual(
            min(due), timezone.localdate(far) - timedelta(days=attendance_auto.BACKFILL_DAYS)
        )

    def test_nothing_is_due_before_the_class_started(self):
        later = self.make_class(start_date=MONDAY + timedelta(days=4))
        due = self.dates(later, now=at(MONDAY + timedelta(days=4), 12))
        self.assertEqual(due, [MONDAY + timedelta(days=4)])

    def test_a_class_with_no_start_date_is_floored_at_its_creation(self):
        """Switching this on must not hand every old classroom a fortnight of registers for
        lessons that never happened."""
        undated = self.make_class(start_date=None)
        # created_at is the real clock, so nothing dated 2026-06-01 can predate it.
        self.assertEqual(self.dates(undated, now=at(MONDAY, 12)), [])

    def test_an_unreadable_lesson_time_still_yields_the_lesson_day(self):
        """The day is the part we are sure of; only the hour is lost."""
        vague = self.make_class(lesson_time="")
        self.assertEqual(self.dates(vague, now=at(MONDAY, 0, 1)), [MONDAY])

    def test_an_unreadable_lesson_days_yields_nothing(self):
        broken = self.make_class(lesson_days="WHENEVER")
        self.assertEqual(self.dates(broken, now=at(MONDAY, 12)), [])
        self.assertFalse(attendance_auto.schedule_is_usable(broken))

    def test_an_even_class_meets_on_the_other_days(self):
        even = self.make_class(lesson_days=Classroom.DAYS_EVEN)
        self.assertEqual(
            self.dates(even, now=at(MONDAY + timedelta(days=3), 12)),
            [MONDAY + timedelta(days=1), MONDAY + timedelta(days=3)],
        )


class EnsureSessionsTests(AutoSessionFixture):
    def test_it_creates_the_register(self):
        created = attendance_auto.ensure_sessions(self.classroom, now=at(MONDAY, 12))
        self.assertEqual([s.date for s in created], [MONDAY])
        self.assertTrue(
            AttendanceSession.objects.filter(classroom=self.classroom, date=MONDAY).exists()
        )

    def test_it_is_idempotent(self):
        attendance_auto.ensure_sessions(self.classroom, now=at(MONDAY, 12))
        again = attendance_auto.ensure_sessions(self.classroom, now=at(MONDAY, 13))
        self.assertEqual(again, [])
        self.assertEqual(AttendanceSession.objects.filter(classroom=self.classroom).count(), 1)

    def test_it_leaves_a_session_a_teacher_already_marked_alone(self):
        existing = AttendanceSession.objects.create(
            classroom=self.classroom, date=MONDAY,
            status=AttendanceSession.STATUS_FINALIZED, created_by=self.owner,
        )
        attendance_auto.ensure_sessions(self.classroom, now=at(MONDAY, 12))
        existing.refresh_from_db()
        # Re-materialising over a finalized session would reopen a lesson that has already
        # been paid out.
        self.assertEqual(existing.status, AttendanceSession.STATUS_FINALIZED)
        self.assertEqual(AttendanceSession.objects.filter(classroom=self.classroom).count(), 1)

    def test_an_auto_session_has_no_author_and_no_title(self):
        [session] = attendance_auto.ensure_sessions(self.classroom, now=at(MONDAY, 12))
        self.assertIsNone(session.created_by)
        self.assertEqual(session.title, "")

    def test_a_class_with_no_lesson_days_gets_nothing(self):
        broken = self.make_class(lesson_days="WHENEVER")
        self.assertEqual(attendance_auto.ensure_sessions(broken, now=at(MONDAY, 12)), [])


class SessionsEndpointTests(AutoSessionFixture):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def url(self, classroom=None):
        return f"/api/classes/{(classroom or self.classroom).id}/attendance/sessions/"

    def test_listing_opens_the_register_for_a_lesson_that_has_started(self):
        # Materialisation runs on read as well as from cron, so a school with no scheduler
        # still gets today's register when the teacher opens the page. This one runs against
        # the real clock on purpose — it is the path a teacher actually takes. An ODD class
        # meets three times a week, so a 14-day window always contains a started lesson.
        self.assertEqual(AttendanceSession.objects.count(), 0)
        body = self.client.get(self.url()).json()
        self.assertGreater(len(body["sessions"]), 0)
        self.assertEqual(len(body["sessions"]), AttendanceSession.objects.count())
        self.assertTrue(body["schedule_is_usable"])
        self.assertTrue(all(s["title"] == "" for s in body["sessions"]))

    def test_listing_twice_does_not_duplicate(self):
        self.client.get(self.url())
        before = AttendanceSession.objects.count()
        self.client.get(self.url())
        self.assertEqual(AttendanceSession.objects.count(), before)

    def test_a_broken_schedule_says_so_rather_than_looking_empty(self):
        broken = self.make_class(lesson_days="WHENEVER")
        body = self.client.get(self.url(broken)).json()
        self.assertEqual(body["sessions"], [])
        # The UI keys the manual escape hatch on this. Without it the page is an empty list
        # that reads as "no lessons yet" for a class that can never open one.
        self.assertFalse(body["schedule_is_usable"])

    def test_a_teacher_can_still_add_a_day_by_hand(self):
        broken = self.make_class(lesson_days="WHENEVER")
        r = self.client.post(self.url(broken), {"date": "2026-06-01"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["date"], "2026-06-01")

    def test_a_title_sent_by_an_old_client_is_ignored(self):
        r = self.client.post(
            self.url(), {"date": "2026-06-03", "title": "Week 2 revision"}, format="json"
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["title"], "")

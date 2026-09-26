"""Registers open themselves on lesson days; teachers do not create them.

Every date here is fixed and passed in as ``now`` rather than read from the clock — a test
that computes "last Wednesday" from ``timezone.now()`` passes on Tuesday and fails on
Thursday, and a scheduling feature is exactly where that bites.

2026-06-01 is a Monday, so an ODD class (Mon/Wed/Fri) meets on the 1st, 3rd and 5th, and an
EVEN class (Tue/Thu/Sat) on the 2nd, 4th and 6th.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import attendance_auto
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceSession
from classes.tasks import open_todays_attendance_registers

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

    def make_class(
        self, *, lesson_days=Classroom.DAYS_ODD, lesson_time="09:00", start_date=MONDAY,
        with_student=True,
    ):
        # start_date is set by default and matters: the backfill is floored at the day the
        # class began, so without it these fixtures would reach back before the term.
        classroom = Classroom.objects.create(
            name="Auto", subject=Classroom.SUBJECT_MATH, lesson_days=lesson_days,
            lesson_time=lesson_time, start_date=start_date, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        # A class the sweep will reach has somebody in the room: it opens registers only for
        # classes with at least one ACTIVE STUDENT, because an empty one has no attendance to
        # take. ``with_student=False`` is the finished-but-unarchived course.
        if with_student:
            student = User.objects.create_user(
                f"auto_student{classroom.pk}@t.com", "secret123", role=C.ROLE_STUDENT
            )
            ClassroomMembership.objects.create(
                classroom=classroom, user=student, role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
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


class OpenTodaysRegistersTaskTests(AutoSessionFixture):
    """The beat sweep, as opposed to the read path: the register is there before the tab is.

    ``ensure_sessions`` is covered above; what is tested here is the sweep around it — which
    classes it reaches, which it leaves alone, and that neither a second run nor one broken
    classroom costs anything.
    """

    def setUp(self):
        super().setUp()
        # Beat hands the task no ``now``, so the task reads the clock itself and there is
        # nothing to inject. Freeze the clock instead, onto the same fixed Monday the rest of
        # this file uses — computing "today" from the real date would make this suite pass on
        # Monday and fail on Sunday, when no classroom meets at all.
        patcher = mock.patch("django.utils.timezone.now", return_value=at(MONDAY, 12))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_it_opens_todays_register_before_anybody_opens_the_page(self):
        self.assertEqual(AttendanceSession.objects.count(), 0)

        stats = open_todays_attendance_registers()

        self.assertEqual(stats["opened"], 1)
        self.assertEqual(stats["failed"], 0)
        session = AttendanceSession.objects.get(classroom=self.classroom)
        self.assertEqual(session.date, MONDAY)
        # Nobody created it. The lesson did.
        self.assertIsNone(session.created_by)

    def test_a_class_that_does_not_meet_today_gets_no_register(self):
        # EVEN is Tue/Thu/Sat; the frozen day is a Monday.
        even = self.make_class(lesson_days=Classroom.DAYS_EVEN)

        open_todays_attendance_registers()

        self.assertFalse(AttendanceSession.objects.filter(classroom=even).exists())
        self.assertTrue(AttendanceSession.objects.filter(classroom=self.classroom).exists())

    def test_an_archived_class_gets_no_register(self):
        archived = self.make_class()
        archived.is_active = False
        archived.save(update_fields=["is_active"])

        stats = open_todays_attendance_registers()

        self.assertEqual(stats["opened"], 1)
        self.assertFalse(AttendanceSession.objects.filter(classroom=archived).exists())

    def test_running_it_again_opens_nothing_and_duplicates_nothing(self):
        first = open_todays_attendance_registers()
        second = open_todays_attendance_registers()

        self.assertEqual(first["opened"], 1)
        self.assertEqual(second["opened"], 0)
        self.assertEqual(AttendanceSession.objects.count(), 1)

    def test_one_broken_classroom_does_not_stop_the_sweep(self):
        self.make_class()
        real = attendance_auto.ensure_sessions
        calls = {"n": 0}

        def _explode_once(classroom, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("bad data")
            return real(classroom, **kw)

        with mock.patch("classes.attendance_auto.ensure_sessions", side_effect=_explode_once):
            stats = open_todays_attendance_registers()

        # The failure is counted into the summary, not swallowed into silence: a sweep that
        # opened nothing because every classroom threw must not read like a quiet day.
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(stats["opened"], 1)

    def test_a_lesson_that_has_not_started_yet_is_not_opened(self):
        """Why the beat entry sweeps all day instead of running once before dawn.

        A register opens when its lesson starts. At 05:00 there is nothing due for a class
        that meets at 09:00 — let alone the 14:00 ones — so an early-morning-only entry would
        open no register on any day.
        """
        with mock.patch("django.utils.timezone.now", return_value=at(MONDAY, 5)):
            stats = open_todays_attendance_registers()

        self.assertEqual(stats["opened"], 0)
        self.assertEqual(AttendanceSession.objects.count(), 0)

    def test_the_sweep_does_not_backfill_a_register_nobody_could_write(self):
        """Tuesday is the day the sweep's ``backfill_days=0`` can be seen at all.

        An ODD class does not meet on a Tuesday, so with ``backfill_days=0`` this run has
        nothing due and opens nothing. With the module default of one day it reaches back to
        MONDAY — a lesson day whose marking window shut two hours after the lesson ended, so
        the register it would mint is a draft nobody below global admin could ever write in.

        Wednesday cannot show the difference: a one-day window from Wednesday reaches only
        Tuesday, which is not a lesson day either, so the assertion held whichever value
        ``tasks.py`` passed — deleting ``backfill_days=0`` left that test green.
        """
        tuesday = MONDAY + timedelta(days=1)

        with mock.patch("django.utils.timezone.now", return_value=at(tuesday, 12)):
            stats = open_todays_attendance_registers()

        self.assertEqual(stats["opened"], 0)
        self.assertFalse(AttendanceSession.objects.filter(classroom=self.classroom).exists())

    def test_a_later_lesson_day_opens_that_day_and_no_earlier_one(self):
        """The other half: on a lesson day exactly one register opens, dated today.

        This one cannot distinguish 0 from the one-day default — Tuesday above is what does
        that — but it does catch a window widened to reach Monday's closed lesson.
        """
        wednesday = MONDAY + timedelta(days=2)

        with mock.patch("django.utils.timezone.now", return_value=at(wednesday, 12)):
            open_todays_attendance_registers()

        self.assertEqual(
            list(
                AttendanceSession.objects.filter(classroom=self.classroom)
                .values_list("date", flat=True)
            ),
            [wednesday],
        )

    def test_a_class_with_no_active_students_gets_no_register(self):
        """A course that finished and was never archived must not collect empty drafts.

        Nothing scores off them, but the Attendance tab orders ``-date``, so one per lesson
        day for ever buries every register that can still be marked.
        """
        finished = self.make_class(with_student=False)

        stats = open_todays_attendance_registers()

        self.assertFalse(AttendanceSession.objects.filter(classroom=finished).exists())
        # Not even looked at: the summary's own count says how many classes the sweep reached.
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["opened"], 1)
        self.assertTrue(AttendanceSession.objects.filter(classroom=self.classroom).exists())

    def test_a_class_with_an_unreadable_schedule_is_counted_rather_than_guessed_at(self):
        # Its teacher still has the manual escape hatch; what it must not have is a silently
        # empty Attendance tab that nobody can explain.
        self.make_class(lesson_days="WHENEVER")

        stats = open_todays_attendance_registers()

        self.assertEqual(stats["no_schedule"], 1)
        self.assertEqual(stats["opened"], 1)

    def test_the_beat_entry_names_a_task_the_worker_can_resolve(self):
        """A beat entry is dispatched by NAME. A name the worker cannot resolve fires nothing,
        for ever, without an error anywhere — which is how this routine sat unscheduled."""
        from celery import current_app
        from django.conf import settings

        entry = settings.CELERY_BEAT_SCHEDULE["classroom-open-attendance-registers"]
        current_app.loader.import_default_modules()

        self.assertEqual(entry["task"], open_todays_attendance_registers.name)
        self.assertIn(entry["task"], current_app.tasks)

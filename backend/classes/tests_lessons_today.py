"""The ops Today board's "Lessons today" (plan PR4-lessons-today): which classes meet on a day, who teaches
them, and what their registers say.

2026-11-09 is a Monday, so an ODD class (Mon/Wed/Fri) meets on it and an EVEN class (Tue/Thu/Sat) meets
on the 10th. Every time is passed in as ``now`` (or the clock is patched for the view), never read from
the real clock, so nothing here depends on when the suite runs.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from unittest import mock

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.attendance_window import marking_window
from classes.lessons_today import lessons_today
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.models_org import Branch, Region
from lcup.followups import _meeting_classes, lesson_check
from lcup.guards import lcup_managed_ids
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink, LinkStatus
from users.models import User

URL = "/api/classes/admin/lessons/today/"
HOST = "admin.mastersat.uz"
STUDENT = ClassroomMembership.ROLE_STUDENT

SUNDAY = date(2026, 11, 8)
MONDAY = date(2026, 11, 9)
TUESDAY = date(2026, 11, 10)
#: Seats are taken well before Monday, so the register's own rule never hides a student by accident.
SEATED_AT = datetime(2026, 9, 1, 9, 0)

LCUP_ON = {"LCUP_ENABLED": True, "LCUP_ATTENDANCE_PULL_ENABLED": True, "LCUP_ATTENDANCE_PUSH_ENABLED": True}


def at(day: date, hour: int, minute: int = 0) -> datetime:
    """An aware datetime in the school's timezone."""
    return timezone.make_aware(datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute))


def iso(day: date, hour: int, minute: int = 0) -> str:
    return at(day, hour, minute).isoformat()


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class LessonsFixture(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("vali", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self._users = 0
        self._lcup_ids = iter(range(5001, 5999))

    def room(self, name, days="ODD", time="14:00-16:00", **extra):
        extra.setdefault("teacher", self.teacher)
        return Classroom.objects.create(
            name=name, subject="MATH", lesson_days=days, lesson_time=time, created_by=self.teacher, **extra
        )

    def seat(self, room, user=None, *, joined=SEATED_AT, **extra):
        self._users += 1
        user = user or make(f"student{self._users}", first_name="Student", last_name=str(self._users))
        row = ClassroomMembership.objects.create(classroom=room, user=user, role=STUDENT, **extra)
        ClassroomMembership.objects.filter(pk=row.pk).update(joined_at=timezone.make_aware(joined))
        return user

    def mark(self, room, user, status, day=MONDAY):
        session, _ = AttendanceSession.objects.get_or_create(
            classroom=room, date=day, defaults={"created_by": self.teacher}
        )
        AttendanceRecord.objects.create(session=session, student=user, status=status)

    def pair(self, room, **extra):
        return LcupGroupLink.objects.create(
            lcup_group_id=next(self._lcup_ids), name=f"{room.name} | lc-up", classroom=room,
            status=extra.pop("status", GroupLinkStatus.CONFIRMED), **extra,
        )

    def lcup_frozen(self, link, user):
        student = LcupStudentLink.objects.create(
            lcup_student_id=next(self._lcup_ids), name=user.username, user=user, status=LinkStatus.CONFIRMED
        )
        return LcupMembership.objects.create(group=link, student=student, lcup_status="frozen")

    def body(self, day=MONDAY, now=None):
        return lessons_today(day, now=now or at(day, 12))

    def ids(self, day=MONDAY, now=None):
        return [row["classroom"]["id"] for row in self.body(day, now)["lessons"]]

    def row(self, room, day=MONDAY, now=None):
        return next(r for r in self.body(day, now)["lessons"] if r["classroom"]["id"] == room.pk)

    def get(self, user=None, **params):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api.get(URL, params, HTTP_HOST=HOST)


class SelectionTests(LessonsFixture):
    def test_an_odd_class_meets_on_monday_and_an_even_class_on_tuesday(self):
        odd, even = self.room("Odd"), self.room("Even", days="EVEN")
        self.assertEqual(self.ids(MONDAY), [odd.pk])
        self.assertEqual(self.ids(TUESDAY), [even.pk])
        self.assertEqual(self.ids(SUNDAY), [])

    @override_settings(LCUP_ENABLED=True)
    def test_every_active_class_meets_not_only_the_paired_ones(self):
        paired, unpaired = self.room("Paired"), self.room("Unpaired", time="16:00")
        self.pair(paired)
        self.assertEqual(self.ids(), [paired.pk, unpaired.pk])

    def test_a_class_that_has_not_begun_is_left_out(self):
        later = self.room("Later", start_date=MONDAY + timedelta(days=2))
        today = self.room("Begins today", start_date=MONDAY)
        running = self.room("Running", start_date=MONDAY - timedelta(days=60))
        undated = self.room("Undated")
        self.assertEqual(set(self.ids()), {today.pk, running.pk, undated.pk})
        self.assertNotIn(later.pk, self.ids())

    def test_a_class_moved_up_a_level_still_meets_before_its_new_course(self):
        moved = self.room("Moved up", start_date=MONDAY + timedelta(days=3))
        AttendanceSession.objects.create(classroom=moved, date=MONDAY - timedelta(days=3), created_by=self.teacher)
        self.room("Never met", start_date=MONDAY + timedelta(days=3))
        self.assertEqual(self.ids(), [moved.pk])

    def test_an_inactive_class_is_left_out(self):
        active, archived = self.room("Active"), self.room("Archived", is_active=False)
        self.assertEqual(self.ids(), [active.pk])
        self.assertNotIn(archived.pk, self.ids())

    def test_an_unreadable_time_is_listed_as_unknown_and_last(self):
        garbage = self.room("Garbage", time="whenever")
        blank = self.room("Blank", time="")
        timed = self.room("Timed", time="18:00")
        early = self.room("Early", time="09:00")
        for room in (garbage, blank):
            self.seat(room)
        body = self.body(now=at(MONDAY, 23))
        self.assertEqual([r["classroom"]["id"] for r in body["lessons"]], [early.pk, timed.pk, blank.pk, garbage.pk])
        row = body["lessons"][2]
        self.assertEqual((row["starts_at"], row["ends_at"], row["phase"]), (None, None, "unknown"))
        # The register degrades to its own calendar day (attendance_window), so it is still open at 23:00 …
        self.assertEqual(row["register"]["state"], "open")
        self.assertEqual(row["register"]["closes_at"], iso(MONDAY + timedelta(days=1), 0))
        self.assertFalse(row["register"]["taken"])
        # … but with no end to the lesson nobody can say it is over, so it is never "not marked".
        self.assertEqual(body["counts"]["not_marked"], 0)


class PhaseTests(LessonsFixture):
    def test_the_phase_and_the_register_at_each_point_of_the_day(self):
        room = self.room("G21 Math", time="14:00-16:00")
        cases = [
            ((13, 59), "upcoming", "not_yet"),
            ((14, 0), "now", "open"),
            ((15, 30), "now", "open"),
            ((16, 0), "ended", "open"),
            ((18, 0), "ended", "open"),
            ((18, 1), "ended", "closed"),
        ]
        for (hour, minute), phase, state in cases:
            with self.subTest(at=f"{hour:02}:{minute:02}"):
                row = self.row(room, now=at(MONDAY, hour, minute))
                self.assertEqual((row["phase"], row["register"]["state"]), (phase, state))
        row = self.row(room)
        self.assertEqual(row["starts_at"], iso(MONDAY, 14))
        self.assertEqual(row["ends_at"], iso(MONDAY, 16))
        self.assertEqual(row["register"]["closes_at"], iso(MONDAY, 18))
        self.assertTrue(row["starts_at"].endswith("+05:00"))

    def test_a_bare_start_runs_the_default_two_hours(self):
        row = self.row(self.room("Bare", time="10:30"), now=at(MONDAY, 12, 29))
        self.assertEqual((row["ends_at"], row["phase"]), (iso(MONDAY, 12, 30), "now"))

    def test_the_view_reads_todays_date_and_time_from_the_clock(self):
        self.room("G21 Math", time="14:00-16:00")
        self.room("Tuesday class", days="EVEN")
        with mock.patch("django.utils.timezone.now", return_value=at(MONDAY, 15)):
            r = self.get()
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["date"], "2026-11-09")
        self.assertEqual([row["phase"] for row in body["lessons"]], ["now"])
        self.assertEqual(body["counts"]["now"], 1)


class RegisterTests(LessonsFixture):
    def test_counts_by_mark_from_that_days_register(self):
        room = self.room("G21 Math")
        a, b, c, d, e, _unmarked = (self.seat(room) for _ in range(6))
        self.seat(room, joined=datetime(2026, 11, 9, 21, 30))  # Monday evening, local time: on the register
        tuesday = self.seat(room, joined=datetime(2026, 11, 10, 0, 30))  # joined after the lesson: not on it
        self.seat(room, status=ClassroomMembership.STATUS_REMOVED)
        ClassroomMembership.objects.create(classroom=room, user=make("ta", C.ROLE_SUPPORT_TEACHER, subject="math"), role="TA")
        for user, status in ((a, "PRESENT"), (b, "PRESENT"), (c, "LATE"), (d, "ABSENT"), (e, "EXCUSED")):
            self.mark(room, user, status)
        self.mark(room, a, "ABSENT", day=MONDAY - timedelta(days=7))  # last Monday's register says nothing today
        self.mark(room, tuesday, "PRESENT", day=MONDAY - timedelta(days=7))
        register = self.row(room)["register"]
        self.assertEqual(
            {k: register[k] for k in ("roster", "marked", "present", "late", "absent", "excused", "taken")},
            {"roster": 7, "marked": 5, "present": 2, "late": 1, "absent": 1, "excused": 1, "taken": True},
        )

    def test_a_register_with_nobody_marked_is_not_taken(self):
        room = self.room("G21 Math")
        self.seat(room)
        register = self.row(room)["register"]
        self.assertEqual((register["roster"], register["marked"], register["taken"]), (1, 0, False))
        AttendanceSession.objects.create(classroom=room, date=MONDAY, created_by=self.teacher)  # opened, no marks
        self.assertFalse(self.row(room)["register"]["taken"])

    def test_a_register_with_nobody_on_it_is_taken(self):
        room = self.room("Empty")
        register = self.row(room)["register"]
        self.assertEqual((register["roster"], register["marked"], register["taken"]), (0, 0, True))

    @override_settings(LCUP_ENABLED=True)
    def test_a_student_lcup_holds_frozen_cannot_be_marked(self):
        """lc-up takes no attendance for a frozen member, so a register of only them is done — as the lesson-end
        check (lcup.followups.lesson_check) says."""
        frozen_only, mixed = self.room("Frozen only"), self.room("Mixed")
        for room in (frozen_only, mixed):
            link = self.pair(room)
            self.lcup_frozen(link, self.seat(room))
        self.seat(mixed)
        for room, taken in ((frozen_only, True), (mixed, False)):
            with self.subTest(room=room.name):
                register = self.row(room)["register"]
                self.assertEqual(register["taken"], taken)
                self.assertEqual(register["taken"], lesson_check(room, MONDAY).taken)
        self.assertEqual(self.row(frozen_only)["register"]["roster"], 1)  # shown on the register, never marked

    def test_a_frozen_seat_follows_the_same_rule_as_the_lesson_end_check(self):
        """Without lc-up the seat's own status says who is frozen; with lc-up on, it says nothing for a class
        lc-up does not run (``frozen_in_lcup``)."""
        room = self.room("Frozen seat")
        self.seat(room, seat_status=ClassroomMembership.SEAT_FROZEN)
        for enabled, taken in ((False, True), (True, False)):
            with self.subTest(lcup=enabled), override_settings(LCUP_ENABLED=enabled):
                self.assertEqual(self.row(room)["register"]["taken"], taken)
                self.assertEqual(lesson_check(room, MONDAY).taken, taken)


class CountsTests(LessonsFixture):
    def test_not_marked_is_only_an_ended_lesson_with_an_open_register_and_no_marks(self):
        ended = self.room("A ended", time="14:00-16:00")
        taken = self.room("B taken", time="14:00-16:00")
        running = self.room("C running", time="16:00-18:00")
        closed = self.room("D closed", time="10:00-12:00")  # closed at 14:00
        later = self.room("E later", time="19:00")
        unknown = self.room("F unknown", time="")
        nobody = self.room("G no teacher", time="14:00-16:00", teacher=None)
        for room in (ended, taken, running, closed, later, unknown):
            self.seat(room)
        self.mark(taken, self.seat(taken), "PRESENT")
        body = self.body(now=at(MONDAY, 17))
        self.assertEqual(body["counts"], {"lessons": 7, "now": 1, "not_marked": 1, "no_teacher": 1})
        rows = {r["classroom"]["id"]: r for r in body["lessons"]}
        self.assertEqual(
            (rows[ended.pk]["phase"], rows[ended.pk]["register"]["taken"], rows[ended.pk]["register"]["state"]),
            ("ended", False, "open"),
        )
        self.assertEqual(rows[closed.pk]["register"]["state"], "closed")
        self.assertEqual(rows[ended.pk]["teacher"], {"id": self.teacher.pk, "name": "Vali Aliyev"})
        self.assertIsNone(rows[nobody.pk]["teacher"])
        self.assertTrue(rows[nobody.pk]["register"]["taken"])  # nobody to mark
        self.assertEqual(rows[later.pk]["phase"], "upcoming")

    def test_the_classroom_names_its_room_and_branch(self):
        branch = Branch.objects.create(region=Region.objects.create(name="Tashkent"), name="Chilonzor")
        placed = self.room("Middle M5 · Math", room_number="3", branch=branch)
        unplaced = self.room("Nowhere", time="16:00")
        rows = {r["classroom"]["id"]: r["classroom"] for r in self.body()["lessons"]}
        self.assertEqual(rows[placed.pk], {"id": placed.pk, "name": "Middle M5 · Math", "room": "3", "branch": "Chilonzor"})
        self.assertEqual(rows[unplaced.pk], {"id": unplaced.pk, "name": "Nowhere", "room": "", "branch": ""})

    def test_the_exact_shape(self):
        room = self.room("G21 Math")
        self.mark(room, self.seat(room), "PRESENT")
        body = self.body()
        self.assertEqual(set(body), {"date", "lessons", "counts"})
        [row] = body["lessons"]
        self.assertEqual(set(row), {"classroom", "teacher", "starts_at", "ends_at", "phase", "register"})
        self.assertEqual(
            set(row["register"]),
            {"roster", "marked", "present", "late", "absent", "excused", "taken", "state", "closes_at"},
        )
        self.assertEqual(set(body["counts"]), {"lessons", "now", "not_marked", "no_teacher"})


class PermissionTests(LessonsFixture):
    def test_admins_and_super_admins_on_the_admin_host(self):
        self.room("G21 Math")
        for user in (self.admin, make("owner", C.ROLE_SUPER_ADMIN)):
            with self.subTest(role=user.role):
                r = self.get(user, date="2026-11-09")
                self.assertEqual(r.status_code, 200, r.content)
                self.assertEqual(r.json()["counts"]["lessons"], 1)

    def test_a_teacher_and_an_auditor_are_refused(self):
        for user in (self.teacher, make("audit", C.ROLE_TEST_AUDITOR)):
            with self.subTest(role=user.role):
                self.assertEqual(self.get(user).status_code, 403)

    def test_the_date_parameter(self):
        even = self.room("Even", days="EVEN")
        body = self.get(date="2026-11-10").json()
        self.assertEqual((body["date"], [r["classroom"]["id"] for r in body["lessons"]]), ("2026-11-10", [even.pk]))
        for bad in ("2026-02-30", "10/11/2026", "tomorrow"):
            with self.subTest(date=bad):
                self.assertEqual(self.get(date=bad).status_code, 400)


@override_settings(**LCUP_ON)
class QueryCountTests(LessonsFixture):
    def build(self, count):
        for _ in range(count):
            n = Classroom.objects.count()
            room = self.room(f"Class {n}", time=f"{9 + n % 10}:00")
            first, second = self.seat(room), self.seat(room)
            self.mark(room, first, "PRESENT")
            if n % 3 == 0:
                self.lcup_frozen(self.pair(room), second)

    def count(self, fn):
        with CaptureQueriesContext(connection) as ctx:
            fn()
        return len(ctx.captured_queries)

    def test_a_fixed_number_of_queries_however_many_classes_meet(self):
        self.build(3)
        three = self.count(lambda: self.body())
        # The classes, their seats, their registers, which of them lc-up runs, who lc-up holds frozen.
        self.assertEqual(three, 5)
        self.build(9)
        with self.assertNumQueries(three):
            body = self.body()
        self.assertEqual(body["counts"]["lessons"], 12)

    def test_the_view_too(self):
        self.build(3)
        three = self.count(lambda: self.get(date="2026-11-09"))
        self.build(9)
        self.assertEqual(self.count(lambda: self.get(date="2026-11-09")), three)


@override_settings(**LCUP_ON)
class LcupAgreementTests(LessonsFixture):
    """``lcup.followups._meeting_classes`` (the lc-up lesson-end beat) keeps its own, narrower rule; the
    paired classes it finds and the ones Today finds must still be the same, with the same lesson."""

    def test_a_paired_class_moved_up_a_level_is_found_by_both(self):
        moved = self.pair(self.room("Paired moved up", start_date=MONDAY + timedelta(days=3))).classroom
        AttendanceSession.objects.create(classroom=moved, date=MONDAY - timedelta(days=3), created_by=self.teacher)
        self.pair(self.room("Paired never met", start_date=MONDAY + timedelta(days=3)))
        self.assertEqual([room.pk for room, _ in _meeting_classes(MONDAY)], [moved.pk])
        self.assertEqual(self.ids(), [moved.pk])

    def test_the_paired_classes_agree_with_the_lesson_end_beat(self):
        rooms = {
            "paired": self.room("Paired", time="14:00-16:00"),
            "paired_morning": self.room("Paired morning", time="10:00"),
            "paired_unreadable": self.room("Paired unreadable", time=""),
            "paired_even": self.room("Paired even", days="EVEN"),
            "paired_not_begun": self.room("Paired not begun", start_date=MONDAY + timedelta(days=1)),
            "paired_archived": self.room("Paired archived", is_active=False),
            "deleted_in_lcup": self.room("Deleted in lc-up"),
            "suggested": self.room("Only suggested"),
            "unpaired": self.room("Unpaired"),
        }
        for key, room in rooms.items():
            if key.startswith("paired"):
                self.pair(room)
        self.pair(rooms["deleted_in_lcup"], deleted_in_lcup_at=at(MONDAY - timedelta(days=3), 9))
        self.pair(rooms["suggested"], status=GroupLinkStatus.SUGGESTED)
        self.mark(rooms["paired_morning"], self.seat(rooms["paired_morning"]), "PRESENT")
        self.seat(rooms["paired"])

        beat = {room.pk: interval for room, interval in _meeting_classes(MONDAY)}
        self.assertEqual(set(beat), {rooms["paired"].pk, rooms["paired_morning"].pk})

        body = self.body(now=at(MONDAY, 17))
        listed = {r["classroom"]["id"]: r for r in body["lessons"]}
        managed = lcup_managed_ids(listed)
        ours = {pk: (r["starts_at"], r["ends_at"]) for pk, r in listed.items() if pk in managed and r["starts_at"]}
        self.assertEqual(ours, {pk: (s.isoformat(), e.isoformat()) for pk, (s, e) in beat.items()})
        # Today lists more than the beat: the unpaired classes, and a paired one whose time cannot be read.
        self.assertEqual(
            set(listed),
            {rooms[k].pk for k in ("paired", "paired_morning", "paired_unreadable", "deleted_in_lcup", "suggested",
                                   "unpaired")},
        )
        for pk, row in listed.items():
            room = Classroom.objects.get(pk=pk)
            with self.subTest(room=room.name):
                # The batched lc-up answer closes the register exactly where marking_window alone does.
                self.assertEqual(row["register"]["closes_at"], marking_window(room, MONDAY)[1].isoformat())
                if pk in beat:
                    self.assertEqual(row["register"]["taken"], lesson_check(room, MONDAY).taken)
        # A class whose registers go to lc-up closes five minutes sooner.
        self.assertEqual(listed[rooms["paired"].pk]["register"]["closes_at"], iso(MONDAY, 17, 55))
        self.assertEqual(listed[rooms["unpaired"].pk]["register"]["closes_at"], iso(MONDAY, 18))
        self.assertEqual(body["counts"]["not_marked"], 1)  # "Paired": ended 16:00, open until 17:55, unmarked

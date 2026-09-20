"""Targeted tests for ``classes.teacher_today`` and ``GET /api/classes/teacher/today/``.

Run only this label — the full suite takes about thirty minutes:

    SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 \
      python3 manage.py test classes.tests_teacher_today \
      --settings=config.settings_test_nomigrations -v 1

Dates are pinned to a real week of September 2026 so "Sunday" means Sunday in every
assertion: 20th Sun, 21st Mon, 22nd Tue, 23rd Wed. ``build_teacher_today`` takes ``now``,
so no test depends on the day it is run.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import resolve, reverse
from django.utils import timezone
from rest_framework.test import APIClient

from assessments.models import AssessmentAttempt, AssessmentSet, HomeworkAssignment
from midterms.models import Midterm

from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.models_schedule import MidtermSchedule
from classes.teacher_today import build_teacher_today

User = get_user_model()

SUNDAY = date(2026, 9, 20)
MONDAY = date(2026, 9, 21)
TUESDAY = date(2026, 9, 22)
WEDNESDAY = date(2026, 9, 23)
FRIDAY = date(2026, 9, 25)


def at(day: date, hour: int = 9, minute: int = 0):
    """An aware datetime on ``day``, in the platform's own (Asia/Tashkent) timezone."""
    return timezone.make_aware(
        datetime.combine(day, time(hour, minute)), timezone.get_current_timezone()
    )


def iso(day: date, hour: int = 9, minute: int = 0) -> str:
    """The same instant as :func:`at`, as this payload writes it."""
    return at(day, hour, minute).isoformat()


class TeacherTodayFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("tt_teacher@t.com")
        self.outsider = User.objects.create_user("tt_outsider@t.com")
        self._seq = 0

    # ── builders ─────────────────────────────────────────────────────────────
    def make_classroom(self, name="Math Junior 3", *, days=Classroom.DAYS_ODD, lesson_time="18:00", **kw):
        return Classroom.objects.create(
            name=name,
            subject=kw.pop("subject", Classroom.SUBJECT_MATH),
            lesson_days=days,
            lesson_time=lesson_time,
            created_by=self.teacher,
            **kw,
        )

    def join(self, classroom, user, role=ClassroomMembership.ROLE_TEACHER, **kw):
        return ClassroomMembership.objects.create(
            classroom=classroom, user=user, role=role, **kw
        )

    def student(self, classroom, first="Anvar", last="Karimov", **kw):
        self._seq += 1
        user = User.objects.create_user(
            f"tt_s{self._seq}@t.com", first_name=first, last_name=last
        )
        self.join(classroom, user, ClassroomMembership.ROLE_STUDENT, **kw)
        return user

    def homework(self, classroom, *, due_at, title="Linear functions, set 4", **kw):
        return Assignment.objects.create(
            classroom=classroom,
            created_by=self.teacher,
            title=title,
            instructions="",
            due_at=due_at,
            status=kw.pop("status", Assignment.STATUS_PUBLISHED),
            **kw,
        )

    def submit(self, assignment, student, status=Submission.STATUS_SUBMITTED, submitted_at=None):
        return Submission.objects.create(
            assignment=assignment,
            student=student,
            status=status,
            submitted_at=submitted_at,
        )

    def mark(self, classroom, day, **counts):
        """Write a register: ``mark(c, MONDAY, present=3, missed=1)``.

        One fresh student per record — ``AttendanceRecord`` is unique per (session, student),
        and these tests only ever assert the counts.
        """
        session, _ = AttendanceSession.objects.get_or_create(classroom=classroom, date=day)
        status_of = {
            "present": AttendanceRecord.STATUS_PRESENT,
            "late": AttendanceRecord.STATUS_LATE,
            "missed": AttendanceRecord.STATUS_ABSENT,
            "excused": AttendanceRecord.STATUS_EXCUSED,
        }
        for key, n in counts.items():
            for _ in range(n):
                AttendanceRecord.objects.create(
                    session=session, student=self.student(classroom), status=status_of[key]
                )
        return session

    # ── readers ──────────────────────────────────────────────────────────────
    def class_row(self, payload, classroom):
        rows = [r for r in payload["classes"] if r["classroom_id"] == classroom.id]
        return rows[0] if rows else None

    def meeting_today(self, day, user=None, hour=9):
        """Names of the classes whose next lesson is that same day — i.e. they meet today.

        Asked before any lesson has started, so a class meeting today is still pointing at
        today's lesson rather than the next one.
        """
        payload = build_teacher_today(user or self.teacher, now=at(day, hour))
        return [
            r["name"]
            for r in payload["classes"]
            if r["next_lesson_at"] and r["next_lesson_at"][:10] == day.isoformat()
        ]


# ── §5: membership scoping ───────────────────────────────────────────────────
class MembershipScopingTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.student(self.classroom)
        hw = self.homework(self.classroom, due_at=at(MONDAY, 18))
        self.submit(hw, self.student(self.classroom))
        self.mark(self.classroom, MONDAY, present=1)
        MidtermSchedule.objects.create(
            classroom=self.classroom,
            midterm=Midterm.objects.create(title="September midterm", subject=Midterm.MATH),
            starts_at=at(WEDNESDAY, 10),
        )

    def test_staff_member_sees_their_class(self):
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual([r["name"] for r in payload["classes"]], ["Math Junior 3"])
        self.assertEqual([r["name"] for r in payload["grading_queue"]], ["Math Junior 3"])
        self.assertEqual(
            [r["name"] for r in payload["stats"]["attendance_week"]], ["Math Junior 3"]
        )
        self.assertEqual([r["title"] for r in payload["upcoming_midterms"]], ["September midterm"])

    def test_staff_non_member_gets_nothing_of_a_class_they_are_not_in(self):
        """Being staff somewhere is not being staff here: only their own class comes back."""
        other = self.make_classroom(name="Someone else's class")
        self.join(other, self.outsider)
        hw = self.homework(other, due_at=at(MONDAY, 18))
        self.submit(hw, self.student(other))
        self.mark(other, MONDAY, present=1)
        MidtermSchedule.objects.create(
            classroom=other,
            midterm=Midterm.objects.create(title="Their midterm", subject=Midterm.MATH),
            starts_at=at(WEDNESDAY, 10),
        )
        payload = build_teacher_today(self.outsider, now=at(MONDAY, 9))
        self.assertEqual([r["name"] for r in payload["classes"]], ["Someone else's class"])
        self.assertEqual([r["name"] for r in payload["grading_queue"]], ["Someone else's class"])
        self.assertEqual(
            [r["name"] for r in payload["stats"]["attendance_week"]], ["Someone else's class"]
        )
        self.assertEqual([r["title"] for r in payload["upcoming_midterms"]], ["Their midterm"])
        self.assertNotIn(self.classroom.id, [r["classroom_id"] for r in payload["classes"]])

    def test_no_membership_at_all_gets_nothing(self):
        """A staff member of no class sees empty lists, not a 403 — every block of them."""
        payload = build_teacher_today(self.outsider, now=at(MONDAY, 9))
        self.assertEqual(payload["classes"], [])
        self.assertEqual(payload["grading_queue"], [])
        self.assertEqual(payload["upcoming_midterms"], [])
        self.assertEqual(
            payload["stats"],
            {"attendance_week": [], "homework_30d": [], "attendance_trend": []},
        )

    def test_student_membership_is_not_staff(self):
        self.join(self.classroom, self.outsider, ClassroomMembership.ROLE_STUDENT)
        payload = build_teacher_today(self.outsider, now=at(MONDAY, 9))
        self.assertEqual(payload["classes"], [])
        self.assertEqual(payload["grading_queue"], [])
        self.assertEqual(payload["stats"]["attendance_week"], [])

    def test_removed_staff_membership_is_not_scope(self):
        ta = User.objects.create_user("tt_ex_ta@t.com")
        self.join(self.classroom, ta, ClassroomMembership.ROLE_TA,
                  status=ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(build_teacher_today(ta, now=at(MONDAY, 9))["classes"], [])

    def test_ta_membership_is_staff(self):
        ta = User.objects.create_user("tt_ta@t.com")
        self.join(self.classroom, ta, ClassroomMembership.ROLE_TA)
        self.assertEqual(
            [r["name"] for r in build_teacher_today(ta, now=at(MONDAY, 9))["classes"]],
            ["Math Junior 3"],
        )

    def test_deactivated_class_is_off_the_desk(self):
        self.classroom.is_active = False
        self.classroom.save(update_fields=["is_active"])
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(payload["classes"], [])
        self.assertEqual(payload["grading_queue"], [])
        self.assertEqual(payload["stats"]["attendance_week"], [])
        self.assertEqual(payload["upcoming_midterms"], [])


# ── §4.1: ODD / EVEN, and Sunday belonging to neither ────────────────────────
class WeekdayMappingTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.odd = self.make_classroom(name="Odd class", days=Classroom.DAYS_ODD)
        self.even = self.make_classroom(name="Even class", days=Classroom.DAYS_EVEN)
        self.join(self.odd, self.teacher)
        self.join(self.even, self.teacher)

    def test_odd_meets_monday_wednesday_friday(self):
        for day in (MONDAY, WEDNESDAY, FRIDAY):
            self.assertEqual(self.meeting_today(day), ["Odd class"], day.isoformat())

    def test_even_meets_tuesday_thursday_saturday(self):
        for day in (TUESDAY, date(2026, 9, 24), date(2026, 9, 26)):
            self.assertEqual(self.meeting_today(day), ["Even class"], day.isoformat())

    def test_sunday_belongs_to_neither(self):
        self.assertEqual(self.meeting_today(SUNDAY), [])

    def test_both_classes_are_listed_every_day_even_the_one_not_meeting(self):
        """§1: ``classes`` is the teacher's whole week, not only today's lessons."""
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(
            sorted(r["name"] for r in payload["classes"]), ["Even class", "Odd class"]
        )
        self.assertEqual(self.class_row(payload, self.even)["next_lesson_at"], iso(TUESDAY, 18))

    def test_date_is_the_callers_local_date(self):
        payload = build_teacher_today(self.teacher, now=at(SUNDAY, 23, 30))
        self.assertEqual(payload["date"], "2026-09-20")

    def test_now_is_the_instant_the_payload_was_built_in_school_time(self):
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9, 12))
        self.assertEqual(payload["now"], "2026-09-21T09:12:00+05:00")


# ── the coordinator's addition: next_lesson_date ─────────────────────────────
class NextLessonDateTests(TeacherTodayFixture):
    def test_all_odd_classes_asked_on_sunday_get_the_coming_monday(self):
        classroom = self.make_classroom(name="Odd class", days=Classroom.DAYS_ODD)
        self.join(classroom, self.teacher)
        payload = build_teacher_today(self.teacher, now=at(SUNDAY, 9))
        self.assertEqual(self.meeting_today(SUNDAY), [])
        self.assertEqual(payload["next_lesson_date"], "2026-09-21")

    def test_it_names_the_NEXT_day_even_on_a_lesson_day(self):
        classroom = self.make_classroom(name="Odd class", days=Classroom.DAYS_ODD)
        self.join(classroom, self.teacher)
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(payload["next_lesson_date"], "2026-09-23")

    def test_nearest_across_all_the_teachers_classes(self):
        odd = self.make_classroom(name="Odd class", days=Classroom.DAYS_ODD)
        even = self.make_classroom(name="Even class", days=Classroom.DAYS_EVEN)
        self.join(odd, self.teacher)
        self.join(even, self.teacher)
        # Monday: the odd class meets again Wednesday, the even one Tuesday — Tuesday wins.
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(payload["next_lesson_date"], "2026-09-22")

    def test_no_classes_means_null(self):
        self.assertIsNone(build_teacher_today(self.teacher, now=at(SUNDAY, 9))["next_lesson_date"])

    def test_unknown_lesson_days_contributes_nothing(self):
        classroom = self.make_classroom(name="Unscheduled", days="")
        self.join(classroom, self.teacher)
        self.assertIsNone(build_teacher_today(self.teacher, now=at(SUNDAY, 9))["next_lesson_date"])


# ── §1: the schedule a teacher reads their week off ──────────────────────────
class ClassScheduleFieldsTests(TeacherTodayFixture):
    def row(self, classroom, now=None):
        return self.class_row(
            build_teacher_today(self.teacher, now=now or at(MONDAY, 9)), classroom
        )

    def test_room_is_the_classrooms_room_number(self):
        classroom = self.make_classroom(room_number="22")
        self.join(classroom, self.teacher)
        self.assertEqual(self.row(classroom)["room"], "22")

    def test_a_class_with_no_room_sends_an_empty_string_not_null(self):
        """Three of the twenty-eight live classes have no room; the client renders a dash."""
        classroom = self.make_classroom(name="Roomless")
        self.join(classroom, self.teacher)
        self.assertEqual(self.row(classroom)["room"], "")

    def test_odd_days_carry_both_the_raw_value_and_the_label(self):
        classroom = self.make_classroom(days=Classroom.DAYS_ODD)
        self.join(classroom, self.teacher)
        row = self.row(classroom)
        self.assertEqual(row["lesson_days"], "ODD")
        self.assertEqual(row["lesson_days_label"], "Mon, Wed, Fri")

    def test_even_days(self):
        classroom = self.make_classroom(name="Even", days=Classroom.DAYS_EVEN)
        self.join(classroom, self.teacher)
        row = self.row(classroom)
        self.assertEqual(row["lesson_days"], "EVEN")
        self.assertEqual(row["lesson_days_label"], "Tue, Thu, Sat")

    def test_unknown_days_label_is_blank_rather_than_a_guess(self):
        classroom = self.make_classroom(name="Unscheduled", days="")
        self.join(classroom, self.teacher)
        row = self.row(classroom)
        self.assertEqual(row["lesson_days"], "")
        self.assertEqual(row["lesson_days_label"], "")

    def test_student_count_is_the_active_roster(self):
        classroom = self.make_classroom()
        self.join(classroom, self.teacher)
        self.student(classroom)
        self.student(classroom)
        self.student(classroom, status=ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(self.row(classroom)["student_count"], 2)

    def test_a_class_not_meeting_today_still_carries_its_whole_schedule(self):
        classroom = self.make_classroom(
            name="Even", days=Classroom.DAYS_EVEN, lesson_time="16:00", room_number="7"
        )
        self.join(classroom, self.teacher)
        row = self.row(classroom)  # asked on a Monday: this class meets Tuesday
        self.assertEqual(
            (row["room"], row["lesson_days_label"], row["lesson_time"], row["state"]),
            ("7", "Tue, Thu, Sat", "16:00", "upcoming"),
        )
        self.assertEqual(row["next_lesson_at"], iso(TUESDAY, 16))


# ── §7 (original): an unreadable lesson_time is listed, never dropped ────────
class LessonTimeTests(TeacherTodayFixture):
    def test_blank_time_still_listed(self):
        classroom = self.make_classroom(name="No time", lesson_time="")
        self.join(classroom, self.teacher)
        row = self.class_row(build_teacher_today(self.teacher, now=at(MONDAY, 9)), classroom)
        self.assertIsNotNone(row)
        self.assertIsNone(row["lesson_time"])

    def test_garbage_time_still_listed(self):
        classroom = self.make_classroom(name="Garbage time", lesson_time="sometime after lunch")
        self.join(classroom, self.teacher)
        row = self.class_row(build_teacher_today(self.teacher, now=at(MONDAY, 9)), classroom)
        self.assertIsNotNone(row)
        self.assertIsNone(row["lesson_time"])

    def test_time_comes_from_parse_lesson_time(self):
        """A range and a 12-hour clock both resolve through lesson_schedule, not a local copy."""
        ranged = self.make_classroom(name="Ranged", lesson_time="08:00-10:00")
        pm = self.make_classroom(name="Evening", lesson_time="4:00 PM")
        self.join(ranged, self.teacher)
        self.join(pm, self.teacher)
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(self.class_row(payload, ranged)["lesson_time"], "08:00")
        self.assertEqual(self.class_row(payload, pm)["lesson_time"], "16:00")


# ── §2 + §3: where the next lesson is, and what state it is in ───────────────
class LessonStateTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom(lesson_time="18:00")  # lesson_hours defaults to 2
        self.join(self.classroom, self.teacher)

    def row(self, now):
        return self.class_row(build_teacher_today(self.teacher, now=now), self.classroom)

    def test_before_todays_lesson_it_is_upcoming_and_points_at_today(self):
        row = self.row(at(MONDAY, 17, 59))
        self.assertEqual(row["state"], "upcoming")
        self.assertEqual(row["next_lesson_at"], iso(MONDAY, 18))

    def test_at_the_bell_it_is_now(self):
        self.assertEqual(self.row(at(MONDAY, 18))["state"], "now")

    def test_during_the_lesson_it_is_still_now_and_still_points_at_it(self):
        row = self.row(at(MONDAY, 19, 59))
        self.assertEqual(row["state"], "now")
        self.assertEqual(row["next_lesson_at"], iso(MONDAY, 18))

    def test_once_it_ends_it_is_done_and_the_next_lesson_takes_its_place(self):
        row = self.row(at(MONDAY, 20))
        self.assertEqual(row["state"], "done")
        self.assertEqual(row["next_lesson_at"], iso(WEDNESDAY, 18))

    def test_the_two_hour_default_applies_when_lesson_hours_is_not_set(self):
        """``lesson_hours`` is 0 on a row that predates the column: assume two hours."""
        self.classroom.lesson_hours = 0
        self.classroom.save(update_fields=["lesson_hours"])
        self.assertEqual(self.row(at(MONDAY, 19, 59))["state"], "now")
        self.assertEqual(self.row(at(MONDAY, 20))["state"], "done")

    def test_an_explicit_lesson_hours_is_obeyed(self):
        self.classroom.lesson_hours = 4
        self.classroom.save(update_fields=["lesson_hours"])
        self.assertEqual(self.row(at(MONDAY, 20))["state"], "now")
        self.assertEqual(self.row(at(MONDAY, 21, 59))["state"], "now")
        self.assertEqual(self.row(at(MONDAY, 22))["state"], "done")

    def test_a_day_it_does_not_meet_is_upcoming_at_the_next_scheduled_day(self):
        row = self.row(at(TUESDAY, 9))
        self.assertEqual(row["state"], "upcoming")
        self.assertEqual(row["next_lesson_at"], iso(WEDNESDAY, 18))

    def test_an_unreadable_time_is_off_with_no_datetime(self):
        self.classroom.lesson_time = "sometime after lunch"
        self.classroom.save(update_fields=["lesson_time"])
        row = self.row(at(MONDAY, 9))
        self.assertEqual(row["state"], "off")
        self.assertIsNone(row["next_lesson_at"])

    def test_unknown_lesson_days_is_off_too(self):
        self.classroom.lesson_days = ""
        self.classroom.save(update_fields=["lesson_days"])
        row = self.row(at(MONDAY, 9))
        self.assertEqual(row["state"], "off")
        self.assertIsNone(row["next_lesson_at"])

    def test_a_class_that_has_not_begun_points_at_its_first_lesson(self):
        self.classroom.start_date = WEDNESDAY
        self.classroom.save(update_fields=["start_date"])
        row = self.row(at(MONDAY, 19))  # its weekday, but the class has not started
        self.assertEqual(row["state"], "upcoming")
        self.assertEqual(row["next_lesson_at"], iso(WEDNESDAY, 18))


# ── §4: the owner's reading order ────────────────────────────────────────────
class ClassOrderingTests(TeacherTodayFixture):
    def names(self, now):
        return [r["name"] for r in build_teacher_today(self.teacher, now=now)["classes"]]

    def test_in_progress_first_then_coming_then_taught_then_unscheduled(self):
        """"The group whose lesson is coming stands first, before and during the lesson, and
        once it is over the next one takes its place." Asked at 09:30 on a Monday."""
        in_progress = self.make_classroom(name="C in progress", lesson_time="09:00")
        finished = self.make_classroom(name="B finished", lesson_time="07:00")
        later_today = self.make_classroom(name="D later today", lesson_time="18:00")
        tomorrow = self.make_classroom(
            name="A tomorrow", days=Classroom.DAYS_EVEN, lesson_time="10:00"
        )
        unscheduled = self.make_classroom(name="E unscheduled", days="")
        for c in (in_progress, finished, later_today, tomorrow, unscheduled):
            self.join(c, self.teacher)

        self.assertEqual(
            self.names(at(MONDAY, 9, 30)),
            ["C in progress", "D later today", "A tomorrow", "B finished", "E unscheduled"],
        )

    def test_the_same_class_moves_down_the_list_as_its_lesson_ends(self):
        morning = self.make_classroom(name="Morning", lesson_time="09:00")
        evening = self.make_classroom(name="Evening", lesson_time="18:00")
        self.join(morning, self.teacher)
        self.join(evening, self.teacher)
        self.assertEqual(self.names(at(MONDAY, 8)), ["Morning", "Evening"])
        self.assertEqual(self.names(at(MONDAY, 10)), ["Morning", "Evening"])  # in progress
        self.assertEqual(self.names(at(MONDAY, 12)), ["Evening", "Morning"])  # taught

    def test_ties_fall_to_the_name(self):
        for name in ("Zulu", "Alpha", "Mike"):
            self.join(self.make_classroom(name=name, days=""), self.teacher)
        self.assertEqual(self.names(at(MONDAY, 9)), ["Alpha", "Mike", "Zulu"])

    def test_two_upcoming_lessons_are_soonest_first_whatever_their_names(self):
        early = self.make_classroom(name="Zulu early", lesson_time="10:00")
        late = self.make_classroom(name="Alpha late", lesson_time="16:00")
        self.join(early, self.teacher)
        self.join(late, self.teacher)
        self.assertEqual(self.names(at(MONDAY, 8)), ["Zulu early", "Alpha late"])


# ── §5: "turned in" means what interventions means by it ─────────────────────
class HomeworkCountingTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.sent = self.student(self.classroom, "Aziza", "Rustamova")
        self.returned = self.student(self.classroom, "Bobur", "Saidov")
        self.drafted = self.student(self.classroom, "Dilnoza", "Tosheva")
        self.nothing = self.student(self.classroom, "Eldor", "Umarov")
        self.hw = self.homework(self.classroom, due_at=at(MONDAY, 18))

    def row(self):
        return self.class_row(
            build_teacher_today(self.teacher, now=at(MONDAY, 9)), self.classroom
        )

    def test_returned_for_revision_counts_as_turned_in(self):
        self.submit(self.hw, self.sent, Submission.STATUS_SUBMITTED)
        self.submit(self.hw, self.returned, Submission.STATUS_RETURNED)
        self.submit(self.hw, self.drafted, Submission.STATUS_DRAFT)
        hw = self.row()["homework"]
        self.assertEqual(hw["assignment_id"], self.hw.id)
        self.assertEqual(hw["title"], "Linear functions, set 4")
        self.assertEqual((hw["turned_in"], hw["missing"]), (2, 2))
        self.assertEqual(
            sorted(s["name"] for s in hw["missing_students"]),
            ["Dilnoza Tosheva", "Eldor Umarov"],
        )

    def test_reviewed_counts_as_turned_in(self):
        self.submit(self.hw, self.sent, Submission.STATUS_REVIEWED)
        self.assertEqual(self.row()["homework"]["turned_in"], 1)

    def test_a_submitted_assessment_attempt_counts_as_turned_in(self):
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra",
            title="Algebra basics", created_by=self.teacher,
        )
        assess_hw = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=self.hw, assigned_by=self.teacher,
        )
        AssessmentAttempt.objects.create(
            homework=assess_hw, student=self.nothing, status=AssessmentAttempt.STATUS_GRADED
        )
        AssessmentAttempt.objects.create(
            homework=assess_hw, student=self.drafted,
            status=AssessmentAttempt.STATUS_IN_PROGRESS,
        )
        hw = self.row()["homework"]
        self.assertEqual((hw["turned_in"], hw["missing"]), (1, 3))
        self.assertNotIn("Eldor Umarov", [s["name"] for s in hw["missing_students"]])

    def test_missing_students_carry_id_and_name_only(self):
        keys = set(self.row()["homework"]["missing_students"][0])
        self.assertEqual(keys, {"id", "name"})

    def test_a_student_with_no_name_is_never_listed_by_their_login(self):
        """Ten live students carry neither a first nor a last name, and 37 have an
        email-shaped username. A nameless one of those must not have their address read out
        to the whole class's teacher: §5 says this payload carries no email."""
        self.nothing.first_name = ""
        self.nothing.last_name = ""
        self.nothing.username = "someone@example.com"
        self.nothing.save(update_fields=["first_name", "last_name", "username"])

        listed = [s for s in self.row()["homework"]["missing_students"] if s["id"] == self.nothing.id]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["name"], "Student")

    def test_removed_students_are_in_no_figure(self):
        gone = self.student(self.classroom, "Farrux", "Xolmatov",
                            status=ClassroomMembership.STATUS_REMOVED)
        row = self.row()
        self.assertEqual(row["student_count"], 4)
        self.assertNotIn(gone.id, [s["id"] for s in row["homework"]["missing_students"]])

    def test_homework_is_null_when_none_is_due_at_that_lesson(self):
        self.hw.delete()
        row = self.row()
        self.assertEqual(row["student_count"], 4)
        self.assertIsNone(row["homework"])

    def test_draft_homework_is_not_due_at_that_lesson(self):
        self.hw.status = Assignment.STATUS_DRAFT
        self.hw.save(update_fields=["status"])
        self.assertIsNone(self.row()["homework"])

    def test_archived_homework_is_not_due_at_that_lesson(self):
        self.hw.status = Assignment.STATUS_ARCHIVED
        self.hw.save(update_fields=["status"])
        self.assertIsNone(self.row()["homework"])

    def test_classwork_is_never_the_lessons_homework(self):
        self.hw.category = Assignment.CATEGORY_CLASSWORK
        self.hw.save(update_fields=["category"])
        self.assertIsNone(self.row()["homework"])

    def test_a_null_deadline_is_open_never_due_today(self):
        """``None`` means the deadline could not be computed — open, never overdue."""
        self.hw.due_at = None
        self.hw.save(update_fields=["due_at"])
        self.assertIsNone(self.row()["homework"])

    def test_homework_due_at_the_next_lesson_is_not_todays(self):
        self.hw.due_at = at(WEDNESDAY, 18)
        self.hw.save(update_fields=["due_at"])
        self.assertIsNone(self.row()["homework"])

    def test_a_class_that_does_not_meet_today_carries_no_homework_block(self):
        """§5: the homework belongs to today's lesson, so a class without one sends null."""
        even = self.make_classroom(name="Even", days=Classroom.DAYS_EVEN)
        self.join(even, self.teacher)
        self.student(even)
        self.homework(even, due_at=at(TUESDAY, 18))
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertIsNone(self.class_row(payload, even)["homework"])
        self.assertIsNotNone(self.class_row(payload, self.classroom)["homework"])


# ── §6: the grading queue, three levels deep ─────────────────────────────────
class GradingQueueTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.hw = self.homework(self.classroom, due_at=at(MONDAY, 18))

    def queue(self, now=None):
        return build_teacher_today(self.teacher, now=now or at(MONDAY, 9))["grading_queue"]

    def waiting(self, now=None):
        return {r["name"]: r["waiting"] for r in self.queue(now)}

    def test_three_levels_class_assignment_student(self):
        student = self.student(self.classroom, "Aziza", "Rustamova")
        self.submit(self.hw, student, submitted_at=at(SUNDAY, 18, 44))
        row = self.queue()[0]
        self.assertEqual(
            (row["classroom_id"], row["name"], row["waiting"]),
            (self.classroom.id, "Math Junior 3", 1),
        )
        assignment = row["assignments"][0]
        self.assertEqual(
            (assignment["assignment_id"], assignment["title"], assignment["waiting"]),
            (self.hw.id, "Linear functions, set 4", 1),
        )
        self.assertEqual(
            assignment["students"],
            [{"id": student.id, "name": "Aziza Rustamova",
              "submitted_at": "2026-09-20T18:44:00+05:00"}],
        )

    def test_only_submitted_work_is_waiting(self):
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_REVIEWED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_RETURNED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_DRAFT)
        self.assertEqual(self.waiting(), {"Math Junior 3": 2})

    def test_classwork_is_never_in_the_queue(self):
        classwork = self.homework(
            self.classroom, due_at=at(MONDAY, 18), title="In-class set",
            category=Assignment.CATEGORY_CLASSWORK,
        )
        self.submit(classwork, self.student(self.classroom))
        self.assertEqual(self.waiting(), {})

    def test_unpublished_homework_is_never_in_the_queue(self):
        self.hw.status = Assignment.STATUS_DRAFT
        self.hw.save(update_fields=["status"])
        self.submit(self.hw, self.student(self.classroom))
        self.assertEqual(self.waiting(), {})

    def test_a_class_with_nothing_waiting_is_omitted(self):
        self.assertEqual(self.waiting(), {})

    def test_it_does_not_depend_on_there_being_a_lesson_today(self):
        self.submit(self.hw, self.student(self.classroom))
        self.assertEqual(self.waiting(now=at(SUNDAY, 9)), {"Math Junior 3": 1})

    def test_removed_students_work_is_not_on_the_desk(self):
        gone = self.student(self.classroom, status=ClassroomMembership.STATUS_REMOVED)
        self.submit(self.hw, gone)
        self.assertEqual(self.waiting(), {})

    def test_classes_are_ordered_by_how_much_is_waiting(self):
        busy = self.make_classroom(name="Busy")
        quiet = self.make_classroom(name="Quiet")
        for c in (busy, quiet):
            self.join(c, self.teacher)
        busy_hw = self.homework(busy, due_at=at(MONDAY, 18))
        quiet_hw = self.homework(quiet, due_at=at(MONDAY, 18))
        for _ in range(3):
            self.submit(busy_hw, self.student(busy))
        self.submit(quiet_hw, self.student(quiet))
        self.submit(self.hw, self.student(self.classroom))
        self.submit(self.hw, self.student(self.classroom))
        self.assertEqual(
            [(r["name"], r["waiting"]) for r in self.queue()],
            [("Busy", 3), ("Math Junior 3", 2), ("Quiet", 1)],
        )

    def test_assignments_are_ordered_by_the_work_that_has_waited_longest(self):
        oldest = self.homework(self.classroom, due_at=at(MONDAY, 18), title="Set 1 (oldest)")
        middle = self.homework(self.classroom, due_at=at(MONDAY, 18), title="Set 2")
        newest = self.homework(self.classroom, due_at=at(MONDAY, 18), title="Set 3 (newest)")
        # The newest assignment has the most waiting; the oldest submission still wins.
        self.submit(newest, self.student(self.classroom), submitted_at=at(MONDAY, 8))
        self.submit(newest, self.student(self.classroom), submitted_at=at(MONDAY, 8, 30))
        self.submit(middle, self.student(self.classroom), submitted_at=at(SUNDAY, 20))
        self.submit(oldest, self.student(self.classroom), submitted_at=at(SUNDAY, 9))
        self.assertEqual(
            [(a["title"], a["waiting"]) for a in self.queue()[0]["assignments"]],
            [("Set 1 (oldest)", 1), ("Set 2", 1), ("Set 3 (newest)", 2)],
        )

    def test_students_are_ordered_by_when_they_handed_in(self):
        first = self.student(self.classroom, "Zulfiya", "Aliyeva")
        second = self.student(self.classroom, "Anvar", "Zokirov")
        self.submit(self.hw, second, submitted_at=at(MONDAY, 8, 30))
        self.submit(self.hw, first, submitted_at=at(SUNDAY, 19))
        self.assertEqual(
            [s["name"] for s in self.queue()[0]["assignments"][0]["students"]],
            ["Zulfiya Aliyeva", "Anvar Zokirov"],
        )

    def test_work_with_no_timestamp_sorts_last_and_is_still_listed(self):
        timed = self.student(self.classroom, "Timed", "Student")
        untimed = self.student(self.classroom, "Untimed", "Student")
        self.submit(self.hw, untimed, submitted_at=None)
        self.submit(self.hw, timed, submitted_at=at(MONDAY, 8))
        students = self.queue()[0]["assignments"][0]["students"]
        self.assertEqual([s["name"] for s in students], ["Timed Student", "Untimed Student"])
        self.assertIsNone(students[1]["submitted_at"])

    def test_at_most_eight_assignments_are_listed_and_waiting_stays_true(self):
        """One live class carries 134 waiting: the list is capped, the number never is."""
        for i in range(11):
            assignment = self.homework(
                self.classroom, due_at=at(MONDAY, 18), title=f"Set {i:02d}"
            )
            self.submit(
                assignment, self.student(self.classroom), submitted_at=at(SUNDAY, 9) + timedelta(minutes=i)
            )
        row = self.queue()[0]
        self.assertEqual(len(row["assignments"]), 8)
        self.assertEqual(row["waiting"], 11)  # all eleven, not the eight shown
        self.assertEqual(
            [a["title"] for a in row["assignments"]],
            [f"Set {i:02d}" for i in range(8)],  # the eight that have waited longest
        )

    def test_at_most_twelve_students_are_listed_and_waiting_stays_true(self):
        for i in range(15):
            self.submit(
                self.hw,
                self.student(self.classroom, "Student", f"{i:02d}"),
                submitted_at=at(SUNDAY, 9) + timedelta(minutes=i),
            )
        row = self.queue()[0]
        assignment = row["assignments"][0]
        self.assertEqual(len(assignment["students"]), 12)
        self.assertEqual(assignment["waiting"], 15)  # the true total
        self.assertEqual(row["waiting"], 15)
        self.assertEqual(
            [s["name"] for s in assignment["students"]],
            [f"Student {i:02d}" for i in range(12)],  # the twelve who have waited longest
        )

    def test_a_nameless_student_is_never_queued_by_their_login(self):
        student = self.student(self.classroom, "", "")
        student.username = "someone@example.com"
        student.save(update_fields=["username"])
        self.submit(self.hw, student, submitted_at=at(MONDAY, 8))
        self.assertEqual(
            self.queue()[0]["assignments"][0]["students"][0]["name"], "Student"
        )


# ── §7: the three stats blocks ───────────────────────────────────────────────
class AttendanceWeekTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)

    def week(self, now=None):
        return build_teacher_today(
            self.teacher, now=now or at(MONDAY, 9)
        )["stats"]["attendance_week"]

    def test_absent_arrives_as_missed(self):
        """The product never calls a student absent."""
        self.mark(self.classroom, MONDAY, present=4, late=1, missed=2, excused=1)
        self.assertEqual(
            self.week(),
            [{"classroom_id": self.classroom.id, "name": "Math Junior 3",
              "present": 4, "late": 1, "missed": 2, "excused": 1}],
        )
        self.assertNotIn("absent", self.week()[0])

    def test_seven_days_counting_back_from_today(self):
        self.mark(self.classroom, MONDAY, present=1)
        self.mark(self.classroom, MONDAY - timedelta(days=6), present=1)  # the far edge
        self.mark(self.classroom, MONDAY - timedelta(days=7), present=5)  # one day too old
        self.assertEqual(self.week()[0]["present"], 2)

    def test_registers_add_up_across_days(self):
        self.mark(self.classroom, MONDAY, present=2, missed=1)
        self.mark(self.classroom, MONDAY - timedelta(days=2), present=3, late=1)
        row = self.week()[0]
        self.assertEqual((row["present"], row["late"], row["missed"]), (5, 1, 1))

    def test_a_class_with_no_register_is_omitted_rather_than_sent_as_zeros(self):
        quiet = self.make_classroom(name="Quiet")
        self.join(quiet, self.teacher)
        self.mark(self.classroom, MONDAY, present=1)
        self.assertEqual([r["name"] for r in self.week()], ["Math Junior 3"])

    def test_another_teachers_register_is_not_mine(self):
        other = self.make_classroom(name="Not mine")
        self.join(other, self.outsider)
        self.mark(other, MONDAY, present=9)
        self.assertEqual(self.week(), [])


class AttendanceTrendTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)

    def trend(self, now=None):
        return build_teacher_today(
            self.teacher, now=now or at(MONDAY, 9)
        )["stats"]["attendance_trend"]

    def test_one_row_per_day_oldest_first_across_every_class(self):
        other = self.make_classroom(name="Other")
        self.join(other, self.teacher)
        self.mark(self.classroom, MONDAY, present=2, missed=1)
        self.mark(other, MONDAY, present=3, late=1)
        self.mark(self.classroom, MONDAY - timedelta(days=2), present=1)
        self.assertEqual(
            self.trend(),
            [
                {"date": "2026-09-19", "present": 1, "late": 0, "missed": 0},
                {"date": "2026-09-21", "present": 5, "late": 1, "missed": 1},
            ],
        )

    def test_a_day_without_a_register_is_absent_from_the_trend_not_a_zero(self):
        self.mark(self.classroom, MONDAY, present=1)
        self.assertEqual([r["date"] for r in self.trend()], ["2026-09-21"])

    def test_fourteen_days_counting_back_from_today(self):
        self.mark(self.classroom, MONDAY - timedelta(days=13), present=1)  # the far edge
        self.mark(self.classroom, MONDAY - timedelta(days=14), present=1)  # too old
        self.assertEqual([r["date"] for r in self.trend()], ["2026-09-08"])

    def test_the_trend_carries_three_lines_and_absent_reads_as_missed(self):
        self.mark(self.classroom, MONDAY, present=1, late=1, missed=1, excused=1)
        row = self.trend()[0]
        self.assertEqual(set(row), {"date", "present", "late", "missed"})
        self.assertEqual((row["present"], row["late"], row["missed"]), (1, 1, 1))


class Homework30dTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.a = self.student(self.classroom, "Aziza", "Rustamova")
        self.b = self.student(self.classroom, "Bobur", "Saidov")
        self.now = at(MONDAY, 9)

    def rates(self, now=None):
        return build_teacher_today(
            self.teacher, now=now or self.now
        )["stats"]["homework_30d"]

    def test_expected_is_every_active_student_times_every_assignment(self):
        self.homework(self.classroom, due_at=at(SUNDAY, 18), title="Set 1")
        self.homework(self.classroom, due_at=at(SUNDAY - timedelta(days=2), 18), title="Set 2")
        self.assertEqual(
            self.rates(),
            [{"classroom_id": self.classroom.id, "name": "Math Junior 3",
              "expected": 4, "turned_in": 0}],
        )

    def test_turned_in_counts_the_pairs_that_were_handed_in(self):
        one = self.homework(self.classroom, due_at=at(SUNDAY, 18), title="Set 1")
        two = self.homework(self.classroom, due_at=at(SUNDAY, 18), title="Set 2")
        self.submit(one, self.a, Submission.STATUS_REVIEWED)
        self.submit(one, self.b, Submission.STATUS_RETURNED)
        self.submit(two, self.a, Submission.STATUS_DRAFT)  # never turned in
        row = self.rates()[0]
        self.assertEqual((row["expected"], row["turned_in"]), (4, 2))

    def test_a_submission_and_an_attempt_on_the_same_homework_are_one_pair(self):
        assignment = self.homework(self.classroom, due_at=at(SUNDAY, 18))
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra",
            title="Algebra basics", created_by=self.teacher,
        )
        assess_hw = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=assignment, assigned_by=self.teacher,
        )
        self.submit(assignment, self.a, Submission.STATUS_SUBMITTED)
        AssessmentAttempt.objects.create(
            homework=assess_hw, student=self.a, status=AssessmentAttempt.STATUS_GRADED
        )
        AssessmentAttempt.objects.create(
            homework=assess_hw, student=self.b, status=AssessmentAttempt.STATUS_SUBMITTED
        )
        row = self.rates()[0]
        self.assertEqual((row["expected"], row["turned_in"]), (2, 2))

    def test_removed_students_are_in_neither_figure(self):
        gone = self.student(self.classroom, "Farrux", "Xolmatov",
                            status=ClassroomMembership.STATUS_REMOVED)
        assignment = self.homework(self.classroom, due_at=at(SUNDAY, 18))
        self.submit(assignment, gone, Submission.STATUS_SUBMITTED)
        row = self.rates()[0]
        self.assertEqual((row["expected"], row["turned_in"]), (2, 0))

    def test_the_window_is_thirty_days_back_from_now(self):
        self.homework(self.classroom, due_at=self.now - timedelta(days=29), title="Inside")
        self.homework(self.classroom, due_at=self.now - timedelta(days=31), title="Too old")
        self.assertEqual(self.rates()[0]["expected"], 2)  # one assignment × two students

    def test_homework_not_yet_due_is_not_counted_against_the_class(self):
        """Work due at tonight's lesson has not come due; counting it would read as failure."""
        self.homework(self.classroom, due_at=at(MONDAY, 18))
        self.assertEqual(self.rates(), [])

    def test_classwork_and_unpublished_work_are_not_asked_for(self):
        self.homework(self.classroom, due_at=at(SUNDAY, 18), title="Classwork",
                      category=Assignment.CATEGORY_CLASSWORK)
        self.homework(self.classroom, due_at=at(SUNDAY, 18), title="Draft",
                      status=Assignment.STATUS_DRAFT)
        self.assertEqual(self.rates(), [])

    def test_a_class_with_nothing_due_is_omitted(self):
        quiet = self.make_classroom(name="Quiet")
        self.join(quiet, self.teacher)
        self.student(quiet)
        self.homework(self.classroom, due_at=at(SUNDAY, 18))
        self.assertEqual([r["name"] for r in self.rates()], ["Math Junior 3"])


# ── §4.3: the 14-day midterm window ──────────────────────────────────────────
class UpcomingMidtermTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.now = at(MONDAY, 9)

    def schedule(self, starts_at, **kw):
        midterm = kw.pop("midterm", None) or Midterm.objects.create(
            title="September midterm", subject=Midterm.MATH, **kw
        )
        return MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=midterm, starts_at=starts_at
        )

    def titles(self):
        return [r["title"] for r in build_teacher_today(self.teacher, now=self.now)["upcoming_midterms"]]

    def test_inside_the_window(self):
        self.schedule(self.now + timedelta(days=13, hours=23))
        self.assertEqual(self.titles(), ["September midterm"])

    def test_exactly_fourteen_days_is_inside(self):
        self.schedule(self.now + timedelta(days=14))
        self.assertEqual(self.titles(), ["September midterm"])

    def test_a_minute_past_fourteen_days_is_outside(self):
        self.schedule(self.now + timedelta(days=14, minutes=1))
        self.assertEqual(self.titles(), [])

    def test_a_past_midterm_is_not_upcoming(self):
        self.schedule(self.now - timedelta(minutes=1))
        self.assertEqual(self.titles(), [])

    def test_a_schedule_without_a_start_is_skipped(self):
        self.schedule(None)
        self.assertEqual(self.titles(), [])

    def test_soonest_first(self):
        self.schedule(self.now + timedelta(days=10),
                      midterm=Midterm.objects.create(title="Later", subject=Midterm.MATH))
        self.schedule(self.now + timedelta(days=2),
                      midterm=Midterm.objects.create(title="Sooner", subject=Midterm.MATH))
        self.assertEqual(self.titles(), ["Sooner", "Later"])

    def test_the_pass_mark_is_the_midterms_effective_one(self):
        self.schedule(self.now + timedelta(days=3), pass_mark=60)
        row = build_teacher_today(self.teacher, now=self.now)["upcoming_midterms"][0]
        self.assertEqual(
            set(row),
            {"midterm_id", "title", "classroom_id", "name", "starts_at", "pass_mark"},
        )
        self.assertEqual(row["pass_mark"], 60)
        self.assertEqual(row["classroom_id"], self.classroom.id)
        self.assertEqual(row["name"], "Math Junior 3")

    def test_an_unset_pass_mark_falls_back_to_the_scale_default(self):
        self.schedule(self.now + timedelta(days=3), scoring_scale=Midterm.SCALE_800)
        self.assertEqual(
            build_teacher_today(self.teacher, now=self.now)["upcoming_midterms"][0]["pass_mark"],
            500,
        )

    def test_an_ungraded_pre_midterm_sends_null_rather_than_a_guess(self):
        self.schedule(self.now + timedelta(days=3),
                      midterm_type=Midterm.TYPE_PRE_MIDTERM, pass_mark=60)
        self.assertIsNone(
            build_teacher_today(self.teacher, now=self.now)["upcoming_midterms"][0]["pass_mark"]
        )

    def test_another_classs_midterm_is_not_mine(self):
        other = self.make_classroom(name="Not mine")
        MidtermSchedule.objects.create(
            classroom=other,
            midterm=Midterm.objects.create(title="Theirs", subject=Midterm.MATH),
            starts_at=self.now + timedelta(days=2),
        )
        self.assertEqual(self.titles(), [])


# ── shape, route and cost ────────────────────────────────────────────────────
class EndpointTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom(room_number="22")
        self.join(self.classroom, self.teacher)
        self.client = APIClient()

    def test_route_is_not_swallowed_by_the_classroom_detail_route(self):
        url = reverse("teacher-today")
        self.assertEqual(url, "/api/classes/teacher/today/")
        self.assertEqual(resolve(url).url_name, "teacher-today")

    def test_get_returns_the_documented_shape(self):
        self.student(self.classroom, "Gulnora", "Yusupova")
        hw = self.homework(self.classroom, due_at=at(MONDAY, 18))
        self.submit(hw, self.student(self.classroom), submitted_at=at(SUNDAY, 18, 44))
        # Over HTTP the window is the real calendar day, so this register is written on it.
        self.mark(self.classroom, timezone.localdate(), present=1)
        self.client.force_authenticate(self.teacher)
        resp = self.client.get("/api/classes/teacher/today/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            set(resp.data),
            {"date", "now", "next_lesson_date", "classes", "grading_queue", "stats",
             "upcoming_midterms"},
        )
        self.assertEqual(
            set(resp.data["stats"]),
            {"attendance_week", "homework_30d", "attendance_trend"},
        )
        queue = resp.data["grading_queue"][0]
        self.assertEqual(set(queue), {"classroom_id", "name", "waiting", "assignments"})
        self.assertEqual(
            set(queue["assignments"][0]),
            {"assignment_id", "title", "waiting", "students"},
        )
        self.assertEqual(
            set(queue["assignments"][0]["students"][0]), {"id", "name", "submitted_at"}
        )
        self.assertEqual(
            set(resp.data["stats"]["attendance_week"][0]),
            {"classroom_id", "name", "present", "late", "missed", "excused"},
        )
        self.assertEqual(
            set(resp.data["stats"]["attendance_trend"][0]),
            {"date", "present", "late", "missed"},
        )
        # The row shapes are asserted off the service, not the request: whether there is a
        # lesson over HTTP depends on the real calendar day, and a test must not.
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(
            set(payload["classes"][0]),
            {"classroom_id", "name", "subject", "room", "lesson_days", "lesson_days_label",
             "lesson_time", "student_count", "next_lesson_at", "state", "homework"},
        )
        self.assertEqual(
            set(payload["classes"][0]["homework"]),
            {"assignment_id", "title", "turned_in", "missing", "missing_students"},
        )

    def test_the_stats_blocks_have_the_documented_row_shape(self):
        self.student(self.classroom, "Gulnora", "Yusupova")
        self.homework(self.classroom, due_at=at(SUNDAY, 18))
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(
            set(payload["stats"]["homework_30d"][0]),
            {"classroom_id", "name", "expected", "turned_in"},
        )

    def test_anonymous_is_refused(self):
        self.assertIn(self.client.get("/api/classes/teacher/today/").status_code, (401, 403))

    def test_the_endpoint_writes_nothing(self):
        before = (
            Submission.objects.count(),
            Assignment.objects.count(),
            ClassroomMembership.objects.count(),
            MidtermSchedule.objects.count(),
            AttendanceSession.objects.count(),
            AttendanceRecord.objects.count(),
        )
        self.client.force_authenticate(self.teacher)
        self.client.get("/api/classes/teacher/today/")
        self.assertEqual(
            before,
            (
                Submission.objects.count(),
                Assignment.objects.count(),
                ClassroomMembership.objects.count(),
                MidtermSchedule.objects.count(),
                AttendanceSession.objects.count(),
                AttendanceRecord.objects.count(),
            ),
        )

    def test_the_query_count_does_not_grow_with_the_number_of_classes(self):
        """Bounded, not N+1: four classes with data of every kind cost what one costs."""
        def cost():
            with CaptureQueriesContext(connection) as ctx:
                build_teacher_today(self.teacher, now=at(MONDAY, 9))
            return len(ctx)

        def fill(classroom, tag):
            self.student(classroom)
            self.submit(
                self.homework(classroom, due_at=at(MONDAY, 18)), self.student(classroom)
            )
            self.submit(  # inside the 30-day window, so that block reads all three queries
                self.homework(classroom, due_at=at(SUNDAY, 18), title="Past set"),
                self.student(classroom),
                submitted_at=at(SUNDAY, 19),
            )
            self.mark(classroom, MONDAY, present=1, missed=1)
            MidtermSchedule.objects.create(
                classroom=classroom,
                midterm=Midterm.objects.create(title=f"MT {tag}", subject=Midterm.MATH),
                starts_at=at(WEDNESDAY, 10),
            )

        fill(self.classroom, "first")
        one = cost()
        for i in range(3):
            extra = self.make_classroom(name=f"Extra {i}")
            self.join(extra, self.teacher)
            fill(extra, i)
        self.assertEqual(cost(), one)
        self.assertLessEqual(one, 12)

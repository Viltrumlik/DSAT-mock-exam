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
from classes.models_schedule import MidtermSchedule
from classes.teacher_today import build_teacher_today

User = get_user_model()

SUNDAY = date(2026, 9, 20)
MONDAY = date(2026, 9, 21)
TUESDAY = date(2026, 9, 22)
WEDNESDAY = date(2026, 9, 23)


def at(day: date, hour: int = 9, minute: int = 0):
    """An aware datetime on ``day``, in the platform's own (Asia/Tashkent) timezone."""
    return timezone.make_aware(
        datetime.combine(day, time(hour, minute)), timezone.get_current_timezone()
    )


class TeacherTodayFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("tt_teacher@t.com", "secret123")
        self.outsider = User.objects.create_user("tt_outsider@t.com", "secret123")
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
            f"tt_s{self._seq}@t.com", "secret123", first_name=first, last_name=last
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

    def submit(self, assignment, student, status=Submission.STATUS_SUBMITTED):
        return Submission.objects.create(
            assignment=assignment, student=student, status=status
        )

    def lesson_row(self, payload, classroom):
        rows = [r for r in payload["lessons"] if r["classroom_id"] == classroom.id]
        return rows[0] if rows else None


# ── §5: membership scoping ───────────────────────────────────────────────────
class MembershipScopingTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.student(self.classroom)
        hw = self.homework(self.classroom, due_at=at(MONDAY, 18))
        self.submit(hw, self.student(self.classroom))
        MidtermSchedule.objects.create(
            classroom=self.classroom,
            midterm=Midterm.objects.create(title="September midterm", subject=Midterm.MATH),
            starts_at=at(WEDNESDAY, 10),
        )

    def test_staff_member_sees_their_class(self):
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual([r["name"] for r in payload["lessons"]], ["Math Junior 3"])
        self.assertEqual([r["name"] for r in payload["waiting_to_check"]], ["Math Junior 3"])
        self.assertEqual([r["title"] for r in payload["upcoming_midterms"]], ["September midterm"])

    def test_staff_non_member_gets_nothing_of_a_class_they_are_not_in(self):
        """Being staff somewhere is not being staff here: only their own class comes back."""
        other = self.make_classroom(name="Someone else's class")
        self.join(other, self.outsider)
        hw = self.homework(other, due_at=at(MONDAY, 18))
        self.submit(hw, self.student(other))
        MidtermSchedule.objects.create(
            classroom=other,
            midterm=Midterm.objects.create(title="Their midterm", subject=Midterm.MATH),
            starts_at=at(WEDNESDAY, 10),
        )
        payload = build_teacher_today(self.outsider, now=at(MONDAY, 9))
        self.assertEqual([r["name"] for r in payload["lessons"]], ["Someone else's class"])
        self.assertEqual([r["name"] for r in payload["waiting_to_check"]], ["Someone else's class"])
        self.assertEqual([r["title"] for r in payload["upcoming_midterms"]], ["Their midterm"])
        self.assertNotIn(self.classroom.id, [r["classroom_id"] for r in payload["lessons"]])

    def test_no_membership_at_all_gets_nothing(self):
        payload = build_teacher_today(self.outsider, now=at(MONDAY, 9))
        self.assertEqual(payload["lessons"], [])
        self.assertEqual(payload["waiting_to_check"], [])
        self.assertEqual(payload["upcoming_midterms"], [])

    def test_student_membership_is_not_staff(self):
        self.join(self.classroom, self.outsider, ClassroomMembership.ROLE_STUDENT)
        payload = build_teacher_today(self.outsider, now=at(MONDAY, 9))
        self.assertEqual(payload["lessons"], [])
        self.assertEqual(payload["waiting_to_check"], [])

    def test_removed_staff_membership_is_not_scope(self):
        ta = User.objects.create_user("tt_ex_ta@t.com", "secret123")
        self.join(self.classroom, ta, ClassroomMembership.ROLE_TA,
                  status=ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(build_teacher_today(ta, now=at(MONDAY, 9))["lessons"], [])

    def test_ta_membership_is_staff(self):
        ta = User.objects.create_user("tt_ta@t.com", "secret123")
        self.join(self.classroom, ta, ClassroomMembership.ROLE_TA)
        self.assertEqual(
            [r["name"] for r in build_teacher_today(ta, now=at(MONDAY, 9))["lessons"]],
            ["Math Junior 3"],
        )

    def test_deactivated_class_is_off_the_desk(self):
        self.classroom.is_active = False
        self.classroom.save(update_fields=["is_active"])
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(payload["lessons"], [])
        self.assertEqual(payload["waiting_to_check"], [])
        self.assertEqual(payload["upcoming_midterms"], [])


# ── §4.1: ODD / EVEN, and Sunday belonging to neither ────────────────────────
class WeekdayMappingTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.odd = self.make_classroom(name="Odd class", days=Classroom.DAYS_ODD)
        self.even = self.make_classroom(name="Even class", days=Classroom.DAYS_EVEN)
        self.join(self.odd, self.teacher)
        self.join(self.even, self.teacher)

    def names_on(self, day):
        return [r["name"] for r in build_teacher_today(self.teacher, now=at(day, 9))["lessons"]]

    def test_odd_meets_monday_wednesday_friday(self):
        for day in (MONDAY, WEDNESDAY, date(2026, 9, 25)):
            self.assertEqual(self.names_on(day), ["Odd class"], day.isoformat())

    def test_even_meets_tuesday_thursday_saturday(self):
        for day in (TUESDAY, date(2026, 9, 24), date(2026, 9, 26)):
            self.assertEqual(self.names_on(day), ["Even class"], day.isoformat())

    def test_sunday_belongs_to_neither(self):
        self.assertEqual(self.names_on(SUNDAY), [])

    def test_date_is_the_callers_local_date(self):
        payload = build_teacher_today(self.teacher, now=at(SUNDAY, 23, 30))
        self.assertEqual(payload["date"], "2026-09-20")


# ── the coordinator's addition: next_lesson_date ─────────────────────────────
class NextLessonDateTests(TeacherTodayFixture):
    def test_all_odd_classes_asked_on_sunday_get_the_coming_monday(self):
        classroom = self.make_classroom(name="Odd class", days=Classroom.DAYS_ODD)
        self.join(classroom, self.teacher)
        payload = build_teacher_today(self.teacher, now=at(SUNDAY, 9))
        self.assertEqual(payload["lessons"], [])
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


# ── §7: an unreadable lesson_time is listed, never dropped ───────────────────
class LessonTimeTests(TeacherTodayFixture):
    def test_blank_time_still_listed(self):
        classroom = self.make_classroom(name="No time", lesson_time="")
        self.join(classroom, self.teacher)
        row = self.lesson_row(build_teacher_today(self.teacher, now=at(MONDAY, 9)), classroom)
        self.assertIsNotNone(row)
        self.assertIsNone(row["lesson_time"])

    def test_garbage_time_still_listed(self):
        classroom = self.make_classroom(name="Garbage time", lesson_time="sometime after lunch")
        self.join(classroom, self.teacher)
        row = self.lesson_row(build_teacher_today(self.teacher, now=at(MONDAY, 9)), classroom)
        self.assertIsNotNone(row)
        self.assertIsNone(row["lesson_time"])

    def test_time_comes_from_parse_lesson_time(self):
        """A range and a 12-hour clock both resolve through lesson_schedule, not a local copy."""
        ranged = self.make_classroom(name="Ranged", lesson_time="08:00-10:00")
        pm = self.make_classroom(name="Evening", lesson_time="4:00 PM")
        self.join(ranged, self.teacher)
        self.join(pm, self.teacher)
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(self.lesson_row(payload, ranged)["lesson_time"], "08:00")
        self.assertEqual(self.lesson_row(payload, pm)["lesson_time"], "16:00")

    def test_untimed_class_sorts_after_the_timed_ones(self):
        late = self.make_classroom(name="Late", lesson_time="18:00")
        early = self.make_classroom(name="Early", lesson_time="09:00")
        untimed = self.make_classroom(name="Untimed", lesson_time="")
        for c in (late, early, untimed):
            self.join(c, self.teacher)
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual([r["name"] for r in payload["lessons"]], ["Early", "Late", "Untimed"])


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
        return self.lesson_row(
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


# ── §4.2: waiting to be checked ──────────────────────────────────────────────
class WaitingToCheckTests(TeacherTodayFixture):
    def setUp(self):
        super().setUp()
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.hw = self.homework(self.classroom, due_at=at(MONDAY, 18))

    def counts(self, now=None):
        payload = build_teacher_today(self.teacher, now=now or at(MONDAY, 9))
        return {r["name"]: r["count"] for r in payload["waiting_to_check"]}

    def test_only_submitted_work_is_waiting(self):
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_REVIEWED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_RETURNED)
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_DRAFT)
        self.assertEqual(self.counts(), {"Math Junior 3": 2})

    def test_a_class_with_nothing_waiting_is_omitted(self):
        self.assertEqual(self.counts(), {})

    def test_it_does_not_depend_on_there_being_a_lesson_today(self):
        self.submit(self.hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        self.assertEqual(self.counts(now=at(SUNDAY, 9)), {"Math Junior 3": 1})

    def test_removed_students_work_is_not_on_the_desk(self):
        gone = self.student(self.classroom, status=ClassroomMembership.STATUS_REMOVED)
        self.submit(self.hw, gone, Submission.STATUS_SUBMITTED)
        self.assertEqual(self.counts(), {})

    def test_newest_first(self):
        other = self.make_classroom(name="Older class")
        self.join(other, self.teacher)
        older_hw = self.homework(other, due_at=at(MONDAY, 18))
        old = self.submit(older_hw, self.student(other), Submission.STATUS_SUBMITTED)
        Submission.objects.filter(pk=old.pk).update(updated_at=at(MONDAY, 1))
        new = self.submit(self.hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        Submission.objects.filter(pk=new.pk).update(updated_at=at(MONDAY, 8))
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(
            [r["name"] for r in payload["waiting_to_check"]], ["Math Junior 3", "Older class"]
        )


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
        self.classroom = self.make_classroom()
        self.join(self.classroom, self.teacher)
        self.client = APIClient()

    def test_route_is_not_swallowed_by_the_classroom_detail_route(self):
        url = reverse("teacher-today")
        self.assertEqual(url, "/api/classes/teacher/today/")
        self.assertEqual(resolve(url).url_name, "teacher-today")

    def test_get_returns_the_documented_shape(self):
        self.student(self.classroom, "Gulnora", "Yusupova")
        hw = self.homework(self.classroom, due_at=at(MONDAY, 18))
        self.submit(hw, self.student(self.classroom), Submission.STATUS_SUBMITTED)
        self.client.force_authenticate(self.teacher)
        resp = self.client.get("/api/classes/teacher/today/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            set(resp.data),
            {"date", "next_lesson_date", "lessons", "waiting_to_check", "upcoming_midterms"},
        )
        self.assertEqual(
            set(resp.data["waiting_to_check"][0]), {"classroom_id", "name", "count"}
        )
        # The row shapes are asserted off the service, not the request: whether there is a
        # lesson over HTTP depends on the real calendar day, and a test must not.
        payload = build_teacher_today(self.teacher, now=at(MONDAY, 9))
        self.assertEqual(
            set(payload["lessons"][0]),
            {"classroom_id", "name", "subject", "lesson_time", "student_count", "homework"},
        )
        self.assertEqual(
            set(payload["lessons"][0]["homework"]),
            {"assignment_id", "title", "turned_in", "missing", "missing_students"},
        )

    def test_anonymous_is_refused(self):
        self.assertIn(self.client.get("/api/classes/teacher/today/").status_code, (401, 403))

    def test_the_endpoint_writes_nothing(self):
        before = (
            Submission.objects.count(),
            Assignment.objects.count(),
            ClassroomMembership.objects.count(),
            MidtermSchedule.objects.count(),
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
            ),
        )

    def test_the_query_count_does_not_grow_with_the_number_of_classes(self):
        """Bounded, not N+1: four classes with data cost what one costs."""
        def cost():
            with CaptureQueriesContext(connection) as ctx:
                build_teacher_today(self.teacher, now=at(MONDAY, 9))
            return len(ctx)

        self.student(self.classroom)
        self.submit(
            self.homework(self.classroom, due_at=at(MONDAY, 18)),
            self.student(self.classroom),
        )
        one = cost()
        for i in range(3):
            extra = self.make_classroom(name=f"Extra {i}")
            self.join(extra, self.teacher)
            self.student(extra)
            self.submit(
                self.homework(extra, due_at=at(MONDAY, 18)), self.student(extra)
            )
            MidtermSchedule.objects.create(
                classroom=extra,
                midterm=Midterm.objects.create(title=f"MT {i}", subject=Midterm.MATH),
                starts_at=at(WEDNESDAY, 10),
            )
        self.assertEqual(cost(), one)
        self.assertLessEqual(one, 7)

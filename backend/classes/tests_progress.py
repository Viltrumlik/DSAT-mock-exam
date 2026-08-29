"""My Progress — attendance and homework, combined, per level.

The three things most likely to be got wrong, and are therefore the reason this file exists:

  * a rate over an EMPTY denominator must be ``None``, never 0 — "we don't know" and "you
    have done none of it" are different sentences and only one of them is fair to a student
    whose course has not started;
  * attendance must NOT be gated on FINALIZED sessions, because production has never
    finalized one and the gate silently reduces a "combined" score to homework-only;
  * EXCUSED leaves the denominator rather than counting as an absence.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.progress import combined_rate, student_progress

User = get_user_model()


class ProgressFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("pg_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.student = User.objects.create_user("pg_student@t.com", "secret123")
        self.junior = self._classroom("Maths junior", Classroom.LEVEL_JUNIOR)
        self._enrol(self.junior)

    def _classroom(self, name, level, subject=Classroom.SUBJECT_MATH):
        return Classroom.objects.create(
            name=name, subject=subject, level=level,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )

    def _enrol(self, classroom, student=None):
        return ClassroomMembership.objects.create(
            classroom=classroom, user=student or self.student,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )

    def _mark(self, classroom, *statuses, finalized=False):
        """One session per status, marked for this student."""
        for i, status in enumerate(statuses):
            session = AttendanceSession.objects.create(
                classroom=classroom,
                date=date(2026, 3, 1) + timedelta(days=i),
                status=(
                    AttendanceSession.STATUS_FINALIZED if finalized
                    else AttendanceSession.STATUS_OPEN
                ),
                created_by=self.admin,
            )
            AttendanceRecord.objects.create(
                session=session, student=self.student, status=status
            )

    def _homework(self, classroom, count, completed, *, status=Assignment.STATUS_PUBLISHED):
        made = []
        for i in range(count):
            assignment = Assignment.objects.create(
                classroom=classroom, title=f"HW {i}", status=status,
                category=Assignment.CATEGORY_HOMEWORK, created_by=self.admin,
            )
            made.append(assignment)
        for assignment in made[:completed]:
            Submission.objects.create(
                assignment=assignment, student=self.student,
                status=Submission.STATUS_SUBMITTED,
            )
        return made

    def level_row(self, level=Classroom.LEVEL_JUNIOR, subject="math"):
        payload = student_progress(self.student)
        track = [t for t in payload["tracks"] if t["subject"] == subject][0]
        return [lv for lv in track["levels"] if lv["level"] == level][0]


class CombinedRateTests(TestCase):
    """The formula on its own — no database, the way `compute_attendance_score` is tested."""

    def test_both_halves_average(self):
        self.assertEqual(combined_rate(90, 70), (80.0, ["attendance", "homework"]))

    def test_one_half_is_that_half_and_says_so(self):
        """Averaging a known 90 with an unknown treated as 0 would invent a 45."""
        self.assertEqual(combined_rate(90, None), (90.0, ["attendance"]))
        self.assertEqual(combined_rate(None, 70), (70.0, ["homework"]))

    def test_neither_half_is_none_not_zero(self):
        self.assertEqual(combined_rate(None, None), (None, []))

    def test_a_genuine_zero_survives(self):
        """0% attended is a real measurement and must not be read as 'no data'."""
        self.assertEqual(combined_rate(0, 0), (0.0, ["attendance", "homework"]))


class AttendanceHalfTests(ProgressFixture):
    def test_open_sessions_count(self):
        """THE one that decides whether this feature shows a number at all.

        Production has 111 attendance sessions and has never finalized one. `rewards.hooks`
        and `rewards.strikes` both dropped the same gate after measuring exactly that; if
        this kept it, every student in the school would see an em dash while their teacher
        looks at a register full of marks.
        """
        self._mark(self.junior, AttendanceRecord.STATUS_PRESENT, AttendanceRecord.STATUS_PRESENT)
        self.assertEqual(self.level_row()["attendance"]["rate"], 100.0)

    def test_late_is_worth_half(self):
        self._mark(self.junior, AttendanceRecord.STATUS_PRESENT, AttendanceRecord.STATUS_LATE)
        self.assertEqual(self.level_row()["attendance"]["rate"], 75.0)

    def test_excused_leaves_the_denominator(self):
        """Counting a sanctioned absence as an absence punishes the student for having a
        reason. Two PRESENT and one EXCUSED is 100%, not 66.7%."""
        self._mark(
            self.junior,
            AttendanceRecord.STATUS_PRESENT,
            AttendanceRecord.STATUS_PRESENT,
            AttendanceRecord.STATUS_EXCUSED,
        )
        row = self.level_row()
        self.assertEqual(row["attendance"]["rate"], 100.0)
        self.assertEqual(row["attendance"]["counted"], 2)
        self.assertEqual(row["attendance"]["excused"], 1)

    def test_no_register_is_none_not_zero(self):
        self.assertIsNone(self.level_row()["attendance"])


class HomeworkHalfTests(ProgressFixture):
    def test_completion_is_measured_against_published_work(self):
        self._homework(self.junior, count=4, completed=3)
        self.assertEqual(self.level_row()["homework"], {"rate": 75.0, "completed": 3, "total": 4})

    def test_draft_homework_is_not_counted(self):
        self._homework(self.junior, count=2, completed=2)
        self._homework(self.junior, count=5, completed=0, status=Assignment.STATUS_DRAFT)
        self.assertEqual(self.level_row()["homework"]["total"], 2)

    def test_no_homework_set_is_none_not_zero(self):
        self.assertIsNone(self.level_row()["homework"])


class LevelLadderTests(ProgressFixture):
    def test_the_level_the_student_is_in_is_marked_current(self):
        self.assertEqual(self.level_row()["state"], "current")

    def test_a_finished_level_keeps_its_numbers(self):
        """The reason this reaches back through every membership rather than only the
        current one: "how did each level go" is a question about levels already left."""
        self._mark(self.junior, AttendanceRecord.STATUS_PRESENT)
        self._homework(self.junior, count=2, completed=1)
        middle = self._classroom("Maths middle", Classroom.LEVEL_MIDDLE)
        self._enrol(middle)

        junior = self.level_row(Classroom.LEVEL_JUNIOR)
        self.assertEqual(junior["state"], "done")
        self.assertEqual(junior["overall"], 75.0)          # 100 attendance, 50 homework
        self.assertEqual(self.level_row(Classroom.LEVEL_MIDDLE)["state"], "current")

    def test_a_level_above_theirs_is_upcoming_with_no_numbers(self):
        row = self.level_row(Classroom.LEVEL_SENIOR)
        self.assertEqual(row["state"], "upcoming")
        self.assertIsNone(row["overall"])

    def test_a_level_they_skipped_is_not_recorded_rather_than_zero(self):
        """A student who joined at Middle never sat Foundation here. Reporting 0% would
        blame them for a course nobody ran."""
        middle = self._classroom("Maths middle", Classroom.LEVEL_MIDDLE)
        self._enrol(middle)
        row = self.level_row(Classroom.LEVEL_FOUNDATION)
        self.assertEqual(row["state"], "not-recorded")
        self.assertIsNone(row["overall"])

    def test_english_has_no_foundation_rung(self):
        english = self._classroom("English junior", Classroom.LEVEL_JUNIOR, Classroom.SUBJECT_ENGLISH)
        self._enrol(english)
        payload = student_progress(self.student)
        track = [t for t in payload["tracks"] if t["subject"] == "english"][0]
        self.assertNotIn(Classroom.LEVEL_FOUNDATION, [lv["level"] for lv in track["levels"]])

    def test_a_subject_the_student_does_not_study_is_left_out(self):
        payload = student_progress(self.student)
        self.assertEqual([t["subject"] for t in payload["tracks"]], ["math"])

    def test_a_removed_membership_is_ignored(self):
        senior = self._classroom("Maths senior", Classroom.LEVEL_SENIOR)
        membership = self._enrol(senior)
        membership.status = ClassroomMembership.STATUS_REMOVED
        membership.save(update_fields=["status"])
        self.assertEqual(self.level_row(Classroom.LEVEL_SENIOR)["state"], "upcoming")

    def test_the_headline_averages_only_the_levels_with_a_number(self):
        """An untaught rung must not drag the headline down as though a course was failed."""
        self._mark(self.junior, AttendanceRecord.STATUS_PRESENT)
        self._homework(self.junior, count=2, completed=1)
        self.assertEqual(student_progress(self.student)["overall"], 75.0)

    def test_a_student_in_nothing_gets_an_empty_payload_not_a_crash(self):
        nobody = User.objects.create_user("pg_nobody@t.com", "secret123")
        payload = student_progress(nobody)
        self.assertEqual(payload["tracks"], [])
        self.assertIsNone(payload["overall"])


class ProgressEndpointTests(ProgressFixture):
    def test_the_endpoint_serves_the_students_own_progress(self):
        self._mark(self.junior, AttendanceRecord.STATUS_PRESENT)
        self.client.force_authenticate(self.student)
        r = self.client.get("/api/classes/progress/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["tracks"][0]["subject"], "math")
        self.assertEqual(r.json()["weights"], {"attendance": 0.5, "homework": 0.5})

    def test_it_needs_a_login(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/classes/progress/").status_code, (401, 403))
